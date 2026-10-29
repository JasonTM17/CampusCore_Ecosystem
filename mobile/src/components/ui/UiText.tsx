import { StyleSheet, Text, TextProps, TextStyle } from 'react-native';
import type { StyleProp } from 'react-native';

import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import type { ThemeColors } from '../../design/theme';

export type TextVariant =
  | 'display'
  | 'headlineLarge'
  | 'headlineMedium'
  | 'headlineSmall'
  | 'bodyLarge'
  | 'bodyMedium'
  | 'bodySmall'
  | 'label'
  | 'meta';

export type TextTone = 'default' | 'muted' | 'primary' | 'success' | 'warning' | 'error' | 'onPrimary';

export interface UiTextProps extends Omit<TextProps, 'style'> {
  variant?: TextVariant;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
}

const textStyles = StyleSheet.create<Record<TextVariant, TextStyle>>({
  display: { ...tokens.typography.display, fontFamily: tokens.typography.family },
  headlineLarge: { ...tokens.typography.headlineLarge, fontFamily: tokens.typography.family },
  headlineMedium: { ...tokens.typography.headlineMedium, fontFamily: tokens.typography.family },
  headlineSmall: { ...tokens.typography.headlineSmall, fontFamily: tokens.typography.family },
  bodyLarge: { ...tokens.typography.bodyLarge, fontFamily: tokens.typography.family },
  bodyMedium: { ...tokens.typography.bodyMedium, fontFamily: tokens.typography.family },
  bodySmall: { ...tokens.typography.bodySmall, fontFamily: tokens.typography.family },
  label: { ...tokens.typography.label, fontFamily: tokens.typography.family },
  meta: { ...tokens.typography.meta, fontFamily: tokens.typography.family },
});

function buildTones(colors: ThemeColors): Record<TextTone, TextStyle> {
  return {
    default: { color: colors.text },
    muted: { color: colors.textMuted },
    primary: { color: colors.primary },
    success: { color: colors.success },
    warning: { color: colors.warning },
    error: { color: colors.error },
    onPrimary: { color: colors.onPrimary },
  };
}

const toneCache = new WeakMap<ThemeColors, Record<TextTone, TextStyle>>();
function tonesFor(colors: ThemeColors) {
  let t = toneCache.get(colors);
  if (!t) {
    t = buildTones(colors);
    toneCache.set(colors, t);
  }
  return t;
}

export function UiText({ variant = 'bodyMedium', tone = 'default', style, ...props }: UiTextProps) {
  const { colors, typography } = useTheme();
  // Expo loads each weight as a named face. Android must not synthesize bold
  // from the regular face; selecting the actual font also preserves diacritics.
  const weight = String(StyleSheet.flatten(style)?.fontWeight ?? textStyles[variant].fontWeight ?? '400');
  const face = Number(weight) >= 700 || weight === 'bold' ? 'BeVietnamPro_700Bold'
    : Number(weight) >= 600 ? 'BeVietnamPro_600SemiBold'
      : Number(weight) >= 500 ? 'BeVietnamPro_500Medium' : 'BeVietnamPro_400Regular';
  const capped =
    props.maxFontSizeMultiplier !== undefined
      ? props.maxFontSizeMultiplier
      : Math.min(props.maxFontSizeMultiplier ?? typography.maxFontScale, typography.maxFontScale);
  return (
    <Text
      {...props}
      maxFontSizeMultiplier={capped}
      style={[textStyles[variant], tonesFor(colors)[tone], style, { fontFamily: face, fontWeight: 'normal' }]}
    />
  );
}
