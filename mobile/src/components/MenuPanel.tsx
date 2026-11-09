import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, findNodeHandle, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { minTapTarget, tokens } from '../design/tokens';
import { chromeFontScaleCap } from '../design/font-scale';
import { chromeFor } from '../design/chrome';
import { useThemedStyles, useTheme } from '../design/theme';
import type { ThemeColors } from '../design/theme';
import {
  canAccessScreen,
  getMenuSections,
  getScreenDefinition,
  type ScreenName,
  type UserRole,
} from '../navigation/routes';
import { useShellCopy } from '../i18n/use-shell-copy';
import { SignOutDialog } from '../screens/account/SignOutDialog';
import { Avatar, Button, StatusPill, UiText } from './Ui';

/** Screens that only make sense with a target id, so they never get a menu entry. */
const PARAMETERISED_SCREENS: ReadonlySet<ScreenName> = new Set(['thesis.detail', 'thesis.registration']);

export interface MenuIdentity {
  name: string;
  email: string;
  demo?: boolean;
}

interface MenuPanelProps {
  activeRoute: ScreenName;
  role: UserRole;
  onClose(): void;
  onNavigate(route: ScreenName): void;
  onSwitchRole(role: UserRole): void;
  allowRoleSwitch: boolean;
  /** Signed-in identity block, fed by the shell from the profile read. */
  identity?: MenuIdentity;
  /** Signed-in session block: the profile screen owns the same flow. */
  onSignOut?(): void;
}

