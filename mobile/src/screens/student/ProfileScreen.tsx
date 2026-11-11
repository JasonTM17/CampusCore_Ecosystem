import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  DataNotice,
  Dialog,
  Field,
  IdentityHeader,
  ListRow,
  SectionCard,
  ScreenShell,
  ScreenSpacer,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { apiClient, campusApi, type AuthUser } from '../../api/client';
import { chromeFor } from '../../design/chrome';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { formatDate } from '../../i18n/locale';
import { useLocale } from '../../i18n/locale-provider';
import type { MobileScreenProps } from '../../navigation/types';
import { SecureField } from '../account/SecureField';
import { SignOutDialog } from '../account/SignOutDialog';
import { LanguageSetting } from '../account/LanguageSetting';
import { ThemeSetting } from '../account/ThemeSetting';
import { TwoFactorCard } from '../account/TwoFactorCard';
import { classifyError, errorMessage } from '../account/account-errors';
import { setExitNotice, type ExitNotice } from '../account/exit-notice';
import { checkPasswordPolicy } from '../account/password-policy';
import type { TwoFactorAction } from '../account/two-factor-flow';
import { ProfilePhotoControls } from '../account/ProfilePhotoControls';
import { profileAvatarDirty } from '../account/profile-avatar-model';
import { readPickedProfileAvatar } from '../account/profile-avatar-io';
import { useAccountCopy } from '../account/use-account-copy';
import { getFileAdapter } from '../../files/file-adapter';
import { parseConduct } from '../content/records-model';
import { useStudentStyles } from './shared/styles';

/** Fields the profile endpoint returns beyond the shared `AuthUser` shape. */
type AccountProfile = AuthUser & { phone?: string | null; address?: string | null; dateOfBirth?: string | null };

/**
 * Office student code (MSSV). `/auth/me` `studentId` is the profile key
 * (`student-profile`), which must never be printed as the student number.
 * The conduct summary's `studentCode` is the column the web shows.
 */
function officeStudentCode(value: string | null | undefined): string | undefined {
  const code = value?.trim() ?? '';
  if (!code || code === 'null' || code === 'undefined') return undefined;
  if (code === 'student-profile' || code.startsWith('student-profile-')) return undefined;
  return code;
}

const PHONE_PATTERN = /^$|^\+?[0-9][0-9\s()./-]{4,78}$/;

