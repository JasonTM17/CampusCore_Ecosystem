'use client';

import { useEffect, useState } from 'react';

/**
 * Ticking clock for deadline-driven UI.
 *
 * Returns 0 until mounted so the server render and the hydration render are
 * identical — no SSR/CSR clock skew around a deadline boundary. The first
 * effect tick supplies the real time and the interval keeps it live, so
 * deadline-dependent UI flips at the boundary without a navigation.
 *
 * Consumers should treat 0 as "clock not yet known" and stay permissive:
 * the server remains the write gate for every deadline decision.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
