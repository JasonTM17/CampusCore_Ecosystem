import type { MobileScreenProps } from '../../navigation/types';
import { EnrollmentWorkspace } from './EnrollmentWorkspace';

export function EnrollmentsScreen({ navigation }: MobileScreenProps) {
  return <EnrollmentWorkspace navigation={navigation} title="enrollmentsTitle" />;
}
