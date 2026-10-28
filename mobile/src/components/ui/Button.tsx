import { ActivityIndicator, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import type { ThemeColors } from '../../design/theme';
import { UiText } from './UiText';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  variant?: 'primary' | 'secondary' | 'text';
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
}: ButtonProps) {
  const { colors, layout } = useTheme();
  const isDisabled = disabled || loading;
  const small = variant === 'text';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small ? styles.smallPad : styles.normalPad,
        { minHeight: layout.touchTarget },
        variantStyle(variant, colors),
        pressed && !isDisabled ? styles.pressed : undefined,
        isDisabled ? styles.disabled : undefined,
        style,
      ]}
    >
      {loading ? (
        <View style={styles.content}>
          <ActivityIndicator color={variant === 'primary' ? colors.onPrimary : colors.primary} size="small" />
          <UiText variant="label" tone={variant === 'primary' ? 'onPrimary' : 'primary'}>
            Loading…
          </UiText>
        </View>
      ) : (
        <UiText variant="label" tone={variant === 'primary' ? 'onPrimary' : 'primary'}>
          {label}
        </UiText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', borderRadius: tokens.radii.control, justifyContent: 'center' },
  normalPad: { paddingHorizontal: tokens.spacing.md },
  smallPad: { paddingHorizontal: tokens.spacing.xs },
  content: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.48 },
});
