import { useContext, useState } from 'react';
import { Image, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Button, Card, UiText } from '../../components/Ui';
import { apiClient } from '../../api/client';
import { signInWithOidc } from '../../auth/oidc-session';
import { sessionStore } from '../../auth/mobile-session-store';
import { tokens } from '../../design/tokens';
import { chromeFor } from '../../design/chrome';
import { useThemedStyles, useTheme } from '../../design/theme';
import type { ThemeColors } from '../../design/theme';
import { accountMessages } from '../../i18n/account-messages';
import { useLocale } from '../../i18n/locale-provider';
import { shellMessages } from '../../i18n/shell-messages';
import { useSession } from '../../session/SessionContext';
import { accountScreen } from '../account/account-routes';
import type { MobileScreenProps } from '../../navigation/types';

const copyByLocale = {
  en: {
    title: 'Welcome back',
    portal: 'Academic information portal',
    heading: 'Sign in',
    preview: 'Preview build — explore with a local pseudo-session.',
    live: 'Continue in your browser with CampusUTE ID. Your credentials never touch this app.',
    explore: 'Explore preview',
    signIn: 'Sign in with CampusUTE ID',
    unreachable: 'Sign-in could not reach the CampusUTE identity service.',
  },
  vi: {
    title: 'Chào mừng trở lại',
    portal: 'Cổng thông tin đào tạo',
    heading: 'Đăng nhập',
    preview: 'Bản xem thử — khám phá bằng phiên cục bộ.',
    live: 'Tiếp tục trong trình duyệt với CampusUTE ID. Thông tin đăng nhập không đi qua ứng dụng này.',
    explore: 'Khám phá bản xem thử',
    signIn: 'Đăng nhập bằng CampusUTE ID',
    unreachable: 'Không kết nối được dịch vụ định danh CampusUTE.',
  },
} as const;

/** How far the form card rides up over the navy hero band. */
const HERO_OVERLAP = tokens.spacing.lg + tokens.spacing.xs;

/**
 * OIDC sign-in (mobile-policy §3): the system browser owns credentials —
 * this screen never sees a credential. Preview mode keeps the local
 * pseudo-session entry (KM-9: memory-only, never SecureStore).
 */
export function SignInScreen({ navigation }: MobileScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { scheme, window } = useTheme();
  const chrome = chromeFor(scheme);
  const session = useSession();
  const { locale } = useLocale();
  const copy = copyByLocale[locale];
  const insets = useContext(SafeAreaInsetsContext);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isPreview = apiClient.mode === 'preview';
  const stackGuests = window.fontScale >= 1.3;

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
      setError(copy.unreachable);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={chrome.surface} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tokens.spacing.xl + (insets?.bottom ?? 0) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { backgroundColor: chrome.surface, paddingTop: (insets?.top ?? 0) + tokens.spacing.lg }]}>
          <View style={styles.brandRow}>
            <Image accessibilityLabel="HCMUTE" accessibilityRole="image" source={require('../../../assets/hcmute-logo.png')} resizeMode="contain" style={styles.brandMark} />
            <View style={styles.brandCopy}>
              <UiText variant="headlineMedium" style={{ color: chrome.onSurface }}>CampusUTE</UiText>
              <UiText variant="bodySmall" style={{ color: chrome.onSurfaceMuted }}>{copy.portal}</UiText>
            </View>
          </View>
          <UiText variant="headlineMedium" style={[styles.heroTitle, { color: chrome.onSurface }]}>{copy.title}</UiText>
        </View>
        <View style={styles.body}>
          <Card style={styles.formCard}>
            <UiText accessibilityRole="header" variant="headlineLarge">{copy.heading}</UiText>
            <UiText variant="bodySmall" tone="muted" style={styles.formIntro}>
              {isPreview ? copy.preview : copy.live}
            </UiText>
            {isPreview ? (
              <Button icon="arrow-right" label={copy.explore} onPress={() => navigation.enterPreview()} style={styles.submit} />
            ) : (
              <Button
                label={copy.signIn}
                icon="login"
                loading={isSubmitting}
                onPress={handleSignIn}
                style={styles.submit}
              />
            )}
            {isPreview ? null : (
              <Button
                label={accountMessages[locale].forgot.title}
                onPress={() => navigation.navigate(accountScreen('forgotPassword'))}
                variant="text"
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
          <View style={stackGuests ? styles.guestColumn : styles.guestRow}>
            <Button icon="newspaper-variant-outline" label={shellMessages[locale].screens.news} onPress={() => navigation.navigate('news')} variant="secondary" style={stackGuests ? undefined : styles.guestButton} />
            <Button icon="file-document-outline" label={shellMessages[locale].screens.docs} onPress={() => navigation.navigate('docs')} variant="secondary" style={stackGuests ? undefined : styles.guestButton} />
          </View>
          <View style={styles.footerFlex} />
        </View>
      </ScrollView>
    </View>
  );
}

function sessionStoreIssuer(): string {
  // The store already resolves EXPO_PUBLIC_ISSUER_URL → platform default
  // (KM-2); the flow must target the same origin the refresh calls use.
  return sessionStore.issuer;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1 },
  hero: { paddingBottom: HERO_OVERLAP + tokens.spacing.lg, paddingHorizontal: tokens.spacing.lg },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.md },
  brandMark: { backgroundColor: tokens.colors.card, borderRadius: tokens.radii.control, height: 56, width: 56 },
  brandCopy: { flex: 1, minWidth: 0, gap: tokens.spacing.xs },
  heroTitle: { marginTop: tokens.spacing.lg },
  body: { alignSelf: 'center', flex: 1, maxWidth: tokens.windowClasses.contentMaxWidth.medium, paddingHorizontal: tokens.layout.mobileGutter, width: '100%' },
  formCard: { marginTop: -HERO_OVERLAP, padding: tokens.spacing.lg },
  formIntro: { marginBottom: tokens.spacing.md, marginTop: tokens.spacing.xs },
  guestRow: { flexDirection: 'row', gap: tokens.spacing.sm, marginTop: tokens.spacing.md },
  guestColumn: { gap: tokens.spacing.sm, marginTop: tokens.spacing.md },
  guestButton: { flex: 1 },
  footerFlex: { flex: 1, minHeight: tokens.spacing.lg },
  submit: { marginTop: tokens.spacing.sm },
  errorPanel: { backgroundColor: colors.errorFixed, borderColor: colors.error, borderRadius: tokens.radii.control, borderWidth: 1, marginTop: tokens.spacing.md, padding: tokens.spacing.sm },
});
