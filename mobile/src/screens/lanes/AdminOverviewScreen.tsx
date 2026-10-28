import { View } from 'react-native';

import { Card, Divider, ListRow, MetricCard, SectionHeading, UiText } from '../../components/Ui';
import { ChartSummary } from '../../components/ui/chart-summary';
import { useLocale } from '../../i18n/locale-provider';
import type { MobileScreenProps } from '../../navigation/types';
import type { LaneScreenId } from '../../navigation/routes';
import { laneApi } from './lane-api';
import { LaneShell, laneStyles, useLaneRequest, useLanesCopy } from './lane-ui';

const DETAIL_LANES: readonly LaneScreenId[] = ['admin.attendance', 'admin.enrollments', 'admin.creditLimits', 'admin.events', 'admin.notifications', 'admin.audit'];

/** Read-only oversight from the existing analytics endpoint; charts carry a text alternative. */
export function AdminOverviewScreen({ navigation }: MobileScreenProps) {
  const { copy } = useLanesCopy();
  const { formatNumber } = useLocale();
  const overview = useLaneRequest(() => laneApi.analytics(), 'admin:overview');
  const data = overview.data;

  return (
    <LaneShell title={copy.titles['admin.overview']} loading={overview.loading} error={overview.error} onRetry={() => void overview.reload()}>
      <View>
        <View style={laneStyles.metrics}>
          <MetricCard label={copy.adminTotals} value={formatNumber(data?.totals?.total ?? 0)} style={laneStyles.metric} />
          <MetricCard label={copy.adminUp} value={formatNumber(data?.totals?.up ?? 0)} style={laneStyles.metric} />
          <MetricCard label={copy.adminDown} value={formatNumber(data?.totals?.down ?? 0)} style={laneStyles.metric} />
        </View>
        <ChartSummary
          title={copy.adminChartTitle}
          series={(data?.gradeDistribution ?? []).map((row) => ({ label: row.grade ?? '', value: row.count ?? 0 }))}
        />
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
        <SectionHeading title={copy.adminShortcuts} />
        <Card>
          {DETAIL_LANES.map((id, index) => (
            <View key={id}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                title={copy.titles[id]}
                onPress={() => navigation.navigateLane?.(id)}
                trailing={<UiText variant="bodyMedium" tone="muted">›</UiText>}
              />
            </View>
          ))}
        </Card>
      </View>
    </LaneShell>
  );
}
