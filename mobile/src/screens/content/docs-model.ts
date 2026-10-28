// Locale accessors and revision list for public documents.

interface LocalizedDoc {
  titleVi: string;
  titleEn: string;
  summaryVi?: string | null;
  summaryEn?: string | null;
  bodyVi?: string | null;
  bodyEn?: string | null;
}

export const docTitle = (doc: LocalizedDoc, locale: 'vi' | 'en'): string =>
  (locale === 'vi' ? doc.titleVi : doc.titleEn) || doc.titleVi || doc.titleEn;

export const docSummary = (doc: LocalizedDoc, locale: 'vi' | 'en'): string =>
  (locale === 'vi' ? doc.summaryVi : doc.summaryEn) ?? '';

export const docBody = (doc: LocalizedDoc, locale: 'vi' | 'en'): string =>
  (locale === 'vi' ? doc.bodyVi : doc.bodyEn) ?? '';

/** Revisions that resolve for readers: the published one and every earlier one, newest first. */
export function revisionNumbers(published: number): number[] {
  if (!Number.isInteger(published) || published < 1) return [];
  return Array.from({ length: published }, (_, index) => published - index);
}
