import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { tokens } from '../design/tokens';
import { chromeFor } from '../design/chrome';
import { useThemedStyles, useTheme } from '../design/theme';
import type { ThemeColors } from '../design/theme';
import { getBottomNavigation } from '../navigation/routes';
import type { BottomNavigationProps } from './BottomNavigation';
import { useShellCopy } from '../i18n/use-shell-copy';
import { UiText } from './Ui';

/** Expanded-window presentation of the same role-aware primary navigation. */
export function NavigationRail({ activeRoute, role, onNavigate, onMenu }: BottomNavigationProps) {
  const styles = useThemedStyles(makeStyles);
  const { scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const items = getBottomNavigation(role);
  const { copy, navLabel } = useShellCopy();

  return (
    <ScrollView
      testID="navigation-rail"
      style={[styles.navigation, { backgroundColor: chrome.surfaceStrong, borderRightColor: chrome.overlay }]}
      contentContainerStyle={styles.navigationContent}
      showsVerticalScrollIndicator={false}
    >
      <View accessibilityRole="tablist" style={styles.tabList}>
        {items.map((item) => {
          const active = item.route === activeRoute;
          return (
            <Pressable
              key={item.route}
              accessibilityLabel={navLabel(item.label)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onNavigate(item.route)}
              style={({ pressed }) => [styles.item, active || pressed ? { backgroundColor: chrome.overlay } : undefined]}
            >
              <View style={styles.icon}>
                <MaterialCommunityIcons color={active ? chrome.gold : chrome.onSurfaceMuted} name={item.icon} size={20} />
              </View>
              <UiText variant="meta" style={[styles.label, { color: active ? chrome.onSurface : chrome.onSurfaceMuted }]}>
                {navLabel(item.label)}
              </UiText>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityLabel={copy.openMenu}
        accessibilityRole="button"
        onPress={onMenu}
        style={({ pressed }) => [styles.item, pressed ? { backgroundColor: chrome.overlay } : undefined]}
      >
        <View style={styles.icon}>
          <MaterialCommunityIcons color={chrome.onSurfaceMuted} name="menu" size={20} />
        </View>
        <UiText variant="meta" style={[styles.label, { color: chrome.onSurfaceMuted }]}>{copy.menu}</UiText>
      </Pressable>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  navigation: {
    backgroundColor: colors.card,
    borderRightColor: colors.outlineVariant,
    borderRightWidth: 1,
    flexGrow: 0,
    flexShrink: 0,
    width: tokens.layout.touchTarget * 2 + tokens.spacing.lg,
  },
  navigationContent: { gap: tokens.spacing.sm, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.md },
  tabList: { gap: tokens.spacing.sm },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: tokens.layout.touchTarget,
    minWidth: tokens.layout.touchTarget,
    paddingHorizontal: tokens.spacing.xs,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.control,
  },
  icon: { alignItems: 'center', borderRadius: tokens.radii.control, height: 30, justifyContent: 'center', marginBottom: tokens.spacing.xs, width: 40 },
  activeIcon: { backgroundColor: colors.primaryFixed },
  label: { alignSelf: 'stretch', flexShrink: 1, textAlign: 'center' },
  pressed: { backgroundColor: colors.surfaceLow, borderRadius: tokens.radii.control },
});
