import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import { tokens } from '../../design/tokens';
import { chromeFor } from '../../design/chrome';
import { useTheme } from '../../design/theme';
import { useLocale } from '../../i18n/locale-provider';
import { Button } from './Button';
import { UiText } from './UiText';
import type { TextTone } from './UiText';

/* ---------- Sheet: bottom sheet on RN Modal ---------- */
export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  accessibilityLabel?: string;
  closeLabel?: string;
  closeAccessibilityLabel?: string;
}

export function Sheet({ visible, onClose, title, children, accessibilityLabel, closeLabel, closeAccessibilityLabel }: SheetProps) {
  const { colors, spacing, radii, scheme, reducedMotion } = useTheme();
  const { t } = useLocale();
  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <View style={[sheetStyles.backdrop, { backgroundColor: chromeFor(scheme).scrim }]}>
        <View
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel ?? title}
          style={[sheetStyles.panel, { backgroundColor: colors.card, borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card, padding: spacing.md }]}
        >
          <View style={[sheetStyles.header, { borderBottomColor: colors.outlineVariant, borderBottomWidth: 1, paddingBottom: spacing.sm }]}>
            {title ? (
              <UiText accessibilityRole="header" variant="headlineSmall" style={sheetStyles.title}>
                {title}
              </UiText>
            ) : null}
            <Button label={closeLabel ?? t('close')} onPress={onClose} variant="text" accessibilityLabel={closeAccessibilityLabel ?? t('closeSheet')} />
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  panel: { maxHeight: '85%' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
  title: { flex: 1, paddingRight: tokens.spacing.sm },
});

/* ---------- Dialog: centered confirmation ---------- */
export interface DialogProps {
  visible: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  destructive?: boolean;
}

export function Dialog({ visible, title, description, confirmLabel, cancelLabel, onConfirm, onCancel, destructive = false }: DialogProps) {
  const { colors, spacing, radii } = useTheme();
  const close = onCancel ?? onConfirm;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={dialogStyles.backdrop}>
        <View
          accessibilityRole="alert"
          accessibilityViewIsModal
          style={[dialogStyles.panel, { backgroundColor: colors.card, borderColor: colors.outlineVariant, borderRadius: radii.card, padding: spacing.lg }]}
        >
          <UiText accessibilityRole="header" variant="headlineSmall">{title}</UiText>
          {description ? <UiText variant="bodySmall" tone="muted" style={dialogStyles.desc}>{description}</UiText> : null}
          <View style={dialogStyles.actions}>
            {cancelLabel ? <Button label={cancelLabel} onPress={close} variant="secondary" /> : null}
            <Button label={confirmLabel} onPress={onConfirm} variant={destructive ? 'destructive' : 'primary'} accessibilityLabel={confirmLabel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const dialogStyles = StyleSheet.create({
  backdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', flex: 1, justifyContent: 'center', padding: tokens.spacing.lg },
  panel: { borderWidth: 1, maxWidth: 420, width: '100%' },
  desc: { marginTop: tokens.spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'flex-end', marginTop: tokens.spacing.lg },
});

/* ---------- Toast: auto-hiding live-region banner ---------- */
export interface ToastProps {
  visible: boolean;
  message: string;
  tone?: 'default' | 'success' | 'error' | 'warning';
  duration?: number;
  onDismiss?: () => void;
}

const toastTones: Record<NonNullable<ToastProps['tone']>, { bg: keyof ReturnType<typeof toneKeys>; text: TextTone }> = {
  default: { bg: 'surfaceHigh', text: 'default' },
  success: { bg: 'successFixed', text: 'success' },
  error: { bg: 'errorFixed', text: 'error' },
  warning: { bg: 'warningFixed', text: 'warning' },
};
function toneKeys() { return tokens.colors; }

export function Toast({ visible, message, tone = 'default', duration = 4000, onDismiss }: ToastProps) {
  const { colors, spacing, radii, layout } = useTheme();
  const { t } = useLocale();
  useEffect(() => {
    if (!visible || !onDismiss) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [visible, duration, onDismiss]);
  if (!visible) return null;
  const m = toastTones[tone];
  return (
    <View
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      style={[toastStyles.toast, { backgroundColor: (colors as Record<string, string>)[m.bg], borderColor: colors.outlineVariant, borderRadius: radii.card, margin: spacing.md, minHeight: layout.touchTarget, padding: spacing.md }]}
    >
      <UiText accessibilityRole={tone === 'error' ? 'alert' : undefined} variant="bodySmall" tone={m.text} style={toastStyles.text}>{message}</UiText>
      {onDismiss ? <Button label={t('close')} onPress={onDismiss} variant="text" accessibilityLabel={t('dismissNotification')} /> : null}
    </View>
  );
}

const toastStyles = StyleSheet.create({
  toast: { alignItems: 'center', borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between' },
  text: { flex: 1, paddingRight: tokens.spacing.sm },
});

/* ---------- Notice: inline persistent banner ---------- */
export interface NoticeProps {
  message: string;
  tone?: 'info' | 'success' | 'warning' | 'error';
  actionLabel?: string;
  onAction?: () => void;
}

const noticeTones: Record<NonNullable<NoticeProps['tone']>, { bg: string; text: TextTone; bar: string }> = {
  info: { bg: 'primaryFixed', text: 'primary', bar: 'primary' },
  success: { bg: 'successFixed', text: 'success', bar: 'success' },
  warning: { bg: 'warningFixed', text: 'warning', bar: 'warning' },
  error: { bg: 'errorFixed', text: 'error', bar: 'error' },
};

export function Notice({ message, tone = 'info', actionLabel, onAction }: NoticeProps) {
  const { colors, spacing, radii, layout } = useTheme();
  const m = noticeTones[tone];
  const c = colors as Record<string, string>;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ alignItems: 'center', backgroundColor: c[m.bg], borderColor: colors.outlineVariant, borderLeftColor: c[m.bar], borderLeftWidth: 3, borderRadius: radii.card, borderWidth: 1, flexDirection: 'row', minHeight: layout.touchTarget, padding: spacing.md }}
    >
      <UiText variant="bodySmall" tone={m.text} style={{ flex: 1, marginRight: spacing.sm }}>{message}</UiText>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="text" /> : null}
    </View>
  );
}

