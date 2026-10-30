import type { MobileScreenProps } from '../../navigation/types';
import { EnrollmentWorkspace } from '../academic/EnrollmentWorkspace';

/** The courses route is the enrollment workspace; it opens on the active tab. */
export function CoursesScreen({ navigation }: MobileScreenProps) {
  return <EnrollmentWorkspace navigation={navigation} title="coursesTitle" />;
}
