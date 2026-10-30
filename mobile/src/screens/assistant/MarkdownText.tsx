import { memo, useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { UiText } from '../../components/Ui';
import type { TextTone } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { parseMarkdown, spansToText } from '../../assistant/markdown';
import type { InlineSpan, MarkdownBlock } from '../../assistant/markdown';

export interface MarkdownTextProps {
  text: string;
  /** Hides unfinished syntax at the tail while the answer is still arriving. */
  streaming?: boolean;
  tone?: TextTone;
}

function Spans({ spans, tone }: { spans: InlineSpan[]; tone: TextTone }) {
  const { colors } = useTheme();
  return (
    <>
      {spans.map((span, index) => {
        if (span.type === 'link') {
          return (
            <UiText
              key={index}
              variant="bodyMedium"
              tone="primary"
              accessibilityRole="link"
              style={styles.link}
              onPress={() => { void Linking.openURL(span.url).catch(() => undefined); }}
            >
              {span.text}
            </UiText>
          );
        }
        const style = [
          span.bold ? styles.bold : undefined,
          span.italic ? styles.italic : undefined,
          span.code ? [styles.code, { backgroundColor: colors.surfaceLow }] : undefined,
        ];
        return (
          <UiText key={index} variant="bodyMedium" tone={tone} style={style}>{span.text}</UiText>
        );
      })}
    </>
  );
}

function Block({ block, tone }: { block: MarkdownBlock; tone: TextTone }) {
  const { colors } = useTheme();
  switch (block.type) {
    case 'heading':
      return (
        <UiText accessibilityRole="header" variant={block.level === 1 ? 'headlineSmall' : 'label'} tone="primary" style={styles.heading}>
          {spansToText(block.spans)}
        </UiText>
      );
    case 'paragraph':
      return <UiText variant="bodyMedium" tone={tone} style={styles.paragraph}><Spans spans={block.spans} tone={tone} /></UiText>;
    case 'quote':
      return (
        <View style={[styles.quote, { backgroundColor: colors.surfaceLow, borderLeftColor: colors.primary }]}>
          <UiText variant="bodyMedium" tone="muted"><Spans spans={block.spans} tone="muted" /></UiText>
        </View>
      );
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.listRow}>
              <UiText variant="bodyMedium" tone="muted" style={styles.marker}>{block.ordered ? `${index + 1}.` : '•'}</UiText>
              <UiText variant="bodyMedium" tone={tone} style={styles.listText}><Spans spans={item} tone={tone} /></UiText>
            </View>
          ))}
        </View>
      );
    case 'code':
      return (
        <ScrollView horizontal style={[styles.codeBlock, { backgroundColor: colors.surfaceLow, borderColor: colors.outlineVariant }]}>
          <UiText variant="bodySmall" style={styles.mono} selectable>{block.text}</UiText>
        </ScrollView>
      );
    case 'table':
      return (
        <ScrollView horizontal style={styles.table}>
          <View>
            <View style={[styles.tableRow, { backgroundColor: colors.surfaceLow }]}>
              {block.header.map((cell, index) => (
                <View key={index} style={[styles.cell, { borderColor: colors.outlineVariant }]}>
                  <UiText variant="label">{spansToText(cell)}</UiText>
                </View>
              ))}
            </View>
            {block.rows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.tableRow}>
                {block.header.map((_, cellIndex) => (
                  <View key={cellIndex} style={[styles.cell, { borderColor: colors.outlineVariant }]}>
                    <UiText variant="bodySmall" tone={tone}><Spans spans={row[cellIndex] ?? []} tone={tone} /></UiText>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
  }
}

/** Renders the safe Markdown subset with native Text only: no HTML, no WebView, https links only. */
export const MarkdownText = memo(function MarkdownText({ text, streaming = false, tone = 'default' }: MarkdownTextProps) {
  const blocks = useMemo(() => parseMarkdown(text, { streaming }), [text, streaming]);
  return (
    <View>
      {blocks.map((block, index) => <Block key={index} block={block} tone={tone} />)}
    </View>
  );
});

const styles = StyleSheet.create({
  heading: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  paragraph: { marginBottom: tokens.spacing.sm },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: 'monospace' },
  mono: { fontFamily: 'monospace' },
  link: { textDecorationLine: 'underline' },
  quote: { borderLeftWidth: 3, marginBottom: tokens.spacing.sm, paddingLeft: tokens.spacing.sm },
  list: { marginBottom: tokens.spacing.sm },
  listRow: { flexDirection: 'row', marginBottom: tokens.spacing.xs },
  marker: { minWidth: 24 },
  listText: { flex: 1 },
  codeBlock: { borderRadius: tokens.radii.control, borderWidth: 1, marginBottom: tokens.spacing.sm, padding: tokens.spacing.sm },
  table: { marginBottom: tokens.spacing.sm },
  tableRow: { flexDirection: 'row' },
  cell: { borderWidth: StyleSheet.hairlineWidth, minWidth: 96, padding: tokens.spacing.xs, maxWidth: 220 },
});
