import { useContext, useRef, useState } from 'react';
import { Image, Linking, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Button, Card, UiText } from '../../components/Ui';
import { LanguageToggleButton } from '../../components/LanguageToggleButton';
import { ThemeToggleButton } from '../../components/ThemeToggleButton';
import { PreviewPill } from '../../components/PreviewPill';
import { apiClient } from '../../api/client';
import { signInWithOidc } from '../../auth/oidc-session';
import { sessionStore } from '../../auth/mobile-session-store';
import { tokens } from '../../design/tokens';
import { chromeFor } from '../../design/chrome';
import { useThemedStyles, useTheme } from '../../design/theme';
import type { ThemeColors } from '../../design/theme';
import { useSession } from '../../session/SessionContext';
import { accountScreen } from '../account/account-routes';
import { takePasswordResetNotice } from '../account/password-reset-notice';
import { useAccountCopy } from '../account/use-account-copy';
import { configuredPortalUrl } from '../operations/shared/portal-url';
import type { MobileScreenProps } from '../../navigation/types';

/** How far the form card rides up over the navy hero band. */
const HERO_OVERLAP = tokens.spacing.lg + tokens.spacing.xs;

/**
 * OIDC sign-in (mobile-policy §3): the system browser owns credentials —
 * this screen never sees a credential. Preview mode keeps the local
 * pseudo-session entry (KM-9: memory-only, never SecureStore).
 */
export function SignInScreen({ navigation }: MobileScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const session = useSession();
  const copy = useAccountCopy();
  const insets = useContext(SafeAreaInsetsContext);
  const [error, setError] = useState<string | null>(null);
  const [passwordReset] = useState(takePasswordResetNotice);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const noMobileSurface = error === copy.signIn.noMobileSurface;
  const portal = configuredPortalUrl();
  const signInFlight = useRef(false);
  const isPreview = apiClient.mode === 'preview';

  const handleSignIn = async () => {
    if (signInFlight.current) return;
    signInFlight.current = true;
    setError(null);
    setIsSubmitting(true);
    try {
      const attemptEpoch = sessionStore.sessionEpoch();
      const outcome = await signInWithOidc({ issuer: sessionStoreIssuer() });
      if (attemptEpoch !== sessionStore.sessionEpoch()) return;
      if (outcome.kind === 'cancelled') {
        session.markBlocked(copy.signIn.authorizationCancelled);
        return;
      }
      if (outcome.kind === 'unavailable') {
        setError(copy.errors.issuerNotConfigured);
        return;
      }
      if (outcome.kind === 'blocked') {
        if (outcome.code === 'no_mobile_surface') {
          setError(copy.signIn.noMobileSurface);
          return;
        }
        session.markBlocked(outcome.code === 'password_change_required'
          ? copy.signIn.passwordChangeRequired
          : copy.signIn.authorizationRejected);
        return;
      }
      sessionStore.bumpEpoch();
      const epoch = sessionStore.sessionEpoch();
      try {
        await sessionStore.saveRefresh(outcome.refreshToken);
      } catch {
        setError(copy.signIn.storage);
        return;
      }
      if (epoch !== sessionStore.sessionEpoch()) return;
      sessionStore.setAccessToken(outcome.accessToken);
      navigation.completeSignIn(outcome.role, outcome.accountId);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        session.markBlocked(copy.signIn.authorizationTimeout);
      } else {
        setError(copy.signIn.unreachable);
      }
    } finally {
      signInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingLeft: insets?.left ?? 0, paddingRight: insets?.right ?? 0 }]}>
      <StatusBar barStyle="light-content" backgroundColor={chrome.surface} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tokens.spacing.xl + (insets?.bottom ?? 0) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { backgroundColor: chrome.surface, paddingTop: (insets?.top ?? 0) + tokens.spacing.lg }]}>
          <View style={styles.brandRow}>
            <Image accessibilityLabel={copy.signIn.institutionName} accessibilityRole="image" source={require('../../../assets/hcmute-logo.png')} resizeMode="contain" style={styles.brandMark} />
            <View style={styles.brandCopy}>
              <UiText variant="headlineMedium" style={{ color: chrome.onSurface }}>CampusUTE</UiText>
              <UiText variant="bodySmall" style={{ color: chrome.onSurfaceMuted }}>{copy.signIn.portal}</UiText>
            </View>
            <LanguageToggleButton />
            <ThemeToggleButton />
          </View>
          <PreviewPill style={styles.previewPill} />
        </View>
        <View style={styles.body} testID="signin-body">
          <Card style={styles.formCard}>
            <UiText accessibilityRole="header" variant="headlineLarge">{copy.signIn.heading}</UiText>
            {passwordReset ? (
              <View accessibilityLiveRegion="polite" style={styles.resetNotice}>
                <UiText variant="label" tone="success">{copy.signIn.passwordUpdatedTitle}</UiText>
                <UiText variant="bodySmall" tone="success">{copy.signIn.passwordUpdatedBody}</UiText>
              </View>
            ) : null}
            {isPreview ? (
              <UiText variant="bodySmall" tone="muted" style={styles.formIntro}>{copy.signIn.preview}</UiText>
            ) : null}
            {isPreview ? (
              <Button icon="arrow-right" label={copy.signIn.explore} onPress={() => navigation.enterPreview()} style={styles.submit} />
            ) : (
              <Button
                label={copy.signIn.signIn}
                icon="login"
                loading={isSubmitting}
                onPress={handleSignIn}
                style={styles.submit}
              />
            )}
            {isPreview ? null : (
              <Button
                label={copy.forgot.title}
                onPress={() => navigation.navigate(accountScreen('forgotPassword'))}
                variant="text"
              />
            )}
            <View style={styles.issueNote}>
              <UiText variant="bodySmall" tone="muted">{copy.signIn.issuedBy}</UiText>
              <UiText variant="bodySmall" tone="muted">{copy.signIn.selfRegistration}</UiText>
              <UiText variant="bodySmall" tone="muted">{copy.signIn.officeContact}</UiText>
            </View>
            {!isPreview && (session.bootStatus === 'unavailable' || session.bootStatus === 'checking') ? (
              <View accessibilityLiveRegion="polite">
                <UiText variant="bodySmall" tone="error">{copy.signIn.unavailable}</UiText>
                <Button label={copy.signIn.retry} loading={session.bootStatus === 'checking'} onPress={() => void session.retryBoot?.()} />
              </View>
            ) : null}
            {!isPreview && session.bootStatus === 'reauthRequired' ? (
              <View accessibilityLiveRegion="polite">
                <UiText variant="bodySmall" tone="error">{copy.errors.unauthorized}</UiText>
              </View>
            ) : null}
            {error ? (
              <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.errorPanel}>
                <UiText variant="bodySmall" tone="error">
                  {error}
                </UiText>
                {noMobileSurface && portal ? (
                  <Button
                    icon="web"
                    label={copy.blocked.openPortal}
                    onPress={() => { void Linking.openURL(portal).catch(() => undefined); }}
                    style={styles.portalAction}
                    variant="secondary"
                  />
                ) : null}
              </View>
            ) : null}
          </Card>
          <View style={styles.footerFlex} />
        </View>
      </ScrollView>
    </View>
  );
}

