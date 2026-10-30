import type { ComponentType } from 'react';

import { StatePanel, ScreenShell } from '../../components/Ui';
import { LANE_FLAGS } from '../../config/lane-flags';
import { useMobileNavigation } from '../../navigation/router-adapter';
import type { LaneScreenId, ScreenName, UserRole } from '../../navigation/routes';
import type { MobileScreenProps } from '../../navigation/types';
import { useSession } from '../../session/SessionContext';
import {
  AdminAttendanceScreen,
  AdminAuditScreen,
  AdminCreditLimitsScreen,
  AdminEnrollmentsScreen,
  AdminEventsScreen,
  AdminNotificationsScreen,
} from './AdminLaneScreens';
import { AdminOverviewScreen } from './AdminOverviewScreen';
import { DeanOverviewScreen } from './DeanOverviewScreen';
import { CheckinScreen } from '../attendance-checkin/CheckinScreen';
import { laneAllowed } from './lane-access';
import { useLanesCopy } from './lane-ui';
import { ApplyReviewScreen, CareersDeskScreen, LibraryDeskScreen } from './StaffDeskScreens';

const HOME: Readonly<Record<UserRole, ScreenName>> = {
  student: 'dashboard.student',
  lecturer: 'lecturer.dashboard',
  admin: 'admin.dashboard',
};

/**
 * Lane screens by id. Kept apart from `screenComponents` on purpose: a lane is
 * not part of the always-on registry and is reached only through `LaneRoute`.
 */
export const laneComponents: Readonly<Record<LaneScreenId, ComponentType<MobileScreenProps>>> = {
  'dean.overview': DeanOverviewScreen,
  'staff.applyReview': ApplyReviewScreen,
  'staff.careersDesk': CareersDeskScreen,
  'staff.libraryDesk': LibraryDeskScreen,
  'admin.overview': AdminOverviewScreen,
  'admin.attendance': AdminAttendanceScreen,
  'admin.audit': AdminAuditScreen,
  'admin.creditLimits': AdminCreditLimitsScreen,
  'admin.enrollments': AdminEnrollmentsScreen,
  'admin.events': AdminEventsScreen,
  'admin.notifications': AdminNotificationsScreen,
  'attendance.checkin': CheckinScreen,
};

/**
 * Route host for one lane. The (app) layout guard already refuses a lane path
 * without flag and grant; this repeats the same rule at render time so the lane
 * content can never mount for a session that is not allowed, whatever mounted it.
 */
export function LaneRoute({ id }: { id: LaneScreenId }) {
  const navigation = useMobileNavigation();
  const session = useSession();
  const { copy } = useLanesCopy();
  const allowed = laneAllowed({ kind: session.kind, role: session.role, capabilities: session.capabilities, flags: LANE_FLAGS, id });
  if (!allowed) {
    const home: ScreenName = HOME[session.role];
    return (
      <ScreenShell title={copy.deniedTitle}>
        <StatePanel
          kind="error"
          title={copy.deniedTitle}
          description={copy.deniedBody}
          actionLabel={copy.backHome}
          onAction={() => navigation.navigate(home)}
        />
      </ScreenShell>
    );
  }
  const Component = laneComponents[id];
  return <Component navigation={navigation} role={session.role} selectedThesisTopicId={null} />;
}
