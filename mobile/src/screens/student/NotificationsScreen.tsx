import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, StatePanel, UiText } from '../../components/Ui';
import { SegmentedControl } from '../../components/ui/index';
import { ApiClientError, apiClient, campusApi } from '../../api/client';
import type { MobileNotification } from '../../api/client';
import type { PushApi } from '../../api/push-notifications';
import { PUSH_OPT_IN_ENABLED } from '../../config/features';
import { tokens } from '../../design/tokens';
import { fillCopy } from '../../i18n/academic-messages';
import { notificationsMessages } from '../../i18n/notifications-messages';
import { recordsMessages } from '../../i18n/records-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { contentApi } from '../content/content-api';
import { contentErrorMessage } from '../content/content-errors';
import { countUnread, joinMeta, notificationReadParam, type NotificationTab } from '../content/content-rules';
import { ListFrame, useConfirm, useContentCopy, useFlash } from '../content/content-ui';
import { previewNotifications } from '../content/preview-data';
import { useContentQuery } from '../content/use-content-query';
import { usePagedList } from '../content/use-paged-list';

/** Notification centre: paged, unread filter, mark read, mark all and delete with confirmation. */
export function NotificationsScreen(_props: MobileScreenProps) {
  const { locale, copy: shared, formatDateTime, t } = useContentCopy();
  const copy = recordsMessages[locale];
  const [tab, setTab] = useState<NotificationTab>('all');
  const [busy, setBusy] = useState(false);
  const { flash, success, fail } = useFlash();
  const { ask, dialog } = useConfirm();

  const preview = useMemo(() => previewNotifications(locale), [locale]);
  const list = usePagedList<MobileNotification>({
    key: `content.notifications.${tab}`,
    fetchPage: (page, limit, signal) => contentApi.notifications({ page, limit, signal, isRead: notificationReadParam(tab) }),
    keyOf: (item) => item.id,
    preview: tab === 'unread' ? preview.filter((item) => !item.isRead) : preview,
  });
  const unread = useContentQuery<number>('content.notifications.unread', () => contentApi.unreadCount());
  const unreadTotal = apiClient.mode === 'live' ? unread.data ?? countUnread(list.items) : countUnread(preview);

  const run = useCallback(async (action: () => Promise<unknown>, apply: () => void, ok: string) => {
    if (busy || apiClient.mode !== 'live') return;
    setBusy(true);
    try {
      await action();
      apply();
      success(ok);
      void unread.reload();
    } catch (error) {
      fail(contentErrorMessage(shared, error, copy.updateFailed));
    } finally {
      setBusy(false);
    }
  }, [busy, copy.updateFailed, fail, shared, success, unread]);

  const markRead = (item: MobileNotification) => {
    if (item.isRead) return;
    void run(
      () => contentApi.markNotificationRead(item.id),
      () => list.patch((row) => (row.id !== item.id ? row : tab === 'unread' ? null : { ...row, isRead: true })),
      copy.markRead,
    );
  };

  const remove = (item: MobileNotification) => ask({
    title: copy.deleteTitle,
    description: item.title,
    confirmLabel: copy.deleteNotification,
    cancelLabel: copy.keep,
    destructive: true,
    onConfirm: () => void run(
      () => contentApi.deleteNotification(item.id),
      () => list.patch((row) => (row.id === item.id ? null : row)),
      copy.deleted,
    ),
  });

  const markAll = () => ask({
    title: copy.markAllTitle,
    confirmLabel: copy.markAllRead,
    cancelLabel: t('cancel'),
    onConfirm: () => void run(
      () => contentApi.markAllNotificationsRead(),
      () => list.patch((row) => (tab === 'unread' ? null : { ...row, isRead: true })),
      copy.markedAll,
    ),
  });

  return (
    <>
      <ListFrame
        title={copy.notificationsTitle}
        list={list}
        keyOf={(item) => item.id}
        emptyTitle={tab === 'unread' ? copy.notificationsUnreadEmpty : copy.notificationsEmpty}
        flash={flash}
        header={(
          <View style={styles.header}>
            <SegmentedControl
              accessibilityLabel={copy.notificationsTitle}
              value={tab}
              onChange={(value) => setTab(value as NotificationTab)}
              options={[{ value: 'all', label: copy.tabAll }, { value: 'unread', label: copy.tabUnread }]}
            />
            <View style={styles.summary}>
              <UiText variant="label" tone="primary" accessibilityLiveRegion="polite">{fillCopy(copy.unreadCount, { n: unreadTotal })}</UiText>
              <Button
                label={copy.markAllRead}
                variant="secondary"
                loading={busy}
                disabled={busy || list.preview || unreadTotal === 0}
                onPress={markAll}
              />
            </View>
            {PUSH_OPT_IN_ENABLED ? <PushOptInCard /> : null}
          </View>
        )}
        renderItem={(item) => (
          <Card tone={item.isRead ? 'card' : 'low'}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={joinMeta([item.isRead ? null : copy.unread, item.title, item.message, formatDateTime(item.createdAt)])}
              accessibilityHint={item.isRead ? undefined : copy.markRead}
              disabled={item.isRead || busy || list.preview}
              onPress={() => markRead(item)}
              style={styles.rowMain}
            >
              <View style={styles.titleRow}>
                <UiText variant="label" tone={item.isRead ? 'default' : 'primary'} style={styles.title}>{item.title}</UiText>
                {item.isRead ? null : <UiText variant="meta" tone="primary">{copy.unread}</UiText>}
              </View>
              {item.message ? <UiText variant="bodySmall" tone="muted">{item.message}</UiText> : null}
              <UiText variant="meta" tone="muted">{formatDateTime(item.createdAt)}</UiText>
            </Pressable>
            <Button
              label={copy.deleteNotification}
              accessibilityLabel={`${copy.deleteNotification}: ${item.title}`}
              variant="text"
              disabled={busy || list.preview}
              onPress={() => remove(item)}
            />
          </Card>
        )}
      />
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.spacing.sm },
  summary: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  rowMain: { gap: tokens.spacing.xs, minHeight: tokens.layout.touchTarget },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm },
  title: { flex: 1 },
});

