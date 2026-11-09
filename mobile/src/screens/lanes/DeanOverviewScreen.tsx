import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, Card, Notice, SectionHeading, StatePanel, StatStrip, StatusPill, UiText } from '../../components/Ui';
import { ChartSummary } from '../../components/ui/chart-summary';
import { ChoiceField } from '../../components/ui/choice-field';
import { fillCopy } from '../../i18n/academic-messages';
import { countForm } from '../../i18n/locale';
import { useLocale } from '../../i18n/locale-provider';
import { minTapTarget, tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { laneApi, type DeanOverview } from './lane-api';
import { LaneShell, QueueCard, laneStyles, useLaneRequest, useLanesCopy } from './lane-ui';
import type { LanesCopy } from '../../i18n/lanes-messages';

const GROUP_PAGE = 20;

type DeanGroup = NonNullable<DeanOverview['groups']>[number];
type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

function deanStatusTone(status: string | undefined): StatusTone {
  switch (status) {
    case 'APPROVED':
    case 'COMPLETED':
      return 'success';
    case 'PENDING':
    case 'SUBMITTED':
    case 'ASSIGNED':
      return 'warning';
    case 'REJECTED':
    case 'CANCELLED':
      return 'error';
    default:
      return 'neutral';
  }
}

function GroupStatusPill({ status, copy }: { status: string | undefined; copy: LanesCopy }) {
  if (!status) return null;
  return <StatusPill label={copy.deanStatus[status] ?? status} tone={deanStatusTone(status)} />;
}

function DeanGroupRow({ group, copy, formatNumber }: {
  group: DeanGroup;
  copy: LanesCopy;
  formatNumber: (value: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const members = group.members ?? [];
  const supervisors = group.supervisors ?? [];
  const title = group.topicTitle || copy.deanNoTitle;
  const memberText = fillCopy(countForm(members.length, copy.deanMembersOne, copy.deanMembers), { n: formatNumber(members.length) });
  return (
    <Card style={styles.groupCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.groupHead}
      >
        <View style={styles.groupHeadCopy}>
          <UiText variant="label">{title}</UiText>
          <UiText variant="bodySmall" tone="muted">{group.departmentName || '—'}</UiText>
          <UiText variant="bodySmall" tone="muted">{memberText}</UiText>
        </View>
        <View style={styles.groupBadges}>
          <GroupStatusPill status={group.status} copy={copy} />
          <GroupStatusPill status={group.approvalStatus} copy={copy} />
          <MaterialCommunityIcons
            accessible={false}
            name={open ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.textMuted}
          />
        </View>
      </Pressable>
      {open ? (
        <View style={[styles.groupDetail, { borderTopColor: colors.outlineVariant }]}>
          <UiText variant="label" tone="muted">{copy.deanMembersHeading}</UiText>
          {members.map((member, index) => (
            <View key={`${member.studentNumber ?? member.displayName ?? index}`} style={styles.memberRow}>
              <UiText variant="bodySmall">{member.displayName || member.studentNumber || '—'}</UiText>
              {member.studentNumber ? <UiText variant="meta" tone="muted">{member.studentNumber}</UiText> : null}
              {member.isLeader ? <StatusPill label={copy.deanLeaderBadge} tone="primary" icon="crown-outline" /> : null}
              {member.isExternal ? <StatusPill label={copy.deanExternalBadge} tone="neutral" /> : null}
            </View>
          ))}
          <UiText variant="label" tone="muted">{copy.deanSupervisorsHeading}</UiText>
          {supervisors.length === 0 ? <UiText variant="bodySmall" tone="muted">{copy.deanNoSupervisor}</UiText> : null}
          {supervisors.map((supervisor) => (
            <View key={supervisor.lecturerId ?? supervisor.displayName} style={styles.supervisorRow}>
              <View style={styles.inline}>
                <UiText variant="bodySmall">{supervisor.displayName || supervisor.lecturerId}</UiText>
                {supervisor.employeeId ? <UiText variant="meta" tone="muted">{supervisor.employeeId}</UiText> : null}
              </View>
              {supervisor.departmentName ? <UiText variant="meta" tone="muted">{supervisor.departmentName}</UiText> : null}
            </View>
          ))}
          {group.rejectionReason ? <Notice tone="error" message={group.rejectionReason} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

/** Faculty thesis overview for one round. Read-only; the server scopes it to the dean's own faculty. */
export function DeanOverviewScreen() {
  const { copy } = useLanesCopy();
  const { formatNumber } = useLocale();
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

      list={{ data: roundList.length ? [
        ...(overview.data?.supervisors ?? []).map((row) => ({ kind: 'supervisor' as const, row })),
        { kind: 'groupsHeading' as const },
        ...shown.map((group) => ({ kind: 'group' as const, group })),
      ] : [],
        keyExtractor: (entry, index) => entry.kind === 'supervisor' ? `supervisor:${entry.row.lecturerId ?? index}`
          : entry.kind === 'group' ? `group:${entry.group.id ?? index}` : 'groupsHeading',
        renderItem: ({ item: entry, index }) => {
          if (entry.kind === 'groupsHeading') return <><SectionHeading title={copy.deanGroups} />{groups.length === 0 ? <StatePanel kind="empty" title={copy.empty} /> : null}</>;
          if (entry.kind === 'supervisor') {
            const row = entry.row;
            const groupCount = row.supervisedGroups ?? 0;
            const topicCount = row.supervisedTopics ?? 0;
            const groupText = fillCopy(countForm(groupCount, copy.deanGroupCountOne, copy.deanGroupCount), { n: formatNumber(groupCount) });
            const topicText = fillCopy(countForm(topicCount, copy.deanTopicCountOne, copy.deanTopicCount), { n: formatNumber(topicCount) });
            return <QueueCard
              title={row.displayName ?? row.lecturerId ?? ''}
              count={row.supervisedGroups ? groupText : undefined}
              lines={[row.departmentName, fillCopy(copy.deanSupervised, { groups: groupText, topics: topicText })]}
              copy={copy}
            />;
          }
          const group = entry.group;
          return <DeanGroupRow key={group.id ?? index} group={group} copy={copy} formatNumber={formatNumber} />; },
        footer: <>{roundList.length === 0 ? null : (<View><View style={laneStyles.stack}>{null}
          </View>
          {groups.length > shown.length ? <Button label={copy.loadMore} variant="secondary" onPress={() => setPages((current) => current + 1)} /> : null}
        </View>)}
    </>,
      }}
    >
      {roundList.length === 0 ? (
        <StatePanel kind="empty" title={copy.deanNoRounds} />
      ) : (<View>
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
            <UiText variant="bodySmall" tone="muted" style={{ marginBottom: 8 }}>
              {overview.data.faculty.facultyName}
            </UiText>
          ) : null}

          <View style={laneStyles.stack}>
            <StatStrip
              items={[
                { icon: 'account-group-outline', label: copy.deanTotalGroups, value: formatNumber(stats?.totalGroups ?? 0) },
                { icon: 'clock-outline', label: copy.deanPending, value: formatNumber(stats?.groupsPendingApproval ?? 0) },
                { icon: 'check-circle-outline', label: copy.deanApproved, value: formatNumber(stats?.groupsApproved ?? 0) },
                { icon: 'file-document-outline', label: copy.deanWithoutTopic, value: formatNumber(stats?.groupsWithoutTopic ?? 0) },
                { icon: 'account-multiple-outline', label: copy.deanStudentsInvolved, value: formatNumber(stats?.totalMembers ?? 0) },
                { icon: 'book-open-page-variant-outline', label: copy.deanFacultyTopics, value: formatNumber(stats?.facultyTopics ?? 0) },
                { icon: 'account-tie-outline', label: copy.deanSupervisingLecturers, value: formatNumber(stats?.supervisorCount ?? 0) },
              ]}
            />

            <ChartSummary
              title={copy.deanByDepartment}
              series={(stats?.byDepartment ?? []).map((row) => ({ label: row.departmentName ?? row.departmentId ?? '', value: row.groupCount ?? 0 }))}
            />

            <SectionHeading title={copy.deanSupervisors} />
            <UiText variant="bodySmall" tone="muted" style={{ marginBottom: tokens.spacing.sm }}>{copy.deanSupervisorsSubtitle}</UiText>
          </View>
          </View>)}</LaneShell>
  );
}

const styles = StyleSheet.create({
  groupCard: { marginBottom: tokens.spacing.sm, padding: 0 },
  groupHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: tokens.spacing.sm, justifyContent: 'space-between', minHeight: minTapTarget, padding: tokens.spacing.md },
  groupHeadCopy: { flex: 1, minWidth: 0, gap: tokens.spacing.xs },
  groupBadges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacing.xs },
  groupDetail: { borderTopWidth: StyleSheet.hairlineWidth, gap: tokens.spacing.sm, padding: tokens.spacing.md },
  memberRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacing.xs, minHeight: tokens.spacing.xl },
  supervisorRow: { gap: tokens.spacing.xs },
  inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacing.xs },
});
