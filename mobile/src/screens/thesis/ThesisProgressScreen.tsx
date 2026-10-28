import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Divider, ListRow, ProgressBar, ScreenShell, SectionHeading, StatePanel, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
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
                        <View key={milestone}>
                          <ListRow
                            leading={String(index + 1)}
                            title={milestoneLabel(milestone)}
                            trailing={<Badge label={stateLabel(value)} tone={MILESTONE_TONE[value]} />}
                          />
                          {index < THESIS_MILESTONES.length - 1 ? <Divider /> : null}
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
});
