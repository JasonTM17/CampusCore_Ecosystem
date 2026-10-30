import { useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { chromeFor } from '../../design/chrome';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { Button } from './Button';
import { UiText } from './UiText';

export type UiIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
export type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

export interface IconChipProps {
  icon: UiIconName;
  size?: 32 | 36 | 40;
  tone?: 'primary' | 'neutral';
  onBrand?: boolean;
}

export function IconChip({ icon, size = 36, tone = 'primary', onBrand = false }: IconChipProps) {
  const { colors, scheme } = useTheme();
  const chrome = chromeFor(scheme);
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.chip, {
      width: size, height: size,
      backgroundColor: onBrand ? chrome.overlay : tone === 'primary' ? colors.primaryFixed : colors.surfaceLow,
    }]}>
      <MaterialCommunityIcons name={icon} size={20} color={onBrand ? chrome.onSurface : tone === 'primary' ? colors.primary : colors.textMuted} />
    </View>
  );
}

export interface IconButtonProps {
  icon: UiIconName;
  accessibilityLabel: string;
  onPress(): void;
  disabled?: boolean;
  loading?: boolean;
  onBrand?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ icon, accessibilityLabel, onPress, disabled = false, loading = false, onBrand = false, style }: IconButtonProps) {
  const { colors, scheme } = useTheme();
  const chrome = chromeFor(scheme);
  const [focused, setFocused] = useState(false);
  const ink = onBrand ? chrome.onSurface : colors.primary;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading}
      onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.iconButton,
        pressed ? { backgroundColor: onBrand ? chrome.overlay : colors.primaryFixed } : undefined,
        focused ? { outlineColor: ink, outlineWidth: 2, outlineOffset: 2, outlineStyle: 'solid' } : undefined,
        disabled || loading ? { opacity: 0.5 } : undefined, style]}>
      {loading ? <ActivityIndicator color={ink} /> : <MaterialCommunityIcons accessible={false} name={icon} size={20} color={ink} />}
    </Pressable>
  );
}

export interface StatusPillProps {
  label: string;
  tone?: StatusTone;
  icon?: UiIconName;
}

export function StatusPill({ label, tone = 'neutral', icon }: StatusPillProps) {
  const { colors } = useTheme();
  const ink = tone === 'neutral' ? colors.textMuted : colors[tone];
  const fill = tone === 'neutral' ? colors.surfaceLow : colors[`${tone}Fixed`];
  return (
    <View style={[styles.pill, { backgroundColor: fill }]}>
      {icon ? <MaterialCommunityIcons accessible={false} importantForAccessibility="no" name={icon} size={14} color={ink} /> : null}
      <UiText variant="meta" style={{ color: ink, flexShrink: 1 }}>{label}</UiText>
    </View>
  );
}

export interface SectionCardProps {
  title: string;
  icon?: UiIconName;
  count?: string;
  actionLabel?: string;
  onAction?(): void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SectionCard({ title, icon, count, actionLabel, onAction, children, style }: SectionCardProps) {
  const { colors, window } = useTheme();
  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.outlineVariant }, style]}>
      <View style={[styles.sectionHeader, { borderBottomColor: colors.outlineVariant }, window.fontScale >= 1.3 ? styles.wrap : undefined]}>
        <View style={styles.sectionTitle}>
          {icon ? <IconChip icon={icon} size={32} /> : null}
          <UiText accessibilityRole="header" variant="headlineSmall" style={{ flex: 1 }}>{title}</UiText>
          {count ? <StatusPill label={count} tone="primary" /> : null}
        </View>
        {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="text" /> : null}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export interface StatStripProps {
  items: ReadonlyArray<{ label: string; value: string; icon?: UiIconName }>;
  style?: StyleProp<ViewStyle>;
}

