import { ActivityIndicator, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { chromeFor } from '../../design/chrome';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import type { ThemeColors } from '../../design/theme';
import { UiText } from './UiText';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  variant?: 'primary' | 'secondary' | 'text' | 'destructive';
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  /** Secondary/text action on a navy HeroCard. */
  onBrand?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

function variantStyle(variant: NonNullable<ButtonProps['variant']>, c: ThemeColors): ViewStyle {
  switch (variant) {
    case 'primary':
      return { backgroundColor: c.primary };
    case 'secondary':
      return { backgroundColor: c.card, borderColor: c.outlineVariant, borderWidth: 1 };
    case 'destructive':
      return { backgroundColor: c.error };
    default:
      return { backgroundColor: 'transparent' };
  }
}

export function Button({
  label,
  onPress,
  accessibilityLabel,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  icon,
  onBrand = false,
}: ButtonProps) {
  const { colors, layout, scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const [focused, setFocused] = useState(false);
  const textColor = variant === 'destructive' ? colors.card : onBrand ? chrome.onSurface : variant === 'primary' ? colors.onPrimary : colors.primary;
  const isDisabled = disabled || loading;
  const small = variant === 'text';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        small ? styles.smallPad : styles.normalPad,
        { minHeight: Math.max(48, layout.touchTarget) },
        variantStyle(variant, colors),
        onBrand ? { backgroundColor: chrome.overlay, borderColor: chrome.overlay, borderWidth: 1 } : undefined,
        focused ? { outlineColor: onBrand ? chrome.accent : colors.primary, outlineWidth: 2, outlineOffset: 2, outlineStyle: 'solid' } : undefined,
        pressed && !isDisabled ? styles.pressed : undefined,
        isDisabled ? styles.disabled : undefined,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={textColor} size="small" /> : icon ? (
          <MaterialCommunityIcons accessible={false} importantForAccessibility="no" color={textColor} name={icon} size={20} />
        ) : null}
        <UiText variant="label" style={{ color: textColor, flexShrink: 1, textAlign: 'center' }}>
          {label}
        </UiText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', borderRadius: tokens.radii.control, justifyContent: 'center' },
  normalPad: { paddingHorizontal: tokens.spacing.md, paddingVertical: tokens.spacing.sm + tokens.spacing.xs },
  smallPad: { paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.sm },
  content: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.48 },
});
