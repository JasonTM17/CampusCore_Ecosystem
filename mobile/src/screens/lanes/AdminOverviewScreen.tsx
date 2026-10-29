import { View } from 'react-native';

import {
  Card,
  Divider,
  ListRow,
  ScreenSpacer,
  SectionCard,
  StatStrip,
  UiText,
} from '../../components/Ui';
import { ChartSummary } from '../../components/ui/chart-summary';
import { useLocale } from '../../i18n/locale-provider';
import type { MobileScreenProps } from '../../navigation/types';
import type { LaneScreenId } from '../../navigation/routes';
import { laneApi } from './lane-api';
import { LaneShell, useLaneRequest, useLanesCopy } from './lane-ui';

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
        <StatStrip
          items={[
            { icon: 'account-group-outline', label: copy.adminTotals, value: formatNumber(data?.totals?.total ?? 0) },
            { icon: 'arrow-up-circle-outline', label: copy.adminUp, value: formatNumber(data?.totals?.up ?? 0) },
            { icon: 'arrow-down-circle-outline', label: copy.adminDown, value: formatNumber(data?.totals?.down ?? 0) },
          ]}
        />
        <ScreenSpacer />
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
        <ScreenSpacer />
        <SectionCard icon="tune-vertical-variant" title={copy.adminShortcuts}>
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
