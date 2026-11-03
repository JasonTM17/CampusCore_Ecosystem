import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createNativeAttendanceApi, type AttendanceApi, type OpenAttendanceSession } from '../../attendance-checkin';
import { DEMO_SESSIONS } from './checkin-demo';

function isPreviewMode(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { apiClient } = require('../../api/client') as typeof import('../../api/client');
    return apiClient.mode === 'preview';
  } catch {
    return false;
  }
}

export interface CheckinOpenSessions {
  count: number;
  /** The read failed, so the count is unknown — never treat it as zero. */
  failed: boolean;
  retry: () => void;
}

/**
 * Open-session count for the conditional "Check in" entry points. Live mode
 * fetches on mount; preview mode returns the sample sessions locally — the
 * card stays visible in the demo without any network call. apiClient (native
 * session store) is required lazily so the import graph stays Jest-safe.
 */
export function useCheckinOpenSessionsState(enabled: boolean, api?: AttendanceApi): CheckinOpenSessions {
  const preview = useMemo(isPreviewMode, []);
  const attendance = useRef<AttendanceApi | null>(null);
  const getApi = useCallback(() => attendance.current ?? (attendance.current = api ?? createNativeAttendanceApi()), [api]);
  const [state, setState] = useState<{ count: number; failed: boolean }>({
    count: preview ? DEMO_SESSIONS.length : 0,
    failed: false,
  });
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    if (preview) { setState({ count: DEMO_SESSIONS.length, failed: false }); return; }
    void (async () => {
      try {
        const sessions: OpenAttendanceSession[] = await getApi().openSessions();
        if (alive.current) setState({ count: sessions.length, failed: false });
      } catch {
        // A failed read leaves the entry reachable with a retry instead of
        // disappearing as if the server had reported no open session.
        if (alive.current) setState((current) => ({ ...current, failed: true }));
      }
    })();
    return () => { alive.current = false; };
  }, [attempt, enabled, getApi, preview]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { count: enabled ? state.count : 0, failed: enabled && state.failed, retry };
}

/** The entry count alone, for callers that only need the number. */
export function useCheckinOpenSessions(enabled: boolean, api?: AttendanceApi): number {
  return useCheckinOpenSessionsState(enabled, api).count;
}
