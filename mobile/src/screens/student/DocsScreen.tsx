import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, UiText } from '../../components/Ui';
import { SearchBar, StatusPill } from '../../components/ui/index';
import type { MobilePublicDoc } from '../../api/client';
import { chromeFontScaleCap } from '../../design/font-scale';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';
import { campusMessages } from '../../i18n/campus-messages';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from '../content/content-api';
import { docCategoryLabel, docSummary, docTitle } from '../content/docs-model';
import { DocDetail } from '../content/DocDetail';
import { summaryRowAccessibilityLabel } from './summary-label';
import { ContentChevron, ContentIconChip, ListFrame, useContentCopy } from '../content/content-ui';
import { previewDocs } from '../content/preview-data';
import { usePagedList } from '../content/use-paged-list';

/** Public documents: server-side search, paging and a published-revision detail view. */
export function DocsScreen(_props: MobileScreenProps) {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ slug?: string | string[]; rev?: string | string[] }>();
  const routeSlugValue = Array.isArray(routeParams.slug) ? routeParams.slug[0] : routeParams.slug;
  const routeRevValue = Array.isArray(routeParams.rev) ? routeParams.rev[0] : routeParams.rev;
  const routeSlug = routeSlugValue && /^[a-z0-9][a-z0-9-]{0,239}$/.test(routeSlugValue)
    ? routeSlugValue : null;
  const parsedRouteRev = routeRevValue && /^[0-9]{1,10}$/.test(routeRevValue)
    ? Number(routeRevValue) : null;
  const routeRevision = parsedRouteRev !== null && Number.isSafeInteger(parsedRouteRev)
    ? parsedRouteRev : null;
  const { locale, formatDate } = useContentCopy();
  const { window } = useTheme();
  const largeText = window.fontScale >= chromeFontScaleCap;
  const copy = campusMessages[locale];
  const categoryLabels = copy.docCategoryLabels as Readonly<Record<string, string>>;
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(routeSlug);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(routeRevision);

  useEffect(() => {
    setSelected(routeSlug);
    setSelectedRevision(routeRevision);
  }, [routeSlug, routeRevision]);

  const preview = useMemo(() => previewDocs(locale), [locale]);
  const list = usePagedList<MobilePublicDoc>({
    key: `content.docs.${search}`,
    fetchPage: (page, limit, signal) => contentApi.docs({ page, limit, signal, search: search || undefined }),
    keyOf: (item) => item.slug,
    preview,
  });

  if (selected) return <DocDetail
    slug={selected}
    initialRevision={selectedRevision}
    onBack={() => { router.replace('/docs'); }}
  />;

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
      renderItem={(doc) => {
        const docSummaryText = docSummary(doc, locale);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={summaryRowAccessibilityLabel({
              title: docTitle(doc, locale),
              badge: fillCopy(copy.revision, { n: doc.publishedRevision }),
              date: doc.publishedAt ? formatDate(doc.publishedAt) : null,
              summary: docSummaryText,
            })}
            onPress={() => {
              router.replace({ pathname: '/docs', params: { slug: doc.slug } });
              setSelected(doc.slug);
              setSelectedRevision(null);
            }}
            style={styles.row}
          >
            <Card>
              <View style={styles.rowContent}>
                <ContentIconChip icon="file-document-outline" />
                <View style={styles.rowCopy}>
                  <UiText variant="label">{docTitle(doc, locale)}</UiText>
                  {docSummaryText ? <UiText ellipsizeMode="tail" variant="bodySmall" tone="muted" numberOfLines={largeText ? 4 : 2}>{docSummaryText}</UiText> : null}
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
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { minHeight: tokens.layout.touchTarget },
  rowContent: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});
