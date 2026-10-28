import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { Button } from './Button';
import { FormField, Sheet } from './primitives';
import { UiText } from './UiText';

export interface DateFieldProps {
  label: string;
  /** ISO date (YYYY-MM-DD) or empty. */
  value: string;
  onChange: (isoDate: string) => void;
  /** Inclusive bounds as ISO dates. */
  min?: string;
  max?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
}

/**
 * Date entry without a native picker: a trigger opens a sheet with a validated
 * text field. The value is committed only when it is a real calendar date.
 */
export function DateField({ label, value, onChange, min, max, required = false, error, disabled = false }: DateFieldProps) {
  const { colors, spacing, radii, layout } = useTheme();
  const { t, formatDate, parseDate } = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | undefined>();

  const shown = value ? formatDate(value) : t('notSelected');

  const openSheet = () => {
    setDraft(value ? formatDate(value) : '');
    setProblem(undefined);
    setOpen(true);
  };

  const commit = () => {
    if (draft.trim() === '') {
      if (required) return setProblem(t('dateRequired'));
      onChange('');
      return setOpen(false);
    }
    const iso = parseDate(draft);
    if (!iso) return setProblem(t('dateInvalid'));
    if (min && iso < min) return setProblem(t('dateTooEarly', { date: formatDate(min) }));
    if (max && iso > max) return setProblem(t('dateTooLate', { date: formatDate(max) }));
    onChange(iso);
    setOpen(false);
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      <UiText variant="label" style={{ marginBottom: spacing.xs }}>
        {label}
        {required ? <UiText variant="label" tone="error"> *</UiText> : null}
      </UiText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={openSheet}
        style={[
          styles.trigger,
          { backgroundColor: colors.card, borderColor: error ? colors.error : colors.outlineVariant, borderRadius: radii.control, minHeight: layout.touchTarget, paddingHorizontal: spacing.md },
          disabled ? styles.disabled : undefined,
        ]}
      >
        <UiText variant="bodyMedium" tone={value ? 'default' : 'muted'} style={styles.grow}>{shown}</UiText>
        <UiText variant="label" tone="muted">▾</UiText>
      </Pressable>
      {error ? <UiText accessibilityRole="alert" variant="bodySmall" tone="error" style={{ marginTop: spacing.xs }}>{error}</UiText> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <FormField
          label={t('selectDate')}
          value={draft}
          onChangeText={(text) => { setDraft(text); setProblem(undefined); }}
          hint={t('dateFormatHint')}
          error={problem}
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={commit}
        />
        <View style={[styles.actions, { gap: spacing.sm }]}>
          <Button label={t('cancel')} onPress={() => setOpen(false)} variant="secondary" />
          <Button label={t('apply')} onPress={commit} />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { alignItems: 'center', borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between' },
  grow: { flex: 1 },
  disabled: { opacity: 0.5 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
