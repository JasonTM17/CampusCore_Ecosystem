import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Divider, ListRow, ProgressBar, ScreenShell, SectionHeading, StatePanel, UiText } from '../../components/Ui';
import { IconChip, StatusPill } from '../../components/ui/index';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { fillThesisCopy } from '../../i18n/thesis-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { ThesisReportCard } from './ThesisReportCard';
import { ThesisRoundPicker } from './ThesisRoundPicker';
import {
  THESIS_MILESTONES,
  memberLabel,
  milestoneState,
  progressPercent,
  statusTone,
  type MilestoneState,
} from './thesis-model';
import { AskAssistantButton, QueryNotices, ThesisStatusBadge, useThesisUi } from './thesis-ui';
import { useActiveThesisRound, useThesisGroup } from './use-thesis';

const MILESTONE_TONE: Record<MilestoneState, 'success' | 'primary' | 'neutral'> = {
  done: 'success',
  current: 'primary',
  pending: 'neutral',
};

/** Server-derived progress of the student's group in the selected round, with the report. */
export function ThesisProgressScreen({ navigation }: MobileScreenProps) {
  const { colors } = useTheme();
  const { copy } = useThesisUi();
  const active = useActiveThesisRound();
  const state = useThesisGroup(active.round?.id ?? null);
  const { group, progress } = state;
  const percent = progressPercent(progress);
  const attention = progress && progress.attentionState !== 'NONE' ? copy.attention[progress.attentionState] : '';
  const idle = !state.loading && !state.error;
  const milestoneLabel = (milestone: string) => copy.milestones[milestone] ?? milestone;
  const stateLabel = (value: MilestoneState) => (
    value === 'done' ? copy.milestoneDone : value === 'current' ? copy.milestoneCurrent : copy.milestonePending
  );

  return (
    <ScreenShell title={copy.progressTitle}>
      <QueryNotices state={active} copy={copy} />
      {!active.loading && !active.error && !active.round ? (
        <StatePanel kind="empty" title={copy.noRounds} description={copy.noRoundsBody} />
      ) : null}
      {active.round ? (
        <>
          <ThesisRoundPicker rounds={active.rounds} current={active.round} onSelect={active.select} copy={copy} />
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
                    <UiText variant="display" tone="primary">{fillThesisCopy(copy.progressPercent, { value: percent })}</UiText>
                  </View>
                  <ThesisStatusBadge status={group.approvalStatus === 'APPROVED' ? 'APPROVED' : group.status} copy={copy} />
                </View>
                <ProgressBar value={percent} tone={percent === 100 ? 'success' : 'primary'} />
                {attention ? <UiText accessibilityRole="alert" variant="bodySmall" tone="warning" style={styles.line}>{attention}</UiText> : null}
                {group.approvalStatus === 'REJECTED' && group.rejectionReason ? (
                  <UiText variant="bodySmall" tone="error" style={styles.line}>{`${copy.groupRejectedReason}: ${group.rejectionReason}`}</UiText>
                ) : null}
                {typeof progress?.finalScore === 'number' ? (
                  <UiText variant="label" style={styles.line}>{`${copy.finalScore}: ${progress.finalScore}`}</UiText>
                ) : null}
              </Card>

              {progress ? (
                <>
                  <SectionHeading title={copy.progressTitle} />
                  <Card style={styles.card}>
                    {THESIS_MILESTONES.map((milestone, index) => {
                      const value = milestoneState(progress, milestone);
                      return (
                        <View key={milestone} style={styles.milestoneRow}>
                          <View style={styles.milestoneTrack}>
                            <View style={[styles.milestoneNode, {
                              backgroundColor: value === 'done' ? colors.successFixed : value === 'current' ? colors.primaryFixed : colors.surfaceLow,
                              borderColor: value === 'done' ? colors.success : value === 'current' ? colors.primary : colors.outlineVariant,
                            }]} />
                            {index < THESIS_MILESTONES.length - 1 ? <View style={[styles.milestoneConnector, { backgroundColor: colors.outlineVariant }]} /> : null}
                          </View>
                          <View style={styles.milestoneCopy}>
                            <UiText variant="label" style={styles.milestoneLabel}>{milestoneLabel(milestone)}</UiText>
                            <StatusPill label={stateLabel(value)} tone={MILESTONE_TONE[value]} />
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
                    {fillThesisCopy(copy.groupMembersCount, { count: group.memberStudentIds.length })}
                  </UiText>
                  <Badge label={copy.status[group.approvalStatus] ?? group.approvalStatus} tone={statusTone(group.approvalStatus)} />
                </View>
                {(group.members ?? []).map((member, index, all) => (
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

              <ThesisReportCard group={group} isLeader={state.isLeader} onChanged={() => void state.reload()} />
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
