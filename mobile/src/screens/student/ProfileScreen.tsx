import { useState, useEffect } from 'react';
import { View } from 'react-native';

import {
  Avatar,
  Badge,
  Button,
  Card,
  DataNotice,
  Divider,
  Field,
  ListRow,
  ScreenShell,
  ScreenSpacer,
  SectionHeading,
  StatePanel,
  UiText,
} from '../../components/Ui';
import { apiClient, campusApi, type AuthUser } from '../../api/client';
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { useStudentStyles } from './shared/styles';

export function ProfileScreen({ navigation, role }: MobileScreenProps) {
  const styles = useStudentStyles();
  const {
    data: account,
    error,
    warning,
    isLoading,
    reload,
  } = useLiveResource<AuthUser | null>(
    'profile',
    null,
    () => campusApi.profile(),
    'Profile is unavailable.',
  );
  const [firstName, setFirstName] = useState(account?.firstName ?? '');
  const [lastName, setLastName] = useState(account?.lastName ?? '');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  useEffect(() => {
    setFirstName(account?.firstName ?? '');
    setLastName(account?.lastName ?? '');
  }, [account]);

  const saveProfile = async () => {
    setIsSavingProfile(true);
    setProfileMessage(null);
    try {
      await campusApi.updateProfile({ firstName, lastName });
      setProfileMessage('Profile saved.');
      void reload();
    } catch {
      setProfileMessage('Profile could not be saved.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const updatePassword = async () => {
    if (newPassword.length < 8) {
      setProfileMessage('New password must be at least 8 characters.');
      return;
    }
    setIsSavingPassword(true);
    setProfileMessage(null);
    try {
      await campusApi.changePassword(oldPassword, newPassword);
      setProfileMessage('Password updated.');
      setOldPassword('');
      setNewPassword('');
    } catch {
      setProfileMessage('Password could not be updated.');
    } finally {
      setIsSavingPassword(false);
    }
  };
  const displayName = apiClient.mode === 'preview'
    ? 'Nguyen Duc Minh'
    : [account?.firstName, account?.lastName].filter(Boolean).join(' ') || 'Student';
  const displayEmail = apiClient.mode === 'preview' ? 'minh.nguyen@ute.edu.vn' : account?.email ?? '—';
  const displayStudentId = apiClient.mode === 'preview' ? '2022SE0417' : account?.studentId ?? '—';

  if (isLoading || error) {
    return (
      <ScreenShell title="Profile" eyebrow="Account" subtitle="Your identity and academic preferences.">
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading profile…' : 'Profile unavailable'}
          description={error ?? 'Retrieving your account details.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? () => void reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Profile" eyebrow="Account" subtitle="Your identity and academic preferences.">
      {warning ? <DataNotice message={warning} /> : null}
      <Card style={styles.profileHero}>
        <View style={styles.profileHeader}>
          <Avatar label={displayName} size={64} />
          <View style={styles.profileCopy}>
            <UiText variant="headlineSmall">{displayName}</UiText>
            <UiText variant="bodySmall" tone="muted">{displayStudentId}</UiText>
            <Badge label={apiClient.mode === 'preview' ? `${role} preview` : role} tone="primary" />
          </View>
        </View>
      </Card>
      <ScreenSpacer />
      <Card>
        <SectionHeading title="Personal details" />
        <ListRow title="University email" subtitle={displayEmail} />
        <Divider />
        <ListRow title="Student ID" subtitle={displayStudentId} />
        <Divider />
        <ListRow title="Account status" subtitle={apiClient.mode === 'preview' ? 'Preview' : 'Authenticated through Java API'} />
        {apiClient.mode === 'live' ? (
          <>
            <Divider />
            <Field label="First name" value={firstName} onChangeText={setFirstName} />
            <Field label="Last name" value={lastName} onChangeText={setLastName} />
            <Button
              label="Save profile"
              disabled={isSavingProfile}
              loading={isSavingProfile}
              onPress={() => void saveProfile()}
            />
            <Field label="Current password" value={oldPassword} onChangeText={setOldPassword} secureTextEntry />
            <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
            <Button
              label="Update password"
              disabled={isSavingPassword}
              loading={isSavingPassword}
              onPress={() => void updatePassword()}
            />
            {profileMessage ? <UiText variant="bodySmall">{profileMessage}</UiText> : null}
          </>
        ) : null}
      </Card>
      <ScreenSpacer />
      <Card tone="low">
        <UiText variant="label">Need help?</UiText>
        <UiText variant="bodySmall" tone="muted" style={styles.cardCopy}>Ask the academic assistant about your schedule, grades, or thesis journey.</UiText>
        <Button label="Open assistant" onPress={() => navigation.navigate('assistant.chat')} variant="secondary" />
      </Card>
      <Button label="Sign out" onPress={navigation.signOut} variant="text" style={styles.signOut} />
    </ScreenShell>
  );
}
