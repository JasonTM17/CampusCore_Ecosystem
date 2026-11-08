import { Redirect, SplashScreen, Stack, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { useFonts } from 'expo-font';
import { BeVietnamPro_400Regular } from '@expo-google-fonts/be-vietnam-pro/400Regular';
import { BeVietnamPro_500Medium } from '@expo-google-fonts/be-vietnam-pro/500Medium';
import { BeVietnamPro_600SemiBold } from '@expo-google-fonts/be-vietnam-pro/600SemiBold';
import { BeVietnamPro_700Bold } from '@expo-google-fonts/be-vietnam-pro/700Bold';

import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { Button, UiText } from '../src/components/Ui';
import { ThemeProvider, useTheme } from '../src/design/theme';
import { tokens } from '../src/design/tokens';
import { LocaleProvider, useLocale } from '../src/i18n/locale-provider';
import { accountMessages } from '../src/i18n/account-messages';
import { NO_CAPABILITIES } from '../src/auth/capabilities';
import { LANE_FLAGS } from '../src/config/lane-flags';
import { laneScreenForPath, pathFor, resolveGuard, screenForPath } from '../src/navigation/route-map';
import { consumePendingCheckinPath, rememberCheckinPath } from '../src/navigation/pending-checkin';
import { SessionProvider, useSession } from '../src/session/SessionContext';

// Hold at module evaluation, before Router can auto-hide the native splash.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Fonts and session bootstrap run in parallel; guards wait for both. */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
  });

  return (
    <ThemeProvider>
      <ThemedStatusBar />
      <LocaleProvider>
        <SessionProvider>
          <BootReady fontsReady={fontsLoaded || Boolean(fontError)} />
        </SessionProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}

function BootReady({ fontsReady }: { fontsReady: boolean }) {
  const session = useSession();
  const { booted, bootStatus, bootUnavailableReason } = session;
  const { ready: localeReady, locale } = useLocale();
  const { colors } = useTheme();
  const pathname = usePathname() ?? '/';
  const shellReady = fontsReady && localeReady;
  useEffect(() => {
    if (!shellReady) return;
    const frame = requestAnimationFrame(() => { void SplashScreen.hideAsync().catch(() => undefined); });
    return () => cancelAnimationFrame(frame);
  }, [shellReady]);
  if (!shellReady) return <View />;
  const copy = accountMessages[locale].signIn;
  if (!booted) {
    return (
      <View
        accessible
        accessibilityLabel={copy.booting}
        accessibilityLiveRegion="polite"
        accessibilityRole="progressbar"
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}
      >
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  const offlineBoot = bootUnavailableReason === 'offline'
    && (bootStatus === 'unavailable' || bootStatus === 'checking');
  return (
    <ErrorBoundary resetKey={pathname}>
      {offlineBoot ? (
        <View accessibilityLiveRegion="polite" style={{ flex: 1, justifyContent: 'center', padding: tokens.spacing.md, gap: tokens.spacing.sm, backgroundColor: colors.background }}>
          <UiText tone="error">{copy.offline}</UiText>
          <Button label={copy.retry} loading={bootStatus === 'checking'} onPress={() => void session.retryBoot?.()} />
        </View>
      ) : <RootNavigator />}
    </ErrorBoundary>
  );
}

/** Status bar follows the active scheme (light content on dark surfaces). */
function ThemedStatusBar() {
  const { scheme, colors } = useTheme();
  return (
    <StatusBar
      barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
      backgroundColor={colors.background}
    />
  );
}

/**
 * Global guard seat: auth routes live OUTSIDE the (app) group, so the guard
 * must run here too — an authenticated session that lands on /sign-in is
 * bounced to role home before any screen renders (mobile-policy §2).
 */
function RootNavigator() {
  const session = useSession();
  const pathname = usePathname() ?? '/';
  const [resumePath, setResumePath] = useState<string | null>(null);
  const returnTarget = useRef<string | null>(null);
  // Resume the preserved link once a session exists: consume it in an effect,
  // then let it take over the guard's redirect slot on the NEXT commit. A
  // plain replace races (and loses to) the /sign-in → role-home Redirect that
  // fires in the same commit as the session flip.
  const { kind, role, capabilities } = session;
  const decision = resolveGuard(session.kind, session.role, pathname, session.capabilities, LANE_FLAGS, session.signingOut);
  const knownRoute = screenForPath(pathname) !== null || laneScreenForPath(pathname) !== null;
  // Preserve known route intents after commit; render stays free of mutations.
  useEffect(() => {
    if (kind !== 'signedOut') return;
    rememberCheckinPath(pathname);
    if (decision.action === 'redirect' && decision.to === 'auth.signIn' && knownRoute) {
      returnTarget.current = pathname;
    }
  }, [kind, pathname, decision.action, decision.to, knownRoute]);
  useEffect(() => {
    if (kind === 'signedOut' || session.signingOut) return;
    const pending = consumePendingCheckinPath() ?? returnTarget.current;
    returnTarget.current = null;
    if (pending === null) return;
    if (resolveGuard(kind, role, pending, capabilities ?? NO_CAPABILITIES, LANE_FLAGS, session.signingOut).action === 'allow') {
      setResumePath(pending);
    }
  }, [kind, role, capabilities, session.signingOut]);
  useEffect(() => {
    if (resumePath !== null && pathname === resumePath) setResumePath(null);
  }, [resumePath, pathname]);
  let redirectHref: string | null = null;
  if (resumePath !== null && pathname !== resumePath) {
    redirectHref = resumePath;
  } else if (session.blockedReason && pathname !== '/sign-in-blocked') {
    redirectHref = '/sign-in-blocked';
  } else if (decision.action === 'redirect' && decision.to) {
    redirectHref = pathFor(decision.to);
  }
  // The navigator stays mounted while a redirect is pending: swapping it for
  // a bare <Redirect> makes expo-router remount this layout, which recreates
  // SessionProvider and drops the session that triggered the redirect.
  return (
    <>
      <ThemedStack />
      {redirectHref ? <Redirect href={redirectHref} /> : null}
    </>
  );
}

function ThemedStack() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
