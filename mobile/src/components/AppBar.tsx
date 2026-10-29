import { createContext, useContext } from 'react';
import { Image, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { apiClient } from '../api/client';
import { chromeFor } from '../design/chrome';
import { tokens } from '../design/tokens';
import { useTheme } from '../design/theme';
import { useShellCopy } from '../i18n/use-shell-copy';
import type { UserRole } from '../navigation/routes';
import { PreviewPill } from './PreviewPill';
import { UiText } from './ui/UiText';

// Standalone component renderers may omit the safe-area provider/context.
// Native app renders always use the package's real context.
const AppBarInsetsContext = SafeAreaInsetsContext ?? createContext<{ top: number } | null>(null);

export interface AppBarProps {
  /** Signed-in view: role and a profile shortcut. */
  role?: UserRole;
  onProfile?: () => void;
  /** Guest view: a way back to sign-in. */
  onSignIn?: () => void;
}

/**
 * Brand top bar shared by every (app) screen: the web portal navy chrome with
 * the CampusUTE mark, the role and a profile shortcut. It owns the status-bar inset so the navy runs under the clock.
 */
export function AppBar({ role, onProfile, onSignIn }: AppBarProps) {
  const { scheme, window } = useTheme();
  const chrome = chromeFor(scheme);
  const insets = useContext(AppBarInsetsContext);
  const { copy } = useShellCopy();
  const roleLabel = role ? copy.roles[role] : null;
  const preview = apiClient.mode === 'preview';

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
          <UiText variant="headlineSmall" style={{ color: chrome.onSurface }}>
            CampusUTE
          </UiText>
          {roleLabel && window.fontScale >= 1.3 ? <UiText variant="meta" style={{ color: chrome.onSurfaceMuted }}>{roleLabel}</UiText> : null}
        </View>
        {roleLabel && window.fontScale < 1.3 && !preview ? (
          <View style={[styles.rolePill, { backgroundColor: chrome.overlay }]}>
            <UiText variant="meta" style={{ color: chrome.onSurface }}>
              {roleLabel}
            </UiText>
          </View>
        ) : null}
        <PreviewPill />
        {onProfile ? (
          <Pressable
            accessibilityLabel={copy.screens.profile}
            accessibilityRole="button"
            onPress={onProfile}
            style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? chrome.overlay : 'transparent' }]}
          >
            <MaterialCommunityIcons color={chrome.onSurface} name="account-circle-outline" size={26} />
          </Pressable>
        ) : null}
        {onSignIn ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSignIn}
            style={({ pressed }) => [styles.signIn, { backgroundColor: pressed ? chrome.overlay : chrome.gold }]}
          >
            <UiText variant="label" style={{ color: chrome.onGold }}>{copy.guestSignIn}</UiText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: tokens.layout.mobileGutter, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.md, minHeight: 56, paddingVertical: tokens.spacing.sm },
  mark: { alignItems: 'center', backgroundColor: tokens.colors.card, borderRadius: tokens.radii.control, height: 36, justifyContent: 'center', padding: 4, width: 36 },
  logo: { height: '100%', width: '100%' },
  copy: { flex: 1, minWidth: 0 },
  rolePill: { borderRadius: tokens.spacing.xs, paddingHorizontal: tokens.spacing.sm, paddingVertical: 4, flexShrink: 1 },
  iconButton: { alignItems: 'center', borderRadius: tokens.radii.control, height: tokens.layout.touchTarget, justifyContent: 'center', width: tokens.layout.touchTarget },
  signIn: { alignItems: 'center', borderRadius: tokens.radii.control, justifyContent: 'center', minHeight: tokens.layout.touchTarget, paddingHorizontal: tokens.spacing.md },
});
