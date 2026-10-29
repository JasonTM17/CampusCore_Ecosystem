import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, IconChip, Notice, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { ScrollableScreenShell as ScreenShell } from '../../components/perf/list-screen-shell';
import { ListGap, type PerformanceListProps } from '../../components/perf/performance-list';
import { ChoiceField } from '../../components/ui/choice-field';
import { FormField, Sheet } from '../../components/ui/primitives';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import { lanesMessages, type LanesCopy } from '../../i18n/lanes-messages';
import { failureKind, type FailureKind } from './lane-model';

export function useLanesCopy(): { copy: LanesCopy; locale: 'vi' | 'en' } {
  const { locale } = useLocale();
  return { copy: lanesMessages[locale], locale };
}

/** Localised message for a failed read or write; never the raw server text. */
export function laneErrorMessage(copy: LanesCopy, error: unknown, fallback: string): string {
  switch (failureKind(error)) {
    case 'offline': return copy.offline;
    case 'unauthorized': return copy.signIn;
    case 'denied': return copy.denied;
    case 'conflict': return copy.conflict;
    case 'invalid': return copy.invalid;
    default: return fallback;
  }
}

interface RequestState<T> {
  key: string;
  data?: T;
  loading: boolean;
  error: string | null;
  failure: FailureKind | null;
}

/**
 * Live request for a lane screen. Deliberately uncached: lane data is
 * authorization-scoped (a revoked grant must not keep showing a queue) and
 * audit rows must never sit in an offline cache. A failure drops the data, a
 * newer request wins, and the screen refetches whenever it regains focus.
 */
export function useLaneRequest<T>(fetcher: () => Promise<T>, key: string, enabled = true) {
  const { copy } = useLanesCopy();
  const [state, setState] = useState<RequestState<T>>({ key, loading: enabled, error: null, failure: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const mine = ++sequence.current;
    setState((current) => ({ key, data: current.key === key ? current.data : undefined, loading: true, error: null, failure: null }));
    try {
      const data = await fetcherRef.current();
      if (mounted.current && mine === sequence.current) setState({ key, data, loading: false, error: null, failure: null });
    } catch (error) {
      if (mounted.current && mine === sequence.current) {
        setState({ key, loading: false, error: laneErrorMessage(copyRef.current, error, copyRef.current.errorTitle), failure: failureKind(error) });
      }
    }
  }, [key, enabled]);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  return {
    data: state.key === key ? state.data : undefined,
    loading: enabled && (state.loading || state.key !== key) && state.error === null,
    error: state.key === key ? state.error : null,
    failure: state.key === key ? state.failure : null,
    reload,
  };
}

export interface LaneShellProps<T = unknown> {
  list?: PerformanceListProps<T>;
  title: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  banner?: { tone: 'success' | 'error' | 'warning'; message: string } | null;
  children: ReactNode;
}

/** Screen frame: loading, error (including denied) and an action-result banner. */
export function LaneShell<T>({ title, loading = false, error, onRetry, banner, children, list }: LaneShellProps<T>) {
  const { copy } = useLanesCopy();
  return (
    <ScreenShell title={title} list={list && { ItemSeparatorComponent: ListGap, ...(loading || error ? { ...list, data: [], footer: null } : list) }}>
      {banner ? <Notice tone={banner.tone} message={banner.message} /> : null}
      {loading || error ? (
        <StatePanel
          kind={loading ? 'loading' : 'error'}
          title={loading ? copy.loading : copy.errorTitle}
          description={loading ? undefined : error ?? undefined}
          actionLabel={loading ? undefined : copy.retry}
          onAction={loading ? undefined : onRetry}
        />
      ) : (
        children
      )}
    </ScreenShell>
  );
}

export const statusTone = (status: string | undefined): 'neutral' | 'primary' | 'success' | 'warning' | 'error' => {
  switch (status) {
    case 'ACCEPTED': case 'APPROVED': case 'PUBLISHED': case 'COMPLETED': case 'ISSUED': case 'OFFER': case 'PRESENT': case 'ATTENDED': case 'SUCCESS': return 'success';
    case 'REJECTED': case 'CANCELLED': case 'ABSENT': case 'EXPIRED': case 'ERROR': case 'URGENT': return 'error';
    case 'SUBMITTED': case 'REQUESTED': case 'PENDING': case 'RETURNED': case 'LATE': case 'WARNING': return 'warning';
    case 'IN_REVIEW': case 'REVIEWING': case 'INTERVIEW': case 'REGISTRATION_OPEN': case 'INFO': case 'ACADEMIC': return 'primary';
    default: return 'neutral';
  }
};

