import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { tokens } from '../design/tokens';
import { useThemedStyles, useTheme } from '../design/theme';
import type { ThemeColors } from '../design/theme';
import {
  getBottomNavigation,
  type ScreenName,
  type UserRole,
} from '../navigation/routes';
import { useShellCopy } from '../i18n/use-shell-copy';
import { UiText } from './Ui';

export interface BottomNavigationProps {
  activeRoute: ScreenName;
  role: UserRole;
  onNavigate(route: ScreenName): void;
  onMenu(): void;
}

export function BottomNavigation({ activeRoute, role, onNavigate, onMenu }: BottomNavigationProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const items = getBottomNavigation(role);
  const { copy, navLabel } = useShellCopy();

  return (
    <View testID="bottom-navigation" style={styles.navigation}>
      <View style={styles.navigationInner}>
        <View accessibilityRole="tablist" style={[styles.tabList, { flex: items.length }]}>
          {items.map((item) => {
            const active = item.route === activeRoute;

            return (
              <Pressable
                key={item.route}
                accessibilityLabel={navLabel(item.label)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => onNavigate(item.route)}
                style={({ pressed }) => [styles.item, { borderTopColor: active ? colors.primary : 'transparent' }, pressed ? styles.pressed : undefined]}
              >
                <View style={[styles.icon, active ? styles.activeIcon : undefined]}>
                  <MaterialCommunityIcons
                    color={active ? colors.primary : colors.textMuted}
                    name={item.icon}
                    size={20}
                  />
                </View>
                <UiText
                  adjustsFontSizeToFit={false}
                  minimumFontScale={1}
                  numberOfLines={2}
                  variant="meta"
                  style={styles.label}
                  tone={active ? 'primary' : 'muted'}
                >
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
          style={({ pressed }) => [styles.item, pressed ? styles.pressed : undefined]}
        >
          <View style={styles.icon}>
            <MaterialCommunityIcons color={colors.textMuted} name="menu" size={20} />
          </View>
          <UiText variant="meta" tone="muted" style={styles.label}>
            {copy.menu}
          </UiText>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  navigation: {
    backgroundColor: colors.card,
    borderTopColor: colors.outlineVariant,
    borderTopWidth: 1,
    minHeight: tokens.layout.bottomNavigationHeight,
    paddingHorizontal: tokens.spacing.xs,
  },
  navigationInner: { alignItems: 'stretch', flexDirection: 'row', minHeight: tokens.layout.bottomNavigationHeight },
  tabList: { alignItems: 'stretch', flexDirection: 'row', minWidth: 0 },
  item: { alignItems: 'center', flex: 1, justifyContent: 'flex-start', minHeight: tokens.layout.bottomNavigationHeight, minWidth: 0, paddingHorizontal: 2, paddingVertical: tokens.spacing.sm, borderTopWidth: 2, borderTopColor: 'transparent' },
  icon: { alignItems: 'center', borderRadius: tokens.radii.control, height: 28, justifyContent: 'center', marginBottom: tokens.spacing.xs, width: 44 },
  label: { textAlign: 'center', alignSelf: 'stretch' },
  activeIcon: { backgroundColor: colors.primaryFixed },
  pressed: { backgroundColor: colors.surfaceLow, borderRadius: tokens.radii.control },
});
