import { StyleSheet, View } from 'react-native';

import { requestAssistantEntryScope } from '../../assistant/entry-scope';
import { Button, Card, DataNotice, Divider, StatePanel, UiText } from '../../components/Ui';
import { IconChip, StatusPill } from '../../components/ui/index';
import { useTheme } from '../../design/theme';
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
  return <StatusPill label={statusLabel(copy, status)} tone={statusTone(status)} />;
}

export type ThesisStepState = 'done' | 'current' | 'pending';

/** Local vertical stepper used by thesis registration and progress screens. */
export function ThesisStepper({
  steps,
  copy,
}: {
  steps: readonly { label: string; state: ThesisStepState }[];
  copy: ThesisCopy;
}) {
  const { colors } = useTheme();
  const stateLabel = (state: ThesisStepState) => (
    state === 'done' ? copy.milestoneDone : state === 'current' ? copy.milestoneCurrent : copy.milestonePending
  );
  const iconTone = (state: ThesisStepState) => (
    state === 'done' ? 'success' : state === 'current' ? 'primary' : 'muted'
  );
  const pillTone = (state: ThesisStepState) => (
    state === 'done' ? 'success' : state === 'current' ? 'primary' : 'neutral'
  );
  return (
    <View style={styles.stepper}>
      {steps.map((step, index) => (
        <View key={`${index}:${step.label}`} style={styles.stepRow}>
          <View style={styles.stepTrack}>
            <View style={[styles.stepNode, {
              backgroundColor: step.state === 'done' ? colors.successFixed : step.state === 'current' ? colors.primaryFixed : colors.surfaceLow,
              borderColor: step.state === 'done' ? colors.success : step.state === 'current' ? colors.primary : colors.outlineVariant,
            }]}>
              <UiText variant="meta" tone={iconTone(step.state)}>{index + 1}</UiText>
            </View>
            {index < steps.length - 1 ? <View style={[styles.stepConnector, { backgroundColor: colors.outlineVariant }]} /> : null}
          </View>
          <View style={styles.stepCopy}>
            <UiText variant="label" style={styles.stepLabel}>{step.label}</UiText>
            <StatusPill label={stateLabel(step.state)} tone={pillTone(step.state)} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function DateLine({ label, text }: { label: string; text?: string | null }) {
  if (!text) return null;
  const { window } = useTheme();
  const stacked = window.fontScale >= 1.3 || window.width < 360;
  return (
    <View style={[styles.dateLine, stacked ? styles.dateLineStacked : undefined]}>
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
        <IconChip icon="lightbulb-outline" />
        <View style={styles.grow}>
          <UiText variant="meta" tone="primary">{topic.departmentId}</UiText>
          <UiText variant="headlineSmall">{topic.title}</UiText>
        </View>
        <ThesisStatusBadge status={topic.status} copy={copy} />
      </View>
      <UiText variant="bodySmall" tone="muted" style={styles.brief}>{topic.description}</UiText>
      <UiText variant="meta" tone="muted">{fillThesisCopy(copy.topicGroupsMax, { count: topic.maxGroups })}</UiText>
      <Button label={copy.openTopic} onPress={onOpen} variant="secondary" accessibilityLabel={`${copy.openTopic}: ${topic.title}`} />
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
  dateLine: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginTop: tokens.spacing.xs },
  dateLineStacked: { flexDirection: 'column', gap: tokens.spacing.xs },
  dateLabel: { flexShrink: 1, minWidth: 0 },
  brief: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.xs },
  divider: { marginVertical: tokens.spacing.sm },
  stepper: { gap: tokens.spacing.sm },
  stepRow: { alignItems: 'stretch', flexDirection: 'row', gap: tokens.spacing.sm, minWidth: 0 },
  stepTrack: { alignItems: 'center', width: 32 },
  stepNode: { alignItems: 'center', borderRadius: tokens.radii.pill, borderWidth: 1, height: 28, justifyContent: 'center', width: 28 },
  stepConnector: { flex: 1, marginVertical: tokens.spacing.xs, width: 2 },
  stepCopy: { alignItems: 'flex-start', flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, minWidth: 0, paddingVertical: tokens.spacing.xs },
  stepLabel: { flexShrink: 1, minWidth: 120 },
});
