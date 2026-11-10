import { useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { campusApi, type AuthUser } from '../api/client';
import { useScreenQuery } from '../hooks/useScreenQuery';
import { useOptionalSession } from '../session/SessionContext';

/** The account icon's slot; the portrait keeps the same footprint so the bar never reflows. */
const AVATAR_SIZE = 26;

const HTTPS_URL = /^https:\/\/\S+$/i;
const DATA_IMAGE_URL = /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i;

export function isUsableAppBarAvatar(value: string | null | undefined): value is string {
  const url = value?.trim() ?? '';
  return HTTPS_URL.test(url) || DATA_IMAGE_URL.test(url);
}

export interface AppBarAccountAvatarProps {
  /** Explicit portrait source; when omitted the signed-in profile read supplies it. */
  avatar?: string | null;
  color: string;
}

/**
 * The AppBar account control's artwork: the saved portrait, else the account
 * icon. The signed-in profile read is the same one the profile screen reloads
 * after a save, so storing or removing a photo reaches the bar.
 */
export function AppBarAccountAvatar({ avatar, color }: AppBarAccountAvatarProps) {
  const session = useOptionalSession();
  if (avatar === undefined && session?.kind === 'authenticated') {
    return <ProfileAccountAvatar color={color} />;
  }
  return <AccountAvatarChip avatar={avatar} color={color} />;
}

function ProfileAccountAvatar({ color }: { color: string }) {
  const { data } = useScreenQuery<AuthUser | null>('profile', () => campusApi.profile(), {
    scope: { locale: 'neutral' },
  });
  return <AccountAvatarChip avatar={data?.avatar} color={color} />;
}

function AccountAvatarChip({ avatar, color }: { avatar?: string | null; color: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = isUsableAppBarAvatar(avatar) ? avatar.trim() : null;

  if (source && source !== failedSource) {
    return (
      <Image
        accessibilityElementsHidden
        accessible={false}
        importantForAccessibility="no"
        onError={() => setFailedSource(source)}
        resizeMode="cover"
        source={{ uri: source }}
        style={styles.photo}
        testID="app-bar-account-avatar"
      />
    );
  }
  return (
    <MaterialCommunityIcons
      color={color}
      name="account-circle-outline"
      size={AVATAR_SIZE}
      testID="app-bar-account-icon"
    />
  );
}

const styles = StyleSheet.create({
  photo: { borderRadius: AVATAR_SIZE / 2, height: AVATAR_SIZE, width: AVATAR_SIZE },
});
