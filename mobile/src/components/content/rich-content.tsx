// Native renderer for the sanitised HTML subset used by news and public
// documents. The web renders the same bodies with a DOM allowlist; this keeps
// that allowlist and turns the markup into native text blocks.

import { memo, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { UiText } from '../Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { safeLinkUrl } from '../../assistant/markdown';

const WEB_ORIGIN = 'https://www.campusute.io.vn';

export function webUrlFor(href: string): string {
  if (/^https:\/\//i.test(href)) return href;
  if (href.startsWith('/')) return `${WEB_ORIGIN}${href}`;
  return `${WEB_ORIGIN}/${href.replace(/^(?:\.\.?\/)+/, '')}`;
}

/** Same tag allowlist as the web announcement sanitizer. */
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
  'dd', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre',
  's', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul',
]);

/** Elements whose content is discarded with the tag, as on the web. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'svg',
  'math', 'form',
]);

const SWALLOW_UNTERMINATED = new Set(['script', 'style', 'template']);

const BLOCK_BOUNDARIES = new Set([
  'article', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure', 'pre',
  'section', 'summary',
]);

const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/(?!\/)|\.{1,2}\/)/i;
const SAFE_IMAGE_URL = /^https:\/\//i;

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)|([a-zA-Z_:][-a-zA-Z0-9_:.]*)/g;

const NAMED_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

export interface RichRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  href?: string;
}

export type RichBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; runs: RichRun[] }
  | { type: 'paragraph'; runs: RichRun[] }
  | { type: 'quote'; runs: RichRun[] }
  | { type: 'list'; ordered: boolean; items: RichRun[][] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'table'; rows: RichRun[][][] };

interface ListState {
  ordered: boolean;
  items: RichRun[][];
  current: RichRun[] | null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (entity) => NAMED_ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Math.min(parseInt(code, 16), 0x10ffff)));
}

function normalizeForSchemeCheck(value: string): string {
  return decodeEntities(value)
    .replace(/[\u0000-\u0020\u00a0\u2028\u2029]/g, '')
    .toLowerCase();
}

export function isSafeRichUrl(value: string): boolean {
  return SAFE_URL.test(normalizeForSchemeCheck(value));
}

export function isSafeRichImageUrl(value: string): boolean {
  return SAFE_IMAGE_URL.test(normalizeForSchemeCheck(value));
}

function cleanText(value: string, preformatted: boolean): string {
  const decoded = decodeEntities(value);
  return preformatted ? decoded.replace(/\r\n/g, '\n') : decoded.replace(/\s+/g, ' ');
}

function trimRuns(runs: RichRun[]): RichRun[] {
  const copy = runs.map((run) => ({ ...run }));
  while (copy.length > 0 && !copy[0].text.trim()) copy.shift();
  while (copy.length > 0 && !copy[copy.length - 1].text.trim()) copy.pop();
  if (copy.length > 0) copy[0] = { ...copy[0], text: copy[0].text.replace(/^\s+/, '') };
  if (copy.length > 0) copy[copy.length - 1] = { ...copy[copy.length - 1], text: copy[copy.length - 1].text.replace(/\s+$/, '') };
  return copy.filter((run) => run.text.length > 0);
}

function hasText(runs: RichRun[]): boolean {
  return runs.some((run) => run.text.trim().length > 0);
}

function readAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const name = (match[1] ?? match[3] ?? '').toLowerCase();
    if (!name || match[1] === undefined) continue;
    let value = match[2] ?? '';
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    attributes[name] = decodeEntities(value).trim();
  }
  return attributes;
}

/** Parses a body into native blocks, dropping anything the web allowlist rejects. */
export function parseRichHtml(html: string | null | undefined): RichBlock[] {
  if (!html) return [];
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const blocks: RichBlock[] = [];
  let paragraph: RichRun[] | null = null;
  let heading: { level: 1 | 2 | 3 | 4; runs: RichRun[] } | null = null;
  let quote: RichRun[] | null = null;
  const lists: ListState[] = [];
  let table: { rows: RichRun[][][] } | null = null;
  let row: RichRun[][] | null = null;
  let cell: RichRun[] | null = null;
  let bold = 0;
  let italic = 0;
  let preformatted = 0;
  const links: Array<string | undefined> = [];

  const currentTarget = (): RichRun[] | null => {
    const list = lists[lists.length - 1];
    if (list?.current) return list.current;
    if (cell) return cell;
    if (heading) return heading.runs;
    if (quote) return quote;
    return paragraph;
  };

  const appendRun = (target: RichRun[], text: string, lineBreak = false) => {
    if (!text) return;
    const href = links[links.length - 1];
    const last = target[target.length - 1];
    const style = { bold: bold > 0, italic: italic > 0, href };
    if (!lineBreak && last && last.bold === style.bold && last.italic === style.italic && last.href === style.href) {
      last.text += text;
      return;
    }
    if (!lineBreak && target.length === 0) text = text.replace(/^\s+/, '');
    if (!lineBreak && last && /\s$/.test(last.text)) text = text.replace(/^\s+/, '');
    if (!text) return;
    target.push({ text, ...style });
  };

  const appendText = (raw: string) => {
    const text = cleanText(raw, preformatted > 0);
    if (!text) return;
    const target = currentTarget();
    if (target) {
      appendRun(target, text);
      return;
    }
    if (!text.trim()) return;
    paragraph = [];
    appendRun(paragraph, text);
  };

  const flushParagraph = () => {
    if (!paragraph) return;
    const runs = trimRuns(paragraph);
    if (hasText(runs)) blocks.push({ type: 'paragraph', runs });
    paragraph = null;
  };

  const flushHeading = () => {
    if (!heading) return;
    const runs = trimRuns(heading.runs);
    if (hasText(runs)) blocks.push({ type: 'heading', level: heading.level, runs });
    heading = null;
  };

  const flushQuote = () => {
    if (!quote) return;
    const runs = trimRuns(quote);
    if (hasText(runs)) blocks.push({ type: 'quote', runs });
    quote = null;
  };

  const flushItem = () => {
    const list = lists[lists.length - 1];
    if (!list || !list.current) return;
    const runs = trimRuns(list.current);
    if (hasText(runs)) list.items.push(runs);
    list.current = null;
  };

  const flushCell = () => {
    if (!cell || !row) { cell = null; return; }
    row.push(trimRuns(cell));
    cell = null;
  };

  const flushRow = () => {
    if (!row || !table) { row = null; return; }
    if (row.some((entry) => hasText(entry))) table.rows.push(row);
    row = null;
  };

  const closeList = () => {
    flushItem();
    const list = lists.pop();
    if (list && list.items.length > 0) blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
  };

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(source)) !== null) {
    if (match.index > lastIndex) appendText(source.slice(lastIndex, match.index));
    const closing = match[1] === '/';
    const name = match[2].toLowerCase();
    const attributes = readAttributes(match[3] ?? '');
    lastIndex = TAG_RE.lastIndex;

    if (DROP_WITH_CONTENT.has(name)) {
      const closeAt = source.toLowerCase().indexOf(`</${name}`, TAG_RE.lastIndex);
      if (closeAt === -1 && SWALLOW_UNTERMINATED.has(name)) {
        lastIndex = source.length;
        TAG_RE.lastIndex = source.length;
        break;
      }
      if (closeAt !== -1) {
        const afterClose = source.indexOf('>', closeAt);
        lastIndex = afterClose === -1 ? source.length : afterClose + 1;
        TAG_RE.lastIndex = lastIndex;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(name)) continue;

    if (closing) {
      switch (name) {
        case 'p': flushParagraph(); break;
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': flushHeading(); break;
        case 'blockquote': flushQuote(); break;
        case 'li': flushItem(); break;
        case 'ul': case 'ol': closeList(); break;
        case 'td': case 'th': flushCell(); break;
        case 'tr': flushCell(); flushRow(); break;
        case 'table':
          flushCell();
          flushRow();
          if (table && table.rows.length > 0) blocks.push({ type: 'table', rows: table.rows });
          table = null;
          break;
        case 'a': links.pop(); break;
        case 'strong': case 'b': bold = Math.max(0, bold - 1); break;
        case 'em': case 'i': italic = Math.max(0, italic - 1); break;
        case 'pre': preformatted = Math.max(0, preformatted - 1); flushParagraph(); break;
        default:
          if (BLOCK_BOUNDARIES.has(name)) flushParagraph();
          break;
      }
      continue;
    }

    switch (name) {
      case 'p':
        flushParagraph();
        paragraph = [];
        break;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        flushParagraph();
        const level = Math.min(4, Number(name[1])) as 1 | 2 | 3 | 4;
        heading = { level, runs: [] };
        break;
      }
      case 'blockquote':
        flushParagraph();
        quote = [];
        break;
      case 'ul':
      case 'ol':
        flushParagraph();
        lists.push({ ordered: name === 'ol', items: [], current: null });
        break;
      case 'li': {
        if (lists.length === 0) lists.push({ ordered: false, items: [], current: null });
        flushItem();
        const list = lists[lists.length - 1];
        list.current = [];
        break;
      }
      case 'table':
        flushParagraph();
        table = { rows: [] };
        break;
      case 'tr': row = []; break;
      case 'td': case 'th': cell = []; break;
      case 'a': {
        const href = attributes.href;
        links.push(href && isSafeRichUrl(href) ? href : undefined);
        break;
      }
      case 'strong': case 'b': bold += 1; break;
      case 'em': case 'i': italic += 1; break;
      case 'pre': preformatted += 1; flushParagraph(); paragraph = []; break;
      case 'br': {
        const target = currentTarget();
        if (target) appendRun(target, '\n', true);
        break;
      }
      case 'img': {
        const src = attributes.src;
        if (src && isSafeRichImageUrl(src)) {
          flushParagraph();
          blocks.push({ type: 'image', src, alt: attributes.alt ?? '' });
        }
        break;
      }
      case 'hr':
        flushParagraph();
        break;
      default:
        if (BLOCK_BOUNDARIES.has(name)) flushParagraph();
        break;
    }
  }

  if (lastIndex < source.length) appendText(source.slice(lastIndex));
  flushParagraph();
  flushHeading();
  flushQuote();
  flushItem();
  flushCell();
  flushRow();
  return blocks;
}

