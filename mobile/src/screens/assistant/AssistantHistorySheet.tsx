import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, StatePanel } from '../../components/Ui';
import { Dialog, Sheet } from '../../components/ui/primitives';
import { tokens } from '../../design/tokens';
import { useLocale } from '../../i18n/locale-provider';
import type { AssistantConversation } from '../../api/client';
import type { AssistantChatCopy } from '../../i18n/assistant-messages';
import { safeText } from '../../assistant/chat-helpers';
import type { AssistantChat } from './useAssistantChat';

export interface AssistantHistorySheetProps {
  chat: AssistantChat;
  copy: AssistantChatCopy;
}

/** Conversation history for the active scope, newest first, with cursor paging and confirmed delete. */
export function AssistantHistorySheet({ chat, copy }: AssistantHistorySheetProps) {
  const { formatDateTime } = useLocale();
  const { history } = chat;
  const [pendingDelete, setPendingDelete] = useState<AssistantConversation | null>(null);
  const title = (conversation: AssistantConversation) => safeText(conversation.title, 80) || copy.conversationFallback;

  return (
    <>
      <Sheet visible={history.open} onClose={() => chat.setHistoryOpen(false)} title={copy.historyTitle}>
        <ScrollView>
          {history.loading ? <StatePanel kind="loading" title={copy.historyLoading} /> : null}
          {history.error ? (
            <StatePanel kind="error" title={copy.historyError} actionLabel={copy.retry} onAction={chat.reloadHistory} />
          ) : null}
          {!history.loading && !history.error && history.items.length === 0 ? (
            <StatePanel kind="empty" title={copy.historyEmpty} />
          ) : null}
          {history.items.map((conversation) => (
            <View key={conversation.id} style={styles.row}>
              <Button
                label={title(conversation)}
                accessibilityLabel={`${title(conversation)}, ${formatDateTime(conversation.updatedAt)}`}
                onPress={() => void chat.selectConversation(conversation)}
                variant={conversation.id === chat.conversationId ? 'primary' : 'secondary'}
                style={styles.select}
              />
              <Button
                label={copy.delete}
                accessibilityLabel={`${copy.delete}: ${title(conversation)}`}
                onPress={() => setPendingDelete(conversation)}
                variant="text"
              />
            </View>
          ))}
          {history.nextCursor ? (
            <View style={styles.more}>
              <Button label={copy.loadMoreHistory} loading={history.loadingMore} onPress={chat.loadMoreHistory} variant="secondary" />
            </View>
          ) : null}
        </ScrollView>
      </Sheet>
      <Dialog
        visible={pendingDelete !== null}
        title={copy.deleteTitle}
        description={copy.deleteBody}
        confirmLabel={copy.delete}
        cancelLabel={copy.cancel}
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) void chat.deleteConversation(target);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.xs, marginBottom: tokens.spacing.xs },
  select: { flex: 1, minWidth: 0 },
  more: { alignItems: 'center', marginTop: tokens.spacing.sm },
});
