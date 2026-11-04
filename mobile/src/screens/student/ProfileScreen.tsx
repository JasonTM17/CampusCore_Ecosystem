import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import {
  Button,
  Card,
  DataNotice,
  Dialog,
  Divider,
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
import { useScreenQuery } from '../../hooks/useScreenQuery';
import type { MobileScreenProps } from '../../navigation/types';
import { SecureField } from '../account/SecureField';
import { SignOutDialog } from '../account/SignOutDialog';
import { LanguageSetting } from '../account/LanguageSetting';
import { TwoFactorCard } from '../account/TwoFactorCard';
import { classifyError, errorMessage } from '../account/account-errors';
import { setExitNotice, type ExitNotice } from '../account/exit-notice';
import { checkPasswordPolicy } from '../account/password-policy';
import type { TwoFactorAction } from '../account/two-factor-flow';
import { useAccountCopy } from '../account/use-account-copy';
import { useStudentStyles } from './shared/styles';

/** Fields the profile endpoint returns beyond the shared `AuthUser` shape. */
type AccountProfile = AuthUser & { phone?: string | null; address?: string | null };

const PHONE_PATTERN = /^$|^\+?[0-9][0-9\s()./-]{4,78}$/;

export function ProfileScreen({ navigation, role }: MobileScreenProps) {
  const styles = useStudentStyles();
  const { colors, scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const copy = useAccountCopy();
  const isLive = apiClient.mode === 'live';
  const {
    data: account,
    error,
    warning,
    isLoading,
    reload,
  } = useScreenQuery<AccountProfile | null>('profile', () => campusApi.profile(), {
    enabled: isLive,
    errorMessage: copy.errors.unknown,
    mapError: (failure) => errorMessage(classifyError(failure), copy.errors),
  });
  const accountRef = useRef(account);
  accountRef.current = account;
  const seededAccountId = useRef<string | null | undefined>(undefined);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const phoneRef = useRef(phone);
  const addressRef = useRef(address);
  const seededPhoneRef = useRef<string | null>(null);
  const seededAddressRef = useRef<string | null>(null);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [confirmPasswordChange, setConfirmPasswordChange] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const updatePhone = (value: string) => {
    phoneRef.current = value;
    setPhone(value);
  };
  const updateAddress = (value: string) => {
    addressRef.current = value;
    setAddress(value);
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

  const endSession = useCallback(
    (notice: ExitNotice) => {
      setExitNotice(notice);
      navigation.signOut();
    },
    [navigation],
  );

  const handleTwoFactorDone = useCallback(
    (action: TwoFactorAction) => endSession(action === 'enable' ? 'twoFactorEnabled' : 'twoFactorDisabled'),
    [endSession],
  );

  const saveProfile = async () => {
    setProfileMessage(null);
    const submittedPhone = phone.trim();
    const submittedAddress = address.trim();
    if (!PHONE_PATTERN.test(submittedPhone)) {
      setProfileMessage(copy.profile.phoneInvalid);
      return;
    }
    setIsSavingProfile(true);
    try {
      await campusApi.updateProfile({ phone: submittedPhone, address: submittedAddress });
      if (phoneRef.current === phone) {
        seededPhoneRef.current = submittedPhone;
        updatePhone(submittedPhone);
      }
      if (addressRef.current === address) {
        seededAddressRef.current = submittedAddress;
        updateAddress(submittedAddress);
      }
      setProfileMessage(copy.profile.saved);
      void reload();
    } catch {
      setProfileMessage(copy.profile.saveFailed);
    } finally {
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
      setIsSavingPassword(false);
    }
  };

  const roleLabel = role === 'lecturer' ? copy.profile.roleLecturer : role === 'admin' ? copy.profile.roleAdmin : copy.profile.roleStudent;
  const displayName = !isLive
    ? 'Nguyen Duc Minh'
    : [account?.firstName, account?.lastName].filter(Boolean).join(' ') || roleLabel;
  const displayEmail = !isLive ? 'minh.nguyen@ute.edu.vn' : account?.email ?? '—';
  const displayId = !isLive ? '2022SE0417' : (role === 'lecturer' ? account?.lecturerId : account?.studentId) ?? '—';

  if (isLoading || error) {
    return (
      <ScreenShell title={copy.profile.title} eyebrow={copy.profile.eyebrow}>
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? copy.profile.loading : copy.profile.errorTitle}
          description={error ?? undefined}
          actionLabel={error ? copy.common.retry : undefined}
          onAction={error ? () => void reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title={copy.profile.title} eyebrow={copy.profile.eyebrow}>
      {warning ? <DataNotice message={warning} /> : null}
      <Card style={[styles.profileHero, { backgroundColor: chrome.surface, borderColor: colors.outlineVariant }]}>
        <IdentityHeader
          chips={[isLive ? roleLabel : `${roleLabel} · ${copy.profile.preview}`]}
          imageUrl={isLive ? account?.avatar : undefined}
          name={displayName}
          onBrand
          role={role === 'admin' ? 'admin' : role === 'lecturer' ? 'lecturer' : 'student'}
          roleLabel={roleLabel}
          subtitle={displayId}
        />
      </Card>
      <ScreenSpacer />
      <SectionCard title={copy.profile.sectionDetails} icon="card-account-details-outline">
        <ListRow icon="email-outline" title={copy.profile.email} subtitle={displayEmail} />
        {isLive ? (
          <>
            <Divider />
            <Field label={copy.profile.phone} value={phone} onChangeText={updatePhone} keyboardType="phone-pad" autoComplete="tel" />
            <Field label={copy.profile.address} value={address} onChangeText={updateAddress} autoComplete="street-address" />
            {profileMessage ? (
              <UiText accessibilityLiveRegion="polite" variant="bodySmall" style={styles.cardCopy}>{profileMessage}</UiText>
            ) : null}
            <Button
              label={isSavingProfile ? copy.profile.saving : copy.profile.save}
              disabled={isSavingProfile}
              loading={isSavingProfile}
              onPress={() => void saveProfile()}
            />
          </>
        ) : null}
      </SectionCard>
      {isLive ? (
        <>
          <ScreenSpacer />
          <SectionCard title={copy.password.title} icon="lock-outline">
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
      <LanguageSetting />
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
