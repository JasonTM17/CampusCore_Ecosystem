import { Pressable, StyleSheet } from 'react-native';

import { chromeFontScaleCap } from '../design/font-scale';
import { chromeFor } from '../design/chrome';
import { minTapTarget, tokens } from '../design/tokens';
import { useTheme } from '../design/theme';
import { useLocale } from '../i18n/locale-provider';
import { useShellCopy } from '../i18n/use-shell-copy';
import { UiText } from './ui/UiText';

/** Compact VI/EN switch used by the signed-in shell and public account headers. */
export function LanguageToggleButton() {
  const { scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const { locale, setLocale } = useLocale();
  const { copy } = useShellCopy();

  return (
    <Pressable
      accessibilityLabel={copy.language}
      accessibilityRole="button"
      onPress={() => setLocale(locale === 'vi' ? 'en' : 'vi')}
      style={({ pressed }) => [styles.language, { backgroundColor: pressed ? chrome.surfaceStrong : chrome.overlay }]}
    >
      <UiText variant="meta" maxFontSizeMultiplier={chromeFontScaleCap} style={{ color: chrome.onSurface }}>
        {locale.toUpperCase()}
      </UiText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  language: { alignItems: 'center', borderRadius: tokens.radii.control, justifyContent: 'center', minHeight: minTapTarget, minWidth: minTapTarget, paddingHorizontal: tokens.spacing.xs },
});
