import { Redirect, SplashScreen, Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar, View } from 'react-native';
import { useFonts } from 'expo-font';
import { BeVietnamPro_400Regular } from '@expo-google-fonts/be-vietnam-pro/400Regular';
import { BeVietnamPro_500Medium } from '@expo-google-fonts/be-vietnam-pro/500Medium';
import { BeVietnamPro_600SemiBold } from '@expo-google-fonts/be-vietnam-pro/600SemiBold';
import { BeVietnamPro_700Bold } from '@expo-google-fonts/be-vietnam-pro/700Bold';

import { ThemeProvider, useTheme } from '../src/design/theme';
import { LocaleProvider, useLocale } from '../src/i18n/locale-provider';
import { pathFor, resolveGuard } from '../src/navigation/route-map';
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
  const { booted } = useSession();
  const { ready: localeReady } = useLocale();
  const ready = fontsReady && booted && localeReady;
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => { void SplashScreen.hideAsync().catch(() => undefined); });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  return ready ? <RootNavigator /> : <View />;
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
  const decision = resolveGuard(session.kind, session.role, pathname, session.capabilities);
  let redirectHref: string | null = null;
  if (session.blockedReason && pathname !== '/sign-in-blocked') {
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
