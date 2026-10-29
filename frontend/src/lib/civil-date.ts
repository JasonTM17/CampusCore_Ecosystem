/**
 * Identity dates such as date of birth reach the client either as a bare
 * civil date `YYYY-MM-DD` or as a serialized instant. The server stores them
 * through UTC fields, so the civil day carried by an instant is its UTC
 * calendar day — never the viewer's own zone, which would shift the shown
 * day east or west of UTC.
 */

/** Zone pinned for rendering stored civil dates so the shown day cannot drift. */
export const CIVIL_DATE_TIME_ZONE = 'UTC';

const BARE_CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZONE_SUFFIX = /(z|[+-]\d{2}:?\d{2})$/i;

/**
 * Reduce a stored identity-date value to its civil day as a `YYYY-MM-DD`
 * input value. Bare civil dates pass through untouched; zoned instants keep
 * their UTC calendar day; zone-less datetimes carry the server's UTC fields.
 * Unparseable input returns '' so callers can fall back to the raw string
 * instead of guessing a shifted day.
 */
export function civilDateInputValue(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return '';
  }
  if (BARE_CIVIL_DATE.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(ZONE_SUFFIX.test(trimmed) ? trimmed : `${trimmed}Z`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const year = parsed.getUTCFullYear();
  const month = `${parsed.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
