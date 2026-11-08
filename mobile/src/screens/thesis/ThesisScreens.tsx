import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, StatePanel, UiText } from '../../components/Ui';
import { ScrollableScreenShell as ScreenShell } from '../../components/perf/list-screen-shell';
import { SearchBar, SegmentedControl } from '../../components/ui/primitives';
import { tokens } from '../../design/tokens';
import { useWindowClass } from '../../design/theme';
import { countForm } from '../../i18n/locale';
import { fillThesisCopy, type ThesisCopy } from '../../i18n/thesis-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { AdvisorCard, ThesisAdvisorsView } from './ThesisAdvisorsView';
import { ThesisRoundPicker } from './ThesisRoundPicker';
import { QueryNotices, RoundCard, TopicCard, useThesisUi } from './thesis-ui';
import { THESIS_ADVISOR_TOPIC_CAP, type AdvisorEntry, type ThesisTopic } from './thesis-model';
import { useActiveThesisRound, useAdvisorDirectory, useThesisTopics } from './use-thesis';

export { ThesisDetailScreen } from './ThesisDetailScreen';
export { ThesisProgressScreen } from './ThesisProgressScreen';
export { ThesisRegistrationScreen } from './ThesisRegistrationScreen';

type ThesisView = 'topics' | 'round' | 'advisors';

function NoRounds({ copy }: { copy: ThesisCopy }) {
  return <StatePanel kind="empty" title={copy.noRounds} description={copy.noRoundsBody} />;
}

const SEARCH_DEBOUNCE_MS = 300;