export function MenuPanel({ activeRoute, role, onClose, onNavigate, onSwitchRole, allowRoleSwitch, identity, onSignOut }: MenuPanelProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors, scheme, window } = useTheme();
  const largeText = window.fontScale >= chromeFontScaleCap;
  const chrome = chromeFor(scheme);
  const { copy, screenTitle } = useShellCopy();
  const previousRoute = useRef(activeRoute);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const sections = getMenuSections(role);
  const firstMenuItem = sections
    .flatMap((section) => section.screens)
    .find((screen) => canAccessScreen(role, screen) && !PARAMETERISED_SCREENS.has(screen));
  const firstMenuItemRef = useRef<View | null>(null);

  useEffect(() => {
    const target = findNodeHandle(firstMenuItemRef.current);
    if (target !== null) AccessibilityInfo.setAccessibilityFocus(target);
  }, []);

  useEffect(() => {
    if (previousRoute.current === activeRoute) return;
    previousRoute.current = activeRoute;
    onClose();
  }, [activeRoute, onClose]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  return (
    <View style={styles.overlay}>
      <Pressable accessibilityLabel={copy.closeMenu} accessibilityRole="button" onPress={onClose} style={[styles.backdrop, { backgroundColor: chrome.scrim }]} />
      <View accessibilityViewIsModal importantForAccessibility="yes" style={styles.panel}>
        <View style={[styles.panelHeader, { backgroundColor: chrome.surface }]}>
          <Image accessible={false} accessibilityElementsHidden importantForAccessibility="no" source={require('../../assets/hcmute-logo.png')} resizeMode="contain" style={styles.logo} />
          <View style={styles.headerCopy}>
            <UiText variant="meta" style={{ color: chrome.onSurfaceMuted }}>
              CampusUTE
            </UiText>
            <UiText accessibilityRole="header" variant="headlineSmall" style={{ color: chrome.onSurface }}>{copy.menuTitle}</UiText>
          </View>
          <Button label={copy.close} onPress={onClose} variant="text" onBrand />
        </View>

        {identity ? (
          <View style={styles.identity}>
            <Avatar label={identity.name.charAt(0)} size={40} />
            <View style={styles.identityCopy}>
              <UiText variant="label" style={styles.identityName}>{identity.name}</UiText>
              <UiText variant="meta" tone="muted" style={styles.identityEmail}>{identity.email}</UiText>
              <View style={styles.identityChips}>
                <StatusPill label={copy.roles[role]} tone="primary" />
                {identity.demo ? <StatusPill label={copy.demoTag} tone="neutral" /> : null}
              </View>
            </View>
          </View>
        ) : null}

        {allowRoleSwitch ? (
          <><UiText variant="label" tone="muted" style={styles.roleLabel}>
            {copy.previewRole}
          </UiText>
          <View testID="menu-panel-role-row" style={[styles.roleRow, largeText ? styles.roleRowStacked : undefined]}>
            {(['student', 'lecturer', 'admin'] as const).map((candidate) => (
            <Pressable
              key={candidate}
              accessibilityRole="button"
              accessibilityState={{ selected: candidate === role }}
              onPress={() => onSwitchRole(candidate)}
              style={[styles.roleButton, largeText ? styles.roleButtonStacked : undefined, candidate === role ? styles.roleButtonActive : undefined]}
            >
              <UiText variant="label" tone={candidate === role ? 'onPrimary' : 'muted'} style={{ textAlign: 'center' }}>
                {copy.roles[candidate]}
              </UiText>
            </Pressable>
            ))}
          </View></>
        ) : null}

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.menuContent}>
          {sections.map((section) => {
            const screens = section.screens.filter(
              (screen) => canAccessScreen(role, screen) && !PARAMETERISED_SCREENS.has(screen),
            );
            if (screens.length === 0) {
              return null;
            }

            return (
              <View key={section.key} style={styles.section}>
                <UiText accessibilityRole="header" variant="label" tone="muted" style={styles.sectionTitle}>
                  {copy.sections[section.key]}
                </UiText>
                {screens.map((screenName) => {
                  const active = screenName === activeRoute;
                  const screen = getScreenDefinition(screenName);

                  return (
                    <Pressable
                      key={screenName}
                      accessibilityLabel={screenTitle(screenName)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => onNavigate(screenName)}
                      ref={screenName === firstMenuItem ? firstMenuItemRef : undefined}
                      style={({ pressed }) => [styles.menuItem, active ? styles.menuItemActive : undefined, pressed ? { backgroundColor: colors.surfaceLow } : undefined]}
                    >
                      <View style={[styles.menuIcon, { backgroundColor: active ? colors.primaryFixed : colors.surfaceLow }]}>
                        <MaterialCommunityIcons
                          color={active ? colors.primary : colors.textMuted}
                          name={screen?.icon ?? 'circle-outline'}
                          size={19}
                        />
                      </View>
                      <UiText variant="bodySmall" tone={active ? 'primary' : 'default'} style={styles.menuLabel}>
                        {screenTitle(screenName)}
                      </UiText>
                      <MaterialCommunityIcons color={colors.textMuted} name="chevron-right" size={20} />
                    </Pressable>
                  );
                })}
              </View>
            );
          })}

          <View style={styles.accountBlock}>
            <Pressable
              accessibilityLabel={copy.profileSettings}
              accessibilityRole="button"
              accessibilityState={{ selected: activeRoute === 'profile' }}
              onPress={() => onNavigate('profile')}
              style={({ pressed }) => [styles.menuItem, activeRoute === 'profile' ? styles.menuItemActive : undefined, pressed ? { backgroundColor: colors.surfaceLow } : undefined]}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.surfaceLow }]}>
                <MaterialCommunityIcons color={colors.textMuted} name="cog-outline" size={19} />
              </View>
              <UiText variant="bodySmall" style={styles.menuLabel}>{copy.profileSettings}</UiText>
              <MaterialCommunityIcons color={colors.textMuted} name="chevron-right" size={20} />
            </Pressable>
            {onSignOut ? (
              <Pressable
                accessibilityLabel={copy.signOut}
                accessibilityRole="button"
                onPress={() => setSignOutOpen(true)}
                style={({ pressed }) => [styles.menuItem, pressed ? { backgroundColor: colors.errorFixed } : undefined]}
              >
                <View style={[styles.menuIcon, { backgroundColor: colors.errorFixed }]}>
                  <MaterialCommunityIcons color={colors.error} name="logout" size={19} />
                </View>
                <UiText variant="bodySmall" tone="error" style={styles.menuLabel}>{copy.signOut}</UiText>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
        <SignOutDialog
          visible={signOutOpen}
          onConfirm={() => {
            setSignOutOpen(false);
            onSignOut?.();
          }}
          onCancel={() => setSignOutOpen(false)}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', zIndex: 10 },
  backdrop: { ...StyleSheet.absoluteFill },
  panel: {
    backgroundColor: colors.card,
    borderColor: colors.outlineVariant,
    borderWidth: 1,
    borderTopLeftRadius: tokens.radii.card,
    borderTopRightRadius: tokens.radii.card,
    maxHeight: '86%',
    paddingHorizontal: tokens.layout.mobileGutter,
    overflow: 'hidden',
  },
  panelHeader: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm + tokens.spacing.xs, marginHorizontal: -tokens.layout.mobileGutter, padding: tokens.spacing.md, marginBottom: tokens.spacing.md },
  logo: { width: 36, height: 40, borderRadius: tokens.radii.control, backgroundColor: tokens.colors.card },
  headerCopy: { flex: 1 },
  identity: { alignItems: 'center', borderBottomColor: colors.outlineVariant, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: tokens.spacing.sm + tokens.spacing.xs, marginBottom: tokens.spacing.md, paddingBottom: tokens.spacing.md },
  identityCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  identityName: { flexShrink: 1 },
  identityEmail: { flexShrink: 1 },
  identityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  roleLabel: { marginBottom: tokens.spacing.xs },
  roleRow: { flexDirection: 'row', gap: tokens.spacing.sm, marginBottom: tokens.spacing.md },
  roleRowStacked: { flexDirection: 'column' },
  roleButton: { flex: 1, minWidth: 0, alignItems: 'center', backgroundColor: colors.surfaceLow, borderColor: colors.outlineVariant, borderRadius: tokens.radii.control, borderWidth: 1, justifyContent: 'center', minHeight: minTapTarget, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.sm },
  roleButtonStacked: { flexBasis: 'auto', flexGrow: 0 },
  roleButtonActive: { backgroundColor: colors.primary },
  menuContent: { paddingBottom: tokens.spacing.xl },
  section: { marginBottom: tokens.spacing.lg },
  sectionTitle: { marginBottom: tokens.spacing.sm },
  menuItem: { alignItems: 'center', borderBottomColor: colors.outlineVariant, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: tokens.radii.control, flexDirection: 'row', minHeight: 52, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.sm },
  menuItemActive: { backgroundColor: colors.primaryFixed },
  menuIcon: { alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: tokens.radii.control },
  menuLabel: { flex: 1, marginLeft: tokens.spacing.sm },
  accountBlock: { borderTopColor: colors.outlineVariant, borderTopWidth: StyleSheet.hairlineWidth, marginTop: tokens.spacing.sm, paddingTop: tokens.spacing.sm },
});
