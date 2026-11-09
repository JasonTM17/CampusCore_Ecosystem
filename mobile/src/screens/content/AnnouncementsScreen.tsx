import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, UiText } from '../../components/Ui';
import { RichAttachments } from '../../components/content/rich-attachments';
import { RichContent } from '../../components/content/rich-content';
import { FilterChip, FilterSheet, SearchBar, StatusPill } from '../../components/ui/index';
import type { FilterValue } from '../../components/ui/index';
import type { MobilePublicAnnouncement } from '../../api/client';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { recordsMessages } from '../../i18n/records-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from './content-api';
import {
  ANNOUNCEMENT_CATEGORIES,
  extractNoticeAttachments,
  filterByAnnouncementQuery,
  filterByPriority,
  joinMeta,
  publisherName,
  type AnnouncementCategory,
} from './content-rules';
import { ContentIconChip, ListFrame, StatusChip, useContentCopy } from './content-ui';
import { previewAnnouncements } from './preview-data';
import { htmlToPlainText, isHtmlBody, summaryOrExcerpt } from './rich-text';
import { usePagedList } from './use-paged-list';

const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

/** Academic announcement inbox for the signed-in student: paged, category/search/priority filters, read in place. */
export function AnnouncementsScreen(_props: MobileScreenProps) {
  const { locale, formatDateTime, t } = useContentCopy();
  const { colors } = useTheme();
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
  const featured = filterActive ? null : rows[0] ?? null;
  const resetFilters = () => {
    setCategory('ALL');
    setSearch('');
    setFilter({});
  };

  const noticeBody = (item: MobilePublicAnnouncement, expanded: boolean) => {
    if (!expanded) return null;
    const body = item.content ?? item.summary;
    const attachments = extractNoticeAttachments(item.content);
    return (
      <>
        {isHtmlBody(body) ? (
          <RichContent html={body} style={styles.body} />
        ) : (
          <UiText variant="bodyLarge" style={styles.body}>{htmlToPlainText(body)}</UiText>
        )}
        <RichAttachments
          attachments={attachments}
          countLabel={copy.announcementsAttachmentCount.replace('{n}', String(attachments.length))}
          documentLabel={copy.announcementsDigitalDocument}
          heading={copy.announcementsAttachments}
        />
      </>
    );
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
          const publishLabel = item.publishAt ? formatDateTime(item.publishAt) : null;
          const publisher = publisherName(item.lecturerDisplayName, item.publishedBy);
          const meta = joinMeta([publishLabel, publisher]);
          const toggle = (
            <Button
              label={expanded ? copy.collapse : copy.expand}
              accessibilityLabel={`${expanded ? copy.collapse : copy.expand}: ${item.title}`}
              variant="text"
              onPress={() => setOpen(expanded ? null : item.id)}
            />
          );

          if (featured?.id === item.id) {
            const excerpt = summaryOrExcerpt(item);
            return (
              <View testID="announcement-featured">
                <Card style={styles.featuredCard}>
                  {item.coverImageUrl ? (
                    <Image
                      accessibilityLabel={item.title}
                      accessibilityRole="image"
                      resizeMode="cover"
                      source={{ uri: item.coverImageUrl }}
                      style={[styles.featuredCover, { backgroundColor: colors.surfaceLow }]}
                    />
                  ) : null}
                  <View style={styles.featuredBody}>
                    <View style={styles.featuredBadges}>
                      <StatusPill icon="star-four-points-outline" label={copy.announcementsFeatured} tone="primary" />
                      <StatusChip code={item.priority} labels={copy.priorityLabels} />
                    </View>
                    <UiText variant="headlineSmall">{item.title}</UiText>
                    {excerpt ? <UiText numberOfLines={3} variant="bodySmall" tone="muted">{excerpt}</UiText> : null}
                    <UiText variant="meta" tone="muted">{meta}</UiText>
                    {noticeBody(item, expanded)}
                    {toggle}
                  </View>
                </Card>
              </View>
            );
          }

          return (
            <Card>
              <View style={styles.titleRow}>
                <ContentIconChip icon="bullhorn-outline" />
                <UiText variant="label" style={styles.title}>{item.title}</UiText>
              </View>
              <View style={styles.meta}>
                <StatusChip code={item.priority} labels={copy.priorityLabels} />
                <UiText variant="meta" tone="muted">{meta}</UiText>
              </View>
              {noticeBody(item, expanded)}
              {toggle}
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
  featuredCard: { overflow: 'hidden', padding: 0 },
  featuredCover: { height: 180, width: '100%' },
  featuredBody: { gap: tokens.spacing.sm, padding: tokens.spacing.md },
  featuredBadges: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});
