import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { SegmentedControl, Sheet } from './primitives';
import type { SegmentOption } from './primitives';
import { UiText } from './UiText';

export interface ChoiceFieldProps {
  label: string;
  options: readonly SegmentOption[];
  value: string | null;
  onChange: (value: string) => void;
  /** `auto` shows segments for up to three options and a sheet otherwise. */
  display?: 'auto' | 'segmented' | 'sheet';
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

const SEGMENT_LIMIT = 3;

export function ChoiceField({ label, options, value, onChange, display = 'auto', placeholder, error, hint, disabled = false }: ChoiceFieldProps) {
  const { colors, spacing, radii, layout } = useTheme();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const segmented = display === 'segmented' || (display === 'auto' && options.length <= SEGMENT_LIMIT);
  const selected = options.find((o) => o.value === value);
  const shown = selected?.label ?? placeholder ?? t('notSelected');

  return (
    <View style={{ marginBottom: spacing.md }}>
      <UiText variant="label" style={{ marginBottom: spacing.xs }}>{label}</UiText>
      {segmented ? (
        <SegmentedControl options={[...options]} value={value ?? ''} onChange={onChange} accessibilityLabel={label} disabled={disabled} />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${shown}`}
            accessibilityHint={hint}
            accessibilityState={{ disabled, expanded: open }}
            disabled={disabled}
            onPress={() => setOpen(true)}
            style={[
              styles.trigger,
              { backgroundColor: colors.card, borderColor: error ? colors.error : colors.outlineVariant, borderRadius: radii.control, minHeight: layout.touchTarget, paddingHorizontal: spacing.md },
              disabled ? styles.disabled : undefined,
            ]}
          >
            <UiText variant="bodyMedium" tone={selected ? 'default' : 'muted'} style={styles.grow}>{shown}</UiText>
            <UiText variant="label" tone="muted">▾</UiText>
          </Pressable>
          <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
            <ScrollView>
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ checked: isSelected, selected: isSelected }}
                    onPress={() => { onChange(option.value); setOpen(false); }}
                    style={[styles.option, { minHeight: layout.touchTarget, paddingHorizontal: spacing.sm }, isSelected ? { backgroundColor: colors.primaryFixed } : undefined]}
                  >
                    <UiText variant="bodyMedium" tone={isSelected ? 'primary' : 'default'} style={styles.grow}>{option.label}</UiText>
                    <UiText variant="label" tone="primary">{isSelected ? '✓' : ''}</UiText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Sheet>
        </>
      )}
      {error ? (
        <UiText accessibilityRole="alert" variant="bodySmall" tone="error" style={{ marginTop: spacing.xs }}>{error}</UiText>
      ) : hint ? (
        <UiText variant="bodySmall" tone="muted" style={{ marginTop: spacing.xs }}>{hint}</UiText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { alignItems: 'center', borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between' },
  grow: { flex: 1 },
  option: { alignItems: 'center', flexDirection: 'row', marginBottom: tokens.spacing.xs },
  disabled: { opacity: 0.5 },
});
