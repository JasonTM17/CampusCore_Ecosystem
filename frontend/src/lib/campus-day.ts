'use client';

import { useEffect, useState } from 'react';
import { campusTodayIso } from '@/lib/attendance-checkin';

/**
 * Timetable "today" lives on the campus calendar (Asia/Ho_Chi_Minh), not the
 * viewer's zone. That zone has been a fixed UTC+07:00 offset with no daylight
 * saving since 1975, so the next campus midnight is always a constant shift
 * away and a mounted page can roll over exactly once per day.
 */
const CAMPUS_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Arm the rollover check just past the boundary: a timer that fires a few
 * milliseconds early would otherwise re-arm for another full day on the old
 * civil date.
 */
const ROLLOVER_SKEW_MS = 1_000;

/** Timetable day number on the campus calendar: 1=Sunday .. 7=Saturday. */
export function campusDayOfWeek(now: Date = new Date()): number {
  const jsDay = new Date(`${campusTodayIso(now)}T00:00:00Z`).getUTCDay();
  return jsDay === 0 ? 1 : jsDay + 1;
}

/** Milliseconds from `now` until the next campus midnight. */
export function msUntilNextCampusMidnight(now: Date = new Date()): number {
  const campusMidnightUtcMs =
    Date.parse(`${campusTodayIso(now)}T00:00:00Z`) - CAMPUS_OFFSET_MS;
  return Math.max(0, campusMidnightUtcMs + DAY_MS - now.getTime());
}

/**
 * Campus day-of-week that stays live on a mounted page: it re-derives the day
 * just after each campus midnight and again whenever the tab returns to
 * visible, so a page that slept through the boundary never keeps badging
 * yesterday as today.
 */
export function useCampusDayOfWeek(): number {
  const [dow, setDow] = useState(() => campusDayOfWeek());
  useEffect(() => {
    let timer: number | undefined;
    const arm = () => {
      timer = window.setTimeout(() => {
        setDow(campusDayOfWeek());
        arm();
      }, msUntilNextCampusMidnight() + ROLLOVER_SKEW_MS);
    };
    const sync = () => {
      setDow(campusDayOfWeek());
      window.clearTimeout(timer);
      arm();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sync();
      }
    };
    arm();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
  return dow;
}