export function StatusBadge({ status, copy }: { status: string | undefined; copy: LanesCopy }) {
  if (!status) return null;
  return <StatusPill label={copy.notifTypes?.[status] ?? copy.statuses[status] ?? status} tone={statusTone(status)} />;
}

export interface StatusFilterProps {
  copy: LanesCopy;
  statuses: readonly string[];
  value: string;
  onChange: (value: string) => void;
}

export function StatusFilter({ copy, statuses, value, onChange }: StatusFilterProps) {
  return (
    <ChoiceField
      label={copy.statusFilter}
      display="sheet"
      options={[{ value: '', label: copy.all }, ...statuses.map((status) => ({ value: status, label: copy.statuses[status] ?? status }))]}
      value={value}
      onChange={onChange}
    />
  );
}

export interface PendingAction {
  /** Button label, also the confirmation title. */
  label: string;
  /** What the action applies to, shown in the confirmation body. */
  subject: string;
  needsText: boolean;
  textLabel?: string;
  run: (text: string) => Promise<unknown>;
}

export interface ActionRunner {
  pending: PendingAction | null;
  busy: boolean;
  error: string | null;
  banner: { tone: 'success' | 'error' | 'warning'; message: string } | null;
  request: (action: PendingAction) => void;
  cancel: () => void;
  confirm: (text: string) => Promise<void>;
}

/**
 * Confirm-then-run for a queue action. One request at a time (a second tap
 * while busy is ignored); a conflict closes the sheet and reloads the list; any
 * other failure keeps the sheet open so the staff member decides whether to retry.
 */
