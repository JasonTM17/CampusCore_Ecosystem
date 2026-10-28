import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, UiText } from '../../components/Ui';
import { FilterSheet, SegmentedControl } from '../../components/ui/index';
import type { FilterValue } from '../../components/ui/index';
import { apiClient } from '../../api/client';
import type { MobileEvent, MobileEventRegistration } from '../../api/client';
import { tokens } from '../../design/tokens';
import { fillCopy } from '../../i18n/academic-messages';
import { eventsMessages } from '../../i18n/events-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from '../content/content-api';
import { contentErrorMessage, errorCode } from '../content/content-errors';
import { EVENT_FILTER_STATUSES, eventAction, filterByStatus, joinMeta } from '../content/content-rules';
import { ListFrame, StatusChip, useConfirm, useContentCopy, useFlash } from '../content/content-ui';
import { EventDetail } from '../content/EventDetail';
import { previewEvents, previewRegistrations } from '../content/preview-data';
import { usePagedList } from '../content/use-paged-list';

type Tab = 'catalog' | 'mine';

/** Student events: published catalogue, own registrations, register and cancel. The server owns every transition. */
export function EventsScreen(_props: MobileScreenProps) {
  const { locale, formatDateTime, copy: common, t } = useContentCopy();
  const copy = eventsMessages[locale];
  const labels = copy.statusLabels as Record<string, string>;
  const [tab, setTab] = useState<Tab>('catalog');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<FilterValue>({});
  const [busy, setBusy] = useState(false);
  const { flash, success, fail, clear } = useFlash();
  const { ask, dialog } = useConfirm();
  const statuses = filter.status ?? [];

  const previewList = useMemo(() => previewEvents(locale), [locale]);
  const catalog = usePagedList<MobileEvent>({
    key: 'content.events',
    fetchPage: (page, limit, signal) => contentApi.events({ page, limit, signal }),
    keyOf: (item) => item.id,
    eager: statuses.length > 0,
    preview: previewList,
  });
  const mine = usePagedList<MobileEventRegistration>({
    key: 'content.events.mine',
    fetchPage: (page, limit, signal) => contentApi.myEventRegistrations({ page, limit, signal }),
    keyOf: (item) => item.registrationId,
    preview: previewRegistrations,
  });

  const refreshAll = useCallback(() => {
    void catalog.reload();
    void mine.reload();
  }, [catalog, mine]);

  const run = useCallback(async (action: () => Promise<unknown>, ok: string, failed: string) => {
    if (busy || apiClient.mode !== 'live') return;
    setBusy(true);
    clear();
    try {
      await action();
      success(ok);
      refreshAll();
    } catch (error) {
      fail(errorCode(error) === 'EVENT_FULL' ? copy.full : contentErrorMessage(common, error, failed));
    } finally {
      setBusy(false);
    }
  }, [busy, clear, common, copy.full, fail, refreshAll, success]);

  const register = (event: MobileEvent) => void run(() => contentApi.registerEvent(event.id), copy.registered, copy.registerFailed);
  const cancel = (event: MobileEvent, registrationId: string) => ask({
    title: copy.cancelTitle,
    description: event.title,
    confirmLabel: copy.cancel,
    cancelLabel: copy.keep,
    destructive: true,
    onConfirm: () => void run(() => contentApi.cancelEventRegistration(registrationId), copy.cancelled, copy.cancelFailed),
  });

  const selected = selectedId ? catalog.items.find((item) => item.id === selectedId)
    ?? mine.items.find((item) => item.event.id === selectedId)?.event ?? null : null;
  if (selected) {
    return (
      <>
        <EventDetail
          event={selected}
          busy={busy}
          flash={flash}
          onBack={() => { setSelectedId(null); clear(); }}
          onRegister={register}
          onCancel={(event) => event.myRegistrationId && cancel(event, event.myRegistrationId)}
        />
        {dialog}
      </>
    );
  }

  const rows = filterByStatus(catalog.items, statuses);
  const actionButton = (event: MobileEvent, registrationId?: string | null) => {
    const action = eventAction(event);
    if (action === 'register') return <Button label={copy.register} accessibilityLabel={`${copy.register}: ${event.title}`} variant="secondary" disabled={busy || catalog.preview} onPress={() => register(event)} />;
    const id = registrationId ?? event.myRegistrationId;
    if (action === 'cancel' && id) return <Button label={copy.cancel} accessibilityLabel={`${copy.cancel}: ${event.title}`} variant="text" disabled={busy || catalog.preview} onPress={() => cancel(event, id)} />;
    if (action === 'full') return <UiText variant="meta" tone="warning">{copy.full}</UiText>;
    return null;
  };
  const eventMeta = (event: MobileEvent) => joinMeta([event.organizer, event.location, formatDateTime(event.startsAt)]);

  const tabs = (
    <View style={styles.header}>
      <SegmentedControl
        accessibilityLabel={copy.title}
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        options={[{ value: 'catalog', label: copy.published }, { value: 'mine', label: copy.mine }]}
      />
      {tab === 'catalog' ? (
        <View style={styles.filterRow}>
          <Button
            label={statuses.length > 0 ? `${t('filters')} (${statuses.length})` : t('filters')}
            accessibilityLabel={t('filters')}
            variant="secondary"
            onPress={() => setFilterOpen(true)}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      {tab === 'catalog' ? (
        <ListFrame
          title={copy.title}
          list={catalog}
          items={rows}
          filtered={statuses.length > 0}
          keyOf={(item) => item.id}
          emptyTitle={copy.empty}
          emptyFilteredTitle={copy.emptyFiltered}
          flash={flash}
          header={tabs}
          renderItem={(event) => (
            <Card>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={joinMeta([event.title, labels[event.status] ?? event.status, eventMeta(event), fillCopy(copy.seats, { n: Math.max(0, event.seatsRemaining) })])}
                onPress={() => setSelectedId(event.id)}
                style={styles.rowMain}
              >
                <UiText variant="label">{event.title}</UiText>
                <UiText variant="bodySmall" tone="muted">{eventMeta(event)}</UiText>
                <View style={styles.chips}>
                  <StatusChip code={event.myRegistrationStatus === 'REGISTERED' ? 'REGISTERED' : event.status} labels={labels} />
                  <UiText variant="meta" tone="muted">{fillCopy(copy.seats, { n: Math.max(0, event.seatsRemaining) })}</UiText>
                </View>
              </Pressable>
              {actionButton(event)}
            </Card>
          )}
        />
      ) : (
        <ListFrame
          title={copy.title}
          list={mine}
          keyOf={(item) => item.registrationId}
          emptyTitle={copy.noRegistrations}
          flash={flash}
          header={tabs}
          renderItem={(entry) => (
            <Card>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={joinMeta([entry.event.title, entry.attendanceStatus === 'ATTENDED' ? copy.attended : labels[entry.registrationStatus] ?? entry.registrationStatus, eventMeta(entry.event)])}
                onPress={() => setSelectedId(entry.event.id)}
                style={styles.rowMain}
              >
                <UiText variant="label">{entry.event.title}</UiText>
                <UiText variant="bodySmall" tone="muted">{eventMeta(entry.event)}</UiText>
                <View style={styles.chips}>
                  <StatusChip code={entry.attendanceStatus === 'ATTENDED' ? 'ATTENDED' : entry.registrationStatus} labels={labels} />
                </View>
              </Pressable>
              {entry.registrationStatus === 'REGISTERED'
                ? actionButton({ ...entry.event, myRegistrationStatus: 'REGISTERED', myRegistrationId: entry.registrationId }, entry.registrationId)
                : null}
            </Card>
          )}
        />
      )}
      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        groups={[{
          id: 'status',
          label: copy.statusFilter,
          multiple: true,
          options: EVENT_FILTER_STATUSES.map((value) => ({ value, label: labels[value] ?? value })),
        }]}
        value={filter}
        onApply={setFilter}
      />
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.spacing.sm },
  filterRow: { alignItems: 'flex-start' },
  rowMain: { gap: tokens.spacing.xs, minHeight: tokens.layout.touchTarget },
  chips: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});
