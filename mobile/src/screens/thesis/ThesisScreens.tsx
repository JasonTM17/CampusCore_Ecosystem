import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ScreenShell, StatePanel, UiText } from '../../components/Ui';
import { SearchBar, SegmentedControl } from '../../components/ui/primitives';
import { tokens } from '../../design/tokens';
import { fillThesisCopy, type ThesisCopy } from '../../i18n/thesis-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { ThesisAdvisorsView } from './ThesisAdvisorsView';
import { ThesisRoundPicker } from './ThesisRoundPicker';
import { filterTopics } from './thesis-model';
import { QueryNotices, RoundCard, TopicCard, useThesisUi } from './thesis-ui';
import { useActiveThesisRound, useThesisTopics } from './use-thesis';

export { ThesisDetailScreen } from './ThesisDetailScreen';
export { ThesisProgressScreen } from './ThesisProgressScreen';
export { ThesisRegistrationScreen } from './ThesisRegistrationScreen';

type ThesisView = 'topics' | 'round' | 'advisors';

function NoRounds({ copy }: { copy: ThesisCopy }) {
  return <StatePanel kind="empty" title={copy.noRounds} description={copy.noRoundsBody} />;
}

/** Published topics of the selected round, with the round and advisor views one tap away. */
export function ThesisTopicsScreen({ navigation }: MobileScreenProps) {
  const { copy, locale } = useThesisUi();
  const active = useActiveThesisRound();
  const roundId = active.round?.id ?? null;
  const topics = useThesisTopics(roundId);
  const [view, setView] = useState<ThesisView>('topics');
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterTopics(topics.items, query), [topics.items, query]);
  const searching = query.trim().length > 0;
  const topicsIdle = !topics.loading && !topics.error;

  return (
    <ScreenShell
      title={copy.topicsTitle}
      headerAction={<Button label={copy.myGroup} onPress={() => navigation.navigate('thesis.progress')} variant="text" />}
    >
      <QueryNotices state={active} copy={copy} />
      {!active.loading && !active.error && !active.round ? <NoRounds copy={copy} /> : null}
      {active.round ? (
        <>
          <ThesisRoundPicker rounds={active.rounds} current={active.round} onSelect={active.select} copy={copy} />
          <View style={styles.segment}>
            <SegmentedControl
              accessibilityLabel={copy.viewLabel}
              value={view}
              onChange={(value) => setView(value === 'round' ? 'round' : value === 'advisors' ? 'advisors' : 'topics')}
              options={[
                { value: 'topics', label: copy.tabTopics },
                { value: 'round', label: copy.tabRound },
                { value: 'advisors', label: copy.tabAdvisors },
              ]}
            />
          </View>

          {view === 'round' ? <RoundCard round={active.round} copy={copy} formatDate={locale.formatDate} /> : null}
          {view === 'advisors' ? <ThesisAdvisorsView roundId={roundId} copy={copy} /> : null}
          {view === 'topics' ? (
            <>
              <SearchBar
                value={query}
                onChangeText={setQuery}
                onClear={() => setQuery('')}
                placeholder={copy.search}
                accessibilityLabel={copy.searchLabel}
                style={styles.search}
              />
              <QueryNotices state={{ ...topics, preview: false }} copy={copy} />
              {topicsIdle ? (
                <UiText variant="meta" tone="muted" style={styles.count}>
                  {fillThesisCopy(copy.topicCount, { count: searching ? visible.length : topics.total ?? topics.items.length })}
                </UiText>
              ) : null}
              {topicsIdle && visible.length === 0 ? (
                <StatePanel kind="empty" title={searching ? copy.emptyTopicsFiltered : copy.emptyTopics} />
              ) : null}
              {visible.map((topic) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  copy={copy}
                  onOpen={() => navigation.navigate('thesis.detail', { thesisTopicId: topic.id })}
                />
              ))}
              {topics.loadMoreError ? (
                <StatePanel kind="error" title={topics.loadMoreError} actionLabel={copy.retry} onAction={topics.loadMore} />
              ) : null}
              {topics.hasMore && !topics.loadMoreError ? (
                <Button
                  label={topics.loadingMore ? copy.loadingMore : copy.loadMore}
                  loading={topics.loadingMore}
                  onPress={topics.loadMore}
                  variant="secondary"
                />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </ScreenShell>
  );
}

/** Standalone round detail, for a route the shell may register later. */
export function ThesisRoundScreen(_props: MobileScreenProps) {
  const { copy, locale } = useThesisUi();
  const active = useActiveThesisRound();
  return (
    <ScreenShell title={copy.roundTitle}>
      <QueryNotices state={active} copy={copy} />
      {!active.loading && !active.error && !active.round ? <NoRounds copy={copy} /> : null}
      {active.round ? (
        <>
          <ThesisRoundPicker rounds={active.rounds} current={active.round} onSelect={active.select} copy={copy} />
          <RoundCard round={active.round} copy={copy} formatDate={locale.formatDate} />
        </>
      ) : null}
    </ScreenShell>
  );
}

/** Standalone advisor directory, for a route the shell may register later. */
export function ThesisAdvisorsScreen(_props: MobileScreenProps) {
  const { copy } = useThesisUi();
  const active = useActiveThesisRound();
  return (
    <ScreenShell title={copy.advisorsTitle}>
      <QueryNotices state={active} copy={copy} />
      {!active.loading && !active.error && !active.round ? <NoRounds copy={copy} /> : null}
      {active.round ? (
        <>
          <ThesisRoundPicker rounds={active.rounds} current={active.round} onSelect={active.select} copy={copy} />
          <ThesisAdvisorsView roundId={active.round.id} copy={copy} />
        </>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  segment: { marginBottom: tokens.spacing.md },
  search: { marginBottom: tokens.spacing.sm },
  count: { marginBottom: tokens.spacing.sm },
});
