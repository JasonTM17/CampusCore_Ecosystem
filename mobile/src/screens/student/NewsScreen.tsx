import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, UiText } from '../../components/Ui';
import { FilterSheet } from '../../components/ui/index';
import type { FilterValue } from '../../components/ui/index';
import type { MobilePublicAnnouncement } from '../../api/client';
import { tokens } from '../../design/tokens';
import { campusMessages } from '../../i18n/campus-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from '../content/content-api';
import { filterByPriority, joinMeta } from '../content/content-rules';
import { ListFrame, StatusChip, useContentCopy } from '../content/content-ui';
import { NewsDetail } from '../content/NewsDetail';
import { previewNews } from '../content/preview-data';
import { excerptOf } from '../content/rich-text';
import { usePagedList } from '../content/use-paged-list';

const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

/** Public campus news: paged feed, priority filter and a detail view. */
export function NewsScreen(_props: MobileScreenProps) {
  const { locale, formatDate, t } = useContentCopy();
  const copy = campusMessages[locale];
  const [selected, setSelected] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<FilterValue>({});
  const priorities = filter.priority ?? [];

  const preview = useMemo(() => previewNews(locale), [locale]);
  const list = usePagedList<MobilePublicAnnouncement>({
    key: 'content.news',
    fetchPage: (page, limit, signal) => contentApi.news({ page, limit, signal }),
    keyOf: (item) => item.id,
    eager: priorities.length > 0,
    preview,
  });

  if (selected) return <NewsDetail idOrSlug={selected} onBack={() => setSelected(null)} />;

  const rows = filterByPriority(list.items, priorities);
  const groups = [{
    id: 'priority',
    label: copy.priority,
    multiple: true,
    options: PRIORITIES.map((value) => ({ value, label: copy.priorityLabels[value] ?? value })),
  }];

  return (
    <>
      <ListFrame
        title={copy.newsTitle}
        list={list}
        items={rows}
        filtered={priorities.length > 0}
        keyOf={(item) => item.id}
        emptyTitle={copy.emptyFeed}
        header={(
          <View style={styles.filterRow}>
            <Button
              label={priorities.length > 0 ? `${t('filters')} (${priorities.length})` : t('filters')}
              accessibilityLabel={t('filters')}
              variant="secondary"
              onPress={() => setFilterOpen(true)}
            />
          </View>
        )}
        renderItem={(item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={joinMeta([item.title, copy.priorityLabels[item.priority ?? ''] ?? item.priority, item.publishAt ? formatDate(item.publishAt) : null])}
            onPress={() => setSelected(item.slug ?? item.id)}
            style={styles.row}
          >
            <Card>
              <UiText variant="label">{item.title}</UiText>
              {item.summary || item.content ? (
                <UiText variant="bodySmall" tone="muted" numberOfLines={2}>{item.summary ?? excerptOf(item.content)}</UiText>
              ) : null}
              <View style={styles.meta}>
                <StatusChip code={item.priority} labels={copy.priorityLabels} />
                {item.publishAt ? <UiText variant="meta" tone="muted">{formatDate(item.publishAt)}</UiText> : null}
              </View>
            </Card>
          </Pressable>
        )}
      />
      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        groups={groups}
        value={filter}
        onApply={setFilter}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: tokens.layout.touchTarget },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginTop: tokens.spacing.xs },
  filterRow: { alignItems: 'flex-start' },
});
