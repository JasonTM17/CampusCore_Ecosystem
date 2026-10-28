import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

import { tokens } from '../design/tokens';
import { useTheme } from '../design/theme';
import type { ThemeColors } from '../design/theme';
import { UiText } from './ui/UiText';
import type { TextTone } from './ui/UiText';
import { Button } from './ui/Button';
import { FormField } from './ui/primitives';
import { ResponsiveContent } from './ui/ResponsiveContent';

export { UiText } from './ui/UiText';
export type { UiTextProps, TextVariant, TextTone } from './ui/UiText';
export { Button } from './ui/Button';
export type { ButtonProps } from './ui/Button';
export * from './ui/index';

/* ---------- themed styles ---------- */

const styleCache = new WeakMap<ThemeColors, ReturnType<typeof buildStyles>>();
function stylesFor(colors: ThemeColors) {
  let s = styleCache.get(colors);
  if (!s) {
    s = buildStyles(colors);
    styleCache.set(colors, s);
  }
  return s;
}

function buildStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    scrollContent: {
      paddingHorizontal: tokens.layout.mobileGutter,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xl + tokens.layout.bottomNavigationHeight,
    },
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: tokens.spacing.lg, paddingBottom: tokens.spacing.md, borderBottomColor: colors.outlineVariant, borderBottomWidth: 1 },
    headerCopy: { flex: 1, paddingRight: tokens.spacing.sm },
    eyebrow: { letterSpacing: 0, marginBottom: tokens.spacing.xs, textTransform: 'uppercase' },
    subtitle: { marginTop: tokens.spacing.xs },
    card: {
      backgroundColor: colors.card,
      borderColor: colors.outlineVariant,
      borderRadius: tokens.radii.card,
      borderWidth: 1,
      padding: tokens.spacing.md,
    },
    fieldGroup: { marginBottom: tokens.spacing.md },
    badge: { alignSelf: 'flex-start', borderRadius: tokens.radii.pill, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.xs },
    metricCard: { flex: 1, minHeight: 88, padding: tokens.spacing.sm + tokens.spacing.xs },
    metricValue: { marginVertical: tokens.spacing.xs },
    sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
    listRow: { alignItems: 'center', flexDirection: 'row', minHeight: tokens.layout.touchTarget, paddingVertical: tokens.spacing.sm },
    leading: { alignItems: 'center', backgroundColor: colors.surfaceLow, borderRadius: tokens.radii.control, height: 36, justifyContent: 'center', marginRight: tokens.spacing.sm, width: 36 },
    leadingUnread: { backgroundColor: colors.primaryFixed },
    listCopy: { flex: 1, paddingRight: tokens.spacing.sm },
    listTitle: { flex: 1 },
    listTitleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
    listMeta: { marginLeft: tokens.spacing.sm },
    unreadTitle: { color: colors.primary, fontWeight: '600' },
    unreadLabel: { backgroundColor: colors.primaryFixed, borderRadius: tokens.radii.pill, paddingHorizontal: tokens.spacing.xs, paddingVertical: 2 },
    rowPressed: { backgroundColor: colors.surfaceLow, borderRadius: tokens.radii.control },
    progressGroup: { marginTop: tokens.spacing.sm },
    progressHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: tokens.spacing.xs },
    progressTrack: { backgroundColor: colors.primaryFixed, borderRadius: tokens.radii.pill, height: tokens.spacing.sm, overflow: 'hidden' },
    progressFill: { borderRadius: tokens.radii.pill, height: '100%' },
    divider: { backgroundColor: colors.outlineVariant, height: 1, marginVertical: tokens.spacing.sm },
    avatar: { alignItems: 'center', backgroundColor: colors.primaryFixed, justifyContent: 'center' },
    scrollSection: { marginBottom: tokens.spacing.lg },
    statePanel: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.outlineVariant, borderLeftColor: colors.primary, borderLeftWidth: 3, borderRadius: tokens.radii.card, borderWidth: 1, flexDirection: 'row', padding: tokens.spacing.md },
    statePanelError: { borderLeftColor: colors.error },
    dataNotice: { borderLeftColor: colors.warning },
    stateCopy: { flex: 1, marginHorizontal: tokens.spacing.sm },
    stateDescription: { marginTop: tokens.spacing.xs },
  });
}

