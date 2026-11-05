import { joinMeta } from '../content/content-rules';

export interface SummaryRowLabelParams {
  title: string;
  badge?: string | null | false;
  meta?: string | null | false;
  date?: string | null | false;
  summary?: string | null | false;
}

/**
 * Builds an accessible description for list and magazine rows whose summary
 * is visually clamped. Preserves title, category/priority/revision metadata,
 * date and the unabridged summary for assistive technologies.
 */
export function summaryRowAccessibilityLabel(
  optionsOrTitle: SummaryRowLabelParams | string,
  date?: string | null | false,
  summary?: string | null | false,
  badge?: string | null | false,
): string {
  if (typeof optionsOrTitle === 'object' && optionsOrTitle !== null) {
    const secondary = optionsOrTitle.badge ?? optionsOrTitle.meta;
    return joinMeta([
      optionsOrTitle.title,
      secondary,
      optionsOrTitle.date,
      optionsOrTitle.summary,
    ]);
  }
  return joinMeta([optionsOrTitle, badge, date, summary]);
}
