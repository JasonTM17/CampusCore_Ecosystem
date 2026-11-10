import { useCallback, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, Card, StatePanel, UiText } from '../../components/Ui';
import { IconChip, Notice, SegmentedControl, StatusPill } from '../../components/ui/index';
import { ApiClientError, apiClient, campusApi } from '../../api/client';
import type { MobileNotification } from '../../api/client';
import type { PushApi } from '../../api/push-notifications';
import { resolveNotificationRoute } from '../../api/push-routes';
import { PUSH_OPT_IN_ENABLED } from '../../config/features';
import { minTapTarget, tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { useOptimisticRows } from '../../hooks/use-optimistic-rows';
import { evictQueryCache, queryCacheKey, writeQueryCache } from '../../hooks/query-cache';
import { fillCopy } from '../../i18n/academic-messages';
import { checkinMessages } from '../../i18n/checkin-messages';
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
import { stripNotificationTagPrefix } from './notification-title';

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
  // The unread page is a PagedResult; its count must never share that cache key.
  const unread = useContentQuery<number>('content.notifications.unread-count', () => contentApi.unreadCount());
  const loadedUnread = countUnread(list.items);
  const unreadTotal = apiClient.mode === 'live'
    ? (unread.data ?? (list.hasMore ? `${loadedUnread}+` : loadedUnread))
    : countUnread(preview);
  const unreadCountLabel = apiClient.mode === 'live' && unread.data == null && list.hasMore && loadedUnread === 0
    ? copy.unreadCountUnknown
    : fillCopy(copy.unreadCount, { n: unreadTotal });
  const hasUnread = apiClient.mode === 'live'
    ? (unread.data != null ? unread.data > 0 : (loadedUnread > 0 || list.hasMore))
    : countUnread(preview) > 0;
  const offline = apiClient.mode === 'live' && list.errorStatus === 0;
  const cacheScope = { locale, roleLane: session?.role ?? role, grants: session?.capabilities ?? [] };
  const identity = JSON.stringify([session?.accountId, locale, session?.role ?? role, cacheScope.grants, session?.epoch, tab]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const busyRef = useRef(false);
  const { rows: optimisticRows, begin } = useOptimisticRows(list.items, identity);

  const run = useCallback(async (
    action: () => Promise<unknown>,
    transform: (row: InboxNotification) => InboxNotification | null,
    ok: string | null | ((result: unknown) => string | null),
  ) => {
    if (busyRef.current || offline || apiClient.mode !== 'live') return;
    busyRef.current = true;
    setBusy(true);
    const rollback = begin(transform);
    try {
      const result = await action();
      if (identityRef.current !== identity) return;
      list.patch(transform);
      for (const resource of ['content.notifications.all', 'content.notifications.unread', 'content.notifications.unread-count']) {
        evictQueryCache(queryCacheKey(session?.accountId ?? null, resource, cacheScope));
      }
      const okMessage = typeof ok === 'function' ? ok(result) : ok;
      if (okMessage) success(okMessage);
      // Read the count outside the screen's own query: opening a notification
      // navigates away, and a write to the shared cache still reaches the badge
      // in the app shell, which a reload from an unmounted screen never would.
      const unreadKey = queryCacheKey(session?.accountId ?? null, 'content.notifications.unread-count', cacheScope);
      void contentApi.unreadCount()
        .then((count) => { if (identityRef.current === identity) writeQueryCache(unreadKey, count); })
        .catch(() => undefined);
    } catch (error) {
      if (identityRef.current === identity) fail(contentErrorMessage(shared, error, copy.updateFailed));
    } finally {
      rollback();
      busyRef.current = false;
      setBusy(false);
    }
  }, [begin, cacheScope, copy.updateFailed, fail, identity, list, offline, session?.accountId, shared, success]);

  const markRead = (item: MobileNotification, announce = true) => {
    if (item.isRead) return;
    void run(
      () => contentApi.markNotificationRead(item.id),
      (row) => (row.id !== item.id ? row : tab === 'unread' ? null : { ...row, isRead: true }),
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
    description: stripNotificationTagPrefix(item.title),
    confirmLabel: copy.deleteNotification,
    cancelLabel: copy.keep,
    destructive: true,
    onConfirm: () => void run(
      () => contentApi.deleteNotification(item.id),
      (row) => (row.id === item.id ? null : row),
      copy.deleted,
    ),
  });

  const markAll = () => ask({
    title: copy.markAllTitle,
    confirmLabel: copy.markAllRead,
    cancelLabel: t('cancel'),
    onConfirm: () => void run(
      () => contentApi.markAllNotificationsRead(),
      (row) => (tab === 'unread' ? null : { ...row, isRead: true }),
      (result) => {
        const updated = typeof (result as { updated?: number })?.updated === 'number'
          ? (result as { updated: number }).updated
          : 0;
        if (updated <= 0) return copy.markedAll;
        return fillCopy(updated === 1 ? copy.markedAllOne : copy.markedAllCount, { n: updated });
      },
    ),
  });

  const tabCounts = useMemo(() => {
    const allCount = list.total ?? list.items.length;
    const unreadTabCount = apiClient.mode === 'live' && unread.data != null
      ? unread.data
      : loadedUnread;
    return { all: allCount, unread: unreadTabCount };
  }, [list.total, list.items.length, loadedUnread, unread.data]);

  const tabOptions = useMemo(
    () => ([
      { value: 'all', label: `${copy.tabAll} (${tabCounts.all})` },
      { value: 'unread', label: `${copy.tabUnread} (${tabCounts.unread})` },
    ]),
    [copy.tabAll, copy.tabUnread, tabCounts.all, tabCounts.unread],
  );

  return (
    <>
      <ListFrame
        title={copy.notificationsTitle}
        description={copy.notificationsDescription}
        icon="bell-outline"
        list={list}
        items={optimisticRows}
        keyOf={(item) => item.id}
        emptyTitle={tab === 'unread' ? copy.notificationsUnreadEmpty : copy.notificationsEmpty}
        emptyActionLabel={copy.openDashboard}
        onEmptyAction={() => navigation.navigate('dashboard.student')}
        flash={flash}
        header={(
          <View style={styles.header}>
            <SegmentedControl
              accessibilityLabel={copy.notificationsTitle}
              value={tab}
              onChange={(value) => setTab(value as NotificationTab)}
              options={tabOptions}
            />
            {offline ? <Notice tone="info" message={center.offlineReadOnly} /> : null}
            <View style={styles.summary}>
              <UiText variant="label" tone="primary" accessibilityLiveRegion="polite">{unreadCountLabel}</UiText>
              <View style={styles.summaryActions}>
                <Button
                  label={center.refresh}
                  variant="secondary"
                  icon="refresh"
                  loading={list.refreshing}
                  disabled={busy || offline || list.preview || list.refreshing}
                  onPress={() => void list.refresh()}
                />
                <Button
                  label={copy.markAllRead}
                  variant="secondary"
                  loading={busy}
                  disabled={busy || offline || list.preview || !hasUnread}
                  onPress={markAll}
                />
              </View>
            </View>
            {PUSH_OPT_IN_ENABLED ? <PushOptInCard /> : null}
          </View>
        )}
        renderItem={(item) => {
          const hasLink = typeof item.link === 'string' && item.link.length > 0;
          const title = stripNotificationTagPrefix(item.title);
          return (
          <Card style={[styles.rowCard, !item.isRead ? { borderColor: colors.primaryFixed } : undefined]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={joinMeta([item.isRead ? copy.read : copy.unread, title, item.message, formatDateTime(item.createdAt)])}
              accessibilityHint={hasLink ? center.openHint : item.isRead ? undefined : copy.markRead}
              disabled={list.preview || (!hasLink && (item.isRead || busy || offline))}
              onPress={() => openItem(item)}
              style={styles.rowMain}
            >
              <View style={styles.titleRow}>
                <IconChip icon={item.isRead ? 'bell-check-outline' : 'bell-ring-outline'} tone={item.isRead ? 'neutral' : 'primary'} />
                <UiText variant="label" tone={item.isRead ? 'default' : 'primary'} style={styles.title}>{title}</UiText>
              </View>
              {item.message ? <UiText variant="bodySmall" tone="muted">{item.message}</UiText> : null}
              <View style={styles.metaRow}>
                {item.isRead ? null : <StatusPill icon="circle-small" label={copy.unread} tone="info" />}
                <UiText variant="meta" tone="muted">{formatDateTime(item.createdAt)}</UiText>
              </View>
            </Pressable>
            <View style={styles.rowFooter}>
              {hasLink ? (
                <Button
                  label={center.openRelated}
                  variant="text"
                  disabled={busy || offline || list.preview}
                  onPress={() => openItem(item)}
                />
              ) : null}
              {item.isRead ? (
                <UiText variant="meta" tone="muted">{copy.read}</UiText>
              ) : (
                <Button
                  label={copy.markRead}
                  variant="text"
                  disabled={busy || offline || list.preview}
                  onPress={() => markRead(item)}
                />
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copy.deleteNotification}: ${title}`}
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
  summaryActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, justifyContent: 'flex-end' },
  rowCard: { position: 'relative', padding: tokens.spacing.md },
  rowIcon: { alignItems: 'center', borderRadius: tokens.radii.control, height: 36, justifyContent: 'center', width: 36 },
  rowDelete: { position: 'absolute', right: tokens.spacing.sm, top: tokens.spacing.sm, alignItems: 'center', borderRadius: tokens.radii.control, height: minTapTarget, justifyContent: 'center', width: minTapTarget },
  rowMain: { gap: tokens.spacing.sm + tokens.spacing.xs, minHeight: minTapTarget },
  rowFooter: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, minHeight: tokens.spacing.lg },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, paddingRight: minTapTarget },
  title: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacing.sm },
});

type PushOptInStatus = 'idle' | 'registered' | 'denied' | 'unavailable' | 'failed';

function PushOptInCard() {
  const { locale, t } = useContentCopy();
  const pushMsg = notificationsMessages[locale];
  const checkinCopy = checkinMessages[locale];
  const [status, setStatus] = useState<PushOptInStatus>('idle');
  const [denialBlocked, setDenialBlocked] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  if (!PUSH_OPT_IN_ENABLED) return null;

  const onEnable = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setStatus('idle');
    try {
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
      // Lazy requires keep the expo-notifications adapter out of app startup
      // while the opt-in flag is off.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createPushNotificationClient } = require('../../api/push-notifications') as typeof import('../../api/push-notifications');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { expoPushPlatform } = require('../../api/expo-push-platform') as typeof import('../../api/expo-push-platform');
      const result = await createPushNotificationClient(expoPushPlatform, api).register(true);
      if (result.status === 'registered') setStatus('registered');
      else if (result.status === 'permission-denied') {
        setStatus('denied');
        // A denial the OS marked final (canAskAgain === false) can only be
        // undone in device settings; anything else may still prompt.
        const permission = await expoPushPlatform.getPermissionsAsync().catch(() => null);
        setDenialBlocked(permission?.canAskAgain === false);
      }
      else if (result.status === 'unavailable') setStatus('unavailable');
      else if (lastError instanceof ApiClientError && lastError.status === 503) setStatus('unavailable');
      else setStatus('failed');
    } catch {
      setStatus('failed');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  if (status === 'idle') {
    return (
      <Card tone="low">
        <UiText variant="label">{pushMsg.permissionTitle}</UiText>
        <UiText variant="bodySmall" tone="muted">{pushMsg.permissionRationale}</UiText>
        <Button label={pushMsg.enableAction} onPress={() => void onEnable()} variant="secondary" loading={pending} disabled={pending} />
      </Card>
    );
  }
  const message = status === 'registered' ? pushMsg.permissionTitle
    : status === 'denied' ? pushMsg.permissionDenied
    : status === 'unavailable' ? pushMsg.unavailable
    : pushMsg.registrationFailed;
  const action = status === 'denied'
    ? denialBlocked
      ? { label: checkinCopy.openSettings, run: () => { void Linking.openSettings().catch(() => undefined); } }
      : { label: t('retry'), run: () => { void onEnable(); } }
    : status === 'failed'
      ? { label: t('retry'), run: () => { void onEnable(); } }
      : null;
  return (
    <StatePanel
      kind={status === 'registered' ? 'empty' : 'error'}
      title={message}
      actionLabel={action?.label}
      onAction={action?.run}
    />
  );
}
