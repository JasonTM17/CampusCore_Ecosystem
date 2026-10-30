import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { tokens } from '../design/tokens';
import { chromeFor } from '../design/chrome';
import { useThemedStyles, useTheme } from '../design/theme';
import type { ThemeColors } from '../design/theme';
import {
  menuSections,
  screenRegistry,
  type ScreenName,
  type UserRole,
} from '../navigation/routes';
import { useShellCopy } from '../i18n/use-shell-copy';
import { Button, UiText } from './Ui';

/** Screens that only make sense with a target id, so they never get a menu entry. */
const PARAMETERISED_SCREENS: ReadonlySet<ScreenName> = new Set(['thesis.detail', 'thesis.registration']);

interface MenuPanelProps {
  activeRoute: ScreenName;
  role: UserRole;
  onClose(): void;
  onNavigate(route: ScreenName): void;
  onSwitchRole(role: UserRole): void;
  allowRoleSwitch: boolean;
}

export function MenuPanel({ activeRoute, role, onClose, onNavigate, onSwitchRole, allowRoleSwitch }: MenuPanelProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors, scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const { copy, screenTitle } = useShellCopy();
  return (
    <View style={styles.overlay}>
      <Pressable accessibilityLabel={copy.closeMenu} accessibilityRole="button" onPress={onClose} style={[styles.backdrop, { backgroundColor: chrome.scrim }]} />
      <View accessibilityViewIsModal importantForAccessibility="yes" style={styles.panel}>
        <View style={[styles.panelHeader, { backgroundColor: chrome.surface }]}>
          <Image accessible={false} source={require('../../assets/hcmute-logo.png')} resizeMode="contain" style={styles.logo} />
          <View style={styles.headerCopy}>
            <UiText variant="meta" style={{ color: chrome.onSurfaceMuted }}>
              CampusUTE
            </UiText>
            <UiText accessibilityRole="header" variant="headlineSmall" style={{ color: chrome.onSurface }}>{copy.menuTitle}</UiText>
          </View>
          <Button label={copy.close} onPress={onClose} variant="text" onBrand />
        </View>

        {allowRoleSwitch ? (
          <><UiText variant="label" tone="muted" style={styles.roleLabel}>
            {copy.previewRole}
          </UiText>
          <View style={styles.roleRow}>
            {(['student', 'lecturer', 'admin'] as const).map((candidate) => (
            <Pressable
              key={candidate}
              accessibilityRole="button"
              accessibilityState={{ selected: candidate === role }}
              onPress={() => onSwitchRole(candidate)}
              style={[styles.roleButton, candidate === role ? styles.roleButtonActive : undefined]}
            >
              <UiText variant="label" tone={candidate === role ? 'onPrimary' : 'muted'} style={{ textAlign: 'center' }}>
                {copy.roles[candidate]}
              </UiText>
            </Pressable>
            ))}
          </View></>
        ) : null}

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.menuContent}>
          {menuSections.map((section) => {
            const screens = screenRegistry.filter(
              (screen) =>
                section.families.some((family) => family === screen.family) &&
                screen.roles.includes(role) &&
                !PARAMETERISED_SCREENS.has(screen.name),
            );
            if (screens.length === 0) {
              return null;
            }

            return (
              <View key={section.title} style={styles.section}>
                <UiText accessibilityRole="header" variant="label" tone="muted" style={styles.sectionTitle}>
                  {section.title === 'Staff' ? copy.sections.staff : section.title === 'Assistant' ? copy.sections.assistant : copy.sections.student}
                </UiText>
                {screens.map((screen) => {
                  const active = screen.name === activeRoute;

                  return (
                    <Pressable
                      key={screen.name}
                      accessibilityLabel={screenTitle(screen.name)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => onNavigate(screen.name)}
                      style={({ pressed }) => [styles.menuItem, active ? styles.menuItemActive : undefined, pressed ? { backgroundColor: colors.surfaceLow } : undefined]}
                    >
                      <View style={[styles.menuIcon, { backgroundColor: active ? colors.primaryFixed : colors.surfaceLow }]}>
                        <MaterialCommunityIcons
                          color={active ? colors.primary : colors.textMuted}
                          name={screen.icon}
                          size={19}
                        />
                      </View>
                      <UiText variant="bodySmall" tone={active ? 'primary' : 'default'} style={styles.menuLabel}>
                        {screenTitle(screen.name)}
                      </UiText>
                      <MaterialCommunityIcons color={colors.textMuted} name="chevron-right" size={20} />
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
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
  roleLabel: { marginBottom: tokens.spacing.xs },
  roleRow: { flexDirection: 'row', gap: tokens.spacing.sm, marginBottom: tokens.spacing.md },
  roleButton: { flex: 1, minWidth: 0, alignItems: 'center', backgroundColor: colors.surfaceLow, borderColor: colors.outlineVariant, borderRadius: tokens.radii.control, borderWidth: 1, justifyContent: 'center', minHeight: tokens.layout.touchTarget, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.sm },
  roleButtonActive: { backgroundColor: colors.primary },
  menuContent: { paddingBottom: tokens.spacing.xl },
  section: { marginBottom: tokens.spacing.lg },
  sectionTitle: { marginBottom: tokens.spacing.sm },
  menuItem: { alignItems: 'center', borderBottomColor: colors.outlineVariant, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: tokens.radii.control, flexDirection: 'row', minHeight: 52, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.sm },
  menuItemActive: { backgroundColor: colors.primaryFixed },
  menuIcon: { alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: tokens.radii.control },
  menuLabel: { flex: 1, marginLeft: tokens.spacing.sm },
});
