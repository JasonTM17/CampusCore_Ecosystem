import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { Button } from './Button';
import { Sheet } from './primitives';
import { UiText } from './UiText';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  id: string;
  label: string;
  options: readonly FilterOption[];
  /** Multi-select groups use checkboxes; single-select groups use radios. */
  multiple?: boolean;
}

/** Selected option values by group id. */
export type FilterValue = Readonly<Record<string, readonly string[]>>;

export interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  groups: readonly FilterGroup[];
  value: FilterValue;
  onApply: (next: FilterValue) => void;
  title?: string;
}

export function toggleFilterValue(current: FilterValue, group: FilterGroup, optionValue: string): FilterValue {
  const selected = current[group.id] ?? [];
  const has = selected.includes(optionValue);
  const next = group.multiple
    ? has ? selected.filter((v) => v !== optionValue) : [...selected, optionValue]
    : has ? [] : [optionValue];
  return { ...current, [group.id]: next };
}

export function FilterSheet({ visible, onClose, groups, value, onApply, title }: FilterSheetProps) {
  const { colors, spacing, radii, layout } = useTheme();
  const { t } = useLocale();
  const [draft, setDraft] = useState<FilterValue>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  return (
    <Sheet visible={visible} onClose={onClose} title={title ?? t('filters')}>
      <ScrollView style={styles.body}>
        {groups.map((group) => (
          <View key={group.id} accessibilityLabel={group.label} style={{ marginBottom: spacing.md }}>
            <UiText variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>{group.label}</UiText>
            {group.options.map((option) => {
              const selected = (draft[group.id] ?? []).includes(option.value);
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole={group.multiple ? 'checkbox' : 'radio'}
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: selected, selected }}
                  onPress={() => setDraft((current) => toggleFilterValue(current, group, option.value))}
                  style={[
                    styles.option,
                    { borderColor: selected ? colors.primary : colors.outlineVariant, borderRadius: radii.control, minHeight: layout.touchTarget, paddingHorizontal: spacing.md },
                    selected ? { backgroundColor: colors.primaryFixed } : undefined,
                  ]}
                >
                  <UiText variant="bodyMedium" tone={selected ? 'primary' : 'default'} style={styles.optionText}>{option.label}</UiText>
                  <UiText variant="label" tone="primary">{selected ? '✓' : ''}</UiText>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={[styles.actions, { gap: spacing.sm, paddingTop: spacing.sm }]}>
        <Button label={t('clear')} onPress={() => setDraft({})} variant="secondary" />
        <Button label={t('apply')} onPress={() => { onApply(draft); onClose(); }} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 0 },
  option: { alignItems: 'center', borderWidth: 1, flexDirection: 'row', marginBottom: tokens.spacing.xs },
  optionText: { flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
