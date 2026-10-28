import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, UiText } from '../../components/Ui';
import { FilterSheet } from '../../components/ui/index';
import type { FilterValue } from '../../components/ui/index';
import type { MobilePublicAnnouncement } from '../../api/client';
import { tokens } from '../../design/tokens';
import { recordsMessages } from '../../i18n/records-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from './content-api';
import { filterByPriority, joinMeta } from './content-rules';
import { ListFrame, StatusChip, useContentCopy } from './content-ui';
import { previewAnnouncements } from './preview-data';
import { htmlToPlainText } from './rich-text';
import { usePagedList } from './use-paged-list';

const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

/** Academic announcement inbox for the signed-in student: paged, priority filter, read in place. */
export function AnnouncementsScreen(_props: MobileScreenProps) {
  const { locale, formatDateTime, t } = useContentCopy();
  const copy = recordsMessages[locale];
  const [open, setOpen] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<FilterValue>({});
  const priorities = filter.priority ?? [];

  const preview = useMemo(() => previewAnnouncements(locale), [locale]);
  const list = usePagedList<MobilePublicAnnouncement>({
    key: 'content.announcements',
    fetchPage: (page, limit, signal) => contentApi.announcementsInbox({ page, limit, signal }),
    keyOf: (item) => item.id,
    eager: priorities.length > 0,
    preview,
  });
  const rows = filterByPriority(list.items, priorities);

  return (
    <>
      <ListFrame
        title={copy.announcementsTitle}
        list={list}
        items={rows}
        filtered={priorities.length > 0}
        keyOf={(item) => item.id}
        emptyTitle={copy.announcementsEmpty}
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
        renderItem={(item) => {
          const expanded = open === item.id;
          return (
            <Card>
              <UiText variant="label">{item.title}</UiText>
              <View style={styles.meta}>
                <StatusChip code={item.priority} labels={copy.priorityLabels} />
                <UiText variant="meta" tone="muted">
                  {joinMeta([item.publishAt ? formatDateTime(item.publishAt) : null, item.lecturerDisplayName ?? item.publishedBy])}
                </UiText>
              </View>
              {expanded ? <UiText variant="bodyMedium">{htmlToPlainText(item.content ?? item.summary)}</UiText> : null}
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
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginVertical: tokens.spacing.xs },
  filterRow: { alignItems: 'flex-start' },
});
