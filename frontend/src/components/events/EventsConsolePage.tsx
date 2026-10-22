'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Flag,
  Megaphone,
  Play,
  Plus,
  RefreshCw,
  TicketCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/context/AuthContext';
import {
  eventsApi,
  isEventsStaffDenied,
  newIdempotencyKey,
  type CampusEvent,
  type EventRosterEntry,
  type MyEventRegistration,
} from '@/lib/events-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { statusToneClass } from '@/components/ui/status';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

/**
 * /dashboard/events — single surface for both audiences (contract D4):
 * staff grant holders see lifecycle + roster + manual attendance; every
 * other authenticated user falls back to the student read/register view.
 * The server is the authority — the UI only picks which surface to render
 * after the staff list call answers EVENTS_STAFF_REQUIRED.
 *
 * Shared by /dashboard/events (students + non-admin grant holders) and
 * /admin/events (admin staff console — the dashboard layout bounces full
 * admins to /admin, so the staff surface lives inside the admin shell).
 */
/** Reuse the key of an unresolved attempt; a settled outcome clears it. */
function pendingKeyFor(keys: Map<string, string>, scope: string): string {
  const existing = keys.get(scope);
  if (existing) return existing;
  const created = newIdempotencyKey();
  keys.set(scope, created);
  return created;
}

