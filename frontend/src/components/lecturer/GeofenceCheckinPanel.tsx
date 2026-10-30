'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  MapPin,
  Presentation,
  Share2,
  Timer,
  TriangleAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { geofencedAttendanceApi } from '@/lib/api';
import {
  buildCheckinLandingPath,
  buildCheckinShareUrl,
  campusTodayIso,
  CHECKIN_DEFAULT_LATE_AFTER_MINUTES,
  CHECKIN_WINDOW_PRESETS_MINUTES,
  planSessionWindow,
  sessionSecondsLeft,
  shouldPollSession,
  splitCheckinReasons,
  type SessionWindowPlan,
} from '@/lib/attendance-checkin';
import { campusCodeMessage } from '@/lib/campus-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { Textarea } from '@/components/ui/textarea';
import { metricToneClass, statusToneClass, type StatusTone } from '@/components/ui/status';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import {
  WorkspaceMetricCard,
  WorkspacePanel,
} from '@/components/dashboard/WorkspaceSurface';
import { ProjectorCodeOverlay } from '@/components/lecturer/ProjectorCodeOverlay';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { components } from '@/types/generated-api';

type SessionResponse = components['schemas']['AttendanceSessionResponse'];
type CheckinView = components['schemas']['AttendanceCheckinView'];
type ActiveGeofence = components['schemas']['AttendanceActiveGeofenceResponse'];

export interface RosterStudent {
  studentId: string;
  studentCode: string;
  studentName: string;
}

interface SessionContext {
  sectionId: string;
  sectionLabel: string;
  date: string;
  roster: RosterStudent[];
}

type SessionSelection = Pick<SessionContext, 'sectionId' | 'sectionLabel' | 'date'>;

function captureSessionContext(
  sectionId: string,
  sectionLabel: string,
  date: string,
  roster: RosterStudent[],
): SessionContext {
  return {
    sectionId,
    sectionLabel,
    date,
    roster: roster.map((student) => ({ ...student })),
  };
}

function getSessionContextState(
  context: SessionContext | null,
  selected: SessionSelection,
) {
  if (!context) return null;
  return {
    sessionLabel: context.sectionLabel,
    sessionDate: context.date,
    selectedLabel: selected.sectionLabel,
    selectedDate: selected.date,
    matches: context.sectionId === selected.sectionId && context.date === selected.date,
  };
}

function resolveStudentLabel(
  rosterById: Map<string, RosterStudent>,
  studentId: string | undefined,
  unknownStudent: string,
) {
  const known = studentId ? rosterById.get(studentId) : undefined;
  if (known) return { name: known.studentName, code: known.studentCode };
  const shortId = studentId ? studentId.slice(0, 8) : '—';
  return { name: unknownStudent.replace('{id}', shortId), code: '' };
}

function canApplySessionRead(
  requestGeneration: number,
  currentGeneration: number,
  requestedSessionId: string,
  currentSession: Pick<SessionResponse, 'id' | 'status'> | null,
  nextSession: Pick<SessionResponse, 'id' | 'status'>,
) {
  if (requestGeneration !== currentGeneration || nextSession.id !== requestedSessionId) {
    return false;
  }
  return !(
    currentSession?.id === requestedSessionId
    && currentSession?.status !== 'OPEN'
    && nextSession.status === 'OPEN'
  );
}

function isSessionOpen(value: Pick<SessionResponse, 'status'> | null) {
  return value?.status === 'OPEN';
}

export interface GeofenceCheckinPanelProps {
  sectionId: string;
  sectionLabel: string;
  /** Campus-calendar date (YYYY-MM-DD) selected on the attendance sheet. */
  date: string;
  roster: RosterStudent[];
  /** Disabled while the roster or section pickers are still resolving. */
  disabled?: boolean;
}

const POLL_INTERVAL_MS = 10_000;

const DECISION_TONES: Record<string, StatusTone> = {
  ACCEPTED: 'success',
  PENDING_REVIEW: 'warning',
  REJECTED: 'danger',
};

