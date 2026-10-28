import type { MobileScreenProps } from '../../navigation/types';
import { LaneEntries } from '../lanes/LaneEntries';
import { WebOnlyPanel, useOpsCopy } from './shared/helpers';

// Native admin work lives in the flag-gated lane screens (src/screens/lanes).
// These registry screens stay the always-on hand-off to the portal resource
// that owns each task, with no data of their own.

export function AdminDashboardScreen({ navigation }: MobileScreenProps) {
  const { copy } = useOpsCopy();
  return (
    <WebOnlyPanel title={copy.adminDashboardTitle} path="/admin">
      <LaneEntries groups={['admin', 'staff']} navigation={navigation} />
    </WebOnlyPanel>
  );
}

export function AdminStudentsScreen() {
  const { copy } = useOpsCopy();
  return <WebOnlyPanel title={copy.adminStudentsTitle} path="/admin/users" />;
}

export function AdminLecturersScreen() {
  const { copy } = useOpsCopy();
  return <WebOnlyPanel title={copy.adminLecturersTitle} path="/admin/lecturers" />;
}
