import { StyleSheet, View } from 'react-native';

import { Card, StatePanel, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { fillThesisCopy, type ThesisCopy } from '../../i18n/thesis-messages';
import { THESIS_ADVISOR_TOPIC_CAP } from './thesis-model';
import { QueryNotices } from './thesis-ui';
import { useAdvisorDirectory } from './use-thesis';

/** Advisors of the round's published topics. Students cannot read the lecturer directory, so this is derived. */
export function ThesisAdvisorsView({ roundId, copy }: { roundId: string | null; copy: ThesisCopy }) {
  const directory = useAdvisorDirectory(roundId);
  const idle = !directory.loading && !directory.error;
  return (
    <View>
      <UiText variant="bodySmall" tone="muted" style={styles.gap}>{copy.advisorsBody}</UiText>
      <QueryNotices state={directory} copy={copy} />
      {idle && directory.capped ? (
        <UiText variant="meta" tone="muted" style={styles.gap}>
          {fillThesisCopy(copy.advisorsCapped, { count: THESIS_ADVISOR_TOPIC_CAP })}
        </UiText>
      ) : null}
      {idle && directory.failed > 0 ? (
        <UiText variant="meta" tone="warning" style={styles.gap}>{copy.advisorsLoadFailed}</UiText>
      ) : null}
      {idle && directory.entries.length === 0 ? <StatePanel kind="empty" title={copy.advisorsEmpty} /> : null}
      {directory.entries.map((advisor) => (
        <Card key={advisor.lecturerId} style={styles.gap}>
          <UiText variant="label">{advisor.name}</UiText>
          {advisor.email ? <UiText variant="bodySmall" tone="muted" selectable>{advisor.email}</UiText> : null}
          <UiText variant="meta" tone="primary" style={styles.count}>
            {fillThesisCopy(copy.advisorTopics, { count: advisor.topics.length })}
          </UiText>
          {advisor.topics.map((topic) => (
            <UiText key={topic.id} variant="bodySmall" tone="muted" numberOfLines={2}>{`• ${topic.title}`}</UiText>
          ))}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { marginBottom: tokens.spacing.sm },
  count: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.xs },
});