export function StatStrip({ items, style }: StatStripProps) {
  const { colors, window } = useTheme();
  const stacked = window.fontScale >= 1.3 || window.width < 360;
  return (
    <View style={[styles.stats, { backgroundColor: colors.card, borderColor: colors.outlineVariant, flexDirection: stacked ? 'column' : 'row' }, style]}>
      {items.map((item, index) => (
        <View key={item.label} accessible accessibilityLabel={`${item.label}: ${item.value}`} style={[styles.stat,
          index > 0 ? { borderColor: colors.outlineVariant, borderLeftWidth: stacked ? 0 : 1, borderTopWidth: stacked ? 1 : 0 } : undefined]}>
          <View style={styles.statTop}>
            <UiText variant="headlineLarge" tone="primary" style={styles.statValue}>{item.value}</UiText>
            {item.icon ? <IconChip icon={item.icon} size={32} /> : null}
          </View>
          <UiText variant="label" tone="muted">{item.label}</UiText>
        </View>
      ))}
    </View>
  );
}

export interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress(): void;
  icon?: UiIconName;
  count?: number;
  disabled?: boolean;
}

export function FilterChip({ label, selected, onPress, icon, count, disabled = false }: FilterChipProps) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled}
      onPress={onPress} style={({ pressed }) => [styles.filter, {
        borderColor: selected ? colors.primary : colors.outlineVariant,
        backgroundColor: selected || pressed ? colors.primaryFixed : colors.card,
        opacity: disabled ? 0.5 : 1,
      }]}>
      {icon ? <MaterialCommunityIcons accessible={false} name={icon} color={selected ? colors.primary : colors.textMuted} size={20} /> : null}
      <UiText variant="label" tone={selected ? 'primary' : 'muted'} numberOfLines={1} style={{ flexShrink: 0 }}>{label}</UiText>
      {count !== undefined ? <UiText variant="meta" tone={selected ? 'primary' : 'muted'}>{count}</UiText> : null}
    </Pressable>
  );
}

export function SheetHeader({ title, subtitle, closeLabel, onClose }: { title: string; subtitle?: string; closeLabel: string; onClose(): void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sheetHeader, { borderBottomColor: colors.outlineVariant }]}>
      <View style={{ flex: 1, gap: tokens.spacing.xs }}>
        <UiText accessibilityRole="header" variant="headlineSmall">{title}</UiText>
        {subtitle ? <UiText variant="bodySmall" tone="muted">{subtitle}</UiText> : null}
      </View>
      <IconButton icon="close" accessibilityLabel={closeLabel} onPress={onClose} />
    </View>
  );
}

const compact = tokens.spacing.sm + tokens.spacing.xs;
const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radii.control, flexShrink: 0 },
  iconButton: { alignItems: 'center', justifyContent: 'center', minHeight: tokens.layout.touchTarget, minWidth: tokens.layout.touchTarget, borderRadius: tokens.radii.control },
  pill: { alignSelf: 'flex-start', alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs, borderRadius: tokens.radii.pill, flexShrink: 1, maxWidth: '100%', minHeight: tokens.spacing.xl, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.xs },
  sectionCard: { borderWidth: 1, borderRadius: tokens.radii.card, minWidth: 0 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, paddingHorizontal: compact, paddingVertical: tokens.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  sectionTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, minWidth: 0 },
  sectionBody: { paddingHorizontal: compact, paddingVertical: tokens.spacing.xs },
  wrap: { flexDirection: 'column', alignItems: 'stretch' },
  stats: { borderWidth: 1, borderRadius: tokens.radii.card, overflow: 'hidden' },
  stat: { flex: 1, minWidth: 0, padding: compact, gap: tokens.spacing.xs },
  statTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.sm },
  statValue: { fontVariant: ['tabular-nums'], flexShrink: 1 },
  filter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget, borderRadius: tokens.radii.control, borderWidth: 1, paddingHorizontal: compact, paddingVertical: tokens.spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, borderBottomWidth: 1, paddingBottom: compact, marginBottom: tokens.spacing.md },
});
