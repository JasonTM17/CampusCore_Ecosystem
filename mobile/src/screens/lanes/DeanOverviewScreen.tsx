import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, MetricCard, SectionHeading, StatePanel, UiText } from '../../components/Ui';
import { ChartSummary } from '../../components/ui/chart-summary';
import { ChoiceField } from '../../components/ui/choice-field';
import { fillCopy } from '../../i18n/academic-messages';
import { laneApi } from './lane-api';
import { LaneShell, QueueCard, laneStyles, useLaneRequest, useLanesCopy } from './lane-ui';

const GROUP_PAGE = 20;

/** Faculty thesis overview for one round. Read-only; the server scopes it to the dean's own faculty. */
export function DeanOverviewScreen() {
  const { copy } = useLanesCopy();
  const rounds = useLaneRequest(() => laneApi.thesisRounds(), 'dean:rounds');
  const [picked, setPicked] = useState('');
  const roundList = rounds.data ?? [];
  const roundId = roundList.some((round) => round.id === picked) ? picked : roundList[0]?.id ?? '';
  const overview = useLaneRequest(() => laneApi.deanOverview(roundId), `dean:overview:${roundId}`, Boolean(roundId));
  const [pages, setPages] = useState(1);
  useEffect(() => setPages(1), [roundId]);

  const stats = overview.data?.stats;
  const groups = overview.data?.groups ?? [];
  const shown = groups.slice(0, pages * GROUP_PAGE);
  const loading = rounds.loading || (Boolean(roundId) && overview.loading);
  const error = rounds.error ?? overview.error;

  return (
    <LaneShell
      title={copy.titles['dean.overview']}
      loading={loading}
      error={error}
      onRetry={() => { void rounds.reload(); void overview.reload(); }}
    >
      {roundList.length === 0 ? (
        <StatePanel kind="empty" title={copy.deanNoRounds} />
      ) : (
        <View>
          {roundList.length > 1 ? (
            <ChoiceField
              label={copy.deanRound}
              display="sheet"
              options={roundList.map((round) => ({ value: round.id, label: round.name }))}
              value={roundId}
              onChange={setPicked}
            />
          ) : null}
          {overview.data?.faculty?.facultyName ? (
            <UiText variant="bodySmall" tone="muted">{overview.data.faculty.facultyName}</UiText>
          ) : null}
          <View style={laneStyles.metrics}>
            <MetricCard label={copy.deanTotalGroups} value={String(stats?.totalGroups ?? 0)} style={laneStyles.metric} />
            <MetricCard label={copy.deanPending} value={String(stats?.groupsPendingApproval ?? 0)} style={laneStyles.metric} />
            <MetricCard label={copy.deanApproved} value={String(stats?.groupsApproved ?? 0)} style={laneStyles.metric} />
            <MetricCard label={copy.deanRejected} value={String(stats?.groupsRejected ?? 0)} style={laneStyles.metric} />
            <MetricCard label={copy.deanNoTopic} value={String(stats?.groupsWithoutTopic ?? 0)} style={laneStyles.metric} />
          </View>
          <ChartSummary
            title={copy.deanByDepartment}
            series={(stats?.byDepartment ?? []).map((row) => ({ label: row.departmentName ?? row.departmentId ?? '', value: row.groupCount ?? 0 }))}
          />
          <SectionHeading title={copy.deanSupervisors} />
          <View style={laneStyles.stack}>
            {(overview.data?.supervisors ?? []).map((row, index) => (
              <QueueCard
                key={row.lecturerId ?? index}
                title={row.displayName ?? row.lecturerId ?? ''}
                lines={[row.departmentName, fillCopy(copy.deanSupervised, { groups: row.supervisedGroups ?? 0, topics: row.supervisedTopics ?? 0 })]}
                copy={copy}
              />
            ))}
          </View>
          <SectionHeading title={copy.deanGroups} />
          {groups.length === 0 ? <StatePanel kind="empty" title={copy.empty} /> : null}
          {shown.map((group, index) => (
            <QueueCard
              key={group.id ?? index}
              title={group.topicTitle || copy.deanNoTitle}
              status={group.approvalStatus}
              lines={[
                group.departmentName,
                fillCopy(copy.deanMembers, { n: group.members?.length ?? 0 }),
                (group.supervisors ?? []).map((supervisor) => supervisor.displayName).filter(Boolean).join(', '),
              ]}
              copy={copy}
            />
          ))}
          {groups.length > shown.length ? <Button label={copy.loadMore} variant="secondary" onPress={() => setPages((current) => current + 1)} /> : null}
        </View>
      )}
    </LaneShell>
  );
}
