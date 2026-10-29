// Announcement and document bodies arrive as sanitised HTML. The native screens
// show them as plain paragraphs: block ends become line breaks, every tag is
// dropped and the common entities are decoded. No markup ever reaches the view.

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  const withBreaks = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|blockquote)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ');
  const stripped = withBreaks.replace(/<[^>]*>/g, '');
  const decoded = stripped
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Math.min(parseInt(code, 16), 0x10ffff)));
  return decoded
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The first non-empty paragraph, shortened for a list row. */
export function excerptOf(html: string | null | undefined, limit = 140): string {
  const text = htmlToPlainText(html).split('\n').find((line) => line.trim().length > 0) ?? '';
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** Card teaser: the authored summary when present, else an excerpt of the body. */
export function summaryOrExcerpt(
  item: { summary?: string | null; content?: string | null },
  limit = 140,
): string {
  const summary = item.summary?.trim();
  return summary ? summary : excerptOf(item.content, limit);
}
