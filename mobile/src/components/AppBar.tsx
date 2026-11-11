import { createContext, useContext } from 'react';
import { Image, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { apiClient } from '../api/client';
import { chromeFontScaleCap } from '../design/font-scale';
import { chromeFor } from '../design/chrome';
import { minTapTarget, tokens } from '../design/tokens';
import { useTheme } from '../design/theme';
import { useShellCopy } from '../i18n/use-shell-copy';
import type { UserRole } from '../navigation/routes';
import { PreviewPill } from './PreviewPill';
import { LanguageToggleButton } from './LanguageToggleButton';
import { ThemeToggleButton } from './ThemeToggleButton';
import { AppBarAccountAvatar } from './AppBarAccountAvatar';
import { brandWordmarkFit, compactSingleLineFit } from './ui/primitives';
import { UiText } from './ui/UiText';
import { unreadBadgeLabel } from './unread-badge';

// Standalone component renderers may omit the safe-area provider/context.
// Native app renders always use the package's real context.
const AppBarInsetsContext = SafeAreaInsetsContext ?? createContext<{ top: number } | null>(null);

export interface AppBarProps {
  /** Signed-in view: role and a profile shortcut. */
  role?: UserRole;
  /** Signed-in view: the account portrait; omitted reads the saved profile. */
  avatar?: string | null;
  /** Signed-in admissions-only view for an account without an academic role. */
  applicant?: boolean;
  /** Signed-in view: the notification preview control and its unread count. */
  unreadCount?: number;
  onNotifications?: () => void;
  onProfile?: () => void;
  /** Signed-in view without a profile screen: the session-ending control. */
  onSignOut?: () => void;
  /** Guest view: a way back to sign-in. */
  onSignIn?: () => void;
}

/**
 * Brand top bar shared by every (app) screen: the web portal navy chrome with
 * the CampusUTE mark, the role and a profile shortcut. It owns the status-bar inset so the navy runs under the clock.
 */
export function AppBar({ role, avatar, applicant = false, unreadCount = 0, onNotifications, onProfile, onSignOut, onSignIn }: AppBarProps) {
  const { scheme, window } = useTheme();
  const chrome = chromeFor(scheme);
  const insets = useContext(AppBarInsetsContext);
  const { copy } = useShellCopy();
  const roleLabel = applicant ? copy.roles.applicant : role ? copy.roles[role] : null;
  const preview = apiClient.mode === 'preview';
  const largeChrome = window.fontScale >= chromeFontScaleCap - 0.01;
  const brandVariant = largeChrome ? 'meta' : 'headlineSmall';
  const unread = unreadCount > 0 ? unreadCount : undefined;
  const notificationsLabel = unread === undefined
    ? copy.notifications.title
    : `${copy.notifications.title}, ${unread} ${copy.unread}`;

  return (
    <View
      testID="app-bar"
      style={[styles.bar, { backgroundColor: chrome.surface, paddingTop: insets?.top ?? 0, borderBottomColor: chrome.overlay }]}
    >
      <StatusBar barStyle="light-content" backgroundColor={chrome.surface} />
      <View style={styles.row}>
        <View style={styles.mark}>
          <Image
            accessibilityLabel="HCMUTE"
            accessibilityRole="image"
            source={require('../../assets/hcmute-logo.png')}
            resizeMode="contain"
            style={styles.logo}
          />
        </View>
        <View style={styles.copy}>
          <UiText
            {...brandWordmarkFit}
            variant={brandVariant}
            maxFontSizeMultiplier={chromeFontScaleCap}
            style={{ color: chrome.onSurface }}
          >
            CampusUTE
          </UiText>
          {roleLabel && largeChrome ? (
            <UiText
              {...compactSingleLineFit}
              variant="meta"
              maxFontSizeMultiplier={chromeFontScaleCap}
              style={{ color: chrome.onSurfaceMuted, flexShrink: 1, minWidth: 0 }}
            >
              {roleLabel}
            </UiText>
          ) : null}
        </View>
        {roleLabel && !largeChrome && !preview ? (
          <View style={[styles.rolePill, { backgroundColor: chrome.overlay }]}>
            <UiText
              {...compactSingleLineFit}
              variant="meta"
              maxFontSizeMultiplier={chromeFontScaleCap}
              style={{ color: chrome.onSurface, flexShrink: 1, minWidth: 0 }}
            >
              {roleLabel}
            </UiText>
          </View>
        ) : null}
        <PreviewPill />
        {/* Signed-in users change language and appearance in Profile; the bar stays brand + role + bell + account. */}
        {role ? null : <LanguageToggleButton />}
        {role ? null : <ThemeToggleButton />}
        {role && onNotifications ? (
          <Pressable
            accessibilityLabel={notificationsLabel}
            accessibilityRole="button"
            onPress={onNotifications}
            style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? chrome.overlay : 'transparent' }]}
          >
            <MaterialCommunityIcons color={chrome.onSurface} name="bell-outline" size={24} />
            {unread === undefined ? null : (
              <View accessibilityElementsHidden accessible={false} importantForAccessibility="no" style={[styles.badge, { backgroundColor: chrome.gold }]}>
                <UiText variant="meta" style={[styles.badgeCount, { color: chrome.onGold }]}>{unreadBadgeLabel(unread)}</UiText>
              </View>
            )}
          </Pressable>
        ) : null}
        {onProfile ? (
          <Pressable
            accessibilityLabel={copy.screens.profile}
            accessibilityRole="button"
            onPress={onProfile}
            style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? chrome.overlay : 'transparent' }]}
          >
            <AppBarAccountAvatar avatar={avatar} color={chrome.onSurface} />
          </Pressable>
        ) : null}
        {onSignOut ? (
          <Pressable
            accessibilityLabel={copy.signOut}
            accessibilityRole="button"
            onPress={onSignOut}
            style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? chrome.overlay : 'transparent' }]}
          >
            <MaterialCommunityIcons color={chrome.onSurface} name="logout" size={26} />
          </Pressable>
        ) : null}
        {onSignIn ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSignIn}
            style={({ pressed }) => [styles.signIn, { backgroundColor: pressed ? chrome.overlay : chrome.accent }]}
          >
            <UiText variant="label" maxFontSizeMultiplier={chromeFontScaleCap} style={{ color: chrome.surfaceStrong }}>{copy.guestSignIn}</UiText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: tokens.layout.mobileGutter, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: 56, paddingVertical: tokens.spacing.sm },
  mark: { alignItems: 'center', backgroundColor: tokens.colors.card, borderRadius: tokens.radii.control, height: 36, justifyContent: 'center', padding: 4, width: 36 },
  logo: { height: '100%', width: '100%' },
  copy: { flex: 1, minWidth: 0 },
  rolePill: { borderRadius: tokens.spacing.xs, paddingHorizontal: tokens.spacing.sm, paddingVertical: 4, flexShrink: 1 },
  iconButton: { alignItems: 'center', borderRadius: tokens.radii.control, height: minTapTarget, justifyContent: 'center', width: minTapTarget },
  badge: { alignItems: 'center', borderRadius: tokens.radii.control, justifyContent: 'center', minHeight: 16, minWidth: 16, paddingHorizontal: 3, position: 'absolute', right: 2, top: 2 },
  badgeCount: { fontSize: 10, lineHeight: 12, textAlign: 'center' },
  signIn: { alignItems: 'center', borderRadius: tokens.radii.control, justifyContent: 'center', minHeight: minTapTarget, paddingHorizontal: tokens.spacing.md },
});