const REASON_TONES: Record<string, StatusTone> = {
  OUTSIDE_AREA: 'danger',
  MOCK_PROVIDER: 'danger',
  IMPOSSIBLE_SPEED: 'danger',
  IDENTICAL_COORDINATES: 'danger',
  ZERO_ACCURACY: 'danger',
  BAD_CODE: 'danger',
  TOO_MANY_ATTEMPTS: 'danger',
  BORDERLINE: 'warning',
  LOW_ACCURACY: 'warning',
  SHARED_DEVICE: 'warning',
  CONSENT_REQUIRED: 'warning',
};

function fieldErrorText(
  kind: NonNullable<SessionWindowPlan['errors'][keyof SessionWindowPlan['errors']]>,
  copy: ReturnType<typeof useI18n>['messages']['attendanceGeofence']['lecturer'],
) {
  switch (kind) {
    case 'past':
      return copy.datePast;
    case 'invalid':
      return copy.dateInvalid;
    case 'required':
      return copy.startTimeRequired;
    default:
      return copy.dateInvalid;
  }
}

/**
 * Lecturer-side geofenced check-in: opens a session for the selected
 * section/date, shows live counters + flagged reviews (polled while the tab
 * is visible), and projects the rotating code. The share link carries the
 * session id only — the rotating code never leaves the projector overlay.
 */