/** Server error code when the API answered (so the outcome is settled), else undefined. */
function errorCode(error: unknown): string | undefined {
  return (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
}

export function EventsConsolePage() {
  const { user, isLoading: authLoading, hasAccess, isForbidden } = useRequireAuth([
    'STUDENT',
    'LECTURER',
    'ADMIN',
    'SUPER_ADMIN',
    'TRUONG_BO_MON',
    'TRUONG_KHOA',
  ]);
  const { locale, formatDateTime } = useI18n();

  const [mode, setMode] = useState<'loading' | 'staff' | 'student'>('loading');
  const [staffEvents, setStaffEvents] = useState<CampusEvent[]>([]);
  const [studentEvents, setStudentEvents] = useState<CampusEvent[]>([]);
  const [myRegistrations, setMyRegistrations] = useState<MyEventRegistration[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [roster, setRoster] = useState<EventRosterEntry[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A retry after a timeout must replay the same Idempotency-Key, so a
  // registration that already landed is returned instead of failing as a duplicate.
  const pendingKeys = useRef(new Map<string, string>());
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState<CampusEvent | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [form, setForm] = useState({
    title: '',
    organizer: '',
    location: '',
    capacity: '50',
    startsAt: '',
    endsAt: '',
    registrationOpensAt: '',
    registrationClosesAt: '',
    description: '',
  });

  const copy = useMemo(
    () =>
      locale === 'vi'
        ? {
            eyebrow: 'ĐOÀN – HỘI • SỰ KIỆN TRƯỜNG',
            title: 'Sự kiện & Hoạt động Đoàn–Hội',
            description:
              'Quản lý vòng đời sự kiện, đăng ký chỗ và điểm danh thủ công theo danh sách.',
            refresh: 'Làm mới',
            loading: 'Đang tải sự kiện',
            create: 'Tạo sự kiện',
            emptyStaff: 'Chưa có sự kiện nào — tạo sự kiện nháp đầu tiên.',
            emptyStudent: 'Chưa có sự kiện nào được công bố.',
            roster: 'Danh sách đăng ký',
            rosterEmpty: 'Chưa có đăng ký nào.',
            capacity: 'Sức chứa',
            seats: 'Còn trống',
            registered: 'Đã đăng ký',
            publish: 'Công bố',
            open: 'Mở đăng ký',
            close: 'Đóng đăng ký',
            complete: 'Hoàn tất',
            cancelEvent: 'Hủy sự kiện',
            cancelReason: 'Lý do hủy (thông báo tới người đăng ký)',
            register: 'Đăng ký tham gia',
            cancelRegistration: 'Hủy đăng ký',
            myRegistrations: 'Đăng ký của tôi',
            attended: 'Có mặt',
            absent: 'Vắng',
            markPresent: 'Điểm danh Có mặt',
            markAbsent: 'Đánh dấu Vắng',
            status: 'Trạng thái',
            when: 'Thời gian',
            where: 'Địa điểm',
            organizer: 'Đơn vị tổ chức',
            window: 'Cửa sổ đăng ký',
            titleField: 'Tên sự kiện',
            submitCreate: 'Tạo bản nháp',
            created: 'Đã tạo sự kiện nháp.',
            actionDone: 'Đã cập nhật trạng thái sự kiện.',
            registeredOk: 'Đăng ký thành công.',
            cancelledOk: 'Đã hủy đăng ký.',
            cancelledEventOk: 'Đã hủy sự kiện và thông báo cho người đăng ký.',
            markedOk: 'Đã cập nhật điểm danh.',
            failed: 'Thao tác chưa thành công — thử lại.',
            full: 'Sự kiện đã hết chỗ.',
            started: 'Sự kiện đã bắt đầu nên không thể đăng ký hoặc hủy.',
            attendanceHint: 'Điểm danh chỉ mở sau khi đóng đăng ký và sự kiện đã bắt đầu.',
            studentHint: 'Bạn đang xem sự kiện với vai trò người tham gia.',
            ownerOnly: 'Chỉ chủ sở hữu sự kiện mới được công bố.',
            statusLabels: {
              DRAFT: 'Bản nháp',
              PUBLISHED: 'Đã công bố',
              REGISTRATION_OPEN: 'Đang mở đăng ký',
              REGISTRATION_CLOSED: 'Đã đóng đăng ký',
              COMPLETED: 'Đã hoàn tất',
              CANCELLED: 'Đã hủy',
            } as Record<string, string>,
          }
        : {
            eyebrow: 'UNION & ASSOCIATION • CAMPUS EVENTS',
            title: 'Events & Union Activities',
            description:
              'Manage the event lifecycle, seat registration and manual roster attendance.',
            refresh: 'Refresh',
            loading: 'Loading events',
            create: 'Create event',
            emptyStaff: 'No events yet — create the first draft.',
            emptyStudent: 'No published events yet.',
            roster: 'Roster',
            rosterEmpty: 'No registrations yet.',
            capacity: 'Capacity',
            seats: 'Seats left',
            registered: 'Registered',
            publish: 'Publish',
            open: 'Open registration',
            close: 'Close registration',
            complete: 'Complete',
            cancelEvent: 'Cancel event',
            cancelReason: 'Cancellation reason (sent to registrants)',
            register: 'Register',
            cancelRegistration: 'Cancel registration',
            myRegistrations: 'My registrations',
            attended: 'Attended',
            absent: 'Absent',
            markPresent: 'Mark attended',
            markAbsent: 'Mark absent',
            status: 'Status',
            when: 'When',
            where: 'Where',
            organizer: 'Organizer',
            window: 'Registration window',
            titleField: 'Event title',
            submitCreate: 'Create draft',
            created: 'Draft event created.',
            actionDone: 'Event updated.',
            registeredOk: 'Registration confirmed.',
            cancelledOk: 'Registration cancelled.',
            cancelledEventOk: 'Event cancelled; registrants notified.',
            markedOk: 'Attendance updated.',
            failed: 'Action failed — please retry.',
            full: 'This event is full.',
            started: 'The event has started, so registration can no longer change.',
            attendanceHint:
              'Attendance opens once registration is closed and the event has started.',
            studentHint: 'You are browsing events as a participant.',
            ownerOnly: 'Only the event owner can publish it.',
            statusLabels: {
              DRAFT: 'Draft',
              PUBLISHED: 'Published',
              REGISTRATION_OPEN: 'Registration open',
              REGISTRATION_CLOSED: 'Registration closed',
              COMPLETED: 'Completed',
              CANCELLED: 'Cancelled',
            } as Record<string, string>,
          },
    [locale],
  );

  const loadStaff = useCallback(async () => {
    const events = await eventsApi.staffList();
    setStaffEvents(events);
    setMode('staff');
  }, []);

  const loadStudent = useCallback(async () => {
    const [events, mine] = await Promise.all([
      eventsApi.listPublished(),
      eventsApi.myRegistrations(),
    ]);
    setStudentEvents(events);
    setMyRegistrations(mine);
    setMode('student');
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      await loadStaff();
    } catch (staffError) {
      if (isEventsStaffDenied(staffError)) {
        try {
          await loadStudent();
        } catch (studentError) {
          setError(copy.failed);
        }
        return;
      }
      setError(copy.failed);
    }
  }, [copy.failed, loadStaff, loadStudent]);

  useEffect(() => {
    if (!authLoading && hasAccess) {
      void load();
    }
  }, [authLoading, hasAccess, load]);

  const loadRoster = useCallback(
    async (eventId: string) => {
      setRosterLoading(true);
      try {
        setRoster(await eventsApi.staffRoster(eventId));
      } catch {
        setRoster([]);
      } finally {
        setRosterLoading(false);
      }
    },
    [],
  );

  const selectEvent = useCallback(
    (eventId: string) => {
      setSelectedEventId((current) => (current === eventId ? null : eventId));
      void loadRoster(eventId);
    },
    [loadRoster],
  );

  // Notification deep links carry ?event=<id> — expand that card once the
  // mode resolves (roster only loads for the staff surface).
  useEffect(() => {
    if (mode === 'loading') return;
    const id = new URLSearchParams(window.location.search).get('event');
    if (id) {
      setSelectedEventId(id);
      if (mode === 'staff') void loadRoster(id);
    }
  }, [mode, loadRoster]);

  const runStaffAction = useCallback(
    async (action: () => Promise<CampusEvent | EventRosterEntry[]>, message: string) => {
      setBusy(true);
      try {
        await action();
        toast.success(message);
        await loadStaff();
        if (selectedEventId) {
          void loadRoster(selectedEventId);
        }
      } catch (actionError) {
        const code = (actionError as { response?: { data?: { code?: string } } })
          ?.response?.data?.code;
        toast.error(code === 'EVENT_NOT_OWNER' ? copy.ownerOnly : copy.failed);
      } finally {
        setBusy(false);
      }
    },
    [copy.failed, copy.ownerOnly, loadRoster, loadStaff, selectedEventId],
  );

  const submitCreate = useCallback(async () => {
    if (!form.title.trim() || !form.organizer.trim() || !form.startsAt || !form.endsAt) {
      toast.error(copy.failed);
      return;
    }
    setBusy(true);
    try {
      await eventsApi.staffCreate({
        title: form.title.trim(),
        organizer: form.organizer.trim(),
        location: form.location.trim() || undefined,
        description: form.description.trim() || undefined,
        capacity: Number.parseInt(form.capacity, 10) || 1,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        registrationOpensAt: form.registrationOpensAt
          ? new Date(form.registrationOpensAt).toISOString()
          : null,
        registrationClosesAt: form.registrationClosesAt
          ? new Date(form.registrationClosesAt).toISOString()
          : null,
      });
      toast.success(copy.created);
      setCreateOpen(false);
      setForm({
        title: '',
        organizer: '',
        location: '',
        capacity: '50',
        startsAt: '',
        endsAt: '',
        registrationOpensAt: '',
        registrationClosesAt: '',
        description: '',
      });
      await loadStaff();
    } catch {
      toast.error(copy.failed);
    } finally {
      setBusy(false);
    }
  }, [copy.created, copy.failed, form, loadStaff]);

  const studentRegister = useCallback(
    async (eventId: string) => {
      setBusy(true);
      try {
        await eventsApi.register(eventId, pendingKeyFor(pendingKeys.current, `register:${eventId}`));
        pendingKeys.current.delete(`register:${eventId}`);
        toast.success(copy.registeredOk);
        await loadStudent();
      } catch (registerError) {
        const code = errorCode(registerError);
        if (code) pendingKeys.current.delete(`register:${eventId}`);
        toast.error(code === 'EVENT_FULL' ? copy.full : code === 'EVENT_STARTED' ? copy.started : copy.failed);
      } finally {
        setBusy(false);
      }
    },
    [copy.failed, copy.full, copy.registeredOk, copy.started, loadStudent],
  );

  const studentCancel = useCallback(
    async (registrationId: string) => {
      setBusy(true);
      try {
        await eventsApi.cancelRegistration(
          registrationId,
          pendingKeyFor(pendingKeys.current, `cancel:${registrationId}`),
        );
        pendingKeys.current.delete(`cancel:${registrationId}`);
        toast.success(copy.cancelledOk);
        await loadStudent();
      } catch (cancelError) {
        const code = errorCode(cancelError);
        if (code) pendingKeys.current.delete(`cancel:${registrationId}`);
        toast.error(code === 'EVENT_STARTED' ? copy.started : copy.failed);
      } finally {
        setBusy(false);
      }
    },
    [copy.cancelledOk, copy.failed, copy.started, loadStudent],
  );

  if (authLoading || (!hasAccess && !isForbidden)) {
    return <LoadingState label={copy.loading} />;
  }
  if (mode === 'loading') {
    return <LoadingState label={copy.loading} />;
  }

  const statusLabel = (status: string) => copy.statusLabels[status] ?? status;

  const eventActions = (event: CampusEvent) => {
    const buttons: React.ReactNode[] = [];
    if (event.status === 'DRAFT') {
      buttons.push(
        <Button
          key="publish"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void runStaffAction(() => eventsApi.staffPublish(event.id), copy.actionDone);
          }}
        >
          <Megaphone className="h-3.5 w-3.5" /> {copy.publish}
        </Button>,
      );
    }
    if (event.status === 'PUBLISHED') {
      buttons.push(
        <Button
          key="open"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void runStaffAction(
              () => eventsApi.staffOpenRegistration(event.id),
              copy.actionDone,
            );
          }}
        >
          <Play className="h-3.5 w-3.5" /> {copy.open}
        </Button>,
      );
    }
    if (event.status === 'REGISTRATION_OPEN') {
      buttons.push(
        <Button
          key="close"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void runStaffAction(
              () => eventsApi.staffCloseRegistration(event.id),
              copy.actionDone,
            );
          }}
        >
          <Flag className="h-3.5 w-3.5" /> {copy.close}
        </Button>,
      );
    }
    if (event.status === 'REGISTRATION_CLOSED') {
      buttons.push(
        <Button
          key="complete"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void runStaffAction(() => eventsApi.staffComplete(event.id), copy.actionDone);
          }}
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> {copy.complete}
        </Button>,
      );
    }
    if (event.status !== 'CANCELLED' && event.status !== 'COMPLETED') {
      buttons.push(
        <Button
          key="cancel"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            setCancelReason('');
            setCancelOpen(event);
          }}
        >
          <Ban className="h-3.5 w-3.5" /> {copy.cancelEvent}
        </Button>,
      );
    }
    return buttons;
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow={<SectionEyebrow>{copy.eyebrow}</SectionEyebrow>}
        title={copy.title}
        description={copy.description}
        actions={
          <div className="flex items-center gap-2">
            {mode === 'staff' ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> {copy.create}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}>
              <RefreshCw className="h-4 w-4" /> {copy.refresh}
            </Button>
          </div>
        }
      />

      {error ? <ErrorState title={error} description="" onRetry={() => void load()} /> : null}

      {mode === 'staff' ? (
        <div className="space-y-4">
          {staffEvents.length === 0 ? (
            <EmptyState title={copy.emptyStaff} description="" />
          ) : (
            staffEvents.map((event) => (
              <div
                key={event.id}
                className="rounded-xl border border-border/60 bg-card/60 p-4 shadow-sm"
              >
                <button
                  type="button"
                  className="flex w-full flex-wrap items-start justify-between gap-3 text-left"
                  onClick={() => selectEvent(event.id)}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">{event.title}</h3>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-medium',
                          statusToneClass(
                            event.status === 'CANCELLED'
                              ? 'danger'
                              : event.status === 'REGISTRATION_OPEN'
                                ? 'success'
                                : event.status === 'DRAFT'
                                  ? 'neutral'
                                  : 'info',
                          ),
                        )}
                      >
                        {statusLabel(event.status)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <Calendar className="mr-1 inline h-3.5 w-3.5" />
                      {formatDateTime(event.startsAt)} → {formatDateTime(event.endsAt)}
                      {event.location ? ` • ${event.location}` : ''}
                      {' • '}
                      {copy.organizer}: {event.organizer}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <Users className="mr-1 inline h-3.5 w-3.5" />
                      {copy.registered}: {event.registeredCount}/{event.capacity} • {copy.seats}:{' '}
                      {event.seatsRemaining}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">{eventActions(event)}</div>
                </button>

                {selectedEventId === event.id ? (
                  <div className="mt-4 border-t border-border/50 pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="flex items-center gap-2 text-sm font-semibold">
                        <ClipboardCheck className="h-4 w-4" /> {copy.roster}
                      </h4>
                      <p className="text-xs text-muted-foreground">{copy.attendanceHint}</p>
                    </div>
                    {rosterLoading ? (
                      <LoadingState label={copy.loading} />
                    ) : roster.length === 0 ? (
                      <EmptyState title={copy.rosterEmpty} description="" />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                              <th className="py-2 pr-3">#</th>
                              <th className="py-2 pr-3">{copy.registered}</th>
                              <th className="py-2 pr-3">Email</th>
                              <th className="py-2 pr-3">{copy.status}</th>
                              <th className="py-2 pr-3">{copy.attended}</th>
                              <th className="py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {roster.map((entry, index) => (
                              <tr
                                key={entry.registrationId}
                                className="border-b border-border/30 last:border-0"
                              >
                                <td className="py-2 pr-3 text-muted-foreground">{index + 1}</td>
                                <td className="py-2 pr-3 font-medium">{entry.studentName}</td>
                                <td className="py-2 pr-3 text-muted-foreground">{entry.email}</td>
                                <td className="py-2 pr-3">{statusLabel(entry.status)}</td>
                                <td className="py-2 pr-3">
                                  {entry.attendanceStatus === 'ATTENDED'
                                    ? copy.attended
                                    : copy.absent}
                                </td>
                                <td className="py-2 text-right">
                                  {entry.status === 'REGISTERED' &&
                                  (event.status === 'REGISTRATION_CLOSED' ||
                                    event.status === 'COMPLETED') ? (
                                    <Button
                                      size="sm"
                                      variant={
                                        entry.attendanceStatus === 'ATTENDED' ? 'ghost' : 'outline'
                                      }
                                      disabled={busy}
                                      onClick={() =>
                                        void runStaffAction(
                                          () =>
                                            eventsApi.staffMarkAttendance(event.id, [
                                              {
                                                registrationId: entry.registrationId,
                                                status:
                                                  entry.attendanceStatus === 'ATTENDED'
                                                    ? 'ABSENT'
                                                    : 'ATTENDED',
                                              },
                                            ]),
                                          copy.markedOk,
                                        )
                                      }
                                    >
                                      <TicketCheck className="h-3.5 w-3.5" />
                                      {entry.attendanceStatus === 'ATTENDED'
                                        ? copy.markAbsent
                                        : copy.markPresent}
                                    </Button>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">{copy.studentHint}</p>
          {studentEvents.length === 0 ? (
            <EmptyState title={copy.emptyStudent} description="" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {studentEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-col justify-between rounded-xl border border-border/60 bg-card/60 p-4 shadow-sm"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">{event.title}</h3>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-medium',
                          statusToneClass(
                            event.status === 'CANCELLED'
                              ? 'danger'
                              : event.status === 'REGISTRATION_OPEN'
                                ? 'success'
                                : 'info',
                          ),
                        )}
                      >
                        {statusLabel(event.status)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <Calendar className="mr-1 inline h-3.5 w-3.5" />
                      {formatDateTime(event.startsAt)} → {formatDateTime(event.endsAt)}
                      {event.location ? ` • ${event.location}` : ''}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {copy.seats}: {event.seatsRemaining}/{event.capacity}
                    </p>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {event.status === 'REGISTRATION_OPEN' &&
                    event.myRegistrationStatus !== 'REGISTERED' ? (
                      <Button
                        size="sm"
                        disabled={busy || event.seatsRemaining <= 0}
                        onClick={() => void studentRegister(event.id)}
                      >
                        {copy.register}
                      </Button>
                    ) : null}
                    {event.myRegistrationStatus === 'REGISTERED' &&
                    event.status !== 'CANCELLED' &&
                    event.status !== 'COMPLETED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          event.myRegistrationId && void studentCancel(event.myRegistrationId)
                        }
                      >
                        <XCircle className="h-3.5 w-3.5" /> {copy.cancelRegistration}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {copy.myRegistrations}
            </h3>
            {myRegistrations.length === 0 ? (
              <EmptyState title={copy.emptyStudent} description="" />
            ) : (
              <div className="space-y-2">
                {myRegistrations.map((entry) => (
                  <div
                    key={entry.registrationId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">{entry.event.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(entry.registeredAt)} • {statusLabel(entry.event.status)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">
                        {statusLabel(entry.registrationStatus)}
                      </span>
                      {entry.attendanceStatus === 'ATTENDED' ? (
                        <span className="font-medium text-emerald-600">{copy.attended}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title={copy.create}>
        <div className="space-y-3">
          <Input
            placeholder={copy.titleField}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <Input
            placeholder={copy.organizer}
            value={form.organizer}
            onChange={(e) => setForm((f) => ({ ...f, organizer: e.target.value }))}
          />
          <Input
            placeholder={copy.where}
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              {copy.when} (start)
              <Input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              {copy.when} (end)
              <Input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              {copy.window} (open)
              <Input
                type="datetime-local"
                value={form.registrationOpensAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, registrationOpensAt: e.target.value }))
                }
              />
            </label>
            <label className="text-xs text-muted-foreground">
              {copy.window} (close)
              <Input
                type="datetime-local"
                value={form.registrationClosesAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, registrationClosesAt: e.target.value }))
                }
              />
            </label>
          </div>
          <Input
            placeholder={copy.capacity}
            type="number"
            min={1}
            value={form.capacity}
            onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
          />
          <Input
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {locale === 'vi' ? 'Đóng' : 'Close'}
            </Button>
            <Button onClick={() => void submitCreate()} disabled={busy}>
              {copy.submitCreate}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={cancelOpen !== null}
        onClose={() => setCancelOpen(null)}
        title={copy.cancelEvent}
      >
        <div className="space-y-3">
          <Input
            placeholder={copy.cancelReason}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(null)}>
              {locale === 'vi' ? 'Đóng' : 'Close'}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const target = cancelOpen;
                setCancelOpen(null);
                if (target) {
                  void runStaffAction(
                    () => eventsApi.staffCancel(target.id, cancelReason || undefined),
                    copy.cancelledEventOk,
                  );
                }
              }}
            >
              {copy.cancelEvent}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
