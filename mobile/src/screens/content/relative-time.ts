// Relative time for content timestamps, ported from the web helper so the same
// record reads the same way on both surfaces.

import { campusMessages } from '../../i18n/campus-messages';
import type { CampusLocale } from '../../i18n/campus-messages';

function fill(template: string, name: string, value: number): string {
  return template.replace(`{${name}}`, () => String(value));
}

export function formatRelativeTime(
  value: string | null | undefined,
  locale: CampusLocale,
  now: number = Date.now(),
): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  const copy = campusMessages[locale].relativeTime;

  if (diffMin < 1) {
    return copy.justNow;
  }
  if (diffMin < 60) {
    return fill(copy.minutesAgo, 'minutes', diffMin);
  }
  if (diffHours < 24) {
    return fill(copy.hoursAgo, 'hours', diffHours);
  }
  if (diffDays === 1) {
    return copy.yesterday;
  }
  if (diffDays < 7) {
    return fill(copy.daysAgo, 'days', diffDays);
  }
  return new Intl.DateTimeFormat(
    locale === 'vi' ? 'vi-VN' : 'en-US',
    { day: '2-digit', month: '2-digit', year: 'numeric' },
  ).format(date);
}
