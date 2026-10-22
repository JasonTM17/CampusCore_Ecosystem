import { Linking, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, UiText } from '../src/components/Ui';
import { tokens } from '../src/design/tokens';
import { useSession } from '../src/session/SessionContext';

/**
 * Sign-in-blocked state (mobile-policy §3, KM-12): mustChangePassword,
 * authorize-paused, dismissed browser, or authorize error never leaves the
 * user on a spinner or raw JSON — the reason is shown with a web-portal
 * escape and a retry.
 */
export default function SignInBlocked() {
  const router = useRouter();
  const session = useSession();
  const reason = session.blockedReason
    ?? 'Sign-in could not finish. Use the web portal if this keeps happening.';

  return (
    <View style={styles.container}>
      <UiText variant="headlineMedium">Sign-in blocked</UiText>
      <UiText style={styles.reason}>{reason}</UiText>
      <Button
        label="Open web portal"
        onPress={() => {
          const portal = process.env.EXPO_PUBLIC_PORTAL_URL
            ?? 'https://portal.localhost:3102';
          void Linking.openURL(portal).catch(() => undefined);
        }}
      />
      <Button
        label="Back to sign-in"
        variant="secondary"
        onPress={() => {
          session.markBlocked(null);
          router.replace('/sign-in');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacing.md,
    padding: tokens.spacing.lg,
    backgroundColor: tokens.colors.background,
  },
  reason: { textAlign: 'center' },
});