export function useActionRunner(copy: LanesCopy, reload: () => void): ActionRunner {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<ActionRunner['banner']>(null);
  const inFlight = useRef(false);

  const request = (action: PendingAction) => { setError(null); setBanner(null); setPending(action); };
  const cancel = () => { if (!inFlight.current) { setPending(null); setError(null); } };

  const confirm = async (text: string) => {
    if (!pending || inFlight.current) return;
    if (pending.needsText && text.trim() === '') { setError(copy.reasonRequired); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await pending.run(text);
      setPending(null);
      setBanner({ tone: 'success', message: copy.done });
      reload();
    } catch (failure) {
      const kind = failureKind(failure);
      const message = laneErrorMessage(copy, failure, copy.generic);
      if (kind === 'conflict' || kind === 'denied' || kind === 'unauthorized') {
        setPending(null);
        setBanner({ tone: 'error', message });
        reload();
      } else {
        setError(message);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { pending, busy, error, banner, request, cancel, confirm };
}

export function ConfirmSheet({ runner, copy }: { runner: ActionRunner; copy: LanesCopy }) {
  const [text, setText] = useState('');
  const { pending } = runner;
  useEffect(() => { if (pending) setText(''); }, [pending]);
  if (!pending) return null;
  return (
    <Sheet visible onClose={runner.cancel} title={fillCopy(copy.confirmTitle, { action: pending.label })}>
      <UiText variant="bodySmall" tone="muted">{fillCopy(copy.confirmBody, { subject: pending.subject })}</UiText>
      {pending.needsText ? (
        <FormField
          label={pending.textLabel ?? copy.reason}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={500}
          required
          editable={!runner.busy}
        />
      ) : null}
      {runner.error ? <UiText accessibilityRole="alert" variant="bodySmall" tone="error">{runner.error}</UiText> : null}
      <View style={styles.sheetActions}>
        <Button label={copy.dismiss} variant="secondary" onPress={runner.cancel} disabled={runner.busy} />
        <Button label={copy.confirm} loading={runner.busy} onPress={() => void runner.confirm(text)} />
      </View>
    </Sheet>
  );
}

export interface QueueCardProps {
  title: string;
  lines: ReadonlyArray<string | null | undefined>;
  status?: string;
  count?: number | string;
  copy: LanesCopy;
  actions?: ReadonlyArray<{
    key: string;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    variant?: 'primary' | 'secondary' | 'destructive' | 'text';
  }>;
  children?: ReactNode;
}

/** One queue row: title, status pill, detail lines and clearly separated actions. */
export function QueueCard({ title, lines, status, count, copy, actions = [], children }: QueueCardProps) {
  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <UiText accessibilityRole="header" variant="label" style={styles.cardTitle}>{title}</UiText>
        <View style={styles.cardHeadBadges}>
          {count !== undefined ? <StatusPill label={String(count)} tone="primary" /> : null}
          {status ? <StatusPill label={copy.notifTypes?.[status] ?? copy.statuses[status] ?? status} tone={statusTone(status)} /> : null}
        </View>
      </View>
      {lines.filter(Boolean).map((line, index) => (
        <UiText key={index} variant="bodySmall" tone="muted">{line}</UiText>
      ))}
      {children}
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <Button
              key={action.key}
              label={action.label}
              variant={action.variant ?? 'secondary'}
              onPress={action.onPress}
              disabled={action.disabled}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export interface AuditTimelineRowProps {
  action: string;
  entityType?: string | null;
  actorId?: string | null;
  createdAt?: string | null;
  copy: LanesCopy;
  isLast?: boolean;
}

/** One audit log row rendered as a compact timeline entry. */
export function AuditTimelineRow({ action, entityType, actorId, createdAt, copy, isLast = false }: AuditTimelineRowProps) {
  const { colors } = useTheme();
  const { formatDateTime } = useLocale();
  return (
    <View style={laneStyles.timelineItem}>
      <View style={laneStyles.timelineConnector}>
        <IconChip icon="history" size={32} tone="neutral" />
        {!isLast ? <View style={[laneStyles.timelineLine, { backgroundColor: colors.outlineVariant }]} /> : null}
      </View>
      <Card style={laneStyles.timelineContent}>
        <View style={styles.cardHead}>
          <UiText accessibilityRole="header" variant="label" style={styles.cardTitle}>{action}</UiText>
          {entityType ? <StatusPill label={entityType} tone="neutral" /> : null}
        </View>
        {actorId ? (
          <UiText variant="bodySmall" tone="muted">
            {copy.actor}: {String(actorId).slice(0, 8)}
          </UiText>
        ) : null}
        {createdAt ? (
          <UiText variant="bodySmall" tone="muted">
            {copy.when}: {formatDateTime(createdAt)}
          </UiText>
        ) : null}
      </Card>
    </View>
  );
}

export interface PagerProps {
  copy: LanesCopy;
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
  disabled?: boolean;
}

/** Server paging control (1-based pages), with the position stated as text. */
export function Pager({ copy, page, totalPages, total, onPage, disabled = false }: PagerProps) {
  return (
    <View style={styles.pager}>
      <UiText variant="bodySmall" tone="muted" accessibilityLiveRegion="polite">
        {fillCopy(copy.pageOf, { page, pages: Math.max(totalPages, 1), total })}
      </UiText>
      <View style={styles.actions}>
        <Button label={copy.prevPage} variant="secondary" disabled={disabled || page <= 1} onPress={() => onPage(page - 1)} />
        <Button label={copy.nextPage} variant="secondary" disabled={disabled || page >= totalPages} onPress={() => onPage(page + 1)} />
      </View>
    </View>
  );
}

export const laneStyles = StyleSheet.create({
  stack: { gap: tokens.spacing.sm },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginBottom: tokens.spacing.md },
  metric: { flexBasis: 140, flexGrow: 1 },
  timelineItem: { flexDirection: 'row', gap: tokens.spacing.md, marginBottom: tokens.spacing.sm },
  timelineConnector: { alignItems: 'center', width: 32 },
  timelineLine: { width: 2, flex: 1, backgroundColor: tokens.colors.outlineVariant, marginTop: 4 },
  timelineContent: { flex: 1, padding: tokens.spacing.md, gap: tokens.spacing.xs },
});

const styles = StyleSheet.create({
  card: { gap: tokens.spacing.xs, marginBottom: tokens.spacing.sm, padding: tokens.spacing.md },
  cardHead: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  cardHeadBadges: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.xs },
  cardTitle: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginTop: tokens.spacing.sm },
  sheetActions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'flex-end', marginTop: tokens.spacing.md },
  pager: { gap: tokens.spacing.sm, marginVertical: tokens.spacing.md },
});
