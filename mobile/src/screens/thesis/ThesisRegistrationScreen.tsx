import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Divider, Field, ListRow, ProgressBar, ScreenShell, SectionHeading, StatePanel, UiText } from '../../components/Ui';
import { Dialog } from '../../components/ui/primitives';
import { tokens } from '../../design/tokens';
import { fillThesisCopy } from '../../i18n/thesis-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { ThesisRoundPicker } from './ThesisRoundPicker';
import { thesisApi } from './thesis-api';
import {
  THESIS_GROUP_MAX_MEMBERS,
  THESIS_STUDENT_SEARCH_MIN,
  groupSizeState,
  isAbortLike,
  isGroupEditable,
  isRegistrationOpen,
  memberLabel,
  statusTone,
  studentHitLabel,
  thesisErrorMessage,
  type StudentSearchHit,
  type ThesisGroup,
  type ThesisMember,
} from './thesis-model';
import { QueryNotices, useThesisUi } from './thesis-ui';
import { useActiveThesisRound, useThesisGroup, useThesisTopic } from './use-thesis';

type Notice = { tone: 'success' | 'error'; text: string } | null;

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_RESULT_CAP = 10;

/** Group, members and topic in one place; every write is leader-only and limited to the open window. */
export function ThesisRegistrationScreen({ navigation, selectedThesisTopicId }: MobileScreenProps) {
  const { copy } = useThesisUi();
  const active = useActiveThesisRound();
  const candidateState = useThesisTopic(selectedThesisTopicId ?? undefined);
  const candidate = candidateState.topic;
  const round = (candidate ? active.rounds.find((item) => item.id === candidate.roundId) : null) ?? active.round;
  const roundId = round?.id ?? null;
  const state = useThesisGroup(roundId);
  const { group, progress, preview } = state;

  const [notice, setNotice] = useState<Notice>(null);
  const [working, setWorking] = useState(false);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<StudentSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<ThesisMember | null>(null);

  const open = isRegistrationOpen(round);
  const memberCount = group?.memberStudentIds.length ?? 0;
  const size = groupSizeState(memberCount);
  const canWrite = !preview && open && state.isLeader && isGroupEditable(group);
  const canAdd = canWrite && size !== 'full';
  const topicAssigned = Boolean(group?.topicId);
  const stepsDone = [Boolean(group), size !== 'tooSmall' && Boolean(group), topicAssigned].filter(Boolean).length;
  const assignedTitle = progress?.topicTitle ?? (candidate && group?.topicId === candidate.id ? candidate.title : null);
  const pendingTopic = candidate && group && group.topicId !== candidate.id ? candidate : null;

  // Debounced student lookup; a newer keystroke cancels the older request.
  useEffect(() => {
    const term = search.trim();
    if (term.length < THESIS_STUDENT_SEARCH_MIN || !canAdd) {
      setHits(null);
      setSearching(false);
      return undefined;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      thesisApi.searchStudents(term, { signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) setHits(result); })
        .catch((error: unknown) => {
          if (isAbortLike(error) || controller.signal.aborted) return;
          setHits([]);
          setNotice({ tone: 'error', text: thesisErrorMessage(copy, error) });
        })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, canAdd, copy]);

  const memberIds = group?.memberStudentIds;
  const candidates = useMemo(
    () => (hits ?? []).filter((hit) => !memberIds?.includes(hit.studentId)).slice(0, SEARCH_RESULT_CAP),
    [hits, memberIds],
  );

  const run = async (action: () => Promise<ThesisGroup>, success?: string) => {
    setWorking(true);
    setNotice(null);
    try {
      state.applyGroup(await action());
      if (success) setNotice({ tone: 'success', text: success });
    } catch (error) {
      setNotice({ tone: 'error', text: thesisErrorMessage(copy, error) });
      void state.reload();
    } finally {
      setWorking(false);
    }
  };

  const members: ThesisMember[] = group?.members ?? (group?.memberStudentIds ?? []).map((studentId) => ({ studentId }));

  return (
    <ScreenShell title={copy.registrationTitle}>
      <QueryNotices state={active} copy={copy} />
      {!active.loading && !active.error && !active.round ? (
        <StatePanel kind="empty" title={copy.noRounds} description={copy.noRoundsBody} />
      ) : null}
      {round ? (
        <>
          <ThesisRoundPicker rounds={active.rounds} current={round} onSelect={active.select} copy={copy} />
          <QueryNotices state={{ ...state, preview: false }} copy={copy} />
          {!state.loading && !state.error ? (
            <>
              {!open ? <UiText variant="bodySmall" tone="warning" style={styles.gap}>{copy.windowClosed}</UiText> : null}
              {group && !state.isLeader ? <UiText variant="bodySmall" tone="muted" style={styles.gap}>{copy.leaderOnly}</UiText> : null}

              <Card tone="primary" style={styles.card}>
                <View style={styles.steps}>
                  <Badge label={copy.stepGroup} tone={group ? 'success' : 'warning'} />
                  <Badge label={copy.stepMembers} tone={group && size !== 'tooSmall' ? 'success' : group ? 'warning' : 'neutral'} />
                  <Badge label={copy.stepTopic} tone={topicAssigned ? 'success' : 'neutral'} />
                </View>
                <ProgressBar label={copy.registrationTitle} value={Math.round((stepsDone / 3) * 100)} />
              </Card>

              <SectionHeading title={copy.groupTitle} />
              <Card style={styles.card}>
                {group ? (
                  <View style={styles.header}>
                    <UiText variant="bodySmall" tone="muted" style={styles.grow}>
                      {fillThesisCopy(copy.groupMembersCount, { count: memberCount })}
                    </UiText>
                    <Badge label={copy.status[group.approvalStatus] ?? group.approvalStatus} tone={statusTone(group.approvalStatus)} />
                  </View>
                ) : (
                  <>
                    <UiText variant="bodySmall" tone="muted" style={styles.gap}>{copy.groupNone}</UiText>
                    <Button
                      label={preview ? copy.previewOnly : copy.groupCreate}
                      disabled={preview || !open}
                      loading={working}
                      onPress={() => void run(() => thesisApi.createGroup(round.id), copy.saved)}
                    />
                  </>
                )}
                {group?.approvalStatus === 'REJECTED' && group.rejectionReason ? (
                  <UiText variant="bodySmall" tone="error" style={styles.gap}>{`${copy.groupRejectedReason}: ${group.rejectionReason}`}</UiText>
                ) : null}
              </Card>

              {group ? (
                <>
                  <SectionHeading title={copy.members} />
                  <Card style={styles.card}>
                    <UiText variant="meta" tone={size === 'tooSmall' ? 'warning' : 'muted'} style={styles.gap}>
                      {`${copy.groupRule} (${memberCount}/${THESIS_GROUP_MAX_MEMBERS})`}
                    </UiText>
                    {members.map((member, index) => {
                      const leader = member.studentId === group.leaderStudentId;
                      return (
                        <View key={member.studentId}>
                          <ListRow
                            leading={memberLabel(member).slice(0, 1).toUpperCase()}
                            title={memberLabel(member)}
                            subtitle={leader ? copy.groupLeader : copy.groupMember}
                            trailing={canWrite && !leader ? (
                              <Button
                                label={copy.remove}
                                accessibilityLabel={`${copy.memberRemove}: ${memberLabel(member)}`}
                                variant="text"
                                disabled={working}
                                onPress={() => setPendingRemove(member)}
                              />
                            ) : undefined}
                          />
                          {index < members.length - 1 ? <Divider /> : null}
                        </View>
                      );
                    })}
                    {canAdd ? (
                      <View style={styles.search}>
                        <Field
                          label={copy.memberSearch}
                          value={search}
                          onChangeText={setSearch}
                          autoCapitalize="none"
                          autoCorrect={false}
                          helperText={copy.memberSearchHint}
                        />
                        {searching ? <UiText variant="meta" tone="muted">{copy.memberSearching}</UiText> : null}
                        {!searching && hits !== null && candidates.length === 0 ? (
                          <UiText variant="bodySmall" tone="muted">{copy.memberSearchEmpty}</UiText>
                        ) : null}
                        {candidates.map((hit) => (
                          <ListRow
                            key={hit.studentId}
                            leading={studentHitLabel(hit).slice(0, 1).toUpperCase()}
                            title={studentHitLabel(hit)}
                            subtitle={[hit.studentNumber, hit.curriculumCode].filter(Boolean).join(' · ')}
                            trailing={(
                              <Button
                                label={copy.memberAdd}
                                accessibilityLabel={`${copy.memberAdd}: ${studentHitLabel(hit)}`}
                                variant="secondary"
                                disabled={working}
                                onPress={() => {
                                  setSearch('');
                                  void run(() => thesisApi.addMember(group.id, hit.studentId), copy.saved);
                                }}
                              />
                            )}
                          />
                        ))}
                      </View>
                    ) : null}
                  </Card>

                  <SectionHeading title={copy.topicStep} />
                  <Card style={styles.card}>
                    {assignedTitle ? (
                      <View style={styles.header}>
                        <UiText variant="label" style={styles.grow}>{assignedTitle}</UiText>
                        <Badge label={copy.topicAssigned} tone="success" />
                      </View>
                    ) : (
                      <UiText variant="bodySmall" tone="muted" style={styles.gap}>{copy.topicChoose}</UiText>
                    )}
                    {pendingTopic ? (
                      <View style={styles.pending}>
                        <UiText variant="label">{pendingTopic.title}</UiText>
                        <Button
                          label={copy.topicAssign}
                          disabled={!canWrite}
                          loading={working}
                          onPress={() => void run(() => thesisApi.assignTopic(group.id, pendingTopic.id), copy.saved)}
                        />
                      </View>
                    ) : null}
                    <Button
                      label={assignedTitle || pendingTopic ? copy.topicChange : copy.topicChoose}
                      variant="text"
                      onPress={() => navigation.navigate('thesis.topics')}
                    />
                  </Card>
                </>
              ) : null}

              {notice ? (
                <UiText accessibilityRole="alert" variant="bodySmall" tone={notice.tone} style={styles.gap}>{notice.text}</UiText>
              ) : null}
              {group ? (
                <Button label={copy.progressTitle} variant="secondary" onPress={() => navigation.navigate('thesis.progress')} />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      <Dialog
        visible={pendingRemove !== null}
        title={copy.memberRemoveTitle}
        description={copy.memberRemoveBody}
        confirmLabel={copy.remove}
        cancelLabel={copy.cancel}
        destructive
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          const target = pendingRemove;
          setPendingRemove(null);
          if (target && group) void run(() => thesisApi.removeMember(group.id, target.studentId), copy.saved);
        }}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: tokens.spacing.md, padding: tokens.spacing.lg },
  gap: { marginBottom: tokens.spacing.sm },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, justifyContent: 'space-between' },
  grow: { flex: 1, minWidth: 0 },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginBottom: tokens.spacing.sm },
  search: { marginTop: tokens.spacing.md },
  pending: { gap: tokens.spacing.sm, marginVertical: tokens.spacing.sm },
});