export function GeofenceCheckinPanel({
  sectionId,
  sectionLabel,
  date,
  roster,
  disabled = false,
}: GeofenceCheckinPanelProps) {
  const { formatDateTime, formatNumber, href, messages } = useI18n();
  const copy = messages.attendanceGeofence.lecturer;
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const [geofences, setGeofences] = useState<ActiveGeofence[]>([]);
  const [geofencesLoading, setGeofencesLoading] = useState(true);
  const [geofencesFailed, setGeofencesFailed] = useState(false);

  const [geofenceId, setGeofenceId] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<number>(15);
  const [lateAfter, setLateAfter] = useState(String(CHECKIN_DEFAULT_LATE_AFTER_MINUTES));
  const [requireCode, setRequireCode] = useState(true);
  const [startTime, setStartTime] = useState('');

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [checkins, setCheckins] = useState<CheckinView[]>([]);
  const [checkinsFailed, setCheckinsFailed] = useState(false);
  const [pollStale, setPollStale] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<SessionWindowPlan['errors']>({});
  const [geofenceError, setGeofenceError] = useState(false);
  const [closing, setClosing] = useState(false);
  const [projectorOpen, setProjectorOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);

  const [reviewTarget, setReviewTarget] = useState<{
    checkin: CheckinView;
    decision: 'APPROVE' | 'REJECT';
  } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');

  const sessionRef = useRef<SessionResponse | null>(null);
  sessionRef.current = session;
  const sessionGenerationRef = useRef(0);
  const geofencesLoadStartedRef = useRef(false);
  const shareInputRef = useRef<HTMLInputElement>(null);

  const loadGeofences = useCallback(async () => {
    setGeofencesLoading(true);
    setGeofencesFailed(false);
    try {
      const list = await geofencedAttendanceApi.listActiveGeofences();
      setGeofences(list ?? []);
    } catch {
      setGeofences([]);
      setGeofencesFailed(true);
    } finally {
      setGeofencesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sectionId || geofencesLoadStartedRef.current) return;
    geofencesLoadStartedRef.current = true;
    void loadGeofences();
  }, [loadGeofences, sectionId]);

  const refreshSession = useCallback(async (idOverride?: string) => {
    const id = idOverride ?? sessionRef.current?.id;
    if (!id) return;
    const requestGeneration = ++sessionGenerationRef.current;
    try {
      const [nextSession, nextCheckins] = await Promise.all([
        geofencedAttendanceApi.getSession(id),
        geofencedAttendanceApi.listSessionCheckins(id).catch(() => null),
      ]);
      if (!canApplySessionRead(
        requestGeneration,
        sessionGenerationRef.current,
        id,
        sessionRef.current,
        nextSession,
      )) return;
      sessionRef.current = nextSession;
      setSession(nextSession);
      if (nextCheckins) {
        setCheckins(nextCheckins);
        setCheckinsFailed(false);
      } else {
        setCheckinsFailed(true);
      }
      setPollStale(false);
    } catch {
      if (requestGeneration === sessionGenerationRef.current) setPollStale(true);
    }
  }, []);

  // Poll every 10s while the tab is visible; hidden tabs skip the fetch but
  // a visibilitychange back to the foreground refreshes immediately.
  useEffect(() => {
    if (!session?.id || session.status !== 'OPEN') return undefined;
    const tick = () => {
      setNowMs(Date.now());
      if (shouldPollSession(document.visibilityState, sessionRef.current?.status)) {
        void refreshSession();
      }
    };
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session?.id, session?.status, refreshSession]);

  // The share URL carries the session id only. Computed post-mount so the
  // SSR pass and the first client render agree (window is absent on the
  // server render of this client component).
  useEffect(() => {
    if (!session?.id) {
      setShareUrl('');
      return;
    }
    const path = buildCheckinLandingPath(session.id);
    setShareUrl(path ? (buildCheckinShareUrl(window.location.origin, href(path)) ?? '') : '');
  }, [session?.id, href]);

  const sessionRoster = sessionContext?.roster ?? roster;
  const rosterById = useMemo(() => {
    const map = new Map<string, RosterStudent>();
    for (const row of sessionRoster) map.set(row.studentId, row);
    return map;
  }, [sessionRoster]);

  const sessionSelection = getSessionContextState(sessionContext, {
    sectionId,
    sectionLabel,
    date,
  });
  const selectionChanged = Boolean(session && sessionSelection && !sessionSelection.matches);
  const sessionContextLabel = copy.forSelection
    .replace('{section}', sessionSelection?.sessionLabel ?? sectionLabel)
    .replace('{date}', sessionSelection?.sessionDate ?? date);
  const selectedContextLabel = sessionSelection
    ? copy.forSelection
      .replace('{section}', sessionSelection.selectedLabel)
      .replace('{date}', sessionSelection.selectedDate)
    : '';

  const geofenceName = useMemo(() => {
    if (!session?.geofenceId) return '';
    const match = geofences.find((g) => g.id === session.geofenceId);
    return match?.name ?? session.geofenceId;
  }, [geofences, session?.geofenceId]);

  const needsStartTime = date > campusTodayIso();

  const handleOpen = useCallback(async () => {
    setOpenError('');
    setGeofenceError(false);
    if (!geofenceId) {
      setGeofenceError(true);
      return;
    }
    const plan = planSessionWindow(
      {
        date,
        durationMinutes,
        lateAfterMinutes: Number(lateAfter),
        startTime: startTime || undefined,
      },
      new Date(),
    );
    setFieldErrors(plan.errors);
    if (Object.keys(plan.errors).length > 0) return;

    const contextAtOpen = captureSessionContext(sectionId, sectionLabel, date, roster);
    setOpening(true);
    try {
      const created = await geofencedAttendanceApi.openSession({
        sectionId,
        date,
        geofenceId,
        requireCode,
        lateAfterMinutes: Number(lateAfter),
        closesAt: plan.closesAtIso,
        ...(plan.opensAtIso ? { opensAt: plan.opensAtIso } : {}),
      });
      sessionGenerationRef.current += 1;
      sessionRef.current = created;
      setSessionContext(contextAtOpen);
      setSession(created);
      setCheckins([]);
      setCheckinsFailed(false);
      setPollStale(false);
      void refreshSession(created.id);
    } catch (error) {
      setOpenError(campusCodeMessage(error, copy.errors));
    } finally {
      setOpening(false);
    }
  }, [
    copy.errors,
    date,
    durationMinutes,
    geofenceId,
    lateAfter,
    refreshSession,
    requireCode,
    roster,
    sectionLabel,
    sectionId,
    startTime,
  ]);

  const handleClose = useCallback(async () => {
    if (!session?.id) return;
    const accepted = await confirm({
      title: copy.closeSessionTitle,
      message: `${copy.closeSessionMessage} ${copy.sessionTitle}: ${sessionContextLabel}`,
      confirmText: copy.closeSessionAction,
      cancelText: messages.common.actions.cancel,
      variant: 'destructive',
    });
    if (!accepted) return;
    setClosing(true);
    try {
      const closed = await geofencedAttendanceApi.closeSession(session.id);
      sessionGenerationRef.current += 1;
      sessionRef.current = closed;
      setSession(closed);
      setProjectorOpen(false);
      void refreshSession(session.id);
    } catch (error) {
      toast.error(campusCodeMessage(error, copy.errors));
    } finally {
      setClosing(false);
    }
  }, [
    confirm,
    copy,
    messages.common.actions.cancel,
    refreshSession,
    session?.id,
    sessionContextLabel,
  ]);

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(copy.linkCopied);
    } catch {
      // Clipboard API denied (insecure context / permissions): select the
      // read-only field so the lecturer can Ctrl+C it themselves.
      shareInputRef.current?.select();
    }
  }, [copy.linkCopied, shareUrl]);

  const handleShare = useCallback(async () => {
    if (!shareUrl || !navigator.share) return;
    try {
      await navigator.share({ url: shareUrl, title: copy.shareLabel });
    } catch {
      // User dismissed the sheet or the platform failed — nothing to fix.
    }
  }, [copy.shareLabel, shareUrl]);

  const openReview = useCallback((checkin: CheckinView, decision: 'APPROVE' | 'REJECT') => {
    setReviewTarget({ checkin, decision });
    setReviewNote(checkin.reviewNote ?? '');
    setReviewError('');
  }, []);

  const submitReview = useCallback(async () => {
    if (!reviewTarget?.checkin.id) return;
    const note = reviewNote.trim();
    if (!note) {
      setReviewError(copy.reviewNoteRequired);
      return;
    }
    setReviewBusy(true);
    setReviewError('');
    try {
      const updated = await geofencedAttendanceApi.reviewCheckin(reviewTarget.checkin.id, {
        decision: reviewTarget.decision,
        note,
      });
      sessionGenerationRef.current += 1;
      setCheckins((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setReviewTarget(null);
    } catch (error) {
      setReviewError(campusCodeMessage(error, copy.errors));
    } finally {
      setReviewBusy(false);
    }
  }, [copy, reviewNote, reviewTarget]);

  const studentLabel = useCallback(
    (studentId: string | undefined) =>
      resolveStudentLabel(rosterById, studentId, copy.unknownStudent),
    [copy.unknownStudent, rosterById],
  );

  const sortedCheckins = useMemo(() => {
    const weight = (row: CheckinView) => (row.decision === 'PENDING_REVIEW' ? 0 : 1);
    return [...checkins].sort((a, b) => {
      const byFlag = weight(a) - weight(b);
      if (byFlag !== 0) return byFlag;
      return (b.capturedAt ?? '').localeCompare(a.capturedAt ?? '');
    });
  }, [checkins]);

  const decisionLabel = (decision: string | undefined) =>
    (decision && copy.decisions[decision as keyof typeof copy.decisions]) || decision || '—';

  const reasonLabel = (token: string) =>
    copy.reasons[token as keyof typeof copy.reasons] || token;

  const isOpen = isSessionOpen(session);
  const secondsLeft = sessionSecondsLeft(session?.closesAt, nowMs);
  const canShare = typeof navigator !== 'undefined' && Boolean(navigator.share);

  useEffect(() => {
    if (selectionChanged) setProjectorOpen(false);
  }, [selectionChanged]);

  if (!sectionId && !session) return null;

  return (
    <WorkspacePanel
      title={copy.panelTitle}
      description={copy.openHint}
      className="print:hidden"
      contentClassName="p-4 sm:p-5"
    >
      <div className="space-y-5" data-testid="checkin-panel">
        {session === null ? (
          <form
            className="space-y-4"
            data-testid="checkin-open-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleOpen();
            }}
            noValidate
          >
            <p className="text-sm font-medium text-foreground">
              {copy.forSelection
                .replace('{section}', sectionLabel)
                .replace('{date}', date)}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label={copy.geofenceLabel}
                value={geofenceId}
                onChange={(event) => {
                  setGeofenceId(event.target.value);
                  setGeofenceError(false);
                }}
                disabled={disabled || geofencesLoading || opening}
                error={geofenceError ? copy.geofenceRequired : undefined}
                aria-label={copy.geofenceLabel}
              >
                <option value="">{copy.geofencePlaceholder}</option>
                {geofences.map((geofence) => (
                  <option key={geofence.id} value={geofence.id}>
                    {geofence.name} ({geofence.campusCode})
                  </option>
                ))}
              </Select>

              <Select
                label={copy.windowLabel}
                value={String(durationMinutes)}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
                disabled={opening}
                aria-label={copy.windowLabel}
                options={CHECKIN_WINDOW_PRESETS_MINUTES.map((minutes) => ({
                  value: String(minutes),
                  label: copy.windowOption.replace('{minutes}', String(minutes)),
                }))}
              />

              <div>
                <label
                  htmlFor="checkin-late-after"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  {copy.lateAfterLabel}
                </label>
                <Input
                  id="checkin-late-after"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={60}
                  step={1}
                  value={lateAfter}
                  onChange={(event) => setLateAfter(event.target.value)}
                  disabled={opening}
                  error={fieldErrors.lateAfter ? copy.lateAfterInvalid : undefined}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {needsStartTime ? (
                <div>
                  <label
                    htmlFor="checkin-start-time"
                    className="mb-1 block text-sm font-medium text-foreground"
                  >
                    {copy.startTimeLabel}
                  </label>
                  <Input
                    id="checkin-start-time"
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    disabled={opening}
                    error={
                      fieldErrors.startTime
                        ? fieldErrors.startTime === 'required'
                          ? copy.startTimeRequired
                          : copy.startTimeInvalid
                        : undefined
                    }
                  />
                </div>
              ) : null}
              <div className="flex items-end pb-1">
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={requireCode}
                    onChange={(event) => setRequireCode(event.target.checked)}
                    disabled={opening}
                    className="h-4 w-4 rounded border-input text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  {copy.requireCodeLabel}
                </label>
              </div>
            </div>

            {fieldErrors.date || fieldErrors.duration ? (
              <p role="alert" className="text-sm text-destructive">
                {fieldErrors.date ? fieldErrorText(fieldErrors.date, copy) : copy.durationInvalid}
              </p>
            ) : null}
            {geofencesFailed ? (
              <p role="alert" className="text-sm text-destructive">
                {copy.geofenceLoadError}{' '}
                <button
                  type="button"
                  className="font-semibold text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => void loadGeofences()}
                >
                  {messages.common.actions.retry}
                </button>
              </p>
            ) : !geofencesLoading && geofences.length === 0 ? (
              <p className="text-sm text-muted-foreground">{copy.geofenceEmpty}</p>
            ) : null}
            {openError ? (
              <p role="alert" className="text-sm text-destructive">
                {openError}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={
                  disabled
                  || opening
                  || geofencesLoading
                  || geofences.length === 0
                  || !sectionId
                }
                className="gap-2"
              >
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {opening ? copy.submittingOpen : copy.submitOpen}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-5" data-testid="checkin-session">
            <div
              role="status"
              data-testid="checkin-session-context"
              data-selection-changed={selectionChanged ? 'true' : 'false'}
              className="space-y-1 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm"
            >
              <p>
                <span className="font-semibold">{copy.sessionTitle}: </span>
                {sessionContextLabel}
              </p>
              {selectionChanged ? (
                <p data-testid="checkin-selection-pending">
                  <span className="font-semibold">{copy.openTitle}: </span>
                  {selectedContextLabel}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={isOpen ? 'info' : 'neutral'}>
                {isOpen ? copy.sessionOpen : copy.sessionClosed}
              </StatusPill>
              {isOpen && secondsLeft !== null ? (
                <StatusPill tone="warning" icon={<Timer className="h-3 w-3" aria-hidden="true" />}>
                  {copy.closesInMinutes.replace('{minutes}', String(Math.ceil(secondsLeft / 60)))}
                </StatusPill>
              ) : null}
              {session.requireCode === false ? (
                <StatusPill tone="neutral">{copy.codeOffChip}</StatusPill>
              ) : (
                <StatusPill tone="neutral">{copy.codeRequiredChip}</StatusPill>
              )}
              {geofenceName ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {geofenceName}
                </span>
              ) : null}
              {pollStale ? (
                <span
                  role="status"
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                    statusToneClass('warning'),
                  )}
                >
                  <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                  {copy.pollStale}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <WorkspaceMetricCard
                compact
                label={copy.counters.accepted}
                value={formatNumber(session.accepted ?? 0)}
                icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                toneClassName={metricToneClass('success')}
              />
              <WorkspaceMetricCard
                compact
                label={copy.counters.pending}
                value={formatNumber(session.pending ?? 0)}
                icon={<TriangleAlert className="h-5 w-5" aria-hidden="true" />}
                toneClassName={metricToneClass('warning')}
              />
              <WorkspaceMetricCard
                compact
                label={copy.counters.rejected}
                value={formatNumber(session.rejected ?? 0)}
                icon={<XCircle className="h-5 w-5" aria-hidden="true" />}
                toneClassName={metricToneClass('danger')}
              />
              <WorkspaceMetricCard
                compact
                label={copy.counters.enrolled}
                value={formatNumber(session.enrolled ?? 0)}
                icon={<Users className="h-5 w-5" aria-hidden="true" />}
                toneClassName={metricToneClass('neutral')}
              />
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label
                  htmlFor="checkin-share-url"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  {copy.shareLabel}
                </label>
                <Input
                  ref={shareInputRef}
                  id="checkin-share-url"
                  value={shareUrl}
                  readOnly
                  onFocus={(event) => event.target.select()}
                  className="w-full font-mono text-xs"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => void handleCopyLink()}
                  disabled={!shareUrl}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  {copy.copyLink}
                </Button>
                {canShare ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => void handleShare()}
                    disabled={!shareUrl}
                  >
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    {copy.shareLink}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => setProjectorOpen(true)}
                  disabled={!isOpen || selectionChanged}
                >
                  <Presentation className="h-4 w-4" aria-hidden="true" />
                  {copy.projector}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleClose()}
                  disabled={!isOpen || closing}
                >
                  {closing ? messages.common.states.loading : copy.closeSession}
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{copy.reviewTitle}</h3>
              {checkinsFailed ? (
                <p role="alert" className="text-sm text-destructive">
                  {copy.reviewLoadError}
                </p>
              ) : null}
              {sortedCheckins.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.reviewEmpty}</p>
              ) : (
                <div
                  className="overflow-x-auto rounded-lg border border-border/70"
                  data-testid="checkin-review-table"
                >
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2.5 font-semibold">{copy.colStudent}</th>
                        <th className="px-3 py-2.5 font-semibold">{copy.colStatus}</th>
                        <th className="px-3 py-2.5 font-semibold">{copy.colFlags}</th>
                        <th className="px-3 py-2.5 font-semibold">{copy.colDistance}</th>
                        <th className="px-3 py-2.5 font-semibold">{copy.colAccuracy}</th>
                        <th className="px-3 py-2.5 font-semibold">{copy.colCaptured}</th>
                        <th className="px-3 py-2.5 font-semibold">{copy.colReview}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {sortedCheckins.map((row) => {
                        const student = studentLabel(row.studentId);
                        const reasons = splitCheckinReasons(row.reason);
                        const pending = row.decision === 'PENDING_REVIEW';
                        return (
                          <tr key={row.id} className="hover:bg-muted/30">
                            <td className="px-3 py-3">
                              <p className="font-medium text-foreground">{student.name}</p>
                              {student.code ? (
                                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                                  {student.code}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-col gap-1">
                                <StatusPill tone={DECISION_TONES[row.decision ?? ''] ?? 'neutral'}>
                                  {decisionLabel(row.decision)}
                                </StatusPill>
                                {row.mockProvider ? (
                                  <StatusPill tone="danger">{copy.mockFlag}</StatusPill>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex max-w-[16rem] flex-wrap gap-1">
                                {reasons.map((token) => (
                                  <span
                                    key={token}
                                    className={cn(
                                      'inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold',
                                      statusToneClass(REASON_TONES[token] ?? 'neutral'),
                                    )}
                                  >
                                    {reasonLabel(token)}
                                  </span>
                                ))}
                                {reasons.length === 0 ? '—' : null}
                              </div>
                            </td>
                            <td className="px-3 py-3 tabular-nums text-muted-foreground">
                              {typeof row.distanceMeters === 'number'
                                ? `${formatNumber(Math.round(row.distanceMeters))} ${copy.metersUnit}`
                                : '—'}
                            </td>
                            <td className="px-3 py-3 tabular-nums text-muted-foreground">
                              {typeof row.accuracyMeters === 'number'
                                ? `±${formatNumber(Math.round(row.accuracyMeters))} ${copy.metersUnit}`
                                : '—'}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap tabular-nums text-muted-foreground">
                              {row.capturedAt
                                ? formatDateTime(row.capturedAt, { hour: '2-digit', minute: '2-digit' })
                                : '—'}
                            </td>
                            <td className="px-3 py-3">
                              {pending ? (
                                <div className="flex flex-wrap gap-1.5">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openReview(row, 'APPROVE')}
                                    aria-label={`${copy.approve} — ${student.name}`}
                                  >
                                    {copy.approve}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openReview(row, 'REJECT')}
                                    aria-label={`${copy.reject} — ${student.name}`}
                                  >
                                    {copy.reject}
                                  </Button>
                                </div>
                              ) : row.reviewedAt ? (
                                <div className="max-w-[14rem] text-xs text-muted-foreground">
                                  <p>
                                    {copy.reviewedLine
                                      .replace('{decision}', decisionLabel(row.decision))
                                      .replace('{time}', formatDateTime(row.reviewedAt))}
                                  </p>
                                  {row.reviewNote ? (
                                    <p className="mt-0.5 break-words">{row.reviewNote}</p>
                                  ) : null}
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {projectorOpen && session?.id && !selectionChanged ? (
        <ProjectorCodeOverlay
          sessionId={session.id}
          sessionStatus={session.status}
          closesAt={session.closesAt}
          requireCode={session.requireCode !== false}
          joinUrl={shareUrl}
          onClose={() => setProjectorOpen(false)}
        />
      ) : null}

      <Modal
        isOpen={Boolean(reviewTarget)}
        onClose={() => setReviewTarget(null)}
        title={copy.reviewNoteTitle}
        description={
          reviewTarget
            ? `${studentLabel(reviewTarget.checkin.studentId).name} — ${
                reviewTarget.decision === 'APPROVE' ? copy.approve : copy.reject
              } — ${copy.sessionTitle}: ${sessionContextLabel}`
            : undefined
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submitReview();
          }}
          noValidate
        >
          <div className="space-y-1.5">
            <label htmlFor="checkin-review-note" className="text-sm font-medium text-foreground">
              {copy.reviewNoteLabel}
            </label>
            <Textarea
              id="checkin-review-note"
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              disabled={reviewBusy}
              error={reviewError || undefined}
              data-testid="checkin-review-note"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReviewTarget(null)}
              disabled={reviewBusy}
            >
              {messages.common.actions.cancel}
            </Button>
            <Button type="submit" disabled={reviewBusy}>
              {reviewBusy ? messages.common.states.loading : copy.reviewSubmit}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmationDialog}
    </WorkspacePanel>
  );
}