type PushOptInStatus = 'idle' | 'registered' | 'denied' | 'unavailable' | 'failed';

function PushOptInCard() {
  const { locale } = useContentCopy();
  const pushMsg = notificationsMessages[locale];
  const [status, setStatus] = useState<PushOptInStatus>('idle');
  if (!PUSH_OPT_IN_ENABLED) return null;

  const onEnable = async () => {
    let lastError: unknown = null;
    const api: PushApi = {
      registerPushDevice: async (installationId, body) => {
        try {
          return await campusApi.registerPushDevice(installationId, body);
        } catch (error) {
          lastError = error;
          throw error;
        }
      },
      unregisterPushDevice: (installationId) => campusApi.unregisterPushDevice(installationId),
    };
    // Dynamic imports keep the expo-notifications adapter out of app startup
    // while the opt-in flag is off.
    const [{ createPushNotificationClient }, { expoPushPlatform }] = await Promise.all([
      import('../../api/push-notifications'),
      import('../../api/expo-push-platform'),
    ]);
    const result = await createPushNotificationClient(expoPushPlatform, api).register(true);
    if (result.status === 'registered') setStatus('registered');
    else if (result.status === 'permission-denied') setStatus('denied');
    else if (result.status === 'unavailable') setStatus('unavailable');
    else if (lastError instanceof ApiClientError && lastError.status === 503) setStatus('unavailable');
    else setStatus('failed');
  };

  if (status === 'idle') {
    return (
      <Card tone="low">
        <UiText variant="label">{pushMsg.permissionTitle}</UiText>
        <UiText variant="bodySmall" tone="muted">{pushMsg.permissionRationale}</UiText>
        <Button label={pushMsg.enableAction} onPress={() => void onEnable()} variant="secondary" />
      </Card>
    );
  }
  const message = status === 'registered' ? pushMsg.permissionTitle
    : status === 'denied' ? pushMsg.permissionDenied
    : status === 'unavailable' ? pushMsg.unavailable
    : pushMsg.registrationFailed;
  return <StatePanel kind={status === 'registered' ? 'empty' : 'error'} title={message} />;
}
