import { StyleSheet, View } from 'react-native';

import { requestAssistantEntryScope } from '../../assistant/entry-scope';
import { Badge, Button, Card, DataNotice, Divider, StatePanel, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { useLocale } from '../../i18n/locale-provider';
import { fillThesisCopy, thesisMessages, type ThesisCopy } from '../../i18n/thesis-messages';
import type { MobileNavigation } from '../../navigation/types';
import { statusLabel, statusTone, type ThesisRound, type ThesisTopic } from './thesis-model';
import type { ThesisQueryState } from './use-thesis';

export function useThesisUi() {
  const locale = useLocale();
  return { copy: thesisMessages[locale.locale], locale };
}

/** Stale banner, first-load spinner and blocking error with retry, in that order. */
export function QueryNotices({ state, copy }: { state: ThesisQueryState; copy: ThesisCopy }) {
  return (
    <>
      {state.preview ? <UiText variant="bodySmall" tone="muted" style={styles.gap}>{copy.previewNotice}</UiText> : null}
      {state.warning ? <DataNotice message={state.warning} /> : null}
      {state.loading ? <StatePanel kind="loading" title={copy.loading} /> : null}
      {state.error ? (
        <StatePanel kind="error" title={state.error} actionLabel={copy.retry} onAction={() => void state.reload()} />
      ) : null}
    </>
  );
}

export function ThesisStatusBadge({ status, copy }: { status: string | null | undefined; copy: ThesisCopy }) {
  if (!status) return null;
  return <Badge label={statusLabel(copy, status)} tone={statusTone(status)} />;
}

export function DateLine({ label, text }: { label: string; text?: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.dateLine}>
      <UiText variant="bodySmall" tone="muted" style={styles.dateLabel}>{label}</UiText>
      <UiText variant="bodySmall" style={styles.grow}>{text}</UiText>
    </View>
  );
}

export function RoundCard({ round, copy, formatDate }: { round: ThesisRound; copy: ThesisCopy; formatDate: (value: string) => string }) {
  const optional = (value?: string | null) => (value ? formatDate(value) : null);
  return (
    <Card tone="primary" style={styles.roundCard}>
      <View style={styles.row}>
        <UiText variant="headlineSmall" style={styles.grow}>{round.name}</UiText>
        <ThesisStatusBadge status={round.status} copy={copy} />
      </View>
      <DateLine label={copy.roundType} text={round.thesisType} />
      <DateLine label={copy.roundProposalPublish} text={optional(round.proposalPublishAt)} />
      <DateLine label={copy.roundRegistration} text={`${formatDate(round.registrationStart)} - ${formatDate(round.registrationEnd)}`} />
      <DateLine label={copy.roundReportDeadline} text={optional(round.reportDeadline)} />
      <DateLine label={copy.roundDefense} text={optional(round.defenseDate)} />
    </Card>
  );
}

export function TopicCard({ topic, copy, onOpen }: { topic: ThesisTopic; copy: ThesisCopy; onOpen: () => void }) {
  return (
    <Card style={styles.gap}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <UiText variant="meta" tone="primary">{topic.departmentId}</UiText>
          <UiText variant="headlineSmall">{topic.title}</UiText>
        </View>
        <ThesisStatusBadge status={topic.status} copy={copy} />
      </View>
      <UiText variant="bodySmall" tone="muted" numberOfLines={3} style={styles.brief}>{topic.description}</UiText>
      <UiText variant="meta" tone="muted">{fillThesisCopy(copy.topicGroupsMax, { count: topic.maxGroups })}</UiText>
      <Button label={copy.openTopic} onPress={onOpen} variant="text" accessibilityLabel={`${copy.openTopic}: ${topic.title}`} />
    </Card>
  );
}

/** Opens the thesis-scoped assistant. Only the corpus scope travels; no report or round content does. */
export function AskAssistantButton({ navigation, label }: { navigation: MobileNavigation; label: string }) {
  return (
    <Button
      label={label}
      variant="secondary"
      onPress={() => {
        requestAssistantEntryScope('specialized');
        navigation.navigate('assistant.chat');
      }}
    />
  );
}

export function SectionDivider() {
  return <View style={styles.divider}><Divider /></View>;
}

export const thesisStyles = StyleSheet.create({
  gap: { marginBottom: tokens.spacing.sm },
  gapLarge: { marginBottom: tokens.spacing.md },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  grow: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});

const styles = StyleSheet.create({
  gap: thesisStyles.gap,
  row: thesisStyles.row,
  grow: thesisStyles.grow,
  roundCard: { marginBottom: tokens.spacing.sm, padding: tokens.spacing.lg },
  dateLine: { flexDirection: 'row', gap: tokens.spacing.sm, marginTop: tokens.spacing.xs },
  dateLabel: { minWidth: 120 },
  brief: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.xs },
  divider: { marginVertical: tokens.spacing.sm },
});
