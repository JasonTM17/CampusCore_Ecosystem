import { StyleSheet, View } from 'react-native';

import {
  Divider,
  ListRow,
  Notice,
  ScreenSpacer,
  SectionCard,
  SectionHeading,
  StatStrip,
  StatusPill,
  UiText,
} from '../../components/Ui';
import { ChartSummary } from '../../components/ui/chart-summary';
import { ResponsiveGrid } from '../../components/ui/ResponsiveGrid';
import { tokens } from '../../design/tokens';
import { useLocale } from '../../i18n/locale-provider';
import type { MobileScreenProps } from '../../navigation/types';
import type { LaneScreenId } from '../../navigation/routes';
import { laneApi } from './lane-api';
import { LaneShell, laneStyles, useLaneRequest, useLanesCopy } from './lane-ui';

const DETAIL_LANES: readonly { id: LaneScreenId; icon: string }[] = [
  { id: 'admin.attendance', icon: 'calendar-check-outline' },
  { id: 'admin.enrollments', icon: 'clipboard-list-outline' },
  { id: 'admin.creditLimits', icon: 'credit-card-plus-outline' },
  { id: 'admin.events', icon: 'calendar-star-outline' },
  { id: 'admin.notifications', icon: 'bell-outline' },
  { id: 'admin.audit', icon: 'history' },
];

/** Read-only oversight from the existing analytics endpoint; charts carry a text alternative. */
export function AdminOverviewScreen({ navigation }: MobileScreenProps) {
  const { copy } = useLanesCopy();
  const { formatNumber } = useLocale();
  const overview = useLaneRequest(() => laneApi.analytics(), 'admin:overview');
  const data = overview.data;

  return (
    <LaneShell
      title={copy.titles['admin.overview']}
      loading={overview.loading}
      error={overview.error}
      onRetry={() => void overview.reload()}
    >
      <View>
        <SectionHeading title={copy.adminOverviewTitle} />
        <UiText variant="bodySmall" tone="muted" style={styles.overviewDescription}>{copy.adminOverviewDescription}</UiText>
        <StatStrip
          items={[
            { icon: 'account-group-outline', label: copy.adminTotalUsers, value: formatNumber(data?.totals?.students ?? 0) },
            { icon: 'account-tie-outline', label: copy.adminTotalLecturers, value: formatNumber(data?.totals?.lecturers ?? 0) },
            { icon: 'book-open-page-variant-outline', label: copy.adminTotalCourses, value: formatNumber(data?.totals?.courses ?? 0) },
            { icon: 'clipboard-list-outline', label: copy.adminTotalEnrollments, value: formatNumber(data?.totals?.enrollments ?? 0) },
          ]}
        />
        <ScreenSpacer />
        <View style={laneStyles.stack}>
          <View style={styles.analyticsHeading}>
            <UiText accessibilityRole="header" variant="headlineSmall" style={styles.analyticsTitle}>{copy.adminAnalytics}</UiText>
            <StatusPill label={copy.adminAnalyticsLive} tone="success" />
          </View>
          <Notice tone="success" message={copy.adminAnalyticsNotice} />
          <ResponsiveGrid>
            <ChartSummary
              title={copy.adminDepartments}
              series={(data?.departments ?? []).map((row) => ({ label: row.code ?? row.name ?? '', value: row.students ?? 0 }))}
            />
            <ChartSummary
              title={copy.adminTrends}
              kind="sparkline"
              unit="%"
              series={(data?.semesterTrends ?? []).map((row) => ({ label: row.semester ?? '', value: row.completionRate ?? 0 }))}
            />
            <ChartSummary
              title={copy.adminFaculty}
              series={(data?.facultyRanks ?? []).map((row) => ({ label: copy.adminFacultyRanks[row.rank ?? ''] ?? row.rank ?? '', value: row.count ?? 0 }))}
            />
            <ChartSummary
              title={copy.adminChartTitle}
              series={(data?.gradeDistribution ?? []).map((row) => ({ label: row.grade ?? '', value: row.count ?? 0 }))}
            />
          </ResponsiveGrid>
        </View>
        <ScreenSpacer />
        <SectionCard icon="tune-vertical-variant" title={copy.adminTools}>
          <UiText variant="bodySmall" tone="muted" style={styles.toolsDescription}>{copy.adminToolsDescription}</UiText>
          {DETAIL_LANES.map(({ id, icon }, index) => (
            <View key={id}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                icon={icon as never}
                title={copy.titles[id]}
                onPress={() => navigation.navigateLane?.(id)}
                trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
              />
            </View>
          ))}
        </SectionCard>
      </View>
    </LaneShell>
  );
}

const styles = StyleSheet.create({
  overviewDescription: { marginBottom: tokens.spacing.md },
  analyticsHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacing.sm },
  analyticsTitle: { flexShrink: 1 },
  toolsDescription: { marginBottom: tokens.spacing.sm },
});
