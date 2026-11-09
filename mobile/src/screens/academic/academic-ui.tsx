import type { ReactNode } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Card, DataNotice, StatePanel, UiText } from '../../components/Ui';
import { ScrollableScreenShell as ScreenShell } from '../../components/perf/list-screen-shell';
import type { PerformanceListProps } from '../../components/perf/performance-list';
import { ChoiceField } from '../../components/ui/choice-field';
import { apiClient } from '../../api/client';
import { minTapTarget, tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { useLocale } from '../../i18n/locale-provider';
import { academicMessages, type AcademicCopy } from '../../i18n/academic-messages';
import type { MobileNavigation } from '../../navigation/types';
import type { ScreenName } from '../../navigation/routes';
import { isResourceUnauthorizedError } from '../student/shared/resource-error';
import { gradeScaleRows } from './gpa';

/** Opens a route that the navigator registers (transcript, curriculum, enrollments); a no-op until it does. */
export const openRoute = (navigation: MobileNavigation, route: string): void => navigation.navigate(route as ScreenName);

export function useAcademicCopy(): { copy: AcademicCopy; locale: 'vi' | 'en' } {
  const { locale } = useLocale();
  return { copy: academicMessages[locale], locale };
}

/** Two-decimal number formatter for GPA values in the active locale. */
export function useGpaFormat(): (value: number | null | undefined) => string {
  const { formatNumber } = useLocale();
  return (value) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const isPreviewMode = (): boolean => apiClient.mode === 'preview';

/** Localised, student-safe message for a failed read; never the raw server text. */
export function academicErrorMessage(copy: AcademicCopy, error: unknown, fallback: string): string {
  // A screen-local 401 stays inline and retryable; the session lane owns sign-in.
  if (isResourceUnauthorizedError(error)) return fallback;
  const status = (error as { status?: number } | null)?.status;
  if (status === 0 || error instanceof TypeError) return copy.offline;
  if (status === 403) return copy.denied;
  const code = (error as { code?: string } | null)?.code;
  if (code && copy.studentErrors[code]) return copy.studentErrors[code];
  return fallback;
}

/** Live-only query: preview sessions never fetch and callers fall back to labelled preview data. */
export function useAcademicQuery<T>(key: string, fetcher: () => Promise<T>, copy: AcademicCopy, enabled = true) {
  return useScreenQuery<T>(key, fetcher, {
    enabled: apiClient.mode === 'live' && enabled,
    errorMessage: copy.errorTitle,
    mapError: (error) => academicErrorMessage(copy, error, copy.generic),
  });
}

export interface AcademicShellProps<T = unknown> {
  list?: PerformanceListProps<T>;
  title: string;
  eyebrow?: string;
  loading?: boolean;
  loadingLabel?: string;
  error?: string | null;
  errorTitle?: string;
  errorDescription?: string;
  warning?: string | null;
  onRetry?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: ReactNode;
}

/** Screen frame with the loading, error and stale-data states in one place. */
export function AcademicShell<T>({ title, eyebrow, loading = false, loadingLabel, error, errorTitle, errorDescription, warning, onRetry, onRefresh, refreshing = false, children, list }: AcademicShellProps<T>) {
  const { copy } = useAcademicCopy();
  const { colors } = useTheme();
  const refreshControl = onRefresh
    ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
    : undefined;
  const frameList = list ? { ...list, ...(refreshControl ? { refreshControl } : {}) } : undefined;
  return (
    <ScreenShell title={title} eyebrow={eyebrow} list={frameList && (loading || error ? { ...frameList, data: [], footer: null } : frameList)}>
      {warning ? <View style={academicStyles.card}><DataNotice message={warning} /></View> : null}
      {loading ? (
        <StatePanel kind="loading" title={loadingLabel ?? copy.loading} />
      ) : error ? (
        <StatePanel kind="error" title={errorTitle ?? copy.errorTitle} description={errorDescription ?? error} actionLabel={copy.retry} onAction={onRetry} />
      ) : (
        children
      )}
    </ScreenShell>
  );
}

export interface TermFieldProps {
  options: ReadonlyArray<{ value: string; label: string }>;
  /** Empty string selects every term. */
  value: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
}

export function TermField({ options, value, onChange, allowAll = true }: TermFieldProps) {
  const { copy } = useAcademicCopy();
  const all = allowAll ? [{ value: '', label: copy.allTerms }] : [];
  return <ChoiceField label={copy.term} options={[...all, ...options]} value={value} onChange={onChange} display="sheet" />;
}

/** Letter, 10-point range and 4.0 point for every band. */
export function GradeScale() {
  const { copy, locale } = useAcademicCopy();
  return (
    <Card>
      <UiText accessibilityRole="header" variant="headlineSmall">{copy.scaleTitle}</UiText>
      <UiText variant="meta" tone="muted" style={styles.scaleHeader}>{copy.scaleHeader}</UiText>
      {gradeScaleRows(locale).map((row) => (
        <View key={row.letter} accessible accessibilityLabel={`${row.letter}, ${row.range}, ${row.point}`} style={styles.scaleRow}>
          <UiText variant="label" style={styles.scaleLetter}>{row.letter}</UiText>
          <UiText variant="bodySmall" tone="muted" style={styles.scaleRange}>{row.range}</UiText>
          <UiText variant="bodySmall">{row.point}</UiText>
        </View>
      ))}
      <UiText variant="meta" tone="muted" style={styles.scaleNote}>{copy.scaleFailingNote}</UiText>
    </Card>
  );
}

export interface SegmentTabsProps {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

/** Equal-width tabs with the shared 48dp minimum target. */
export function SegmentTabs({ label, value, options, onChange }: SegmentTabsProps) {
  const { colors } = useTheme();
  return (
    <View accessibilityLabel={label} style={styles.tabs}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[
              styles.tab,
              { borderColor: selected ? colors.primary : colors.outlineVariant, backgroundColor: selected ? colors.primaryFixed : colors.card },
            ]}
          >
            <UiText variant="label" tone={selected ? 'primary' : 'muted'} style={styles.tabText}>{option.label}</UiText>
          </Pressable>
        );
      })}
    </View>
  );
}

export const academicStyles = StyleSheet.create({
  gap: { height: tokens.spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  rowCopy: { flex: 1, minWidth: 160 },
  card: { marginBottom: tokens.spacing.sm },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginBottom: tokens.spacing.md },
  metric: { flexBasis: 140, flexGrow: 1 },
  actions: { gap: tokens.spacing.sm, marginTop: tokens.spacing.sm },
});

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  tab: { alignItems: 'center', borderRadius: tokens.radii.control, borderWidth: 1, flexGrow: 1, justifyContent: 'center', minHeight: minTapTarget, minWidth: minTapTarget, paddingHorizontal: tokens.spacing.sm },
  tabText: { textAlign: 'center' },
  scaleHeader: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.xs },
  scaleNote: { marginTop: tokens.spacing.sm },
  scaleRow: { alignItems: 'center', flexDirection: 'row', minHeight: 32 },
  scaleLetter: { width: 48 },
  scaleRange: { flex: 1 },
});
