import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { ASSISTANT_FEEDBACK_REASONS } from '../../api/assistant-limits';
import { fillAssistantCopy, type AssistantChatCopy } from '../../i18n/assistant-messages';
import { safeText } from '../../assistant/chat-helpers';
import type { AssistantCitation, AssistantFeedbackRating, AssistantFeedbackReason } from '../../api/client';
import type { ChatMessage } from './useAssistantChat';
import { MarkdownText } from './MarkdownText';

const POSITIVE_REASONS: readonly AssistantFeedbackReason[] = ['HELPFUL', 'CLEAR'];
const NEGATIVE_REASONS: readonly AssistantFeedbackReason[] = ['INCORRECT', 'OUTDATED', 'NOT_RELEVANT', 'UNSAFE'];

function Citations({ citations, copy }: { citations: AssistantCitation[]; copy: AssistantChatCopy }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const label = fillAssistantCopy(copy.sources, { count: citations.length });
  return (
    <View style={styles.sources}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.sourcesHeader}
      >
        <UiText variant="label" tone="primary" style={styles.grow}>{label}</UiText>
        <UiText variant="label" tone="primary">{open ? '▴' : '▾'}</UiText>
      </Pressable>
      {open ? citations.map((citation) => (
        <View key={citation.id} style={[styles.citation, { borderLeftColor: colors.primary }]}>
          <UiText variant="label" tone="primary">{safeText(citation.title, 160)}</UiText>
          <UiText variant="meta" tone="muted">
            {[safeText(citation.source, 120), citation.locale?.toUpperCase(), citation.domain].filter(Boolean).join(' · ')}
          </UiText>
          {citation.excerpt ? (
            <UiText variant="bodySmall" tone="muted" style={styles.excerpt}>{safeText(citation.excerpt, 600)}</UiText>
          ) : null}
        </View>
      )) : null}
    </View>
  );
}

export interface MessageBubbleProps {
  message: ChatMessage;
  copy: AssistantChatCopy;
  feedbackBusy: boolean;
  onRate: (messageId: string, rating: AssistantFeedbackRating, reason?: AssistantFeedbackReason) => void;
}

export const MessageBubble = memo(function MessageBubble({ message, copy, feedbackBusy, onRate }: MessageBubbleProps) {
  const { colors } = useTheme();
  const student = message.from === 'student';
  const rated = message.feedback;
  const reasons = rated ? (rated.rating === 'UP' ? POSITIVE_REASONS : NEGATIVE_REASONS) : [];
  const canRate = !student && !message.local;
  return (
    <View style={[styles.row, student ? styles.studentRow : undefined]}>
      <Card tone={student ? 'primary' : 'card'} style={[styles.card, { borderColor: student ? colors.primary : colors.outlineVariant }, student ? styles.studentCard : undefined]}>
        <View style={styles.header}>
          <UiText variant="meta" tone={student ? 'primary' : 'muted'}>{student ? copy.you : copy.assistant}</UiText>
          {!student && message.degraded && message.reasonCode !== 'CANCELLED' ? <Badge label={copy.fallbackAnswer} tone="warning" /> : null}
        </View>
        {student ? (
          <UiText variant="bodyMedium" style={styles.text}>{message.text}</UiText>
        ) : message.blocked ? (
          <UiText variant="bodyMedium" tone="muted" style={styles.text}>{message.text}</UiText>
        ) : (
          <MarkdownText text={message.text} />
        )}
        {!student && message.reasonCode === 'KNOWLEDGE_UNAVAILABLE' ? (
          <UiText variant="meta" tone="warning" style={styles.text}>{copy.knowledgeUnavailable}</UiText>
        ) : null}
        {!student && message.citations?.length ? <Citations citations={message.citations} copy={copy} /> : null}
        {canRate ? (
          <View accessibilityLabel={copy.feedbackReasonTitle}>
            <View style={styles.feedback}>
              <Button
                label={rated?.rating === 'UP' ? `✓ ${copy.helpful}` : copy.helpful}
                accessibilityLabel={copy.helpful}
                loading={feedbackBusy}
                onPress={() => onRate(message.id, 'UP')}
                variant="text"
              />
              <Button
                label={rated?.rating === 'DOWN' ? `✓ ${copy.notHelpful}` : copy.notHelpful}
                accessibilityLabel={copy.notHelpful}
                loading={feedbackBusy}
                onPress={() => onRate(message.id, 'DOWN')}
                variant="text"
              />
            </View>
            {rated ? (
              <View style={styles.reasons}>
                {reasons.filter((reason) => (ASSISTANT_FEEDBACK_REASONS as readonly string[]).includes(reason)).map((reason) => (
                  <Pressable
                    key={reason}
                    accessibilityRole="button"
                    accessibilityLabel={copy.reasons[reason]}
                    accessibilityState={{ selected: rated.reason === reason }}
                    disabled={feedbackBusy}
                    onPress={() => onRate(message.id, rated.rating, reason)}
                    style={[styles.reason, {
                      backgroundColor: rated.reason === reason ? colors.primaryFixed : colors.card,
                      borderColor: rated.reason === reason ? colors.primary : colors.outlineVariant,
                    }]}
                  >
                    <UiText variant="meta" tone={rated.reason === reason ? 'primary' : 'muted'}>{copy.reasons[reason]}</UiText>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'flex-start', marginBottom: tokens.spacing.sm, width: '100%' },
  studentRow: { justifyContent: 'flex-end' },
  card: { alignSelf: 'flex-start', maxWidth: '94%', padding: tokens.spacing.md },
  studentCard: { alignSelf: 'flex-end' },
  header: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm, justifyContent: 'space-between', marginBottom: tokens.spacing.xs },
  text: { marginTop: tokens.spacing.xs },
  sources: { marginTop: tokens.spacing.sm },
  sourcesHeader: { alignItems: 'center', flexDirection: 'row', minHeight: tokens.layout.touchTarget },
  grow: { flex: 1 },
  citation: { borderLeftWidth: 2, marginBottom: tokens.spacing.sm, paddingLeft: tokens.spacing.sm },
  excerpt: { marginTop: tokens.spacing.xs },
  feedback: { flexDirection: 'row', gap: tokens.spacing.xs, marginTop: tokens.spacing.xs },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  reason: { alignItems: 'center', borderRadius: tokens.radii.control, borderWidth: 1, justifyContent: 'center', minHeight: tokens.layout.touchTarget, paddingHorizontal: tokens.spacing.sm },
});
