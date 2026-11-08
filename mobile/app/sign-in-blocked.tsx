import { BackHandler, Linking, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { Button, UiText } from '../src/components/Ui';
import { useTheme } from '../src/design/theme';
import { tokens } from '../src/design/tokens';
import { useSession } from '../src/session/SessionContext';
import { useAccountCopy } from '../src/screens/account/use-account-copy';
import { configuredPortalUrl } from '../src/screens/operations/shared/portal-url';

/**
 * Sign-in-blocked state (mobile-policy §3, KM-12): mustChangePassword,
 * authorize-paused, dismissed browser, or authorize error never leaves the
 * user on a spinner or raw JSON — the reason is shown with a web-portal
 * escape and a retry.
 */
export default function SignInBlocked() {
  const router = useRouter();
  const session = useSession();
  const { colors } = useTheme();
  const copy = useAccountCopy();
  const reason = session.blockedReason ?? copy.blocked.fallbackReason;
  const portal = configuredPortalUrl();

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      session.markBlocked(null);
      router.replace('/sign-in');
      return true;
    });
    return () => subscription.remove();
  }, [router, session.markBlocked]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <UiText accessibilityRole="header" variant="headlineMedium">{copy.blocked.title}</UiText>
      <UiText style={styles.reason}>{reason}</UiText>
      {portal ? (
        <Button
          label={copy.blocked.openPortal}
          onPress={() => {
            void Linking.openURL(portal).catch(() => undefined);
          }}
        />
      ) : null}
      <Button
        label={copy.common.backToSignIn}
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
  },
  reason: { textAlign: 'center' },
});
