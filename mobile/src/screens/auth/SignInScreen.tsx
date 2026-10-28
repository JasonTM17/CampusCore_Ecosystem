import { useContext, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Button, Card, ScreenShell, UiText } from '../../components/Ui';
import { apiClient } from '../../api/client';
import { signInWithOidc } from '../../auth/oidc-session';
import { sessionStore } from '../../auth/mobile-session-store';
import { tokens } from '../../design/tokens';
import { useThemedStyles, useTheme } from '../../design/theme';
import type { ThemeColors } from '../../design/theme';
import { accountMessages } from '../../i18n/account-messages';
import { useLocale } from '../../i18n/locale-provider';
import { useSession } from '../../session/SessionContext';
import { accountScreen } from '../account/account-routes';
import type { MobileScreenProps } from '../../navigation/types';

const copyByLocale = {
  en: {
    eyebrow: 'CampusCore mobile',
    title: 'Welcome back',
    subtitle: 'Sign in with your university account.',
    portal: 'Academic information portal',
    heading: 'Sign in',
    preview: 'Preview build — explore with a local pseudo-session.',
    live: 'Continue in your browser with CampusCore ID. Your credentials never touch this app.',
    explore: 'Explore preview',
    signIn: 'Sign in with CampusCore ID',
    unreachable: 'Sign-in could not reach the CampusCore identity service.',
  },
  vi: {
    eyebrow: 'CampusCore mobile',
    title: 'Chào mừng trở lại',
    subtitle: 'Đăng nhập bằng tài khoản trường.',
    portal: 'Cổng thông tin đào tạo',
    heading: 'Đăng nhập',
    preview: 'Bản xem thử — khám phá bằng phiên cục bộ.',
    live: 'Tiếp tục trong trình duyệt với CampusCore ID. Thông tin đăng nhập không đi qua ứng dụng này.',
    explore: 'Khám phá bản xem thử',
    signIn: 'Đăng nhập bằng CampusCore ID',
    unreachable: 'Không kết nối được dịch vụ định danh CampusCore.',
  },
} as const;

/**
 * OIDC sign-in (mobile-policy §3): the system browser owns credentials —
 * this screen never sees a credential. Preview mode keeps the local
 * pseudo-session entry (KM-9: memory-only, never SecureStore).
 */
export function SignInScreen({ navigation }: MobileScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const session = useSession();
  const { locale } = useLocale();
  const copy = copyByLocale[locale];
  const insets = useContext(SafeAreaInsetsContext);
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
      setError(copy.unreachable);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenShell
      eyebrow={copy.eyebrow}
      title={copy.title}
      subtitle={copy.subtitle}
      contentStyle={[styles.content, { paddingTop: tokens.spacing.sm + (insets?.top ?? 0) }]}
    >
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <MaterialCommunityIcons color={colors.text} name="school-outline" size={22} />
        </View>
        <View style={styles.brandCopy}>
          <UiText variant="headlineSmall">CampusCore</UiText>
          <UiText variant="bodySmall" tone="muted">{copy.portal}</UiText>
        </View>
      </View>

      <Card style={styles.formCard}>
        <UiText variant="headlineSmall">{copy.heading}</UiText>
        <UiText variant="bodySmall" tone="muted" style={styles.formIntro}>
          {isPreview ? copy.preview : copy.live}
        </UiText>
        {isPreview ? (
          <Button label={copy.explore} onPress={() => navigation.enterPreview()} style={styles.submit} />
        ) : (
          <Button
            label={copy.signIn}
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
