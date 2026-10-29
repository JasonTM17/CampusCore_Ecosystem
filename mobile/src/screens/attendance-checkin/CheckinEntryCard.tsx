import { View } from 'react-native';

import { Button, Card, IconChip, UiText } from '../../components/Ui';
import { LANE_FLAGS } from '../../config/lane-flags';
import { fillCopy } from '../../i18n/academic-messages';
import { checkinMessages } from '../../i18n/checkin-messages';
import { useLocale } from '../../i18n/locale-provider';
import { laneAllowedForSession, type LaneScreenId } from '../../navigation/routes';
import type { MobileNavigation } from '../../navigation/types';
import { NO_CAPABILITIES } from '../../auth/capabilities';
import type { SessionValue } from '../../session/SessionContext';
import { useCheckinOpenSessions } from './use-checkin-sessions';
import type { AttendanceApi } from '../../attendance-checkin';
import { useCheckinStyles } from './checkin-styles';

const LANE: LaneScreenId = 'attendance.checkin';

/**
 * SessionContext drags the native session store into the import graph; require
 * it lazily and fail closed (same idea as NotificationsScreen's optional read).
 */
function useOptionalSession(): SessionValue | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSession } = require('../../session/SessionContext') as typeof import('../../session/SessionContext');
    return useSession();
  } catch {
    return null;
  }
}

/**
 * Conditional "Check in" entry point (student dashboard + Attendance screen).
 * Renders only when the lane is open for this session AND open attendance
 * sessions exist. The lecturer deep link works regardless — it carries the id.
 */
export function CheckinEntryCard({ api, navigation }: { api?: AttendanceApi; navigation: MobileNavigation }) {
  const session = useOptionalSession();
  const { locale } = useLocale();
  const copy = checkinMessages[locale];
  const styles = useCheckinStyles();
  const allowed = session !== null && laneAllowedForSession({
    kind: session.kind,
    role: session.role,
    capabilities: session.capabilities ?? NO_CAPABILITIES,
    flags: LANE_FLAGS,
    id: LANE,
  });
  const openCount = useCheckinOpenSessions(allowed, api);

  if (!allowed || openCount === 0) return null;

  return (
    <Card>
      <View style={styles.entryRow} testID="checkin-entry">
        <IconChip icon="map-marker-check-outline" size={32} />
        <View style={styles.entryCopy}>
          <UiText variant="bodyMedium">{copy.entryTitle}</UiText>
          <UiText variant="bodySmall" tone="muted">{fillCopy(copy.entryDetail, { n: openCount })}</UiText>
        </View>
        <View testID="checkin-entry-open">
          <Button
            label={copy.entryAction}
            onPress={() => navigation.navigateLane?.(LANE)}
            variant="secondary"
          />
        </View>
      </View>
    </Card>
  );
}
