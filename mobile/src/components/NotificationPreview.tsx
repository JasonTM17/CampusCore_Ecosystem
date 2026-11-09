import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { MobileNotification } from '../api/client';import { tokens } from '../design/tokens';
import { useTheme } from '../design/theme';
import { useLocale } from '../i18n/locale-provider';
import { useShellCopy } from '../i18n/use-shell-copy';
import { contentMessages } from '../i18n/content-messages';
import { recordsMessages } from '../i18n/records-messages';
import { contentApi } from '../screens/content/content-api';
import { contentErrorMessage } from '../screens/content/content-errors';
import { useContentQuery } from '../screens/content/use-content-query';
import { stripNotificationTagPrefix } from '../screens/student/notification-title';
import { Button, Notice, Sheet, UiText } from './Ui';

/** Inbox row as the tenant API returns it: the producer link rides along with the typed fields. */
export type PreviewNotification = MobileNotification & { link?: unknown };

export interface NotificationPreviewProps {
  unreadCount: number;
  onClose(): void;
  onOpen(notification: PreviewNotification): void;
  onMarkedRead(): void;
  onNoticeBoard(): void;
  onOpenInbox(): void;
}

/**
 * Header bell preview: the newest five unread notifications with the web
 * panel's loading, failure, empty and footer states. Reading is optimistic —
 * the caller owns the unread badge and the guarded target.
 */
export function NotificationPreview({ unreadCount, onClose, onOpen, onMarkedRead, onNoticeBoard, onOpenInbox }: NotificationPreviewProps) {
  const { colors } = useTheme();
  const { copy } = useShellCopy();
  const { locale } = useLocale();
  const preview = useContentQuery<PreviewNotification[]>(
    'content.notifications.preview',
    () => contentApi.notifications({ page: 0, limit: 5, isRead: false }).then((page) => page.items.slice(0, 5)),
  );
  const unread = useContentQuery<number>('content.notifications.unread-count', () => contentApi.unreadCount());
  const [markFailed, setMarkFailed] = useState<string | null>(null);
  const rows = (preview.data ?? []).slice(0, 5);

  const open = (item: PreviewNotification) => {
    if (!item.isRead) {
      setMarkFailed(null);
      void contentApi.markNotificationRead(item.id)
        .then(onMarkedRead)
        .catch((cause: unknown) => {
          setMarkFailed(contentErrorMessage(contentMessages[locale], cause, recordsMessages[locale].updateFailed));
          void unread.reload();
        });
    }
    onOpen(item);
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={copy.notifications.title}
      closeLabel={copy.close}
      accessibilityLabel={`${copy.notifications.title}, ${unreadCount} ${copy.unread}`}
      footer={(
        <View style={styles.footer}>
          <Button icon="bullhorn-outline" label={copy.notifications.noticeBoard} onPress={onNoticeBoard} variant="text" />
          <Button label={copy.notifications.openInbox} onPress={onOpenInbox} variant="text" />
        </View>
      )}
    >
      {markFailed ? <Notice tone="error" message={markFailed} /> : null}
      {preview.isLoading ? (
        <UiText variant="bodySmall" tone="muted" style={styles.state}>{copy.notifications.loading}</UiText>
      ) : preview.error ? (
        <View style={styles.state}>
          <UiText variant="bodySmall" tone="error">{copy.notifications.loadFailed}</UiText>
          <Button label={copy.notifications.retry} onPress={() => void preview.reload()} variant="secondary" />
        </View>
      ) : rows.length === 0 ? (
        <UiText variant="bodySmall" tone="muted" style={styles.state}>{copy.notifications.empty}</UiText>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {rows.map((item) => {
            const title = stripNotificationTagPrefix(item.title) || copy.notifications.fallbackTitle;
            const message = item.message || copy.notifications.fallbackContent;
            return (
              <View key={item.id} style={[styles.row, { borderColor: colors.outlineVariant }]}>
                <Button
                  variant="text"
                  label={title}
                  accessibilityLabel={title}
                  onPress={() => open(item)}
                />
                <UiText variant="meta" tone="muted" numberOfLines={2}>{message}</UiText>
              </View>
            );
          })}
        </ScrollView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  state: { gap: tokens.spacing.sm, paddingVertical: tokens.spacing.md },
  list: { maxHeight: 320 },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: tokens.spacing.sm },
  footer: { gap: tokens.spacing.xs },
});