/* ---------- Skeleton ---------- */
export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style, testID }: SkeletonProps) {
  const { colors, reducedMotion, motion } = useTheme();
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: motion.durationMedium, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: motion.durationMedium, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, opacity, motion.durationMedium]);
  const base = { width, height, borderRadius, backgroundColor: colors.surfaceHigh } as ViewStyle;
  return (
    <Animated.View
      testID={testID}
      accessibilityState={{ busy: true }}
      style={[base, reducedMotion ? { opacity: 1 } : { opacity }, style]}
    />
  );
}

/* ---------- SearchBar ---------- */
export interface SearchBarProps extends Omit<TextInputProps, 'style'> {
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SearchBar({ value, onChangeText, onClear, placeholder, accessibilityLabel, style, ...input }: SearchBarProps) {
  const { colors, spacing, radii, layout, typography } = useTheme();
  const { t } = useLocale();
  const clear = onClear ?? (() => onChangeText(''));
  return (
    <View style={[{ alignItems: 'center', backgroundColor: colors.card, borderColor: colors.outlineVariant, borderRadius: radii.control, borderWidth: 1, flexDirection: 'row', minHeight: layout.touchTarget, paddingLeft: spacing.md }, style]}>
      <TextInput
        {...input}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={accessibilityLabel ?? placeholder ?? t('search')}
        placeholder={placeholder}
        placeholderTextColor={colors.outline}
        style={{ color: colors.text, flex: 1, fontFamily: typography.family, fontSize: typography.bodyMedium.fontSize, minHeight: layout.touchTarget, paddingVertical: spacing.sm }}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('clearSearch')}
          onPress={clear}
          style={{ alignItems: 'center', justifyContent: 'center', minHeight: layout.touchTarget, minWidth: layout.touchTarget }}
        >
          <UiText variant="label" tone="muted">✕</UiText>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ---------- SegmentedControl ---------- */
export interface SegmentOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}

export function SegmentedControl({ options, value, onChange, accessibilityLabel, disabled = false }: SegmentedControlProps) {
  const { colors, spacing, radii, layout } = useTheme();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={{ backgroundColor: colors.surfaceLow, borderColor: colors.outlineVariant, borderRadius: radii.control, borderWidth: 1, flexDirection: 'row', padding: 2 }}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="tab"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              { alignItems: 'center', borderRadius: radii.control - 2, flex: 1, justifyContent: 'center', minHeight: layout.touchTarget, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
              selected ? { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 1 } : undefined,
              pressed && !disabled ? { opacity: 0.85 } : undefined,
              disabled ? { opacity: 0.5 } : undefined,
            ]}
          >
            <UiText variant="label" tone={selected ? 'primary' : 'muted'}>{opt.label}</UiText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- EmptyState ---------- */
export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}

