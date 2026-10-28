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
  if (session.blockedReason && pathname !== '/sign-in-blocked') {
    return <Redirect href="/sign-in-blocked" />;
  }
  const decision = resolveGuard(session.kind, session.role, pathname);
  if (decision.action === 'redirect' && decision.to) {
    return <Redirect href={pathFor(decision.to)} />;
  }
  return <ThemedStack />;
}

function ThemedStack() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