function sessionStoreIssuer(): string {
  // The store resolves EXPO_PUBLIC_ISSUER_URL and uses a platform default in
  // development (KM-2); the flow must target the same origin the refresh calls use.
  return sessionStore.issuer;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1 },
  hero: { paddingBottom: HERO_OVERLAP + tokens.spacing.lg, paddingHorizontal: tokens.spacing.lg },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.md },
  brandMark: { backgroundColor: tokens.colors.card, borderRadius: tokens.radii.control, height: 56, width: 56 },
  brandCopy: { flex: 1, minWidth: 0, gap: tokens.spacing.xs },
  previewPill: { alignSelf: 'flex-start', marginTop: tokens.spacing.sm },
  body: { alignSelf: 'center', flexGrow: 1, maxWidth: tokens.windowClasses.contentMaxWidth.medium, paddingHorizontal: tokens.layout.mobileGutter, width: '100%' },
  formCard: { marginTop: -HERO_OVERLAP, padding: tokens.spacing.lg },
  formIntro: { marginBottom: tokens.spacing.md, marginTop: tokens.spacing.xs },
  resetNotice: { backgroundColor: colors.successFixed, borderColor: colors.success, borderRadius: tokens.radii.control, borderWidth: 1, gap: tokens.spacing.xs, marginBottom: tokens.spacing.md, marginTop: tokens.spacing.sm, padding: tokens.spacing.sm },
  issueNote: { gap: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  footerFlex: { flex: 1, minHeight: tokens.spacing.lg },
  submit: { marginTop: tokens.spacing.sm },
  errorPanel: { backgroundColor: colors.errorFixed, borderColor: colors.error, borderRadius: tokens.radii.control, borderWidth: 1, marginTop: tokens.spacing.md, padding: tokens.spacing.sm },
  portalAction: { marginTop: tokens.spacing.sm },
});
