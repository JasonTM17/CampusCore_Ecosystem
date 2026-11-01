import { Linking, StyleSheet, View } from 'react-native';

import { Button, StatusPill, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import type { MobileScreenProps } from '../../navigation/types';
import { useSession } from '../../session/SessionContext';
import { DEFAULT_PORTAL_URL } from '../operations/shared/portal-url';
import { AccountFrame } from './AccountFrame';
import { useAccountCopy } from './use-account-copy';

/**
 * Sign-in blocked screen for sessions halted by forced password change,
 * authorization error or administrative block.
 */
export function BlockedScreen({ navigation }: MobileScreenProps) {
  const copy = useAccountCopy();
  const session = useSession();
  const reason = session.blockedReason ?? copy.blocked.fallbackReason;

  return (
    <AccountFrame title={copy.blocked.title} subtitle={copy.blocked.subtitle}>
      <View style={styles.content}>
        <StatusPill label={copy.blocked.status} tone="error" icon="shield-alert-outline" />
        <UiText variant="bodyMedium" tone="muted" style={styles.reason}>
          {reason}
        </UiText>
        <Button
          icon="web"
          label={copy.blocked.openPortal}
          onPress={() => {
            const portal = process.env.EXPO_PUBLIC_PORTAL_URL ?? DEFAULT_PORTAL_URL;
            void Linking.openURL(portal).catch(() => undefined);
          }}
          style={styles.primaryAction}
        />
        <Button
          label={copy.common.backToSignIn}
          variant="secondary"
          onPress={() => {
            session.markBlocked(null);
            navigation.navigate('auth.signIn');
          }}
        />
      </View>
    </AccountFrame>
  );
}

const styles = StyleSheet.create({
  content: { gap: tokens.spacing.md },
  reason: { marginTop: tokens.spacing.xs },
  primaryAction: { marginTop: tokens.spacing.sm },
});