const HEADING_VARIANTS = {
  1: 'headlineMedium',
  2: 'headlineSmall',
  3: 'label',
  4: 'bodyLarge',
} as const;

function InlineRuns({ runs, openLink }: { runs: RichRun[]; openLink: (href: string) => void }): ReactNode {
  return runs.map((run, index) => {
    const style = [run.bold ? styles.bold : undefined, run.italic ? styles.italic : undefined];
    if (run.href) {
      return (
        <UiText
          key={index}
          accessibilityRole="link"
          onPress={() => openLink(run.href as string)}
          style={[style, styles.link]}
          tone="primary"
          variant="bodyLarge"
        >
          {run.text}
        </UiText>
      );
    }
    return <UiText key={index} style={style} variant="bodyLarge">{run.text}</UiText>;
  });
}

function BlockView({ block, openLink }: { block: RichBlock; openLink: (href: string) => void }) {
  const { colors } = useTheme();
  switch (block.type) {
    case 'heading': {
      const variant = HEADING_VARIANTS[block.level];
      return (
        <UiText accessibilityRole="header" style={styles.heading} variant={variant}>
          <InlineRuns runs={block.runs} openLink={openLink} />
        </UiText>
      );
    }
    case 'paragraph':
      return (
        <UiText style={styles.paragraph} variant="bodyLarge">
          <InlineRuns runs={block.runs} openLink={openLink} />
        </UiText>
      );
    case 'quote':
      return (
        <View style={[styles.quote, { backgroundColor: colors.surfaceLow, borderLeftColor: colors.primary }]}>
          <UiText style={styles.paragraph} variant="bodyLarge">
            <InlineRuns runs={block.runs} openLink={openLink} />
          </UiText>
        </View>
      );
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.listRow}>
              <UiText style={styles.marker} tone="muted" variant="bodyLarge">
                {block.ordered ? `${index + 1}.` : '•'}
              </UiText>
              <UiText style={styles.listText} variant="bodyLarge">
                <InlineRuns runs={item} openLink={openLink} />
              </UiText>
            </View>
          ))}
        </View>
      );
    case 'image':
      return (
        <Image
          accessibilityLabel={block.alt || undefined}
          accessibilityRole="image"
          accessible={Boolean(block.alt)}
          resizeMode="contain"
          source={{ uri: block.src }}
          style={[styles.image, { backgroundColor: colors.surfaceLow }]}
        />
      );
    case 'table':
      return (
        <View style={[styles.table, { borderColor: colors.outlineVariant }]}>
          {block.rows.map((cells, rowIndex) => (
            <View
              key={rowIndex}
              style={[styles.tableRow, { borderColor: colors.outlineVariant }, rowIndex > 0 ? styles.tableRowDivider : undefined]}
            >
              {cells.map((runs, cellIndex) => (
                <UiText key={cellIndex} style={styles.tableCell} variant="bodySmall">
                  <InlineRuns runs={runs} openLink={openLink} />
                </UiText>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

export interface RichContentProps {
  html: string | null | undefined;
  style?: StyleProp<ViewStyle>;
}

/** Renders a sanitised announcement or document body with native blocks. */
export const RichContent = memo(function RichContent({ html, style }: RichContentProps) {
  const blocks = useMemo(() => parseRichHtml(html), [html]);
  const openLink = useCallback((href: string) => {
    if (href.startsWith('#')) return;
    // Internal app routes go through the shared link policy; a body link still
    // opens its canonical web page because the reader never leaves this screen.
    const internal = safeLinkUrl(href);
    const url = internal || href.startsWith('/') || href.startsWith('./') || href.startsWith('../')
      ? webUrlFor(href)
      : href;
    void Linking.openURL(url).catch(() => undefined);
  }, []);

  if (blocks.length === 0) return null;
  return (
    <View style={[styles.container, style]}>
      {blocks.map((block, index) => <BlockView key={index} block={block} openLink={openLink} />)}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: tokens.spacing.xs },
  paragraph: { marginBottom: tokens.spacing.xs },
  heading: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  link: { textDecorationLine: 'underline' },
  quote: { borderLeftWidth: 3, marginBottom: tokens.spacing.xs, paddingLeft: tokens.spacing.sm, paddingVertical: tokens.spacing.xs },
  list: { marginBottom: tokens.spacing.xs },
  listRow: { flexDirection: 'row', marginBottom: tokens.spacing.xs },
  marker: { minWidth: 24 },
  listText: { flex: 1 },
  image: { borderRadius: tokens.radii.control, height: 200, width: '100%' },
  table: { borderRadius: tokens.radii.control, borderWidth: 1, marginBottom: tokens.spacing.xs, overflow: 'hidden' },
  tableRow: { flexDirection: 'column', padding: tokens.spacing.xs },
  tableRowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  tableCell: { paddingVertical: 2 },
});
