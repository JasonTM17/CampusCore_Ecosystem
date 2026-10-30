'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, RefreshCw, X } from 'lucide-react';
import { geofencedAttendanceApi } from '@/lib/api';
import { nextCodeRefreshMs, sessionSecondsLeft } from '@/lib/attendance-checkin';
import { Button } from '@/components/ui/button';
import { statusToneClass } from '@/components/ui/status';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import type { components } from '@/types/generated-api';

type CodeResponse = components['schemas']['AttendanceCodeResponse'];

const CODE_RETRY_MS = 5_000;

export interface ProjectorCodeOverlayProps {
  sessionId: string;
  /** Session status at mount time; the overlay hides its code when closed. */
  sessionStatus: string | undefined;
  closesAt?: string;
  requireCode: boolean;
  /** Absolute https landing link (session id only — never the code). */
  joinUrl: string;
  onClose: () => void;
}

/**
 * Full-screen classroom projector: a huge rotating code driven by the
 * server's expiresAt. The code lives only in component state — never in the
 * URL, storage or logs — and the overlay is the only place that fetches it.
 */
export function ProjectorCodeOverlay({
  sessionId,
  sessionStatus,
  closesAt,
  requireCode,
  joinUrl,
  onClose,
}: ProjectorCodeOverlayProps) {
  const { formatDateTime, messages } = useI18n();
  const copy = messages.attendanceGeofence.lecturer;
  const rootRef = useRef<HTMLDivElement>(null);

  const [code, setCode] = useState<CodeResponse | null>(null);
  const [codeFailed, setCodeFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isOpen = sessionStatus === 'OPEN';
  const wantsCode = isOpen && requireCode;

  // Fetch the rotating code on the server's schedule: refetch when the
  // current code expires (+skew), retry shortly on a stale boundary, and
  // back off on failure. Unmounting the overlay ends every pending timer —
  // the code is not fetched while it is not on screen.
  useEffect(() => {
    if (!wantsCode) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const next = await geofencedAttendanceApi.getCurrentCode(sessionId);
        if (cancelled) return;
        setCode(next);
        setCodeFailed(false);
        timer = setTimeout(load, nextCodeRefreshMs(next, Date.now()));
      } catch {
        if (cancelled) return;
        setCodeFailed(true);
        timer = setTimeout(load, CODE_RETRY_MS);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [wantsCode, sessionId, retryNonce]);

  // 1s heartbeat for the "rotates in" countdown and the closes-in footer.
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  // Fullscreen API: the button toggles, the change listener keeps the icon
  // honest when the user exits with Esc/F11 instead.
  useEffect(() => {
    const onFullscreenChange = () =>
      setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void rootRef.current?.requestFullscreen?.();
    }
  }, []);

  const codeExpiresMs = code?.expiresAt ? new Date(code.expiresAt).getTime() : Number.NaN;
  const secondsLeft = Number.isNaN(codeExpiresMs)
    ? null
    : Math.max(0, Math.ceil((codeExpiresMs - nowMs) / 1_000));
  const stepSeconds = code?.stepSeconds ?? 30;
  const rotationProgress =
    secondsLeft === null ? null : Math.min(1, secondsLeft / stepSeconds);
  const sessionSeconds = sessionSecondsLeft(closesAt, nowMs);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={copy.projectorHeading}
      data-testid="checkin-projector"
      className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-8 sm:py-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:text-base">
          {copy.projectorHeading}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? copy.fullscreenExit : copy.fullscreenEnter}
            title={isFullscreen ? copy.fullscreenExit : copy.fullscreenEnter}
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onClose}
            aria-label={copy.projectorExit}
            title={copy.projectorExit}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4 pb-10 text-center sm:gap-8">
        {!isOpen ? (
          <p className="text-2xl font-semibold text-muted-foreground sm:text-3xl">
            {copy.projectorClosed}
          </p>
        ) : !requireCode ? (
          <p className="text-2xl font-semibold text-muted-foreground sm:text-3xl">
            {copy.projectorNoCode}
          </p>
        ) : codeFailed && !code ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-xl font-semibold text-muted-foreground sm:text-2xl" role="alert">
              {copy.projectorWaiting}
            </p>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => {
                setCodeFailed(false);
                // Bumping the nonce re-runs the fetch effect immediately;
                // it remains the only path that touches the code endpoint.
                setRetryNonce((n) => n + 1);
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {copy.projectorRetry}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-lg font-medium text-muted-foreground sm:text-xl">
              {copy.projectorHint}
            </p>
            <div aria-live="polite" aria-atomic="true">
              <span className="block font-mono text-[clamp(4rem,17vw,15rem)] font-bold leading-none tracking-[0.15em] text-foreground">
                {code?.code ?? '—'}
              </span>
            </div>
            <div className="flex w-full max-w-md flex-col items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold sm:text-base',
                  statusToneClass('info'),
                )}
              >
                {secondsLeft !== null
                  ? copy.projectorRotatesIn.replace('{seconds}', String(secondsLeft))
                  : copy.projectorWaiting}
              </span>
              {rotationProgress !== null ? (
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="presentation"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
                    style={{ width: `${Math.round(rotationProgress * 100)}%` }}
                  />
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 pb-6 text-xs text-muted-foreground sm:text-sm">
        <span className="max-w-full truncate">
          <span className="font-semibold">{copy.projectorJoinLabel}:</span>{' '}
          {joinUrl || '—'}
        </span>
        {closesAt && sessionSeconds !== null ? (
          <span className="tabular-nums">
            {copy.closesInMinutes.replace(
              '{minutes}',
              String(Math.ceil(sessionSeconds / 60)),
            )}
          </span>
        ) : closesAt ? (
          <span className="tabular-nums">{formatDateTime(closesAt, { hour: '2-digit', minute: '2-digit' })}</span>
        ) : null}
      </div>
    </div>
  );
}