export function EmptyState({ title, description, actionLabel, onAction, loading = false }: EmptyStateProps) {
  const { colors, spacing, radii, layout } = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ alignItems: 'center', backgroundColor: colors.card, borderColor: colors.outlineVariant, borderRadius: radii.card, borderWidth: 1, minHeight: layout.touchTarget * 2, padding: spacing.lg }}
    >
      {loading ? <ActivityIndicator color={colors.primary} size="small" /> : null}
      <UiText accessibilityRole="header" variant="headlineSmall" style={{ marginTop: spacing.xs, textAlign: 'center' }}>{title}</UiText>
      {description ? <UiText variant="bodySmall" tone="muted" style={{ marginTop: spacing.xs, textAlign: 'center' }}>{description}</UiText> : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.md }}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

/* ---------- InlineError ---------- */
export interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function InlineError({ message, onRetry, retryLabel }: InlineErrorProps) {
  const { colors, spacing, radii, layout } = useTheme();
  const { t } = useLocale();
  return (
    <View
      accessibilityLiveRegion="assertive"
      style={{ alignItems: 'center', backgroundColor: colors.errorFixed, borderColor: colors.error, borderLeftWidth: 3, borderRadius: radii.card, borderWidth: 1, flexDirection: 'row', minHeight: layout.touchTarget, padding: spacing.md }}
    >
      <UiText accessibilityRole="alert" variant="bodySmall" tone="error" style={{ flex: 1, marginRight: spacing.sm }}>{message}</UiText>
      {onRetry ? <Button label={retryLabel ?? t('retry')} onPress={onRetry} variant="secondary" accessibilityLabel={retryLabel ?? t('retry')} /> : null}
    </View>
  );
}

/* ---------- FormField: label + input + error/hint ---------- */
export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function FormField({ label, error, hint, required = false, style, ...input }: FormFieldProps) {
  const { colors, spacing, radii, layout, typography } = useTheme();
  const { t } = useLocale();
  const [focused, setFocused] = useState(false);
  const description = [required ? t('required') : null, hint, error].filter(Boolean).join('. ') || undefined;
  return (
    <View style={[{ marginBottom: spacing.md }, style]}>
      <UiText variant="label" style={{ marginBottom: spacing.xs }}>
        {label}
        {required ? <UiText variant="label" tone="error"> *</UiText> : null}
      </UiText>
      <TextInput
        {...input}
        onFocus={(event) => { setFocused(true); input.onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); input.onBlur?.(event); }}
        accessibilityLabel={input.accessibilityLabel ?? label}
        accessibilityHint={description}
        accessibilityState={{ disabled: input.editable === false }}
        placeholderTextColor={input.placeholderTextColor ?? colors.outline}
        style={[
          {
            backgroundColor: colors.card,
            borderColor: error ? colors.error : focused ? colors.primary : colors.outlineVariant,
            borderRadius: radii.control,
            borderWidth: 1,
            color: colors.text,
            fontFamily: typography.family,
            fontSize: typography.bodyMedium.fontSize,
            minHeight: Math.max(48, layout.touchTarget),
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            ...(focused ? { outlineColor: colors.primary, outlineWidth: 2, outlineOffset: 2, outlineStyle: 'solid' as const } : {}),
          },
        ]}
      />
      {error ? (
        <UiText accessibilityRole="alert" variant="bodySmall" tone="error" style={{ marginTop: spacing.xs }}>
          {error}
        </UiText>
      ) : hint ? (
        <UiText variant="bodySmall" tone="muted" style={{ marginTop: spacing.xs }}>
          {hint}
        </UiText>
      ) : null}
    </View>
  );
}
