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

import { MaterialCommunityIcons } from '@expo/vector-icons';

import { chromeFor } from '../design/chrome';
import { tokens } from '../design/tokens';
import { useTheme } from '../design/theme';
import { useShellCopy } from '../i18n/use-shell-copy';
import type { ThemeColors } from '../design/theme';
import { UiText } from './ui/UiText';
import type { TextTone } from './ui/UiText';
import { Button } from './ui/Button';
import { FormField } from './ui/primitives';
import { ResponsiveContent } from './ui/ResponsiveContent';
import { IconChip } from './ui/institutional';

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
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: tokens.spacing.md },
    headerCopy: { flex: 1, paddingRight: tokens.spacing.sm },
    eyebrow: { letterSpacing: 0, marginBottom: tokens.spacing.xs, textTransform: 'uppercase' },
    subtitle: { marginTop: tokens.spacing.xs },
    card: {
      backgroundColor: colors.card,
      borderColor: colors.outlineVariant,
      borderRadius: tokens.radii.card,
      borderWidth: 1,
      elevation: tokens.elevation.low,
      padding: tokens.spacing.md,
      shadowColor: '#0A2A57',
      shadowOffset: { height: 1, width: 0 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
    },
    heroCard: { borderRadius: tokens.radii.card, padding: tokens.spacing.md },
    heroActions: { marginTop: tokens.spacing.sm + tokens.spacing.xs },
    metricHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    metricIcon: { alignItems: 'center', backgroundColor: colors.primaryFixed, borderRadius: tokens.radii.control, height: 32, justifyContent: 'center', width: 32 },
    actionTile: { alignItems: 'center', flex: 1, gap: tokens.spacing.sm, justifyContent: 'center', minHeight: 92, minWidth: tokens.layout.touchTarget, padding: tokens.spacing.sm + tokens.spacing.xs },
    actionIcon: { alignItems: 'center', backgroundColor: colors.primaryFixed, borderRadius: tokens.radii.control, height: 36, justifyContent: 'center', width: 36 },
    chevron: { marginLeft: tokens.spacing.xs },
    fieldGroup: { marginBottom: tokens.spacing.md },
    badge: { alignSelf: 'flex-start', borderRadius: tokens.radii.pill, paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.xs },
    metricCard: { flex: 1, justifyContent: 'space-between', minHeight: 104, minWidth: 0, padding: tokens.spacing.md },
    metricValue: { marginVertical: tokens.spacing.xs },
    sectionHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between', marginBottom: tokens.spacing.sm },
    listRow: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: 48, paddingVertical: tokens.spacing.sm + tokens.spacing.xs },
    leading: { alignItems: 'center', backgroundColor: colors.surfaceLow, borderRadius: tokens.radii.control, height: 36, justifyContent: 'center', marginRight: tokens.spacing.sm, width: 36 },
    leadingUnread: { backgroundColor: colors.primaryFixed },
    listCopy: { flex: 1, minWidth: 0, gap: tokens.spacing.xs },
    listTitle: { flex: 1 },
    listTitleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
    listMeta: { flexShrink: 1, maxWidth: '36%', textAlign: 'right', fontVariant: ['tabular-nums'] },
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
    statePanel: { alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacing.sm, backgroundColor: colors.card, borderColor: colors.outlineVariant, borderRadius: tokens.radii.card, borderWidth: 1, flexDirection: 'row', padding: tokens.spacing.md },
    statePanelError: { backgroundColor: colors.errorFixed },
    dataNotice: { backgroundColor: colors.warningFixed },
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
  /** Custom auth composition can keep the shell without its standard heading. */
  hideHeader?: boolean;
}

export function ScreenShell({ title, eyebrow, subtitle, children, headerAction, contentStyle, hideHeader = false }: ScreenShellProps) {
  const styles = useUiStyles();
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {hideHeader ? null : <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            {eyebrow ? (
              <UiText variant="meta" tone="primary" style={styles.eyebrow}>
                {eyebrow.toUpperCase()}
              </UiText>
            ) : null}
            <UiText accessibilityRole="header" variant="headlineMedium">{title}</UiText>
            {subtitle ? (
              <UiText variant="bodySmall" tone="muted" style={styles.subtitle}>
                {subtitle}
              </UiText>
            ) : null}
          </View>
          {headerAction}
        </View>}
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
  const { colors, scheme } = useTheme();
  const tones = {
    card: { backgroundColor: colors.card },
    low: { backgroundColor: colors.surfaceLow },
    primary: { backgroundColor: colors.primaryFixed, borderColor: colors.primary },
  } satisfies Record<NonNullable<CardProps['tone']>, ViewStyle>;
  return <View style={[styles.card, tones[tone], scheme === 'dark' ? { elevation: 0, shadowOpacity: 0 } : undefined, style]}>{children}</View>;
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
  /** Optional MaterialCommunityIcons glyph shown in a tinted chip. */
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  style?: StyleProp<ViewStyle>;
}