/** Topic search is a server read, so the term is sent once typing settles. */
function useSearchTerm(query: string): string {
  const [term, setTerm] = useState('');
  useEffect(() => {
    const next = query.trim();
    if (!next) {
      setTerm('');
      return undefined;
    }
    const timer = setTimeout(() => setTerm(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  return term;
}

type ThesisListItem = ThesisTopic | AdvisorEntry;

/** Published topics of the selected round, with the round and advisor views one tap away. */
export function ThesisTopicsScreen({ navigation }: MobileScreenProps) {
  const { copy, locale } = useThesisUi();
  const window = useWindowClass();
  const twoColumns = window.class === 'expanded' && window.fontScale < 1.3;
  const active = useActiveThesisRound();
  const roundId = active.round?.id ?? null;
  const [view, setView] = useState<ThesisView>('topics');
  const [query, setQuery] = useState('');
  const term = useSearchTerm(query);
  const topics = useThesisTopics(roundId, term);
  const directory = useAdvisorDirectory(roundId, view === 'advisors');
  const visible = topics.items;
  const searching = term.length > 0;
  const topicsIdle = !topics.loading && !topics.error;
  const directoryIdle = !directory.loading && !directory.error;
  const topicCount = topics.total ?? topics.items.length;

  return (
    <ScreenShell<ThesisListItem>
      title={copy.topicsTitle}
      headerAction={<Button label={copy.myGroup} onPress={() => navigation.navigate('thesis.progress')} variant="text" />}
      list={{
        initialNumToRender: 20,
        numColumns: (twoColumns && view === 'topics') ? 2 : 1,
        columnWrapperStyle: (twoColumns && view === 'topics') ? styles.columns : undefined,
        data: (!active.round ? [] : view === 'topics' ? visible : view === 'advisors' ? directory.entries : []) as ThesisListItem[],
        keyExtractor: (item: ThesisListItem) => ('lecturerId' in item ? item.lecturerId : String(item.id)),
        renderItem: ({ item }: { item: ThesisListItem }) => {
          if (view === 'topics') {
            const topic = item as unknown as ThesisTopic;
            return (
              <View style={twoColumns ? styles.topicHalf : styles.topicFull}>
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  copy={copy}
                  onOpen={() => navigation.navigate('thesis.detail', { thesisTopicId: topic.id })}
                />
              </View>
            );
          }
          if (view === 'advisors') {
            return <AdvisorCard advisor={item as unknown as AdvisorEntry} copy={copy} />;
          }
          return null;
        },
        footer: (
          <>
            {active.round && view === 'topics' ? (
              <>
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
            {active.round && view === 'advisors' ? (
              <>
                {directoryIdle && directory.capped ? (
                  <UiText variant="meta" tone="muted" style={styles.count}>
                    {fillThesisCopy(countForm(THESIS_ADVISOR_TOPIC_CAP, copy.advisorsCappedOne, copy.advisorsCapped), { count: THESIS_ADVISOR_TOPIC_CAP })}
                  </UiText>
                ) : null}
                {directoryIdle && directory.failed > 0 ? (
                  <View style={styles.failure}>
                    <UiText variant="meta" tone="warning">{copy.advisorsLoadFailed}</UiText>
                    <Button label={copy.retry} variant="secondary" onPress={() => void directory.reload()} />
                  </View>
                ) : null}
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
              </>
            ) : null}
          </>
        ),
      }}
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
          {view === 'advisors' ? (
            <>
              <UiText variant="bodySmall" tone="muted" style={styles.count}>{copy.advisorsBody}</UiText>
              <QueryNotices state={directory} copy={copy} />
              {directoryIdle && directory.entries.length === 0 ? <StatePanel kind="empty" title={copy.advisorsEmpty} /> : null}
            </>
          ) : null}
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
                  {fillThesisCopy(countForm(topicCount, copy.topicCountOne, copy.topicCount), { count: topicCount })}
                </UiText>
              ) : null}
              {topicsIdle && visible.length === 0 ? (
                <StatePanel kind="empty" title={searching ? copy.emptyTopicsFiltered : copy.emptyTopics} />
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
  const directory = useAdvisorDirectory(active.round?.id ?? null);
  const idle = !directory.loading && !directory.error;
  return (
    <ScreenShell
      title={copy.advisorsTitle}
      list={{
        data: active.round ? directory.entries : [],
        keyExtractor: (item) => item.lecturerId,
        renderItem: ({ item }) => <AdvisorCard advisor={item} copy={copy} />,
        footer: (
          <>
            {idle && directory.capped ? (
              <UiText variant="meta" tone="muted" style={styles.count}>
                {fillThesisCopy(countForm(THESIS_ADVISOR_TOPIC_CAP, copy.advisorsCappedOne, copy.advisorsCapped), { count: THESIS_ADVISOR_TOPIC_CAP })}
              </UiText>
            ) : null}
            {idle && directory.failed > 0 ? (
              <View style={styles.failure}>
                <UiText variant="meta" tone="warning">{copy.advisorsLoadFailed}</UiText>
                <Button label={copy.retry} variant="secondary" onPress={() => void directory.reload()} />
              </View>
            ) : null}
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
          </>
        ),
      }}
    >
      <QueryNotices state={active} copy={copy} />
      {!active.loading && !active.error && !active.round ? <NoRounds copy={copy} /> : null}
      {active.round ? (
        <>
          <ThesisRoundPicker rounds={active.rounds} current={active.round} onSelect={active.select} copy={copy} />
          <UiText variant="bodySmall" tone="muted" style={styles.count}>{copy.advisorsBody}</UiText>
          <QueryNotices state={directory} copy={copy} />
          {idle && directory.entries.length === 0 ? <StatePanel kind="empty" title={copy.advisorsEmpty} /> : null}
        </>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  columns: { justifyContent: 'space-between' },
  topicHalf: { width: '48.5%' },
  topicFull: { width: '100%' },
  segment: { marginBottom: tokens.spacing.md },
  search: { marginBottom: tokens.spacing.sm },
  count: { marginBottom: tokens.spacing.sm },
  failure: { gap: tokens.spacing.xs, marginBottom: tokens.spacing.sm },
});
