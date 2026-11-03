import { toCampusLocalDateTimeInput } from '@/lib/attendance-checkin';

/** datetime-local is campus wall time: render on the fixed campus clock, not the browser's. */
export function toThesisLocalInput(iso?: string | null): string {
  return toCampusLocalDateTimeInput(iso);
}