export function MetricCard({ label, value, detail, icon, style }: MetricCardProps) {
  const styles = useUiStyles();
  const { colors } = useTheme();
  return (
    <Card style={[styles.metricCard, style]}>
      <View style={styles.metricHead}>
        <UiText variant="headlineLarge" tone="primary" style={[styles.metricValue, { flex: 1, fontVariant: ['tabular-nums'] }]}>
          {value}
        </UiText>
        {icon ? (
          <View style={styles.metricIcon}>
            <MaterialCommunityIcons color={colors.primary} name={icon} size={18} />
          </View>
        ) : null}
      </View>
      <UiText variant="label" tone="muted">
        {label}
      </UiText>
      {detail ? (
        <UiText variant="meta" tone="muted">
          {detail}
        </UiText>
      ) : null}
    </Card>
  );
}

export interface HeroCardProps {
  eyebrow?: string;
  title: string;
  detail?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}

/** Brand-navy summary surface (web hero band): light copy on the portal chrome. */
export function HeroCard({ eyebrow, title, detail, children, style, icon }: HeroCardProps) {
  const styles = useUiStyles();
  const { scheme } = useTheme();
  const chrome = chromeFor(scheme);
  return (
    <View style={[styles.heroCard, { backgroundColor: chrome.surface }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm + tokens.spacing.xs }}>
      {icon ? <IconChip icon={icon} onBrand size={40} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
      {eyebrow ? (
        <UiText variant="meta" style={{ color: chrome.accent }}>
          {eyebrow}
        </UiText>
      ) : null}
      <UiText variant="headlineMedium" style={{ color: chrome.onSurface, marginTop: tokens.spacing.xs }}>
        {title}
      </UiText>
      {detail ? (
        <UiText variant="bodySmall" style={{ color: chrome.onSurfaceMuted, marginTop: tokens.spacing.xs }}>
          {detail}
        </UiText>
      ) : null}
      </View>
      </View>
      {children ? <View style={styles.heroActions}>{children}</View> : null}
    </View>
  );
}

export interface ActionTileProps {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

/** Icon-over-label shortcut used for quick actions. */
export function ActionTile({ label, icon, onPress, style, compact = false }: ActionTileProps) {
  const styles = useUiStyles();
  const { colors, scheme } = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.actionTile, scheme === 'dark' ? { elevation: 0, shadowOpacity: 0 } : undefined, compact ? { flexDirection: 'row', justifyContent: 'flex-start', minHeight: 60 } : undefined, pressed ? { backgroundColor: colors.surfaceLow } : undefined, style]}
    >
      <View style={styles.actionIcon}>
        <MaterialCommunityIcons color={colors.primary} name={icon} size={22} />
      </View>
      <UiText variant="label" style={{ textAlign: compact ? 'left' : 'center', flexShrink: 1, ...(compact ? { flex: 1 } : {}) }}>
        {label}
      </UiText>
      {compact ? <MaterialCommunityIcons accessible={false} name="chevron-right" color={colors.textMuted} size={20} /> : null}
    </Pressable>
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
      <UiText accessibilityRole="header" variant="headlineSmall" style={{ flexShrink: 1 }}>{title}</UiText>
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
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  stackedMeta?: boolean;
}

export function ListRow({ title, subtitle, meta, leading, trailing, onPress, unread = false, icon, stackedMeta = false }: ListRowProps) {
  const styles = useUiStyles();
  const { colors, window } = useTheme();
  const stack = stackedMeta || window.fontScale >= 1.3;
  const { copy } = useShellCopy();
  const accessibilityLabel = [
    unread ? copy.unread : null,
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
      {icon ? <IconChip icon={icon} tone={unread ? 'primary' : 'neutral'} /> : leading ? (
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
              {copy.unread}
            </UiText>
          ) : null}
        </View>
        {subtitle ? (
          <UiText variant="bodySmall" tone="muted">
            {subtitle}
          </UiText>
        ) : null}
        {meta && stack ? <UiText variant="meta" tone="muted">{meta}</UiText> : null}
      </View>
      {meta && !stack ? (
        <UiText variant="meta" tone="muted" style={styles.listMeta}>
          {meta}
        </UiText>
      ) : null}
      {trailing}
      {onPress && !trailing ? (
        <MaterialCommunityIcons color={colors.textMuted} name="chevron-right" size={20} style={styles.chevron} />
      ) : null}
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
      ) : <MaterialCommunityIcons accessible={false} importantForAccessibility="no" name={kind === 'error' ? 'alert-circle-outline' : 'inbox-outline'} color={kind === 'error' ? colors.error : colors.textMuted} size={24} />}
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