type UiStyles = ReturnType<typeof buildStyles>;
function useUiStyles(): UiStyles {
  const { colors } = useTheme();
  return stylesFor(colors);
}

/* ---------- primitives (exports unchanged) ---------- */

export interface ScreenShellProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  children: ReactNode;
  headerAction?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

export function ScreenShell({ title, eyebrow, subtitle, children, headerAction, contentStyle }: ScreenShellProps) {
  const styles = useUiStyles();
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            {eyebrow ? (
              <UiText variant="meta" tone="primary" style={styles.eyebrow}>
                {eyebrow.toUpperCase()}
              </UiText>
            ) : null}
            <UiText accessibilityRole="header" variant="headlineLarge">{title}</UiText>
            {subtitle ? (
              <UiText variant="bodySmall" tone="muted" style={styles.subtitle}>
                {subtitle}
              </UiText>
            ) : null}
          </View>
          {headerAction}
        </View>
        <ResponsiveContent>{children}</ResponsiveContent>
      </ScrollView>
    </View>
  );
}

export interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'card' | 'low' | 'primary';
}

export function Card({ children, style, tone = 'card' }: CardProps) {
  const styles = useUiStyles();
  const { colors } = useTheme();
  const tones = {
    card: { backgroundColor: colors.card },
    low: { backgroundColor: colors.surfaceLow },
    primary: { backgroundColor: colors.primaryFixed, borderColor: colors.primary },
  } satisfies Record<NonNullable<CardProps['tone']>, ViewStyle>;
  return <View style={[styles.card, tones[tone], style]}>{children}</View>;
}

export interface FieldProps extends React.ComponentProps<typeof FormField> {
  helperText?: string;
}

export function Field({ label, helperText, style, ...props }: FieldProps) {
  return <FormField label={label} hint={helperText} style={style} {...props} />;
}

export interface BadgeProps {
  label: string;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'error';
}

export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const styles = useUiStyles();
  const { colors } = useTheme();
  const bg = {
    neutral: colors.surface,
    primary: colors.primaryFixed,
    success: colors.successFixed,
    warning: colors.warningFixed,
    error: colors.errorFixed,
  } as const;
  const textTone: TextTone =
    tone === 'primary' ? 'primary' : tone === 'neutral' ? 'muted' : tone;
  return (
    <View style={[styles.badge, { backgroundColor: bg[tone] }]}>
      <UiText variant="meta" tone={textTone}>
        {label}
      </UiText>
    </View>
  );
}

export interface MetricCardProps {
  label: string;
  value: string;
  detail?: string;
  style?: StyleProp<ViewStyle>;
}

export function MetricCard({ label, value, detail, style }: MetricCardProps) {
  const styles = useUiStyles();
  return (
    <Card style={[styles.metricCard, style]}>
      <UiText variant="bodySmall" tone="muted">
        {label}
      </UiText>
      <UiText variant="headlineMedium" tone="primary" style={styles.metricValue}>
        {value}
      </UiText>
      {detail ? (
        <UiText variant="meta" tone="muted">
          {detail}
        </UiText>
      ) : null}
    </Card>
  );
}

export interface SectionHeadingProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeading({ title, actionLabel, onAction }: SectionHeadingProps) {
  const styles = useUiStyles();
  return (
    <View style={styles.sectionHeading}>
      <UiText accessibilityRole="header" variant="headlineSmall">{title}</UiText>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="text" />
      ) : null}
    </View>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string;
  meta?: string;
  leading?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  unread?: boolean;
}

