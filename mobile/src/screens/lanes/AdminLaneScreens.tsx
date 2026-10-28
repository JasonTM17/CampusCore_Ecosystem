import { useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Button, SectionHeading, StatePanel, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
import { DateField } from '../../components/ui/date-field';
import { FormField, Sheet } from '../../components/ui/primitives';
import { fillCopy } from '../../i18n/academic-messages';
import { useLocale } from '../../i18n/locale-provider';
import type { LanesCopy } from '../../i18n/lanes-messages';
import {
  LANE_PAGE_SIZE,
  laneApi,
  type AttendanceRow,
  type AuditRow,
  type CreditApplication,
  type EnrollmentRow,
  type NotificationRow,
  type RosterRow,
  type StaffEvent,
} from './lane-api';
import {
  NOTIFICATION_TYPES,
  attendanceMark,
  canMarkAttendance,
  eventActions,
  failureKind,
  validateNotification,
  type EventAction,
  type NotificationDraft,
} from './lane-model';
import {
  ConfirmSheet,
  LaneShell,
  Pager,
  QueueCard,
  StatusFilter,
  laneErrorMessage,
  laneStyles,
  useActionRunner,
  useLaneRequest,
  useLanesCopy,
  type PendingAction,
} from './lane-ui';
import { HandoffLink } from './HandoffLink';

const todayIso = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const personName = (user?: { firstName?: string; lastName?: string }) =>
  [user?.lastName, user?.firstName].filter(Boolean).join(' ');

const courseLine = (section?: { sectionNumber?: string; course?: { code?: string; name?: string } }) =>
  [section?.course?.code, section?.course?.name].filter(Boolean).join(' · ') + (section?.sectionNumber ? ` (${section.sectionNumber})` : '');

interface FilterBarProps {
  copy: LanesCopy;
  children: ReactNode;
  onApply: () => void;
  onClear: () => void;
}

function FilterBar({ copy, children, onApply, onClear }: FilterBarProps) {
  return (
    <View>
      {children}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Button label={copy.applyFilters} onPress={onApply} />
        <Button label={copy.clearFilters} variant="secondary" onPress={onClear} />
      </View>
    </View>
  );
}

interface PagedProps<T> {
  title: string;
  copy: LanesCopy;
  filters: ReactNode;
  onApply: () => void;
  onClear: () => void;
  page: number;
  onPage: (page: number) => void;
  request: ReturnType<typeof useLaneRequest<{ items: T[]; meta: { total: number; totalPages: number } }>>;
  renderItem: (item: T, index: number) => ReactNode;
  footer?: ReactNode;
}

/** Filtered, server-paged read-only list shared by the oversight lanes. */
function PagedList<T>({ title, copy, filters, onApply, onClear, page, onPage, request, renderItem, footer }: PagedProps<T>) {
  const data = request.data;
  return (
    <LaneShell title={title} loading={request.loading && !data} error={request.error} onRetry={() => void request.reload()}>
      <View>
        <FilterBar copy={copy} onApply={onApply} onClear={onClear}>{filters}</FilterBar>
        {data && data.items.length === 0 ? <StatePanel kind="empty" title={copy.noMatch} /> : null}
        <View style={laneStyles.stack}>{(data?.items ?? []).map(renderItem)}</View>
        {data ? (
          <Pager copy={copy} page={page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={onPage} disabled={request.loading} />
        ) : null}
        {footer}
      </View>
    </LaneShell>
  );
}

/** Draft/applied filter pair: typing never refetches; Apply commits and returns to page 1. */
function useFilters<F extends Record<string, string>>(initial: F) {
  const [draft, setDraft] = useState<F>(initial);
  const [applied, setApplied] = useState<F>(initial);
  const [page, setPage] = useState(1);
  return {
    draft,
    applied,
    page,
    setPage,
    set: (key: keyof F, value: string) => setDraft((current) => ({ ...current, [key]: value })),
    apply: () => { setApplied(draft); setPage(1); },
    clear: () => { setDraft(initial); setApplied(initial); setPage(1); },
  };
}

const orUndefined = (value: string) => (value.trim() === '' ? undefined : value.trim());

/* ---------- attendance ---------- */

export function AdminAttendanceScreen() {
  const { copy } = useLanesCopy();
  const { formatDate } = useLocale();
  const filters = useFilters({ sectionId: '', studentId: '', date: '' });
  const { applied, page } = filters;
  const request = useLaneRequest(
    () => laneApi.attendance(
      { sectionId: orUndefined(applied.sectionId), studentId: orUndefined(applied.studentId), date: orUndefined(applied.date) },
      { page, limit: LANE_PAGE_SIZE },
    ),
    `admin:attendance:${applied.sectionId}:${applied.studentId}:${applied.date}:${page}`,
  );
  return (
    <PagedList<AttendanceRow>
      title={copy.titles['admin.attendance']}
      copy={copy}
      page={page}
      onPage={filters.setPage}
      onApply={filters.apply}
      onClear={filters.clear}
      request={request}
      filters={
        <>
          <FormField label={copy.filterSection} value={filters.draft.sectionId} onChangeText={(value) => filters.set('sectionId', value)} autoCapitalize="none" />
          <FormField label={copy.filterStudent} value={filters.draft.studentId} onChangeText={(value) => filters.set('studentId', value)} autoCapitalize="none" />
          <DateField label={copy.filterDate} value={filters.draft.date} onChange={(value) => filters.set('date', value)} max={todayIso()} />
        </>
      }
      renderItem={(row, index) => (
        <QueueCard
          key={row.id ?? index}
          title={personName(row.student?.user) || row.studentId || ''}
          status={row.status}
          copy={copy}
          lines={[courseLine(row.section), row.date ? formatDate(row.date) : null]}
        />
      )}
    />
  );
}

/* ---------- enrollments ---------- */

export function AdminEnrollmentsScreen() {
  const { copy } = useLanesCopy();
  const { formatDate } = useLocale();
  const filters = useFilters({ status: '', semesterId: '', sectionId: '', studentId: '' });
  const { applied, page } = filters;
  const request = useLaneRequest(
    () => laneApi.enrollments(
      {
        status: orUndefined(applied.status),
        semesterId: orUndefined(applied.semesterId),
        sectionId: orUndefined(applied.sectionId),
        studentId: orUndefined(applied.studentId),
      },
      { page, limit: LANE_PAGE_SIZE },
    ),
    `admin:enrollments:${applied.status}:${applied.semesterId}:${applied.sectionId}:${applied.studentId}:${page}`,
  );
  return (
    <PagedList<EnrollmentRow>
      title={copy.titles['admin.enrollments']}
      copy={copy}
      page={page}
      onPage={filters.setPage}
      onApply={filters.apply}
      onClear={filters.clear}
      request={request}
      footer={<HandoffLink label={copy.openOnWeb} path="/admin/enrollments" />}
      filters={
        <>
          <StatusFilter copy={copy} statuses={['ENROLLED', 'PENDING', 'DROPPED', 'COMPLETED']} value={filters.draft.status} onChange={(value) => filters.set('status', value)} />
          <FormField label={copy.filterSemester} value={filters.draft.semesterId} onChangeText={(value) => filters.set('semesterId', value)} autoCapitalize="none" />
          <FormField label={copy.filterSection} value={filters.draft.sectionId} onChangeText={(value) => filters.set('sectionId', value)} autoCapitalize="none" />
          <FormField label={copy.filterStudent} value={filters.draft.studentId} onChangeText={(value) => filters.set('studentId', value)} autoCapitalize="none" />
        </>
      }
      renderItem={(row, index) => (
        <QueueCard
          key={row.id ?? index}
          title={personName(row.student?.user) || copy.student}
          status={row.status}
          copy={copy}
          lines={[courseLine(row.section), row.semester?.name, row.enrolledAt ? formatDate(row.enrolledAt) : null]}
        />
      )}
    />
  );
}

/* ---------- audit (read-only, minimal fields, never cached) ---------- */

export function AdminAuditScreen() {
  const { copy } = useLanesCopy();
  const { formatDateTime } = useLocale();
  const filters = useFilters({ action: '', entityType: '' });
  const { applied, page } = filters;
  const request = useLaneRequest(
    () => laneApi.audit({ action: orUndefined(applied.action), entityType: orUndefined(applied.entityType) }, { page, limit: LANE_PAGE_SIZE }),
    `admin:audit:${applied.action}:${applied.entityType}:${page}`,
  );
  return (
    <PagedList<AuditRow>
      title={copy.titles['admin.audit']}
      copy={copy}
      page={page}
      onPage={filters.setPage}
      onApply={filters.apply}
      onClear={filters.clear}
      request={request}
      filters={
        <>
          <FormField label={copy.filterAction} value={filters.draft.action} onChangeText={(value) => filters.set('action', value)} autoCapitalize="none" />
          <FormField label={copy.filterEntity} value={filters.draft.entityType} onChangeText={(value) => filters.set('entityType', value)} autoCapitalize="none" />
        </>
      }
      renderItem={(row, index) => (
        <QueueCard
          key={row.id ?? index}
          title={String(row.action ?? '')}
          copy={copy}
          lines={[
            row.entityType ? `${copy.entity}: ${row.entityType}` : null,
            row.actorId ? `${copy.actor}: ${String(row.actorId).slice(0, 8)}` : null,
            row.createdAt ? `${copy.when}: ${formatDateTime(row.createdAt)}` : null,
          ]}
        />
      )}
    />
  );
}

/* ---------- credit-limit applications ---------- */

export function AdminCreditLimitsScreen() {
  const { copy } = useLanesCopy();
  const [status, setStatus] = useState('PENDING');
  const request = useLaneRequest(() => laneApi.creditApplications(status), `admin:credit:${status}`);
  const runner = useActionRunner(copy, () => void request.reload());
  const items = request.data ?? [];

  const review = (row: CreditApplication, decision: 'APPROVED' | 'REJECTED'): PendingAction => ({
    label: decision === 'APPROVED' ? copy.approve : copy.reject,
    subject: `${row.studentName ?? row.studentCode ?? row.id}`,
    needsText: decision === 'REJECTED',
    textLabel: copy.reviewNote,
    run: (text) => laneApi.creditReview(row, decision, text),
  });

  return (
    <LaneShell title={copy.titles['admin.creditLimits']} loading={request.loading} error={request.error} onRetry={() => void request.reload()} banner={runner.banner}>
      <View>
        <StatusFilter copy={copy} statuses={['PENDING', 'APPROVED', 'REJECTED']} value={status} onChange={setStatus} />
        {items.length === 0 ? <StatePanel kind="empty" title={copy.empty} /> : null}
        <View style={laneStyles.stack}>
          {items.map((row) => (
            <QueueCard
              key={row.id}
              title={row.studentName ?? row.studentCode ?? row.id}
              status={row.status}
              copy={copy}
              lines={[
                row.studentCode,
                row.semesterName ?? row.roundName,
                typeof row.requestedLimit === 'number' ? fillCopy(copy.creditRequested, { n: row.requestedLimit }) : null,
                typeof row.standardLimit === 'number' ? fillCopy(copy.creditStandard, { n: row.standardLimit }) : null,
                row.reason ? fillCopy(copy.creditReason, { text: row.reason }) : null,
                row.reviewerNote,
              ]}
              actions={row.status === 'PENDING' ? [
                { key: 'approve', label: copy.approve, onPress: () => runner.request(review(row, 'APPROVED')) },
                { key: 'reject', label: copy.reject, onPress: () => runner.request(review(row, 'REJECTED')) },
              ] : []}
            />
          ))}
        </View>
      </View>
      <ConfirmSheet runner={runner} copy={copy} />
    </LaneShell>
  );
}

/* ---------- events and attendance marks ---------- */

const EVENT_LABEL = (copy: LanesCopy, action: EventAction): string => ({
  publish: copy.publish,
  closeRegistration: copy.closeRegistration,
  complete: copy.completeEvent,
  cancel: copy.cancelEvent,
})[action];

const EVENT_PATH: Record<Exclude<EventAction, 'cancel'>, 'publish' | 'close-registration' | 'complete'> = {
  publish: 'publish',
  closeRegistration: 'close-registration',
  complete: 'complete',
};

function EventRoster({ event, copy, onBack }: { event: StaffEvent; copy: LanesCopy; onBack: () => void }) {
  const roster = useLaneRequest(() => laneApi.eventRoster(event.id), `admin:roster:${event.id}`);
  const runner = useActionRunner(copy, () => void roster.reload());
  const markable = canMarkAttendance(event.status);
  const rows: RosterRow[] = roster.data ?? [];

  const mark = (row: RosterRow, status: 'ATTENDED' | 'ABSENT'): PendingAction | null => {
    const body = attendanceMark(row, status);
    if (!body) return null;
    return {
      label: status === 'ATTENDED' ? copy.markAttended : copy.markAbsent,
      subject: row.studentName ?? row.email ?? body.registrationId,
      needsText: false,
      run: () => laneApi.eventMark(event.id, body),
    };
  };

  return (
    <LaneShell title={event.title ?? copy.rosterTitle} loading={roster.loading} error={roster.error} onRetry={() => void roster.reload()} banner={runner.banner}>
      <View>
        <Button label={copy.eventBack} variant="secondary" onPress={onBack} />
        <SectionHeading title={copy.rosterTitle} />
        {rows.length === 0 ? <StatePanel kind="empty" title={copy.rosterEmpty} /> : null}
        <View style={laneStyles.stack}>
          {rows.map((row, index) => {
            const attended = mark(row, 'ATTENDED');
            const absent = mark(row, 'ABSENT');
            return (
              <QueueCard
                key={row.registrationId ?? index}
                title={row.studentName ?? row.email ?? ''}
                status={row.attendanceStatus ?? row.status}
                copy={copy}
                lines={[row.email]}
                actions={markable && attended && absent ? [
                  { key: 'attended', label: copy.markAttended, onPress: () => runner.request(attended) },
                  { key: 'absent', label: copy.markAbsent, onPress: () => runner.request(absent) },
                ] : []}
              />
            );
          })}
        </View>
      </View>
      <ConfirmSheet runner={runner} copy={copy} />
    </LaneShell>
  );
}

export function AdminEventsScreen() {
  const { copy } = useLanesCopy();
  const { formatDateTime } = useLocale();
  const [selected, setSelected] = useState<StaffEvent | null>(null);
  const request = useLaneRequest(() => laneApi.staffEvents(), 'admin:events', selected === null);
  const runner = useActionRunner(copy, () => void request.reload());
  const items = request.data ?? [];

  if (selected) return <EventRoster event={selected} copy={copy} onBack={() => setSelected(null)} />;

  const act = (event: StaffEvent, action: EventAction): PendingAction => ({
    label: EVENT_LABEL(copy, action),
    subject: event.title ?? event.id,
    needsText: action === 'cancel',
    textLabel: copy.reason,
    run: (text) => (action === 'cancel' ? laneApi.eventCancel(event.id, text) : laneApi.eventTransition(event.id, EVENT_PATH[action])),
  });

  return (
    <LaneShell title={copy.titles['admin.events']} loading={request.loading} error={request.error} onRetry={() => void request.reload()} banner={runner.banner}>
      <View>
        {items.length === 0 ? <StatePanel kind="empty" title={copy.empty} /> : null}
        <View style={laneStyles.stack}>
          {items.map((event) => (
            <QueueCard
              key={event.id}
              title={event.title ?? event.id}
              status={event.status}
              copy={copy}
              lines={[
                event.startsAt ? formatDateTime(event.startsAt) : null,
                event.location,
                typeof event.capacity === 'number' ? fillCopy(copy.registered, { n: event.registeredCount ?? 0, cap: event.capacity }) : null,
              ]}
              actions={[
                { key: 'detail', label: copy.eventDetail, onPress: () => setSelected(event) },
                ...eventActions(event.status).map((action) => ({ key: action, label: EVENT_LABEL(copy, action), onPress: () => runner.request(act(event, action)) })),
              ]}
            />
          ))}
        </View>
        <HandoffLink label={copy.openOnWeb} path="/admin/events" />
      </View>
      <ConfirmSheet runner={runner} copy={copy} />
    </LaneShell>
  );
}

/* ---------- notifications ---------- */

type SendState = 'idle' | 'sending' | 'sent' | 'unknown';

const EMPTY_DRAFT: NotificationDraft = { userId: '', title: '', message: '', type: 'INFO' };

export function AdminNotificationsScreen() {
  const { copy } = useLanesCopy();
  const { formatDateTime } = useLocale();
  const [draft, setDraft] = useState<NotificationDraft>(EMPTY_DRAFT);
  const [problems, setProblems] = useState<ReturnType<typeof validateNotification>>([]);
  const [previewing, setPreviewing] = useState(false);
  const [state, setState] = useState<SendState>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [page, setPage] = useState(1);
  const history = useLaneRequest(() => laneApi.notificationHistory({ page, limit: LANE_PAGE_SIZE }), `admin:notifications:${page}`);

  const preview = () => {
    const found = validateNotification(draft);
    setProblems(found);
    setSendError(null);
    if (found.length === 0) setPreviewing(true);
  };

  // A notification reaches its recipient immediately and the server has no
  // idempotency key, so a failed send is never retried automatically; when the
  // outcome is unknown the admin is told to check the history first.
  const send = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState('sending');
    setSendError(null);
    try {
      await laneApi.sendNotification(draft);
      setPreviewing(false);
      setDraft(EMPTY_DRAFT);
      setState('sent');
      void history.reload();
    } catch (error) {
      const kind = failureKind(error);
      if (kind === 'offline' || kind === 'other') {
        setPreviewing(false);
        setState('unknown');
      } else {
        setSendError(laneErrorMessage(copy, error, copy.generic));
        setState('idle');
      }
    } finally {
      inFlight.current = false;
    }
  };

  const rows: NotificationRow[] = history.data?.items ?? [];
  const meta = history.data?.meta;
  const busy = state === 'sending';

  return (
    <LaneShell
      title={copy.titles['admin.notifications']}
      loading={history.loading && !history.data}
      error={history.error}
      onRetry={() => void history.reload()}
      banner={state === 'sent' ? { tone: 'success', message: copy.notifSent } : state === 'unknown' ? { tone: 'warning', message: copy.notifUnknown } : null}
    >
      <View>
        <FormField
          label={copy.notifRecipient}
          value={draft.userId}
          onChangeText={(userId) => setDraft((current) => ({ ...current, userId }))}
          autoCapitalize="none"
          autoCorrect={false}
          error={problems.includes('recipient') ? copy.notifRecipientInvalid : undefined}
        />
        <FormField
          label={copy.notifTitle}
          value={draft.title}
          onChangeText={(title) => setDraft((current) => ({ ...current, title }))}
          maxLength={200}
          error={problems.includes('title') ? copy.notifTitleRequired : undefined}
        />
        <FormField
          label={copy.notifMessage}
          value={draft.message}
          onChangeText={(message) => setDraft((current) => ({ ...current, message }))}
          multiline
          maxLength={2000}
          error={problems.includes('message') ? copy.notifMessageRequired : undefined}
        />
        <ChoiceField
          label={copy.notifType}
          display="sheet"
          options={NOTIFICATION_TYPES.map((value) => ({ value, label: copy.notifTypes[value] ?? value }))}
          value={draft.type}
          onChange={(type) => setDraft((current) => ({ ...current, type: type as NotificationDraft['type'] }))}
        />
        <Button label={copy.notifPreview} onPress={preview} disabled={busy} />
        <UiText variant="bodySmall" tone="muted">{copy.notifBulkWeb}</UiText>
        <HandoffLink label={copy.openOnWeb} path="/admin/notifications" />

        <SectionHeading title={copy.notifHistory} />
        {rows.length === 0 ? <StatePanel kind="empty" title={copy.empty} /> : null}
        <View style={laneStyles.stack}>
          {rows.map((row, index) => (
            <QueueCard
              key={row.id ?? index}
              title={row.title ?? ''}
              copy={copy}
              lines={[row.type ? copy.notifTypes[row.type] ?? row.type : null, row.createdAt ? formatDateTime(row.createdAt) : null]}
            />
          ))}
        </View>
        {meta ? <Pager copy={copy} page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} disabled={history.loading} /> : null}
      </View>

      {previewing ? (
        <Sheet visible onClose={() => { if (!busy) setPreviewing(false); }} title={copy.notifPreviewTitle}>
          <UiText variant="label">{draft.title.trim()}</UiText>
          <UiText variant="bodySmall" tone="muted">{copy.notifTypes[draft.type] ?? draft.type}</UiText>
          <UiText variant="bodyMedium">{draft.message.trim()}</UiText>
          <UiText variant="bodySmall" tone="muted">{fillCopy(copy.notifSendBody, { to: draft.userId.trim() })}</UiText>
          {sendError ? <UiText accessibilityRole="alert" variant="bodySmall" tone="error">{sendError}</UiText> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <Button label={copy.notifBack} variant="secondary" onPress={() => setPreviewing(false)} disabled={busy} />
            <Button label={copy.notifSend} loading={busy} onPress={() => void send()} />
          </View>
        </Sheet>
      ) : null}
    </LaneShell>
  );
}
