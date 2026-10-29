import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, Card, StatePanel, UiText } from '../../components/Ui';
import { IconChip, Notice, SegmentedControl, StatusPill } from '../../components/ui/index';
import { ApiClientError, apiClient, campusApi } from '../../api/client';
import type { MobileNotification } from '../../api/client';
import type { PushApi } from '../../api/push-notifications';
import { resolveNotificationRoute } from '../../api/push-routes';
import { PUSH_OPT_IN_ENABLED } from '../../config/features';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { fillCopy } from '../../i18n/academic-messages';
import { notificationsCenterMessages } from '../../i18n/notifications-center-messages';
import { notificationsMessages } from '../../i18n/notifications-messages';
import { recordsMessages } from '../../i18n/records-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { useSession, type SessionValue } from '../../session/SessionContext';
import { contentApi } from '../content/content-api';
import { contentErrorMessage } from '../content/content-errors';
import { countUnread, joinMeta, notificationReadParam, type NotificationTab } from '../content/content-rules';
import { ListFrame, useConfirm, useContentCopy, useFlash } from '../content/content-ui';
import { previewNotifications } from '../content/preview-data';
import { useContentQuery } from '../content/use-content-query';
import { usePagedList } from '../content/use-paged-list';

/** Inbox row as the API returns it: the producer link rides along with the typed fields. */
type InboxNotification = MobileNotification & { link?: unknown };

/** Session read that yields null outside a provider instead of throwing (same hook order either way). */
function useOptionalSession(): SessionValue | null {
  try {
    return useSession();
  } catch {
    return null;
  }
}

/**
 * Notification centre: paged, unread filter, mark read, mark all and delete with confirmation.
 * A row that names a target opens it only through the route allowlist; offline the cached
 * rows stay readable and every mutation is blocked.
 */
