import type { Ref } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { View as NativeView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { tokens } from '../design/tokens';
import { chromeFontScaleCap } from '../design/font-scale';
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
  unreadCount?: number;
  menuButtonRef?: Ref<NativeView>;
}

export function BottomNavigation({ activeRoute, role, onNavigate, onMenu, unreadCount, menuButtonRef }: BottomNavigationProps) {
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
            const count = item.route === 'notifications' && unreadCount !== undefined && unreadCount > 0
              ? unreadCount
              : undefined;

            return (
              <Pressable
                key={item.route}
                accessibilityLabel={count === undefined ? navLabel(item.label) : `${navLabel(item.label)}, ${count} ${copy.unread}`}
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
                  {count === undefined ? null : (
                    <View accessibilityElementsHidden accessible={false} importantForAccessibility="no" style={styles.badge}>
                      <UiText variant="meta" tone="onPrimary" style={styles.badgeCount}>{count}</UiText>
                    </View>
                  )}
                </View>
                <UiText
                  adjustsFontSizeToFit={false}
                  maxFontSizeMultiplier={chromeFontScaleCap}
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
          ref={menuButtonRef}
          style={({ pressed }) => [styles.item, pressed ? styles.pressed : undefined]}
        >
          <View style={styles.icon}>
            <MaterialCommunityIcons color={colors.textMuted} name="menu" size={20} />
          </View>
          <UiText variant="meta" tone="muted" maxFontSizeMultiplier={chromeFontScaleCap} style={styles.label}>
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
  badge: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: tokens.radii.pill, justifyContent: 'center', minHeight: 17, minWidth: 17, paddingHorizontal: 3, position: 'absolute', right: 0, top: -3 },
  badgeCount: { fontSize: 10, lineHeight: 12, textAlign: 'center' },
  label: { textAlign: 'center', alignSelf: 'stretch' },
  activeIcon: { backgroundColor: colors.primaryFixed },
  pressed: { backgroundColor: colors.surfaceLow, borderRadius: tokens.radii.control },
});
