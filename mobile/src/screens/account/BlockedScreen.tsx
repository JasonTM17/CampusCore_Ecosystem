import { Linking, StyleSheet, View } from 'react-native';

import { Button, StatusPill, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import type { MobileScreenProps } from '../../navigation/types';
import { useSession } from '../../session/SessionContext';
import { AccountFrame } from './AccountFrame';
import { useAccountCopy } from './use-account-copy';

/**
 * Sign-in blocked screen for sessions halted by forced password change,
 * authorization error or administrative block.
 */
export function BlockedScreen({ navigation }: MobileScreenProps) {
  const copy = useAccountCopy();
  const session = useSession();
  const reason =
    session.blockedReason ??
    'Sign-in could not finish. Use the web portal if this keeps happening.';

  return (
    <AccountFrame title="Sign-in blocked" subtitle="Access verification required">
      <View style={styles.content}>
        <StatusPill label="Blocked" tone="error" icon="shield-alert-outline" />
        <UiText variant="bodyMedium" tone="muted" style={styles.reason}>
          {reason}
        </UiText>
        <Button
          icon="web"
          label="Open web portal"
          onPress={() => {
            const portal =
              process.env.EXPO_PUBLIC_PORTAL_URL ?? 'https://portal.localhost:3102';
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
