import { useState } from 'react';
import { View } from 'react-native';

import {
  Button,
  Card,
  DataNotice,
  Divider,
  ListRow,
  ScreenShell,
  ScreenSpacer,
  StatePanel,
  UiText,
} from '../../components/Ui';
import type { MobileScreenProps } from '../../navigation/types';
import { useLiveResource } from './shared/useLiveResource';
import { studentFriendlyErrorMessage } from './shared/errors';
import { previewNotifications } from './shared/preview';
import { ApiClientError, apiClient, campusApi } from '../../api/client';
import type { MobileNotification } from '../../api/client';
import type { PushApi } from '../../api/push-notifications';
import { PUSH_OPT_IN_ENABLED } from '../../config/features';
import { notificationsMessages } from '../../i18n/notifications-messages';
import { useStudentStyles } from './shared/styles';

export function NotificationsScreen({ navigation }: MobileScreenProps) {
  const styles = useStudentStyles();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const {
    data: liveNotifications,
    error,
    warning,
    isLoading,
    reload,
    setData: setLiveNotifications,
  } = useLiveResource<MobileNotification[]>(
    'notifications',
    [],
    async () => (await campusApi.notifications()).data,
    'Notifications are unavailable.',
  );
  const visibleNotifications = apiClient.mode === 'preview'
    ? previewNotifications.map((item, index) => ({ id: String(index), title: item.title, message: item.subtitle, createdAt: item.meta, isRead: !item.unread }))
    : liveNotifications;

  const markRead = async (id: string) => {
    if (apiClient.mode === 'preview') return;
    setBusyId(id);
    setMutationError(null);
    try {
      await campusApi.markNotificationRead(id);
      setLiveNotifications((current) => current.map((item) => (
        item.id === id ? { ...item, isRead: true } : item
      )));
    } catch (nextError) {
      setMutationError(studentFriendlyErrorMessage(nextError, 'Notification could not be updated.'));
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    if (apiClient.mode === 'preview') return;
    setIsMarkingAll(true);
    setMutationError(null);
    try {
      await campusApi.markAllNotificationsRead();
      setLiveNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
    } catch (nextError) {
      setMutationError(studentFriendlyErrorMessage(nextError, 'Notifications could not be updated.'));
    } finally {
      setIsMarkingAll(false);
    }
  };

  if (isLoading || error) {
    return (
      <ScreenShell title="Notifications" eyebrow="Stay informed" subtitle="Account alerts and academic updates.">
        <StatePanel
          kind={isLoading ? 'loading' : 'error'}
          title={isLoading ? 'Loading notifications…' : 'Notifications unavailable'}
          description={error ?? 'Retrieving your latest updates.'}
          actionLabel={error ? 'Try again' : undefined}
          onAction={error ? () => void reload() : undefined}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Notifications" eyebrow="Stay informed" subtitle="Unread items are marked clearly for continuity.">
      {warning ? <DataNotice message={warning} /> : null}
      <Card tone="low" style={styles.notificationSummary}>
        <View accessibilityLiveRegion="polite">
          <UiText variant="label" tone="primary">{visibleNotifications.filter((item) => !item.isRead).length} unread updates</UiText>
          <UiText variant="bodySmall" tone="muted">Your next action is thesis registration.</UiText>
        </View>
      </Card>
      <ScreenSpacer />
      {mutationError ? (
        <StatePanel kind="error" title="Could not update notifications" description={mutationError} />
      ) : null}
      {visibleNotifications.length > 0 ? <Card>
        {visibleNotifications.map((notification, index) => (
          <View key={notification.id}>
            <ListRow
              leading={notification.isRead ? '·' : '•'}
              meta={notification.createdAt}
              onPress={apiClient.mode === 'live' && !notification.isRead && busyId !== notification.id
                ? () => void markRead(notification.id)
                : undefined}
              subtitle={notification.message}
              title={notification.title}
              unread={!notification.isRead}
            />
            {index < visibleNotifications.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </Card> : (
        <StatePanel kind="empty" title="No notifications" description="New account and academic updates will appear here." />
      )}
      <ScreenSpacer />
      {PUSH_OPT_IN_ENABLED ? <PushOptInCard /> : null}
      <ScreenSpacer />
      <Button
        label="Mark all as read"
        loading={isMarkingAll}
        onPress={() => void markAllRead()}
        variant="secondary"
        disabled={apiClient.mode === 'preview' || visibleNotifications.every((item) => item.isRead)}
      />
    </ScreenShell>
  );
}

const pushMsg = notificationsMessages.en;

type PushOptInStatus = 'idle' | 'registered' | 'denied' | 'unavailable' | 'failed';

function PushOptInCard() {
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
