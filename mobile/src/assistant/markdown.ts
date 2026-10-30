/**
 * Markdown subset for assistant answers: headings, paragraphs, lists, tables,
 * quotes and fenced code, with bold, italic, inline code and https links.
 * The output is a plain data tree rendered by native Text; nothing here emits
 * HTML, and raw tags stay literal text.
 */

export type InlineSpan =
  | { type: 'text'; text: string; bold?: boolean; italic?: boolean; code?: boolean }
  | { type: 'link'; text: string; url: string };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; spans: InlineSpan[] }
  | { type: 'paragraph'; spans: InlineSpan[] }
  | { type: 'quote'; spans: InlineSpan[] }
  | { type: 'list'; ordered: boolean; items: InlineSpan[][] }
  | { type: 'code'; text: string }
  | { type: 'table'; header: InlineSpan[][]; rows: InlineSpan[][][] };

const HTTPS_URL = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#]\S*)?$/i;

/** Only absolute https links with a DNS host and no embedded credentials open; everything else stays text. */
export function safeLinkUrl(raw: string): string | null {
  const url = raw.trim();
  if (url.length === 0 || url.length > 2048) return null;
  if (/[\u0000- \u007F<>"'`\\]/.test(url)) return null;
  return HTTPS_URL.test(url) ? url : null;
}

function styled(spans: InlineSpan[], style: { bold?: boolean; italic?: boolean }): InlineSpan[] {
  return spans.map((span) => (span.type === 'text' ? { ...span, ...style } : span));
}

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let buffer = '';
  let index = 0;
  const flush = () => {
    if (buffer) spans.push({ type: 'text', text: buffer });
    buffer = '';
  };
  while (index < text.length) {
    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2);
      if (end > index + 2) {
        flush();
        spans.push(...styled(parseInline(text.slice(index + 2, end)), { bold: true }));
        index = end + 2;
        continue;
      }
    }
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end > index + 1) {
        flush();
        spans.push({ type: 'text', text: text.slice(index + 1, end), code: true });
        index = end + 1;
        continue;
      }
    }
    if (text[index] === '*' && text[index + 1] !== undefined && text[index + 1] !== ' ' && text[index + 1] !== '*') {
      const end = text.indexOf('*', index + 1);
      if (end > index + 1 && text[end - 1] !== ' ' && text[end + 1] !== '*') {
        flush();
        spans.push(...styled(parseInline(text.slice(index + 1, end)), { italic: true }));
        index = end + 1;
        continue;
      }
    }
    if (text[index] === '[') {
      const match = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(text.slice(index));
      if (match) {
        flush();
        const url = safeLinkUrl(match[2]);
        if (url) spans.push({ type: 'link', text: match[1], url });
        else spans.push({ type: 'text', text: match[1] });
        index += match[0].length;
        continue;
      }
    }
    buffer += text[index];
    index += 1;
  }
  flush();
  return spans;
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^\s*(?:([-*•])|(\d{1,3})[.)])\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * While a reply is still arriving, drop a trailing fragment that would flash as
 * raw syntax: an unfinished link, a dangling emphasis or code marker, or a
 * table row that has not been closed yet.
 */
export function trimIncompleteSyntax(text: string): string {
  let value = text;
  const fences = (value.match(/^\s*```/gm) ?? []).length;
  if (fences % 2 === 1) return value; // inside an open code block every character is literal
  value = value.replace(/\[[^\]\n]*\]\([^)\n]*$/, '').replace(/\[[^\]\n]*$/, '');
  value = value.replace(/(?:\*{1,2}|`)$/, '');
  const lines = value.split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (/^\s*\|/.test(last) && !/\|\s*$/.test(last)) lines.pop();
  return lines.join('\n');
}

export function parseMarkdown(source: string, options: { streaming?: boolean } = {}): MarkdownBlock[] {
  const text = (options.streaming ? trimIncompleteSyntax(source) : source).replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence, or the end of an unterminated block
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: Math.min(heading[1].length, 3) as 1 | 2 | 3, spans: parseInline(heading[2]) });
      index += 1;
      continue;
    }
    if (/^\s*\|/.test(line) && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1])) {
      flushParagraph();
      const header = splitRow(line).map(parseInline);
      const rows: InlineSpan[][][] = [];
      index += 2;
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        rows.push(splitRow(lines[index]).map(parseInline));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const ordered = item[2] !== undefined;
      const items: InlineSpan[][] = [];
      while (index < lines.length) {
        const next = LIST_ITEM.exec(lines[index]);
        if (!next || (next[2] !== undefined) !== ordered) break;
        items.push(parseInline(next[3]));
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', spans: parseInline(quote.join('\n')) });
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return blocks;
}

/** Plain-text projection for accessibility labels and copy. */
export function spansToText(spans: InlineSpan[]): string {
  return spans.map((span) => span.text).join('');
}
