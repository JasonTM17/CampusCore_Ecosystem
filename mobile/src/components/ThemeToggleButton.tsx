import { Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { chromeFor } from '../design/chrome';
import { minTapTarget, tokens } from '../design/tokens';
import { useTheme } from '../design/theme';
import { nextThemePreference } from '../design/theme-preference';
import { useShellCopy } from '../i18n/use-shell-copy';

/** Compact theme cycle switch used by the signed-in shell and public account headers. */
export function ThemeToggleButton() {
  const { scheme, preference, setPreference } = useTheme();
  const chrome = chromeFor(scheme);
  const { copy } = useShellCopy();
  const nextPreference = nextThemePreference(preference);
  const themeAction = nextPreference === 'system'
    ? copy.theme.switchToSystem
    : nextPreference === 'dark'
      ? copy.theme.switchToDark
      : copy.theme.switchToLight;
  const themeLabel = `${copy.theme[preference]}, ${themeAction}`;
  const themeIcon = nextPreference === 'system'
    ? 'theme-light-dark'
    : nextPreference === 'dark'
      ? 'weather-night'
      : 'white-balance-sunny';

  return (
    <Pressable
      accessibilityLabel={themeLabel}
      accessibilityRole="button"
      onPress={() => setPreference(nextPreference)}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? chrome.overlay : 'transparent' }]}
    >
      <MaterialCommunityIcons color={chrome.onSurface} name={themeIcon} size={24} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconButton: { alignItems: 'center', borderRadius: tokens.radii.control, height: minTapTarget, justifyContent: 'center', width: minTapTarget },
});
