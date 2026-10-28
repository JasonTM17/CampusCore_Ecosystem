import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, SegmentedControl, StatePanel, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import type { MobileScreenProps } from '../../navigation/types';
import { fillAssistantCopy, assistantMessages } from '../../i18n/assistant-messages';
import { MarkdownText } from './MarkdownText';
import { AssistantComposer } from './AssistantComposer';
import { AssistantHistorySheet } from './AssistantHistorySheet';
import { KeyboardSafeView } from './KeyboardSafeView';
import { MessageBubble } from './MessageBubble';
import { useAssistantChat, type AssistantChat } from './useAssistantChat';

function failureTitle(chat: AssistantChat): string {
  const msg = assistantMessages[chat.locale];
  switch (chat.failure?.kind) {
    case 'session': return msg.sessionExpired;
    case 'forbidden': return msg.forbidden;
    case 'rate': return msg.rateLimited.replace('{seconds}', '30');
    case 'quota': return msg.quotaExceeded;
    case 'interrupted': return msg.interruptedStatus;
    case 'invalid': return msg.streamInvalid;
    case 'unavailable': return msg.unavailable;
    default: return chat.copy.errorTitle;
  }
}

/** Assistant chat: scope switch, history, guarded composer, citations, feedback, cancel and retry. */
export function AssistantChatScreen({ navigation }: MobileScreenProps) {
  const { colors } = useTheme();
  const chat = useAssistantChat();
  const { copy, locale, stream, messages, failure } = chat;
  const msg = assistantMessages[locale];
  const scroll = useRef<ScrollView>(null);
  const stickToBottom = useRef(true);
  const lastId = messages[messages.length - 1]?.id;

  // New turns follow the end of the thread; loading older history keeps the reading position.
  useEffect(() => { stickToBottom.current = true; }, [lastId, chat.busy]);

  const empty = messages.length === 0 && !chat.busy && !failure;
  const specialized = chat.scope === 'specialized';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardSafeView>
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onContentSizeChange={() => { if (stickToBottom.current) scroll.current?.scrollToEnd({ animated: false }); }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleRow}>
            <UiText accessibilityRole="header" variant="headlineLarge" style={styles.title}>{copy.title}</UiText>
            {chat.isPreview ? <Badge label="PREVIEW" tone="warning" /> : null}
          </View>
          <View style={styles.toolbar}>
            <View style={styles.scope}>
              <SegmentedControl
                accessibilityLabel={copy.scopeLabel}
                value={chat.scope}
                onChange={(value) => chat.changeScope(value === 'specialized' ? 'specialized' : 'academic')}
                options={[{ value: 'academic', label: copy.scopeAcademic }, { value: 'specialized', label: copy.scopeSpecialized }]}
              />
            </View>
            {!chat.isPreview ? <Button label={copy.history} onPress={() => chat.setHistoryOpen(true)} variant="secondary" /> : null}
            <Button label={copy.newChat} onPress={chat.newChat} variant="text" />
          </View>
          {chat.isPreview ? <UiText variant="bodySmall" tone="muted" style={styles.gap}>{copy.previewNotice}</UiText> : null}

          {chat.earlierCursor ? (
            <View style={styles.gap}>
              <Button
                label={chat.loadingEarlier ? copy.loadingEarlier : copy.loadEarlier}
                loading={chat.loadingEarlier}
                onPress={() => { stickToBottom.current = false; void chat.loadEarlier(); }}
                variant="secondary"
              />
            </View>
          ) : null}

          {empty ? (
            <StatePanel
              kind="empty"
              title={specialized ? copy.emptySpecializedTitle : copy.emptyAcademicTitle}
              description={specialized ? copy.emptySpecializedBody : copy.emptyAcademicBody}
            />
          ) : null}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              copy={copy}
              feedbackBusy={chat.feedbackBusyId === message.id}
              onRate={(id, rating, reason) => void chat.rate(id, rating, reason)}
            />
          ))}

          {chat.liveAnswer ? (
            <Card style={styles.gap}><MarkdownText text={chat.liveAnswer} streaming /></Card>
          ) : null}
          {chat.busy ? <StatePanel kind="loading" title={chat.reconciling ? copy.reconciling : copy.working} /> : null}

          {chat.quota ? (
            <StatePanel
              kind="error"
              title={copy.quotaTitle}
              description={chat.quota.resetAt
                ? fillAssistantCopy(copy.quotaBody, { limit: chat.quota.limit, time: chat.quota.resetAt })
                : fillAssistantCopy(copy.quotaBodyNoTime, { limit: chat.quota.limit })}
            />
          ) : null}
          {failure ? (
            <StatePanel
              kind="error"
              title={failureTitle(chat)}
              description={failure.kind === 'generic' ? copy.errorBody : undefined}
              actionLabel={failure.resubmittable && chat.canRetry ? msg.retryAction : undefined}
              onAction={failure.resubmittable && chat.canRetry ? () => void chat.retry() : undefined}
            />
          ) : null}
          {chat.feedbackError ? <UiText accessibilityRole="alert" variant="bodySmall" tone="error">{copy.feedbackFailed}</UiText> : null}

          <View accessibilityLiveRegion="polite">
            {stream.phase === 'sending' || stream.phase === 'streaming' ? (
              <UiText variant="meta" tone="muted">{msg.a11yStreaming}</UiText>
            ) : stream.phase === 'complete' ? (
              <UiText variant="meta" tone="muted">{msg.a11yCompleted}</UiText>
            ) : stream.phase === 'cancelled' ? (
              <UiText variant="meta" tone="muted">{msg.a11yStopped}</UiText>
            ) : stream.phase === 'error' && chat.streamState.connectionLost ? (
              <UiText variant="meta" tone="muted">{msg.a11yInterrupted}</UiText>
            ) : null}
          </View>

          {specialized ? (
            <Button label={copy.openThesis} onPress={() => navigation.navigate('thesis.progress')} variant="text" style={styles.gap} />
          ) : null}
        </ScrollView>
        <AssistantComposer chat={chat} />
      </KeyboardSafeView>
      <AssistantHistorySheet chat={chat} copy={copy} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: tokens.layout.mobileGutter, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.md },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm, marginBottom: tokens.spacing.sm },
  title: { flexShrink: 1 },
  toolbar: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs, marginBottom: tokens.spacing.sm },
  scope: { flexGrow: 1, minWidth: 200 },
  gap: { marginBottom: tokens.spacing.sm },
});