export function NotificationsScreen({ navigation, role }: MobileScreenProps) {
  const { colors } = useTheme();
  const { locale, copy: shared, formatDateTime, t } = useContentCopy();
  const copy = recordsMessages[locale];
  const center = notificationsCenterMessages[locale];
  const pushMsg = notificationsMessages[locale];
  const session = useOptionalSession();
  const [tab, setTab] = useState<NotificationTab>('all');
  const [busy, setBusy] = useState(false);
  const { flash, success, fail } = useFlash();
  const { ask, dialog } = useConfirm();

  const preview = useMemo(() => previewNotifications(locale), [locale]);
  const list = usePagedList<InboxNotification>({
    key: `content.notifications.${tab}`,
    fetchPage: (page, limit, signal) => contentApi.notifications({ page, limit, signal, isRead: notificationReadParam(tab) }),
    keyOf: (item) => item.id,
    preview: tab === 'unread' ? preview.filter((item) => !item.isRead) : preview,
  });
  const unread = useContentQuery<number>('content.notifications.unread', () => contentApi.unreadCount());
  const unreadTotal = apiClient.mode === 'live' ? unread.data ?? countUnread(list.items) : countUnread(preview);
  const offline = apiClient.mode === 'live' && list.errorStatus === 0;

  const run = useCallback(async (action: () => Promise<unknown>, apply: () => void, ok: string | null) => {
    if (busy || offline || apiClient.mode !== 'live') return;
    setBusy(true);
    try {
      await action();
      apply();
      if (ok) success(ok);
      void unread.reload();
    } catch (error) {
      fail(contentErrorMessage(shared, error, copy.updateFailed));
    } finally {
      setBusy(false);
    }
  }, [busy, copy.updateFailed, fail, offline, shared, success, unread]);

  const markRead = (item: MobileNotification, announce = true) => {
    if (item.isRead) return;
    void run(
      () => contentApi.markNotificationRead(item.id),
      () => list.patch((row) => (row.id !== item.id ? row : tab === 'unread' ? null : { ...row, isRead: true })),
      announce ? copy.markRead : null,
    );
  };

  const openItem = (item: InboxNotification) => {
    if (typeof item.link !== 'string' || item.link.length === 0) {
      markRead(item);
      return;
    }
    const decision = resolveNotificationRoute(item.link, {
      kind: session?.kind ?? 'signedOut',
      role: session?.role ?? role,
      capabilities: session?.capabilities,
    });
    markRead(item, false);
    if (decision.action === 'refuse') {
      fail(pushMsg.openFailed);
    } else if (decision.lane) {
      navigation.navigateLane?.(decision.lane);
    } else if (decision.screen) {
      navigation.navigate(decision.screen, decision.topicId ? { thesisTopicId: decision.topicId } : undefined);
    }
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
        icon="bell-outline"
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
            {offline ? <Notice tone="info" message={center.offlineReadOnly} /> : null}
            <View style={styles.summary}>
              <UiText variant="label" tone="primary" accessibilityLiveRegion="polite">{fillCopy(copy.unreadCount, { n: unreadTotal })}</UiText>
              <Button
                label={copy.markAllRead}
                variant="secondary"
                loading={busy}
                disabled={busy || offline || list.preview || unreadTotal === 0}
                onPress={markAll}
              />
            </View>
            {PUSH_OPT_IN_ENABLED ? <PushOptInCard /> : null}
          </View>
        )}
        renderItem={(item) => {
          const hasLink = typeof item.link === 'string' && item.link.length > 0;
          return (
          <Card style={[styles.rowCard, !item.isRead ? { borderColor: colors.primaryFixed } : undefined]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={joinMeta([item.isRead ? null : copy.unread, item.title, item.message, formatDateTime(item.createdAt)])}
              accessibilityHint={hasLink ? center.openHint : item.isRead ? undefined : copy.markRead}
              disabled={list.preview || (!hasLink && (item.isRead || busy || offline))}
              onPress={() => openItem(item)}
              style={styles.rowMain}
            >
              <View style={styles.titleRow}>
                <IconChip icon={item.isRead ? 'bell-check-outline' : 'bell-ring-outline'} tone={item.isRead ? 'neutral' : 'primary'} />
                <UiText variant="label" tone={item.isRead ? 'default' : 'primary'} style={styles.title}>{item.title}</UiText>
              </View>
              {item.message ? <UiText variant="bodySmall" tone="muted">{item.message}</UiText> : null}
              <View style={styles.metaRow}>
                {item.isRead ? null : <StatusPill icon="circle-small" label={copy.unread} tone="primary" />}
                <UiText variant="meta" tone="muted">{formatDateTime(item.createdAt)}</UiText>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copy.deleteNotification}: ${item.title}`}
              accessibilityState={{ disabled: busy || offline || list.preview }}
              disabled={busy || offline || list.preview}
              onPress={() => remove(item)}
              style={({ pressed }) => [styles.rowDelete, pressed ? { backgroundColor: colors.surfaceLow } : undefined, busy || offline || list.preview ? { opacity: 0.4 } : undefined]}
            >
              <MaterialCommunityIcons color={colors.textMuted} name="trash-can-outline" size={20} />
            </Pressable>
          </Card>
          );
        }}
      />
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.spacing.sm },
  summary: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  rowCard: { position: 'relative', padding: tokens.spacing.md },
  rowIcon: { alignItems: 'center', borderRadius: tokens.radii.pill, height: 36, justifyContent: 'center', width: 36 },
  rowDelete: { position: 'absolute', right: tokens.spacing.sm, top: tokens.spacing.sm, alignItems: 'center', borderRadius: tokens.radii.control, height: tokens.layout.touchTarget, justifyContent: 'center', width: tokens.layout.touchTarget },
  rowMain: { gap: tokens.spacing.sm + tokens.spacing.xs, minHeight: tokens.layout.touchTarget },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, paddingRight: tokens.layout.touchTarget },
  title: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacing.sm },
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
