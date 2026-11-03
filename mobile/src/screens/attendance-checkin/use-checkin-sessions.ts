import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { createNativeAttendanceApi, type AttendanceApi, type OpenAttendanceSession } from '../../attendance-checkin';
import { DEMO_SESSIONS } from './checkin-demo';

type FocusEffect = (callback: () => void | (() => void)) => void;

/**
 * expo-router is required lazily like apiClient below: a static import would
 * drag the router into the import graph of every screen rendering this hook,
 * which breaks component tests that load it without a navigation context. The
 * resolved hook is constant for the process, so calling it (or skipping it)
 * keeps the hook order stable.
 */
const onFocus: FocusEffect | undefined = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-router') as typeof import('expo-router')).useFocusEffect;
  } catch {
    return undefined;
  }
})();

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
  const fetching = useRef(false);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    if (preview) { setState({ count: DEMO_SESSIONS.length, failed: false }); return; }
    fetching.current = true;
    void (async () => {
      try {
        const sessions: OpenAttendanceSession[] = await getApi().openSessions();
        if (alive.current) setState({ count: sessions.length, failed: false });
      } catch {
        // A failed read leaves the entry reachable with a retry instead of
        // disappearing as if the server had reported no open session.
        if (alive.current) setState((current) => ({ ...current, failed: true }));
      } finally {
        fetching.current = false;
      }
    })();
    return () => { alive.current = false; };
  }, [attempt, enabled, getApi, preview]);

  // Tabs keep this screen mounted while unfocused, so a session opened while
  // the student was away only shows up on a re-read. The focus callback also
  // runs for the mount focus — that read is still in flight, so it is skipped.
  onFocus?.(useCallback(() => {
    if (!fetching.current) retry();
  }, [retry]));

  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && !fetching.current) retry();
    });
    return () => subscription.remove();
  }, [enabled, retry]);

  return { count: enabled ? state.count : 0, failed: enabled && state.failed, retry };
}

/** The entry count alone, for callers that only need the number. */
export function useCheckinOpenSessions(enabled: boolean, api?: AttendanceApi): number {
  return useCheckinOpenSessionsState(enabled, api).count;
}
