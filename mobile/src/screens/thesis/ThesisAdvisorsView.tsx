import { StyleSheet, View } from 'react-native';

import { Button, Card, StatePanel, UiText } from '../../components/Ui';
import { tokens } from '../../design/tokens';
import { countForm } from '../../i18n/locale';
import { fillThesisCopy, type ThesisCopy } from '../../i18n/thesis-messages';
import { THESIS_ADVISOR_TOPIC_CAP, type AdvisorEntry } from './thesis-model';
import { QueryNotices } from './thesis-ui';
import { useAdvisorDirectory } from './use-thesis';

export function AdvisorCard({ advisor, copy }: { advisor: AdvisorEntry; copy: ThesisCopy }) {
  return (
    <Card style={styles.gap}>
      <UiText variant="label">{advisor.name}</UiText>
      {advisor.email ? <UiText variant="bodySmall" tone="muted" selectable>{advisor.email}</UiText> : null}
      <UiText variant="meta" tone="primary" style={styles.count}>
        {fillThesisCopy(countForm(advisor.topics.length, copy.advisorTopicsOne, copy.advisorTopics), { count: advisor.topics.length })}
      </UiText>
      {advisor.topics.map((topic) => (
        <UiText key={topic.id} variant="bodySmall" tone="muted">{`• ${topic.title}`}</UiText>
      ))}
    </Card>
  );
}

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
          {fillThesisCopy(countForm(THESIS_ADVISOR_TOPIC_CAP, copy.advisorsCappedOne, copy.advisorsCapped), { count: THESIS_ADVISOR_TOPIC_CAP })}
        </UiText>
      ) : null}
      {idle && directory.failed > 0 ? (
        <View style={styles.failure}>
          <UiText variant="meta" tone="warning">{copy.advisorsLoadFailed}</UiText>
          <Button label={copy.retry} variant="secondary" onPress={() => void directory.reload()} />
        </View>
      ) : null}
      {idle && directory.entries.length === 0 ? <StatePanel kind="empty" title={copy.advisorsEmpty} /> : null}
      {directory.entries.map((advisor) => (
        <AdvisorCard key={advisor.lecturerId} advisor={advisor} copy={copy} />
      ))}
      {directory.loadMoreError ? (
        <StatePanel kind="error" title={directory.loadMoreError} actionLabel={copy.retry} onAction={directory.loadMore} />
      ) : null}
      {directory.hasMore && !directory.loadMoreError ? (
        <Button
          label={directory.loadingMore ? copy.loadingMore : copy.loadMore}
          loading={directory.loadingMore}
          onPress={directory.loadMore}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { marginBottom: tokens.spacing.sm },
  count: { marginBottom: tokens.spacing.xs, marginTop: tokens.spacing.xs },
  failure: { gap: tokens.spacing.xs, marginBottom: tokens.spacing.sm },
});
