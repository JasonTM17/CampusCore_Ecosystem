import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, UiText } from '../../components/Ui';
import { SearchBar, StatusPill } from '../../components/ui/index';
import type { MobilePublicDoc } from '../../api/client';
import { tokens } from '../../design/tokens';
import { campusMessages } from '../../i18n/campus-messages';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from '../content/content-api';
import { docCategoryLabel, docSummary, docTitle } from '../content/docs-model';
import { DocDetail } from '../content/DocDetail';
import { joinMeta } from '../content/content-rules';
import { ContentChevron, ContentIconChip, ListFrame, useContentCopy } from '../content/content-ui';
import { previewDocs } from '../content/preview-data';
import { usePagedList } from '../content/use-paged-list';

/** Public documents: server-side search, paging and a published-revision detail view. */
export function DocsScreen(_props: MobileScreenProps) {
  const { locale, formatDate } = useContentCopy();
  const copy = campusMessages[locale];
  const categoryLabels = copy.docCategoryLabels as Readonly<Record<string, string>>;
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const preview = useMemo(() => previewDocs(locale), [locale]);
  const list = usePagedList<MobilePublicDoc>({
    key: `content.docs.${search}`,
    fetchPage: (page, limit, signal) => contentApi.docs({ page, limit, signal, search: search || undefined }),
    keyOf: (item) => item.slug,
    preview,
  });

  if (selected) return <DocDetail slug={selected} onBack={() => setSelected(null)} />;

  return (
    <ListFrame
      title={copy.docsTitle}
      icon="file-document-outline"
      list={list}
      filtered={search.length > 0}
      keyOf={(item) => item.slug}
      emptyTitle={copy.emptyDocs}
      header={(
        <SearchBar
          value={input}
          onChangeText={setInput}
          onClear={() => { setInput(''); setSearch(''); }}
          placeholder={copy.searchPlaceholder}
          accessibilityLabel={copy.search}
          returnKeyType="search"
          onSubmitEditing={() => setSearch(input.trim())}
        />
      )}
      renderItem={(doc) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={joinMeta([docTitle(doc, locale), fillCopy(copy.revision, { n: doc.publishedRevision })])}
          onPress={() => setSelected(doc.slug)}
          style={styles.row}
        >
          <Card>
            <View style={styles.rowContent}>
              <ContentIconChip icon="file-document-outline" />
              <View style={styles.rowCopy}>
                <UiText variant="label">{docTitle(doc, locale)}</UiText>
                {docSummary(doc, locale) ? <UiText variant="bodySmall" tone="muted" numberOfLines={2}>{docSummary(doc, locale)}</UiText> : null}
                <View style={styles.meta}>
                  <StatusPill label={fillCopy(copy.revision, { n: doc.publishedRevision })} tone="primary" />
                  {doc.categoryId ? <UiText variant="meta" tone="muted">{docCategoryLabel(doc.categoryId, categoryLabels)}</UiText> : null}
                  {doc.publishedAt ? <UiText variant="meta" tone="muted">{formatDate(doc.publishedAt)}</UiText> : null}
                </View>
              </View>
              <ContentChevron />
            </View>
          </Card>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { minHeight: tokens.layout.touchTarget },
  rowContent: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});
