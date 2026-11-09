import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Divider, ListRow, ProgressBar, ScreenShell, SectionHeading, StatePanel, UiText } from '../../components/Ui';
import { IconChip, StatusPill } from '../../components/ui/index';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { countForm } from '../../i18n/locale';
import { useLocale } from '../../i18n/locale-provider';
import { fillThesisCopy } from '../../i18n/thesis-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { ThesisReportCard } from './ThesisReportCard';
import { ThesisRoundPicker } from './ThesisRoundPicker';
import {
  THESIS_MILESTONES,
  canShowFinalScore,
  isNotQualified,
  memberLabel,
  milestoneState,
  milestoneTone,
  progressPercent,
  statusTone,
  type MilestoneState,
} from './thesis-model';
import { AskAssistantButton, QueryNotices, ThesisStatusBadge, useThesisUi } from './thesis-ui';
import { useActiveThesisRound, useThesisGroup } from './use-thesis';

/** Server-derived progress of the student's group in the selected round, with the report. */
export function ThesisProgressScreen({ navigation }: MobileScreenProps) {
  const { colors } = useTheme();
  const { formatNumber } = useLocale();
  const { copy } = useThesisUi();
  const active = useActiveThesisRound();
  const state = useThesisGroup(active.round?.id ?? null);
  const { group, progress } = state;
  const percent = progressPercent(progress);
  const notQualified = isNotQualified(progress);
  const outcome = notQualified ? copy.attention.NOT_QUALIFIED : '';
  const attention = !notQualified && progress && progress.attentionState !== 'NONE' ? copy.attention[progress.attentionState] : '';
  const idle = !state.loading && !state.error;
  const milestoneLabel = (milestone: string) => copy.milestones[milestone] ?? milestone;
  const currentStage = progress
    ? milestoneLabel(THESIS_MILESTONES[Math.max(THESIS_MILESTONES.indexOf(progress.currentMilestone as (typeof THESIS_MILESTONES)[number]), 0)])
    : '';
  const stateLabel = (value: MilestoneState) => {
    if (value === 'skipped') return copy.milestoneSkipped;
    return value === 'done' ? copy.milestoneDone : value === 'current' ? copy.milestoneCurrent : copy.milestonePending;
  };

  return (
    <ScreenShell title={copy.progressTitle}>
      <QueryNotices state={active} copy={copy} />
      {!active.loading && !active.error && !active.round ? (
        <StatePanel kind="empty" title={copy.noRounds} description={copy.noRoundsBody} />
      ) : null}
      {active.round ? (
        <>
          <ThesisRoundPicker rounds={active.rounds} current={active.round} onSelect={active.select} copy={copy} />
          {progress ? (
            <View style={styles.stage}>
              <Badge label={`${copy.progressCurrentStage}: ${currentStage}`} tone="neutral" />
            </View>
          ) : null}
          <QueryNotices state={{ ...state, preview: false }} copy={copy} />

          {idle && !group ? (
            <StatePanel
              kind="empty"
              title={copy.progressNoGroup}
              description={copy.progressNoGroupBody}
              actionLabel={copy.startRegistration}
              onAction={() => navigation.navigate('thesis.registration')}
            />
          ) : null}

          {group ? (
            <>
              <Card tone="primary" style={styles.card}>
                <View style={styles.header}>
                  <IconChip icon="file-chart-outline" size={40} />
                  <View style={styles.grow}>
                    <UiText variant="label">{progress?.topicTitle ?? copy.topicChoose}</UiText>
                    {progress ? (
                      <UiText variant="display" tone="primary">{fillThesisCopy(copy.progressPercent, { value: percent })}</UiText>
                    ) : null}
                  </View>
                  <ThesisStatusBadge status={group.status === 'CANCELLED' ? 'CANCELLED' : group.approvalStatus === 'APPROVED' ? 'APPROVED' : group.approvalStatus === 'REJECTED' ? 'REJECTED' : group.status} copy={copy} />
                </View>
                {progress ? <ProgressBar value={percent} tone={percent === 100 && !notQualified ? 'success' : 'primary'} /> : null}
                {outcome ? (
                  <>
                    <SectionHeading title={copy.progressAttention} />
                    <UiText accessibilityRole="alert" variant="label" tone="warning" style={styles.line}>{outcome}</UiText>
                  </>
                ) : attention ? (
                  <>
                    <SectionHeading title={copy.progressAttention} />
                    <UiText accessibilityRole="alert" variant="bodySmall" tone="warning" style={styles.line}>{attention}</UiText>
                  </>
                ) : null}
                {group.approvalStatus === 'REJECTED' && group.rejectionReason ? (
                  <UiText variant="bodySmall" tone="error" style={styles.line}>{`${copy.groupRejectedReason}: ${group.rejectionReason}`}</UiText>
                ) : null}
                {canShowFinalScore(group, progress) && typeof progress?.finalScore === 'number' ? (
                  <UiText variant="label" style={styles.line}>{`${copy.finalScore}: ${formatNumber(progress.finalScore, { maximumFractionDigits: 2 })}`}</UiText>
                ) : null}
              </Card>

              {state.progressFailed ? (
                <StatePanel
                  kind="error"
                  title={copy.progressFailed}
                  actionLabel={copy.retry}
                  onAction={() => void state.reload()}
                />
              ) : null}

              {progress ? (
                <>
                  <SectionHeading title={copy.progressTitle} />
                  <Card style={styles.card}>
                    {THESIS_MILESTONES.map((milestone, index) => {
                      const value = milestoneState(progress, milestone);
                      const tone = milestoneTone(value, notQualified);
                      const skipped = value === 'skipped';
                      return (
                        <View key={milestone} style={styles.milestoneRow}>
                          <View style={styles.milestoneTrack}>
                            <View style={[styles.milestoneNode, {
                              backgroundColor: tone === 'success' ? colors.successFixed : tone === 'primary' ? colors.primaryFixed : colors.surfaceLow,
                              borderColor: tone === 'success' ? colors.success : tone === 'primary' ? colors.primary : colors.outlineVariant,
                            }]} />
                            {index < THESIS_MILESTONES.length - 1 ? <View style={[styles.milestoneConnector, { backgroundColor: colors.outlineVariant }]} /> : null}
                          </View>
                          <View
                            style={styles.milestoneCopy}
                            accessible={skipped}
                            accessibilityLabel={skipped ? `${milestoneLabel(milestone)}: ${stateLabel(value)}` : undefined}
                          >
                            <UiText variant="label" style={styles.milestoneLabel}>{milestoneLabel(milestone)}</UiText>
                            <StatusPill label={stateLabel(value)} tone={tone} />
                          </View>
                        </View>
                      );
                    })}
                  </Card>
                </>
              ) : null}

              <SectionHeading title={copy.myGroup} actionLabel={copy.registrationTitle} onAction={() => navigation.navigate('thesis.registration')} />
              <Card style={styles.card}>
                <View style={styles.header}>
                  <UiText variant="bodySmall" tone="muted" style={styles.grow}>
                    {fillThesisCopy(countForm(group.memberStudentIds.length, copy.groupMembersCountOne, copy.groupMembersCount), { count: group.memberStudentIds.length })}
                  </UiText>
                  <Badge label={copy.status[group.approvalStatus] ?? group.approvalStatus} tone={statusTone(group.approvalStatus)} />
                </View>
                {((group.members && group.members.length > 0)
                  ? group.members
                  : (group.memberStudentIds ?? []).map((studentId) => ({ studentId }))
                ).map((member, index, all) => (
                  <View key={member.studentId}>
                    <ListRow
                      leading={memberLabel(member).slice(0, 1).toUpperCase()}
                      title={memberLabel(member)}
                      subtitle={member.studentId === group.leaderStudentId ? copy.groupLeader : copy.groupMember}
                    />
                    {index < all.length - 1 ? <Divider /> : null}
                  </View>
                ))}
              </Card>

              <ThesisReportCard group={group} isLeader={state.isLeader} roundStatus={active.round?.status} reportDeadline={active.round?.reportDeadline} onChanged={() => void state.reload()} />
              <AskAssistantButton navigation={navigation} label={copy.askAssistant} />
            </>
          ) : null}

          {!group && idle ? <View style={styles.assist}><AskAssistantButton navigation={navigation} label={copy.askAssistant} /></View> : null}
        </>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: tokens.spacing.md, padding: tokens.spacing.lg },
  stage: { alignSelf: 'flex-start', marginBottom: tokens.spacing.sm },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  grow: { flex: 1, minWidth: 0 },
  line: { marginTop: tokens.spacing.sm },
  assist: { marginTop: tokens.spacing.md },
  milestoneRow: { alignItems: 'stretch', flexDirection: 'row', gap: tokens.spacing.sm, minWidth: 0, paddingVertical: tokens.spacing.xs },
  milestoneTrack: { alignItems: 'center', width: 28 },
  milestoneNode: { borderRadius: tokens.radii.pill, borderWidth: 2, height: 16, marginTop: tokens.spacing.xs, width: 16 },
  milestoneConnector: { flex: 1, marginVertical: tokens.spacing.xs, width: 2 },
  milestoneCopy: { alignItems: 'flex-start', flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, minWidth: 0 },
  milestoneLabel: { flexShrink: 1, minWidth: 120 },
});
