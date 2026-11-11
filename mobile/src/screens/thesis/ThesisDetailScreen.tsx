import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Divider, ScreenShell, SectionHeading, StatePanel, UiText } from '../../components/Ui';
import { IconChip } from '../../components/ui/index';
import { tokens } from '../../design/tokens';
import { countForm } from '../../i18n/locale';
import { fillThesisCopy } from '../../i18n/thesis-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { thesisApi } from './thesis-api';
import { isRegistrationOpen, supervisorName, thesisErrorMessage } from './thesis-model';
import { AskAssistantButton, QueryNotices, ThesisStatusBadge, useThesisUi } from './thesis-ui';
import { useThesisGroup, useThesisRounds, useThesisTopic, useTopicSupervisors } from './use-thesis';

/** One published topic: brief, advisors, the student's registration state and the assistant entry. */
export function ThesisDetailScreen({ navigation, selectedThesisTopicId }: MobileScreenProps) {
  const { copy, locale } = useThesisUi();
  const topicId = selectedThesisTopicId ?? undefined;
  const topicState = useThesisTopic(topicId);
  const { topic } = topicState;
  const supervisors = useTopicSupervisors(topicId);
  const rounds = useThesisRounds();
  const round = topic ? rounds.rounds.find((item) => item.id === topic.roundId) ?? null : null;
  const group = useThesisGroup(topic?.roundId ?? null);
  const chosen = Boolean(topic && group.group?.topicId === topic.id);
  const canRegister = Boolean(topic) && isRegistrationOpen(round) && group.loaded && !group.loading && !group.error && !group.isStale && !group.cancelled && !chosen;
  const hasGroupWithoutTopic = Boolean(group.group && !group.group.topicId);
  const [choosing, setChoosing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onChooseTopic = async () => {
    if (!group.group || !topic || choosing) return;
    setChoosing(true);
    setActionError(null);
    try {
      const updated = await thesisApi.assignTopic(group.group.id, topic.id);
      group.applyGroup(updated);
    } catch (error) {
      setActionError(thesisErrorMessage(copy, error));
      void group.reload();
    } finally {
      setChoosing(false);
    }
  };

  return (
    <ScreenShell title={copy.detailTitle}>
      <QueryNotices state={topicState} copy={copy} />
      {!topicId ? <StatePanel kind="empty" title={copy.topicNotFound} actionLabel={copy.back} onAction={() => navigation.navigate('thesis.topics')} /> : null}
      {topic ? (
        <>
          <Card tone="primary" style={styles.card}>
            <View style={styles.header}>
              <IconChip icon="lightbulb-outline" size={40} />
              <View style={styles.grow}>
                {topic.departmentName ? (
                  <UiText variant="meta" tone="primary">{`${copy.topicDepartment}: ${topic.departmentName}`}</UiText>
                ) : null}
                <UiText variant="headlineSmall">{topic.title}</UiText>
              </View>
              <ThesisStatusBadge status={topic.status} copy={copy} />
            </View>
            {round ? <UiText variant="bodySmall" tone="muted" style={styles.line}>{round.name}</UiText> : null}
            <Divider />
            <UiText variant="label" style={styles.line}>{copy.topicBrief}</UiText>
            <UiText variant="bodySmall" tone="muted" selectable>{topic.description}</UiText>
            <UiText variant="meta" tone="muted" style={styles.line}>
              {fillThesisCopy(countForm(topic.maxGroups, copy.topicGroupsMaxOne, copy.topicGroupsMax), { count: topic.maxGroups })}
            </UiText>
          </Card>

          <Card style={styles.card}>
            <SectionHeading title={copy.supervisors} />
            <QueryNotices state={{ ...supervisors, preview: false }} copy={copy} />
            {!supervisors.loading && !supervisors.error && supervisors.supervisors.length === 0 ? (
              <UiText variant="bodySmall" tone="muted">{copy.supervisorsEmpty}</UiText>
            ) : null}
            {supervisors.supervisors.map((supervisor) => (
              <View key={supervisor.lecturerId} style={styles.line}>
                <UiText variant="label">{supervisorName(supervisor)}</UiText>
                {supervisor.email ? <UiText variant="bodySmall" tone="muted" selectable>{supervisor.email}</UiText> : null}
              </View>
            ))}
          </Card>

          {chosen ? (
            <UiText variant="bodySmall" tone="success" style={styles.line}>{copy.topicAssigned}</UiText>
          ) : null}
          <QueryNotices state={{ ...rounds, preview: false }} copy={copy} />
          <QueryNotices state={group} copy={copy} />
          {!chosen && !canRegister && group.loaded && !group.loading && !group.error ? (
            group.cancelled ? (
              <UiText variant="bodySmall" tone="muted" style={styles.blocked}>{copy.topicGroupCancelled}</UiText>
            ) : !group.group ? (
              <View style={styles.blocked}>
                <UiText variant="bodySmall" tone="muted">{copy.noGroup}</UiText>
                <UiText variant="bodySmall" tone="muted">{copy.noGroupDescription}</UiText>
              </View>
            ) : null
          ) : null}
          <View style={styles.actions}>
            {canRegister ? (
              hasGroupWithoutTopic ? (
                <>
                  <Button
                    label={copy.topicChoose}
                    loading={choosing}
                    disabled={choosing}
                    onPress={() => void onChooseTopic()}
                  />
                  {actionError ? (
                    <UiText accessibilityRole="alert" variant="bodySmall" tone="error" style={styles.line}>
                      {actionError}
                    </UiText>
                  ) : null}
                </>
              ) : (
                <Button label={copy.register} onPress={() => navigation.navigate('thesis.registration', { thesisTopicId: topic.id })} />
              )
            ) : null}
            {chosen ? (
              <Button label={copy.myGroup} onPress={() => navigation.navigate('thesis.progress')} variant="secondary" />
            ) : null}
            <AskAssistantButton navigation={navigation} label={copy.askAssistantTopic} />
          </View>
        </>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: tokens.spacing.md, padding: tokens.spacing.lg },
  description: { marginBottom: tokens.spacing.sm },
  blocked: { gap: tokens.spacing.xs, marginBottom: tokens.spacing.md },
  header: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  line: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.xs },
  actions: { gap: tokens.spacing.sm },
});