export function ProfileScreen({ navigation, role }: MobileScreenProps) {
  const styles = useStudentStyles();
  const { colors, scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const copy = useAccountCopy();
  const { locale } = useLocale();
  const isLive = apiClient.mode === 'live';
  const {
    data: account,
    error,
    warning,
    isLoading,
    reload,
  } = useScreenQuery<AccountProfile | null>('profile', () => campusApi.profile(), {
    enabled: isLive,
    scope: { locale: 'neutral' },
    errorMessage: copy.errors.unknown,
    mapError: (failure) => errorMessage(classifyError(failure), copy.errors),
  });
  const conduct = useScreenQuery<unknown>(
    'profile.student-code',
    () => apiClient.get<unknown>('/conduct/my'),
    {
      enabled: isLive && role === 'student',
      scope: { locale: 'neutral' },
      errorMessage: copy.errors.unknown,
      mapError: (failure) => errorMessage(classifyError(failure), copy.errors),
    },
  );
  const accountRef = useRef(account);
  accountRef.current = account;
  const seededAccountId = useRef<string | null | undefined>(undefined);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const phoneRef = useRef(phone);
  const addressRef = useRef(address);
  const seededPhoneRef = useRef<string | null>(null);
  const seededAddressRef = useRef<string | null>(null);
  const profileSaveFlight = useRef(false);
  const signOutFlight = useRef(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileMessage, setProfileMessage] = useState<{ text: string; kind: 'error' | 'success' } | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const savingPasswordRef = useRef(false);
  const [confirmPasswordChange, setConfirmPasswordChange] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState('');
  const avatarPreviewRef = useRef(avatarPreview);
  avatarPreviewRef.current = avatarPreview;
  const seededAvatarRef = useRef<string | null>(null);
  const photoPickFlight = useRef(false);

  const updatePhone = (value: string) => {
    phoneRef.current = value;
    setPhone(value);
    setProfileMessage(null);
  };
  const updateAddress = (value: string) => {
    addressRef.current = value;
    setAddress(value);
    setProfileMessage(null);
  };

  useEffect(() => {
    const currentAccount = accountRef.current;
    const accountId = currentAccount?.id ?? null;
    const isNewAccount = seededAccountId.current !== accountId;
    seededAccountId.current = accountId;

    const nextPhone = currentAccount?.phone ?? '';
    const nextAddress = currentAccount?.address ?? '';

    if (isNewAccount || phoneRef.current === seededPhoneRef.current) {
      phoneRef.current = nextPhone;
      seededPhoneRef.current = nextPhone;
      setPhone(nextPhone);
    }
    if (isNewAccount || addressRef.current === seededAddressRef.current) {
      addressRef.current = nextAddress;
      seededAddressRef.current = nextAddress;
      setAddress(nextAddress);
    }
  }, [account?.id, account?.phone, account?.address]);

  useEffect(() => {
    const saved = account?.avatar ?? '';
    if (seededAvatarRef.current === null || seededAvatarRef.current !== saved || avatarPreviewRef.current === seededAvatarRef.current) {
      seededAvatarRef.current = saved;
      avatarPreviewRef.current = saved;
      setAvatarPreview(saved);
    }
  }, [account?.avatar, account?.id]);

  const endSession = useCallback(
    (notice: ExitNotice) => {
      if (signOutFlight.current) return;
      signOutFlight.current = true;
      setExitNotice(notice);
      navigation.signOut();
    },
    [navigation],
  );

  const handleTwoFactorDone = useCallback(
    (action: TwoFactorAction) => endSession(action === 'enable' ? 'twoFactorEnabled' : 'twoFactorDisabled'),
    [endSession],
  );

  const pickProfilePhoto = async () => {
    if (photoPickFlight.current || !isLive) return;
    const adapter = getFileAdapter();
    if (!adapter.capability('pick').available) return;
    photoPickFlight.current = true;
    let release: (() => void) | undefined;
    try {
      const result = await adapter.pick({
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      });
      if (result.status === 'cancelled') return;
      if (result.status !== 'picked') {
        setProfileMessage({ text: copy.profile.photoUploadFailed, kind: 'error' });
        return;
      }
      release = result.file.release;
      const read = await readPickedProfileAvatar(result.file);
      if (!read.ok) {
        setProfileMessage({ text: copy.profile.photoUploadFailed, kind: 'error' });
        return;
      }
      setProfileMessage(null);
      setAvatarPreview(read.dataUrl);
    } finally {
      release?.();
      photoPickFlight.current = false;
    }
  };

  const removeProfilePhoto = () => {
    setProfileMessage(null);
    setAvatarPreview('');
  };

  const saveProfile = async () => {
    if (profileSaveFlight.current) return;
    setProfileMessage(null);
    const submittedPhone = phone.trim();
    const submittedAddress = address.trim();
    if (!PHONE_PATTERN.test(submittedPhone)) {
      setProfileMessage({ text: copy.profile.phoneInvalid, kind: 'error' });
      return;
    }
    if (submittedAddress.length > 500) {
      setProfileMessage({ text: copy.profile.addressTooLong, kind: 'error' });
      return;
    }
    profileSaveFlight.current = true;
    setIsSavingProfile(true);
    try {
      await campusApi.updateProfile({ phone: submittedPhone, address: submittedAddress, avatar: avatarPreview });
      if (phoneRef.current === phone) {
        seededPhoneRef.current = submittedPhone;
        updatePhone(submittedPhone);
      }
      if (addressRef.current === address) {
        seededAddressRef.current = submittedAddress;
        updateAddress(submittedAddress);
      }
      setProfileMessage({ text: copy.profile.saved, kind: 'success' });
      void reload();
    } catch (failure) {
      setProfileMessage({ text: errorMessage(classifyError(failure), copy.errors), kind: 'error' });
    } finally {
      profileSaveFlight.current = false;
      setIsSavingProfile(false);
    }
  };

  const validatePassword = () => {
    setPasswordMessage(null);
    if (!oldPassword) {
      setPasswordMessage(copy.password.currentRequired);
      return false;
    }
    if (newPassword.length < 8) {
      setPasswordMessage(copy.errors.codes.PASSWORD_TOO_SHORT);
      return false;
    }
    const issue = checkPasswordPolicy(newPassword, {
      email: account?.email,
      currentPassword: oldPassword,
      confirmPassword,
    });
    if (issue) {
      setPasswordMessage(copy.errors.codes[issue]);
      return false;
    }
    return true;
  };

  const updatePassword = async () => {
    if (savingPasswordRef.current) return;
    savingPasswordRef.current = true;
    setConfirmPasswordChange(false);
    setIsSavingPassword(true);
    try {
      await campusApi.changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      // The server ends every session on a password change.
      endSession('passwordChanged');
    } catch (failure) {
      setPasswordMessage(errorMessage(classifyError(failure), copy.errors));
    } finally {
      savingPasswordRef.current = false;
      setIsSavingPassword(false);
    }
  };

  const roleLabel = role === 'lecturer' ? copy.profile.roleLecturer : role === 'admin' ? copy.profile.roleAdmin : copy.profile.roleStudent;
  const displayName = !isLive
    ? 'Nguyễn Đức Minh'
    : [account?.lastName, account?.firstName].filter(Boolean).join(' ') || roleLabel;
  const displayEmail = !isLive ? 'minh.nguyen@ute.edu.vn' : account?.email ?? '—';
  const studentCode = role === 'student' ? officeStudentCode(parseConduct(conduct.data)?.studentCode) : undefined;
  const photoPickAvailable = isLive && getFileAdapter().capability('pick').available;
  const avatarDirty = isLive && profileAvatarDirty(avatarPreview, account?.avatar);
  const heroImageUrl = isLive ? avatarPreview || undefined : undefined;
  const displayId = !isLive
    ? '2022SE0417'
    : role === 'lecturer'
      ? (account?.lecturerId ?? '—')
      : role === 'student'
        ? studentCode
        : (account?.studentId ?? '—');

  if (isLoading || error) {
    return (
      <ScreenShell title={copy.profile.title} eyebrow={copy.profile.eyebrow} subtitle={copy.profile.description}>
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? copy.profile.loading : copy.profile.errorTitle}
          description={error ?? undefined}
          actionLabel={error ? copy.common.retry : undefined}
          onAction={error ? () => void reload() : undefined}
        />
        <ScreenSpacer />
        <LanguageSetting />
        <ScreenSpacer />
        <ThemeSetting />
        <ScreenSpacer />
        <Button icon="logout" label={copy.signOut.button} onPress={() => setConfirmSignOut(true)} variant="destructive" style={styles.signOut} />
        <SignOutDialog
          visible={confirmSignOut}
          onConfirm={() => {
            setConfirmSignOut(false);
            endSession('signedOut');
          }}
          onCancel={() => setConfirmSignOut(false)}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title={copy.profile.title} eyebrow={copy.profile.eyebrow} subtitle={copy.profile.description}>
      {warning ? <View style={profileStyles.notice}><DataNotice message={warning} /></View> : null}
      <Card style={[styles.profileHero, { backgroundColor: chrome.surface, borderColor: colors.outlineVariant }]}>
        <IdentityHeader
          chips={[isLive ? roleLabel : `${roleLabel} · ${copy.profile.preview}`]}
          imageUrl={heroImageUrl}
          name={displayName}
          onBrand
          role={role === 'admin' ? 'admin' : role === 'lecturer' ? 'lecturer' : 'student'}
          roleLabel={roleLabel}
          subtitle={displayId}
        />
        {isLive ? (
          <ProfilePhotoControls
            copy={copy.profile}
            disabled={isSavingProfile}
            onPick={() => void pickProfilePhoto()}
            onRemove={removeProfilePhoto}
            pickAvailable={photoPickAvailable}
            showRemove={!!avatarPreview}
            unsaved={avatarDirty}
          />
        ) : null}
      </Card>
      <ScreenSpacer />
      <SectionCard title={copy.profile.sectionDetails} icon="card-account-details-outline">
        {isLive ? (
          <>
            {account?.firstName ? (
              <Field label={copy.profile.firstName} value={account.firstName} editable={false} multiline={false} />
            ) : null}
            {account?.lastName ? (
              <Field label={copy.profile.lastName} value={account.lastName} editable={false} multiline={false} />
            ) : null}
            <Field label={copy.profile.email} value={displayEmail} editable={false} multiline={false} />
            <Field label={copy.profile.phone} value={phone} onChangeText={updatePhone} keyboardType="phone-pad" autoComplete="tel" editable={!isSavingProfile} maxLength={80} />
            <Field label={copy.profile.dateOfBirth} value={formatDate(account?.dateOfBirth, locale)} editable={false} multiline={false} />
            <Field label={copy.profile.address} value={address} onChangeText={updateAddress} autoComplete="street-address" editable={!isSavingProfile} maxLength={500} />
            {profileMessage?.kind === 'error' ? (
              <View accessible accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.cardCopy}>
                <UiText variant="bodySmall" tone="error">{profileMessage.text}</UiText>
              </View>
            ) : profileMessage ? (
              <UiText accessibilityLiveRegion="polite" variant="bodySmall" style={styles.cardCopy}>{profileMessage.text}</UiText>
            ) : null}
            <Button
              label={isSavingProfile ? copy.profile.saving : copy.profile.save}
              disabled={isSavingProfile}
              loading={isSavingProfile}
              onPress={() => void saveProfile()}
            />
          </>
        ) : (
          <ListRow icon="email-outline" title={copy.profile.email} subtitle={displayEmail} />
        )}
      </SectionCard>
      {isLive ? (
        <>
          <ScreenSpacer />
          <SectionCard title={copy.password.title} icon="lock-outline">
            <UiText variant="bodySmall" tone="muted" style={styles.cardCopy}>{copy.password.description}</UiText>
            <SecureField
              label={copy.password.current}
              value={oldPassword}
              onChangeText={setOldPassword}
              autoComplete="current-password"
              editable={!isSavingPassword}
              showLabel={copy.common.showPassword}
              hideLabel={copy.common.hidePassword}
            />
            <SecureField
              label={copy.password.next}
              value={newPassword}
              onChangeText={setNewPassword}
              autoComplete="new-password"
              editable={!isSavingPassword}
              showLabel={copy.common.showPassword}
              hideLabel={copy.common.hidePassword}
            />
            <UiText variant="bodySmall" tone="muted" style={styles.cardCopy}>{copy.password.hint}</UiText>
            <SecureField
              label={copy.password.confirm}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              autoComplete="new-password"
              editable={!isSavingPassword}
              showLabel={copy.common.showPassword}
              hideLabel={copy.common.hidePassword}
            />
            {passwordMessage ? (
              <View accessible accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.cardCopy}>
                <UiText variant="bodySmall" tone="error">{passwordMessage}</UiText>
              </View>
            ) : null}
            <Button
              label={isSavingPassword ? copy.password.saving : copy.password.submit}
              disabled={isSavingPassword}
              loading={isSavingPassword}
              onPress={() => {
                if (validatePassword()) setConfirmPasswordChange(true);
              }}
            />
          </SectionCard>
          <ScreenSpacer />
          <TwoFactorCard email={account?.email} onCompleted={handleTwoFactorDone} />
        </>
      ) : null}
      <ScreenSpacer />
      <SectionCard title={copy.profile.whatChangesTitle} icon="information-outline">
        {copy.profile.whatChanges.map((paragraph) => (
          <UiText key={paragraph} variant="bodySmall" tone="muted" style={styles.cardCopy}>{paragraph}</UiText>
        ))}
      </SectionCard>
      <ScreenSpacer />
      <LanguageSetting />
      <ScreenSpacer />
      <ThemeSetting />
      <ScreenSpacer />
      <Card>
        <ListRow icon="robot-outline" title={copy.profile.openAssistant} onPress={() => navigation.navigate('assistant.chat')} />
      </Card>
      <Button icon="logout" label={copy.signOut.button} onPress={() => setConfirmSignOut(true)} variant="destructive" style={styles.signOut} />
      <Dialog
        visible={confirmPasswordChange}
        title={copy.password.confirmTitle}
        description={copy.password.confirmBody}
        confirmLabel={copy.password.confirmAction}
        cancelLabel={copy.common.cancel}
        onConfirm={() => void updatePassword()}
        onCancel={() => setConfirmPasswordChange(false)}
      />
      <SignOutDialog
        visible={confirmSignOut}
        onConfirm={() => {
          setConfirmSignOut(false);
          endSession('signedOut');
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </ScreenShell>
  );
}

const profileStyles = StyleSheet.create({
  notice: { marginBottom: tokens.spacing.sm },
});