export function ListRow({ title, subtitle, meta, leading, trailing, onPress, unread = false }: ListRowProps) {
  const styles = useUiStyles();
  const accessibilityLabel = [
    unread ? 'Unread' : null,
    title,
    subtitle,
    meta,
  ].filter(Boolean).join('. ');
  const content = (
    <View
      accessible={!onPress}
      accessibilityLabel={!onPress ? accessibilityLabel : undefined}
      style={styles.listRow}
    >
      {leading ? (
        <View style={[styles.leading, unread ? styles.leadingUnread : undefined]}>
          <UiText variant="label" tone={unread ? 'primary' : 'muted'}>
            {leading}
          </UiText>
        </View>
      ) : null}
      <View style={styles.listCopy}>
        <View style={styles.listTitleRow}>
          <UiText variant="bodyMedium" style={unread ? styles.unreadTitle : styles.listTitle}>
            {title}
          </UiText>
          {unread ? (
            <UiText variant="meta" tone="primary" style={styles.unreadLabel}>
              Unread
            </UiText>
          ) : null}
        </View>
        {subtitle ? (
          <UiText variant="bodySmall" tone="muted" numberOfLines={2}>
            {subtitle}
          </UiText>
        ) : null}
      </View>
      {meta ? (
        <UiText variant="meta" tone="muted" style={styles.listMeta}>
          {meta}
        </UiText>
      ) : null}
      {trailing}
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [pressed ? styles.rowPressed : undefined]}
    >
      {content}
    </Pressable>
  );
}

export interface ProgressBarProps {
  value: number;
  label?: string;
  tone?: 'primary' | 'success' | 'warning';
}

export function ProgressBar({ value, label, tone = 'primary' }: ProgressBarProps) {
  const styles = useUiStyles();
  const { colors } = useTheme();
  const boundedValue = Math.max(0, Math.min(100, value));
  const fill = {
    primary: colors.primaryContainer,
    success: colors.success,
    warning: colors.warning,
  } as const;

  return (
    <View
      accessible
      accessibilityLabel={label ?? 'Progress'}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(boundedValue) }}
      style={styles.progressGroup}
    >
      {label ? (
        <View style={styles.progressHeader}>
          <UiText variant="bodySmall" tone="muted">
            {label}
          </UiText>
          <UiText variant="meta" tone={tone === 'primary' ? 'primary' : tone}>
            {Math.round(boundedValue)}%
          </UiText>
        </View>
      ) : null}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { backgroundColor: fill[tone] }, { width: `${boundedValue}%` }]} />
      </View>
    </View>
  );
}

export function Divider() {
  const styles = useUiStyles();
  return <View style={styles.divider} />;
}

export function Avatar({ label, size = 48 }: { label: string; size?: number }) {
  const styles = useUiStyles();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <UiText variant="headlineSmall" tone="primary">
        {label.slice(0, 1).toUpperCase()}
      </UiText>
    </View>
  );
}

export function ScreenSpacer({ size = tokens.spacing.md }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export interface StatePanelProps {
  kind: 'loading' | 'error' | 'empty';
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function StatePanel({ kind, title, description, actionLabel, onAction }: StatePanelProps) {
  const styles = useUiStyles();
  const { colors } = useTheme();
  return (
    <View
      accessibilityLiveRegion={kind === 'error' ? 'assertive' : 'polite'}
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      style={[styles.statePanel, kind === 'error' ? styles.statePanelError : undefined]}
    >
      {kind === 'loading' ? (
        <ActivityIndicator color={colors.primary} size="small" />
      ) : null}
      <View style={styles.stateCopy}>
        <UiText variant="label" tone={kind === 'error' ? 'error' : 'default'}>
          {title}
        </UiText>
        {description ? (
          <UiText variant="bodySmall" tone="muted" style={styles.stateDescription}>
            {description}
          </UiText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" />
      ) : null}
    </View>
  );
}

export function ScrollSection({ children }: { children: ReactNode }) {
  const styles = useUiStyles();
  return <View style={styles.scrollSection}>{children}</View>;
}

/**
 * Offline-stale banner (mobile-policy §5): rendered above real data when a
 * revalidation failed — the memory copy stays visible, the banner is the
 * "dữ liệu có thể cũ" warning. Never rendered instead of data.
 */
export function DataNotice({ message }: { message: string }) {
  const styles = useUiStyles();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.statePanel, styles.dataNotice]}
    >
      <UiText variant="bodySmall" tone="warning">
        {message}
      </UiText>
    </View>
  );
}
