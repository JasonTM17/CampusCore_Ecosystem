import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, UiText } from '../../components/Ui';
import { FilterChip, FilterSheet, SearchBar } from '../../components/ui/index';
import type { FilterValue } from '../../components/ui/index';
import type { MobilePublicAnnouncement } from '../../api/client';
import { tokens } from '../../design/tokens';
import { recordsMessages } from '../../i18n/records-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from './content-api';
import {
  ANNOUNCEMENT_CATEGORIES,
  filterByAnnouncementQuery,
  filterByPriority,
  joinMeta,
  publisherName,
  type AnnouncementCategory,
} from './content-rules';
import { ContentIconChip, ListFrame, StatusChip, useContentCopy } from './content-ui';
import { previewAnnouncements } from './preview-data';
import { htmlToPlainText } from './rich-text';
import { usePagedList } from './use-paged-list';

const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

/** Academic announcement inbox for the signed-in student: paged, category/search/priority filters, read in place. */
export function AnnouncementsScreen(_props: MobileScreenProps) {
  const { locale, formatDateTime, t } = useContentCopy();
  const copy = recordsMessages[locale];
  const [open, setOpen] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<FilterValue>({});
  const [category, setCategory] = useState<AnnouncementCategory>('ALL');
  const [search, setSearch] = useState('');
  const priorities = filter.priority ?? [];
  const filterLabel = priorities.length > 0 ? `${t('filters')} (${priorities.length})` : t('filters');
  const filterActive = category !== 'ALL' || search.trim().length > 0 || priorities.length > 0;

  const preview = useMemo(() => previewAnnouncements(locale), [locale]);
  const list = usePagedList<MobilePublicAnnouncement>({
    key: 'content.announcements',
    fetchPage: (page, limit, signal) => contentApi.announcementsInbox({ page, limit, signal }),
    keyOf: (item) => item.id,
    eager: filterActive,
    preview,
  });
  const rows = filterByAnnouncementQuery(filterByPriority(list.items, priorities), category, search);
  const resetFilters = () => {
    setCategory('ALL');
    setSearch('');
    setFilter({});
  };

  return (
    <>
      <ListFrame
        title={copy.announcementsTitle}
        eyebrow={copy.announcementsEyebrow}
        description={copy.announcementsDescription}
        list={list}
        items={rows}
        filtered={filterActive}
        keyOf={(item) => item.id}
        emptyTitle={copy.announcementsEmpty}
        emptyDescription={copy.announcementsEmptyDescription}
        emptyActionLabel={copy.announcementsCategories.ALL}
        onEmptyAction={resetFilters}
        header={(
          <View style={styles.controls}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChips}>
              {ANNOUNCEMENT_CATEGORIES.map((value) => (
                <FilterChip
                  key={value}
                  label={copy.announcementsCategories[value] ?? value}
                  selected={category === value}
                  onPress={() => setCategory(value)}
                />
              ))}
            </ScrollView>
            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder={copy.announcementsSearch}
              accessibilityLabel={copy.announcementsSearch}
              returnKeyType="search"
            />
            <Button
              label={filterLabel}
              accessibilityLabel={filterLabel}
              variant="secondary"
              onPress={() => setFilterOpen(true)}
            />
          </View>
        )}
        renderItem={(item) => {
          const expanded = open === item.id;
          return (
            <Card>
              <View style={styles.titleRow}>
                <ContentIconChip icon="bullhorn-outline" />
                <UiText variant="label" style={styles.title}>{item.title}</UiText>
              </View>
              <View style={styles.meta}>
                <StatusChip code={item.priority} labels={copy.priorityLabels} />
                <UiText variant="meta" tone="muted">
                  {joinMeta([item.publishAt ? formatDateTime(item.publishAt) : null, publisherName(item.lecturerDisplayName, item.publishedBy)])}
                </UiText>
              </View>
              {expanded ? <UiText variant="bodyLarge" style={styles.body}>{htmlToPlainText(item.content ?? item.summary)}</UiText> : null}
              <Button
                label={expanded ? copy.collapse : copy.expand}
                accessibilityLabel={`${expanded ? copy.collapse : copy.expand}: ${item.title}`}
                variant="text"
                onPress={() => setOpen(expanded ? null : item.id)}
              />
            </Card>
          );
        }}
      />
      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        groups={[{
          id: 'priority',
          label: copy.priorityFilter,
          multiple: true,
          options: PRIORITIES.map((value) => ({ value, label: copy.priorityLabels[value] ?? value })),
        }]}
        value={filter}
        onApply={setFilter}
      />
    </>
  );
}

const styles = StyleSheet.create({
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm },
  title: { flex: 1, minWidth: 0 },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginTop: tokens.spacing.sm },
  body: { marginTop: tokens.spacing.md },
  controls: { gap: tokens.spacing.sm },
  categoryChips: { flexDirection: 'row', gap: tokens.spacing.sm, paddingVertical: 1 },
});
