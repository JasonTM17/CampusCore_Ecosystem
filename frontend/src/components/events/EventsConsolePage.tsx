'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { eventsMessages } from '@/i18n/events-messages';
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

  const [mode, setMode] = useState<'loading' | 'error' | 'staff' | 'student'>('loading');
  const isStudent = user?.roles?.includes('STUDENT') ?? false;
  const [staffGranted, setStaffGranted] = useState(false);
  const accountId = user?.id;
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const loadSequence = useRef(0);
  const rosterSequence = useRef(0);
  const selectedRef = useRef<string | null>(null);
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

  const copy = eventsMessages[locale];

  const loadStaff = useCallback(async () => {
    const events = await eventsApi.staffList();
    if (accountRef.current === accountId) setStaffEvents(events);
  }, [accountId]);

  const loadStudent = useCallback(async () => {
    const [events, mine] = await Promise.all([
      eventsApi.listPublished(),
      isStudent ? eventsApi.myRegistrations() : Promise.resolve([]),
    ]);
    if (accountRef.current !== accountId) return;
    setStudentEvents(events);
    setMyRegistrations(mine);
  }, [accountId, isStudent]);

  const load = useCallback(async () => {
    const request = ++loadSequence.current;
    const current = () => request === loadSequence.current && accountRef.current === accountId;
    setError('');
    try {
      const events = await eventsApi.staffList();
      if (!current()) return;
      setStaffEvents(events);
      setStaffGranted(true);
      setMode((previous) => previous === 'student' ? previous : 'staff');
      if (isStudent) {
        try { await loadStudent(); }
        catch { if (current()) setError(copy.failed); }
      }
    } catch (staffError) {
      if (!current()) return;
      if (isEventsStaffDenied(staffError)) {
        setStaffGranted(false);
        try {
          await loadStudent();
          if (current()) setMode('student');
        } catch {
          if (current()) { setError(copy.failed); setMode('error'); }
        }
        return;
      }
      setError(copy.failed);
      setMode('error');
    }
  }, [accountId, copy.failed, isStudent, loadStudent]);

  const invalidateReads = useCallback(() => {
    ++loadSequence.current;
    ++rosterSequence.current;
  }, []);

  // Locale-sensitive loading may restart; unresolved operation identity belongs
  // to the account and must survive those restarts.
  useEffect(() => {
    pendingKeys.current.clear();
  }, [accountId]);

  useEffect(() => {
    invalidateReads();
    selectedRef.current = null;
    setSelectedEventId(null);
    setRoster([]);
    setStaffEvents([]);
    setStudentEvents([]);
    setMyRegistrations([]);
    setStaffGranted(false);
    setBusy(false);
    setCreateOpen(false);
    setCancelOpen(null);
    setMode('loading');
    if (!authLoading && hasAccess) void load();
    return invalidateReads;
  }, [accountId, authLoading, hasAccess, invalidateReads, load]);

  const loadRoster = useCallback(async (eventId: string) => {
    const request = ++rosterSequence.current;
    const current = () => request === rosterSequence.current &&
      accountRef.current === accountId && selectedRef.current === eventId;
    setRoster([]);
    setRosterLoading(true);
    try {
      const entries = await eventsApi.staffRoster(eventId);
      if (current()) setRoster(entries);
    } catch {
      if (current()) setRoster([]);
    } finally {
      if (current()) setRosterLoading(false);
    }
  }, [accountId]);

  const selectEvent = useCallback((eventId: string) => {
    const next = selectedRef.current === eventId ? null : eventId;
    selectedRef.current = next;
    ++rosterSequence.current;
    setSelectedEventId(next);
    setRoster([]);
    if (next) void loadRoster(next);
  }, [loadRoster]);

  const switchView = async (view: 'staff' | 'student') => {
    ++rosterSequence.current;
    selectedRef.current = null;
    setSelectedEventId(null);
    setRoster([]);
    setError('');
    setMode(view);
    if (view === 'student') {
      try { await loadStudent(); }
      catch { if (accountRef.current === accountId) setError(copy.failed); }
    }
  };

  // Notification deep links carry ?event=<id> — expand that card once the
  // mode resolves (roster only loads for the staff surface).
  useEffect(() => {
    if (mode !== 'staff') return;
    const id = new URLSearchParams(window.location.search).get('event');
    if (id) {
      selectedRef.current = id;
      setSelectedEventId(id);
      if (mode === 'staff') void loadRoster(id);
    }
  }, [mode, loadRoster]);

  const runStaffAction = useCallback(
    async (action: () => Promise<CampusEvent | EventRosterEntry[]>, message: string) => {
      setBusy(true);
      try {
        await action();
        if (accountRef.current !== accountId) return;
        toast.success(message);
        await loadStaff();
        if (accountRef.current !== accountId) return;
        if (selectedEventId && selectedRef.current === selectedEventId) {
          void loadRoster(selectedEventId);
        }
      } catch (actionError) {
        if (accountRef.current !== accountId) return;
        const code = (actionError as { response?: { data?: { code?: string } } })
          ?.response?.data?.code;
        toast.error(code === 'EVENT_NOT_OWNER' ? copy.ownerOnly : copy.failed);
      } finally {
        if (accountRef.current === accountId) setBusy(false);
      }
    },
    [accountId, copy.failed, copy.ownerOnly, loadRoster, loadStaff, selectedEventId],
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
      if (accountRef.current !== accountId) return;
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
      if (accountRef.current === accountId) toast.error(copy.failed);
    } finally {
      if (accountRef.current === accountId) setBusy(false);
    }
  }, [accountId, copy.created, copy.failed, form, loadStaff]);

  const studentRegister = useCallback(
    async (eventId: string) => {
      setBusy(true);
      try {
        await eventsApi.register(eventId, pendingKeyFor(pendingKeys.current, `register:${eventId}`));
        if (accountRef.current !== accountId) return;
        pendingKeys.current.delete(`register:${eventId}`);
        toast.success(copy.registeredOk);
        await loadStudent();
      } catch (registerError) {
        if (accountRef.current !== accountId) return;
        const code = errorCode(registerError);
        if (code) pendingKeys.current.delete(`register:${eventId}`);
        toast.error(code === 'EVENT_FULL' ? copy.full : code === 'EVENT_STARTED' ? copy.started : copy.failed);
      } finally {
        if (accountRef.current === accountId) setBusy(false);
      }
    },
    [accountId, copy.failed, copy.full, copy.registeredOk, copy.started, loadStudent],
  );

  const studentCancel = useCallback(
    async (registrationId: string) => {
      setBusy(true);
      try {
        await eventsApi.cancelRegistration(
          registrationId,
          pendingKeyFor(pendingKeys.current, `cancel:${registrationId}`),
        );
        if (accountRef.current !== accountId) return;
        pendingKeys.current.delete(`cancel:${registrationId}`);
        toast.success(copy.cancelledOk);
        await loadStudent();
      } catch (cancelError) {
        if (accountRef.current !== accountId) return;
        const code = errorCode(cancelError);
        if (code) pendingKeys.current.delete(`cancel:${registrationId}`);
        toast.error(code === 'EVENT_STARTED' ? copy.started : copy.failed);
      } finally {
        if (accountRef.current === accountId) setBusy(false);
      }
    },
    [accountId, copy.cancelledOk, copy.failed, copy.started, loadStudent],
  );

  if (authLoading || (!hasAccess && !isForbidden)) {
    return <LoadingState label={copy.loading} />;
  }
  if (mode === 'loading' && !error) {
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
            {staffGranted && isStudent ? (
              <>
                <Button size="sm" variant={mode === 'student' ? 'default' : 'outline'} onClick={() => void switchView('student')}>{copy.participation}</Button>
                <Button size="sm" variant={mode === 'staff' ? 'default' : 'outline'} onClick={() => void switchView('staff')}>{copy.staffTools}</Button>
              </>
            ) : null}
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
                <div className="flex w-full flex-wrap items-start justify-between gap-3 text-left">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold"><button type="button" className="text-left hover:underline" aria-expanded={selectedEventId === event.id} onClick={() => selectEvent(event.id)}>{event.title}</button></h3>
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
                </div>

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
                                                version: entry.version,
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
      ) : mode === 'student' ? (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">{isStudent ? copy.studentHint : copy.browseHint}</p>
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
                    {isStudent && event.status === 'REGISTRATION_OPEN' &&
                    event.myRegistrationStatus !== 'REGISTERED' ? (
                      <Button
                        size="sm"
                        disabled={busy || event.seatsRemaining <= 0}
                        onClick={() => void studentRegister(event.id)}
                      >
                        {copy.register}
                      </Button>
                    ) : null}
                    {isStudent && event.myRegistrationStatus === 'REGISTERED' &&
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

          {isStudent ? <div>
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
          </div> : null}
        </div>
      ) : null}

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
              {copy.when} {copy.startLabel}
              <Input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              {copy.when} {copy.endLabel}
              <Input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              {copy.window} {copy.opensLabel}
              <Input
                type="datetime-local"
                value={form.registrationOpensAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, registrationOpensAt: e.target.value }))
                }
              />
            </label>
            <label className="text-xs text-muted-foreground">
              {copy.window} {copy.closesLabel}
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
            placeholder={copy.descriptionField}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {copy.dismiss}
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
              {copy.dismiss}
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
