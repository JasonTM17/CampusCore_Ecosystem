import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Card, UiText } from '../../components/Ui';
import { FilterChip, StatusPill } from '../../components/ui/index';
import type { MobilePublicAnnouncement } from '../../api/client';
import { chromeFontScaleCap } from '../../design/font-scale';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';
import { campusMessages } from '../../i18n/campus-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from '../content/content-api';
import { filterByPriority, newsCategoryLabel, publisherName } from '../content/content-rules';
import { ContentChevron, ContentIconChip, ListFrame, StatusChip, useContentCopy } from '../content/content-ui';
import { NewsDetail } from '../content/NewsDetail';
import { previewNews } from '../content/preview-data';
import { formatRelativeTime } from '../content/relative-time';
import { excerptOf } from '../content/rich-text';
import { usePagedList } from '../content/use-paged-list';
import { summaryRowAccessibilityLabel } from './summary-label';

const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

/** Public campus news: paged feed, priority filter and a detail view. */
export const NewsScreen = memo(function NewsScreen(_props: MobileScreenProps) {
  const { locale } = useContentCopy();
  const { window } = useTheme();
  const largeText = window.fontScale >= chromeFontScaleCap;
  const copy = campusMessages[locale];
  const categoryLabels = copy.newsCategoryLabels as Readonly<Record<string, string>>;
  const params = useLocalSearchParams<{ focus?: string }>();
  const [selected, setSelected] = useState<string | null>(() => (typeof params.focus === 'string' && params.focus.trim() ? params.focus.trim() : null));
  const [filter, setFilter] = useState<{ priority?: string[] }>({});
  const priorities = filter.priority ?? [];

  const preview = useMemo(() => previewNews(locale), [locale]);
  const list = usePagedList<MobilePublicAnnouncement>({
    key: 'content.news',
    fetchPage: (page, limit, signal) => contentApi.news({ page, limit, signal }),
    keyOf: (item) => item.id,
    eager: priorities.length > 0,
    preview,
  });

  useEffect(() => {
    setSelected(typeof params.focus === 'string' && params.focus.trim() ? params.focus.trim() : null);
  }, [params.focus]);

  if (selected) return <NewsDetail idOrSlug={selected} onBack={() => setSelected(null)} />;

  const rows = filterByPriority(list.items, priorities);
  const togglePriority = (value: string) => setFilter((current) => {
    const currentValues = current.priority ?? [];
    return { priority: currentValues.includes(value) ? currentValues.filter((item) => item !== value) : [...currentValues, value] };
  });

  return (
    <>
      <ListFrame
        title={copy.newsTitle}
        description={copy.newsSubtitle}
        icon="newspaper-variant-outline"
        list={list}
        items={rows}
        filtered={priorities.length > 0}
        keyOf={(item) => item.id}
        emptyTitle={copy.emptyFeed}
        errorTitle={copy.newsLoadErrorTitle}
        errorDescription={copy.newsLoadError}
        header={(
          <View style={styles.filters}>
            <UiText variant="meta" tone="muted">{copy.priority}</UiText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips}>
              {PRIORITIES.map((value) => (
                <FilterChip
                  key={value}
                  label={copy.priorityLabels[value] ?? value}
                  selected={priorities.includes(value)}
                  onPress={() => togglePriority(value)}
                />
              ))}
            </ScrollView>
          </View>
        )}
        renderItem={(item) => {
          const summaryText = item.summary ?? (item.content ? excerptOf(item.content) : null);
          const category = newsCategoryLabel(categoryLabels, item.categoryId);
          const dateLabel = formatRelativeTime(item.publishAt ?? item.createdAt, locale);
          const publisher = publisherName(item.lecturerDisplayName, item.publishedBy);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={summaryRowAccessibilityLabel({
                title: item.title,
                badge: copy.priorityLabels[item.priority ?? ''] ?? item.priority,
                date: dateLabel || null,
                summary: summaryText,
              })}
              onPress={() => setSelected(item.slug ?? item.id)}
              style={styles.row}
            >
              <Card>
                <View style={styles.rowContent}>
                  <ContentIconChip icon="newspaper-variant-outline" />
                  <View style={styles.rowCopy}>
                    <UiText variant="label">{item.title}</UiText>
                    {summaryText ? (
                      <UiText ellipsizeMode="tail" variant="bodySmall" tone="muted" numberOfLines={largeText ? 4 : 2}>{summaryText}</UiText>
                    ) : null}
                    <View style={styles.meta}>
                      <StatusChip code={item.priority} labels={copy.priorityLabels} />
                      {category ? <StatusPill label={category} tone="neutral" /> : null}
                      {dateLabel ? <UiText variant="meta" tone="muted">{dateLabel}</UiText> : null}
                    </View>
                    <View style={styles.footer}>
                      {publisher ? <UiText variant="meta" tone="muted" style={styles.publisher}>{publisher}</UiText> : null}
                      <UiText variant="label" tone="primary" style={styles.readMore}>{copy.readMore}</UiText>
                    </View>
                  </View>
                  <ContentChevron />
                </View>
              </Card>
            </Pressable>
          );
        }}
      />
    </>
  );
});

const styles = StyleSheet.create({
  row: { minHeight: tokens.layout.touchTarget },
  rowContent: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  footer: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  publisher: { flexShrink: 1 },
  readMore: { marginLeft: 'auto' },
  filters: { gap: tokens.spacing.xs },
  filterChips: { flexDirection: 'row', gap: tokens.spacing.sm, paddingVertical: 1 },
});
