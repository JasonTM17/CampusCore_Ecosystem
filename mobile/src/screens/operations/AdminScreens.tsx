import { View } from 'react-native';

import { WebOnlyPanel } from './shared/helpers';
import { useOpsStyles } from './shared/styles';

export function AdminDashboardScreen() {
  const styles = useOpsStyles();
  return <WebOnlyPanel title="Admin dashboard" />;
}


export function AdminStudentsScreen() {
  const styles = useOpsStyles();
  return <WebOnlyPanel title="Manage students" />;
}


export function AdminLecturersScreen() {
  const styles = useOpsStyles();
  return <WebOnlyPanel title="Manage lecturers" />;
}
