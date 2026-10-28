import { Redirect, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'react-native';
import {
  BeVietnamPro_400Regular,
  BeVietnamPro_500Medium,
  BeVietnamPro_600SemiBold,
  BeVietnamPro_700Bold,
  useFonts,
} from '@expo-google-fonts/be-vietnam-pro';

import { ThemeProvider, useTheme } from '../src/design/theme';
import { pathFor, resolveGuard } from '../src/navigation/route-map';
import { SessionProvider, useSession } from '../src/session/SessionContext';

/**
 * Root layout (mobile-policy §1, KM-14/KM-17). Boot order is pinned:
 * fonts → install-marker check → loadBootstrap → optional silent refresh →
 * session state → router render. The SecureStore/bootstrap steps plug into
 * this slot in the OIDC wave — until then the bootstrap is just fonts, and
 * the guard never evaluates before fonts resolve.
 */
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <ThemeProvider>
      <ThemedStatusBar />
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </ThemeProvider>
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
