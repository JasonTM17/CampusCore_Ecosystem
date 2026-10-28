import { useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Card, UiText } from '../../components/Ui';
import { SearchBar } from '../../components/ui/index';
import type { MobilePublicDoc } from '../../api/client';
import { tokens } from '../../design/tokens';
import { campusMessages } from '../../i18n/campus-messages';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from '../content/content-api';
import { docSummary, docTitle } from '../content/docs-model';
import { DocDetail } from '../content/DocDetail';
import { joinMeta } from '../content/content-rules';
import { ListFrame, useContentCopy } from '../content/content-ui';
import { previewDocs } from '../content/preview-data';
import { usePagedList } from '../content/use-paged-list';

/** Public documents: server-side search, paging and a published-revision detail view. */
export function DocsScreen(_props: MobileScreenProps) {
  const { locale } = useContentCopy();
  const copy = campusMessages[locale];
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
            <UiText variant="label">{docTitle(doc, locale)}</UiText>
            {docSummary(doc, locale) ? <UiText variant="bodySmall" tone="muted" numberOfLines={2}>{docSummary(doc, locale)}</UiText> : null}
            <UiText variant="meta" tone="muted">
              {joinMeta([doc.categoryId, fillCopy(copy.revision, { n: doc.publishedRevision })])}
            </UiText>
          </Card>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { minHeight: tokens.layout.touchTarget },
});
