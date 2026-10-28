import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, Card, ScreenShell, UiText } from '../../components/Ui';
import { apiClient } from '../../api/client';
import { signInWithOidc } from '../../auth/oidc-session';
import { sessionStore } from '../../auth/mobile-session-store';
import { tokens } from '../../design/tokens';
import { useThemedStyles, useTheme } from '../../design/theme';
import type { ThemeColors } from '../../design/theme';
import { useSession } from '../../session/SessionContext';
import type { MobileScreenProps } from '../../navigation/types';

/**
 * OIDC sign-in (mobile-policy §3): the system browser owns credentials —
 * this screen never sees a credential. Preview mode keeps the local
 * pseudo-session entry (KM-9: memory-only, never SecureStore).
 */
export function SignInScreen({ navigation }: MobileScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isPreview = apiClient.mode === 'preview';

  const handleSignIn = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const outcome = await signInWithOidc({ issuer: sessionStoreIssuer() });
      if (outcome.kind === 'cancelled') {
        return;
      }
      if (outcome.kind === 'blocked') {
        session.markBlocked(outcome.reason);
        return;
      }
      await sessionStore.saveRefresh(outcome.refreshToken);
      sessionStore.setAccessToken(outcome.accessToken);
      sessionStore.bumpEpoch();
      navigation.completeSignIn(outcome.role, outcome.accountId);
    } catch {
      setError('Sign-in could not reach the CampusCore identity service.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenShell
      eyebrow="CampusCore mobile"
      title="Welcome back"
      subtitle="Sign in with your university account."
      contentStyle={styles.content}
    >
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <MaterialCommunityIcons color={colors.text} name="school-outline" size={22} />
        </View>
        <View style={styles.brandCopy}>
          <UiText variant="headlineSmall">CampusCore</UiText>
          <UiText variant="bodySmall" tone="muted">Academic information portal</UiText>
        </View>
      </View>

      <Card style={styles.formCard}>
        <UiText variant="headlineSmall">Sign in</UiText>
        <UiText variant="bodySmall" tone="muted" style={styles.formIntro}>
          {isPreview
            ? 'Preview build — explore with a local pseudo-session.'
            : 'Continue in your browser with CampusCore ID. Your credentials never touch this app.'}
        </UiText>
        {isPreview ? (
          <Button label="Explore preview" onPress={() => navigation.enterPreview()} style={styles.submit} />
        ) : (
          <Button
            label="Sign in with CampusCore ID"
            loading={isSubmitting}
            onPress={handleSignIn}
            style={styles.submit}
          />
        )}
        {error ? (
          <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.errorPanel}>
            <UiText variant="bodySmall" tone="error">
              {error}
            </UiText>
          </View>
        ) : null}
      </Card>
    </ScreenShell>
  );
}

function sessionStoreIssuer(): string {
  // The store already resolves EXPO_PUBLIC_ISSUER_URL → platform default
  // (KM-2); the flow must target the same origin the refresh calls use.
  return sessionStore.issuer;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  content: { paddingTop: tokens.spacing.sm },
  brandRow: { alignItems: 'center', borderBottomColor: colors.outlineVariant, borderBottomWidth: 1, flexDirection: 'row', marginBottom: tokens.spacing.lg, paddingBottom: tokens.spacing.md },
  brandMark: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: tokens.radii.control, height: 44, justifyContent: 'center', width: 44 },
  brandCopy: { flex: 1, marginLeft: tokens.spacing.sm },
  formCard: { padding: tokens.spacing.lg },
  formIntro: { marginBottom: tokens.spacing.lg, marginTop: tokens.spacing.xs },
  submit: { marginTop: tokens.spacing.sm },
  errorPanel: { backgroundColor: colors.errorFixed, borderColor: colors.error, borderLeftColor: colors.error, borderLeftWidth: 3, borderRadius: tokens.radii.control, borderWidth: 1, marginTop: tokens.spacing.md, padding: tokens.spacing.sm },
});
