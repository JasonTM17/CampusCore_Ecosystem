import { Redirect, Slot, usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomNavigation } from '../../src/components/BottomNavigation';
import { MenuPanel } from '../../src/components/MenuPanel';
import { tokens } from '../../src/design/tokens';
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
 * back navigation cannot bypass session or role gates. Bottom navigation and
 * the menu panel live here, not inside screens.
 */
export default function AppGroupLayout() {
  const router = useRouter();
  const session = useSession();
  const pathname = usePathname() ?? '/';
  const [menuOpen, setMenuOpen] = useState(false);

  const decision = resolveGuard(session.kind, session.role, pathname);
  if (decision.action === 'redirect' && decision.to) {
    return <Redirect href={pathFor(decision.to)} />;
  }

  const activeRoute = (screenForPath(pathname) ?? 'dashboard.student') as ScreenName;
  const navigate = (route: ScreenName) => {
    setMenuOpen(false);
    router.push(pathFor(route));
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={tokens.colors.background} />
      <View style={styles.container}>
        <View
          importantForAccessibility={menuOpen ? 'no-hide-descendants' : 'auto'}
          style={styles.content}
        >
          <Slot />
          <BottomNavigation
            activeRoute={activeRoute}
            role={session.role}
            onNavigate={navigate}
            onMenu={() => setMenuOpen(true)}
          />
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
  safeArea: { backgroundColor: tokens.colors.background, flex: 1 },
  container: { flex: 1 },
  content: { flex: 1 },
});
