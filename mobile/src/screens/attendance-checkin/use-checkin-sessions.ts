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

/**
 * Open-session count for the conditional "Check in" entry points. Live mode
 * fetches on mount; preview mode returns the sample sessions locally — the
 * card stays visible in the demo without any network call. apiClient (native
 * session store) is required lazily so the import graph stays Jest-safe.
 */
export function useCheckinOpenSessions(enabled: boolean, api?: AttendanceApi) {
  const preview = useMemo(isPreviewMode, []);
  const attendance = useRef<AttendanceApi | null>(null);
  const getApi = useCallback(() => attendance.current ?? (attendance.current = api ?? createNativeAttendanceApi()), [api]);
  const [count, setCount] = useState<number | null>(preview ? DEMO_SESSIONS.length : null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    if (preview) { setCount(DEMO_SESSIONS.length); return; }
    void (async () => {
      try {
        const sessions: OpenAttendanceSession[] = await getApi().openSessions();
        if (alive.current) setCount(sessions.length);
      } catch {
        if (alive.current) setCount(0);
      }
    })();
    return () => { alive.current = false; };
  }, [enabled, preview, getApi]);

  return enabled ? (count ?? 0) : 0;
}
