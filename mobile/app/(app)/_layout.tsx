import { Redirect, Slot, usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '../../src/components/AppBar';
import { AssistantFab } from '../../src/components/AssistantFab';
import { BottomNavigation } from '../../src/components/BottomNavigation';
import { MenuPanel } from '../../src/components/MenuPanel';
import { NavigationRail } from '../../src/components/NavigationRail';
import { NO_CAPABILITIES } from '../../src/auth/capabilities';
import { LANE_FLAGS } from '../../src/config/lane-flags';
import { useTheme } from '../../src/design/theme';
import { useDashboardPrefetch } from '../../src/hooks/use-dashboard-prefetch';
import {
  pathFor,
  resolveGuard,
  roleHomePath,
  screenForPath,
} from '../../src/navigation/route-map';
import type { ScreenName } from '../../src/navigation/routes';
import { useSession } from '../../src/session/SessionContext';

/**
 * (app) group layout — owns the protected-route guard and the chrome
 * (mobile-policy §1/§2, KM-13a, KM-14). Every child render first passes
 * `resolveGuard`; a redirect decision renders `<Redirect>` so deep links and
 * back navigation cannot bypass session or role gates. Adaptive navigation and
 * the menu panel live here, not inside screens.
 */
export default function AppGroupLayout() {
  const router = useRouter();
  const session = useSession();
  const pathname = usePathname() ?? '/';
  useDashboardPrefetch(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const { colors, window } = useTheme();
  const expanded = window.class === 'expanded';

  const decision = resolveGuard(session.kind, session.role, pathname, session.capabilities, LANE_FLAGS);
  if (decision.action === 'redirect' && decision.to) {
    return <Redirect href={pathFor(decision.to)} />;
  }

  if (session.kind === 'signedOut') {
    // Guest view of a public page: no account chrome, just a way back to sign-in.
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
        <AppBar onSignIn={() => router.replace('/sign-in')} />
        <View testID="app-route-content" style={styles.routeContent}><Slot /></View>
      </SafeAreaView>
    );
  }

  const activeRoute = (screenForPath(pathname) ?? 'dashboard.student') as ScreenName;
  const navigate = (route: ScreenName) => {
    setMenuOpen(false);
    router.push(pathFor(route));
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
      <AppBar role={session.role} onProfile={() => navigate('profile')} />
      <View style={styles.container}>
        <View
          testID="app-chrome"
          importantForAccessibility={menuOpen ? 'no-hide-descendants' : 'auto'}
          style={[styles.content, expanded ? styles.expanded : undefined]}
        >
          {expanded ? (
            <NavigationRail
              activeRoute={activeRoute}
              role={session.role}
              onNavigate={navigate}
              onMenu={() => setMenuOpen(true)}
            />
          ) : null}
          <View testID="app-route-content" style={styles.routeContent}>
            <Slot />
            <AssistantFab
              session={session.kind}
              role={session.role}
              capabilities={session.capabilities ?? NO_CAPABILITIES}
              pathname={pathname}
              onPress={() => navigate('assistant.chat')}
            />
          </View>
          {!expanded ? (
            <BottomNavigation
              activeRoute={activeRoute}
              role={session.role}
              onNavigate={navigate}
              onMenu={() => setMenuOpen(true)}
            />
          ) : null}
        </View>
        {menuOpen ? (
          <MenuPanel
            activeRoute={activeRoute}
            role={session.role}
            onClose={() => setMenuOpen(false)}
            onNavigate={navigate}
            onSwitchRole={(role) => {
              session.switchRole(role);
              setMenuOpen(false);
              router.replace(roleHomePath(role));
            }}
            allowRoleSwitch={session.kind === 'preview'}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  content: { flex: 1 },
  expanded: { flexDirection: 'row' },
  routeContent: { flex: 1, minWidth: 0 },
});
