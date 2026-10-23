import type { ComponentType } from 'react';

import { SignInScreen } from './auth/SignInScreen';
import { AssistantChatScreen } from './assistant/AssistantScreen';
import {
  AdminDashboardScreen,
  AdminLecturersScreen,
  AdminStudentsScreen,
  LecturerAttendanceScreen,
  LecturerDashboardScreen,
  LecturerGradingScreen,
  LecturerScheduleScreen,
} from './operations/OperationsScreens';
import { EventsScreen } from './student/EventsScreen';
import { LearningScreen } from './student/LearningScreen';
import { AdmissionsScreen } from './student/AdmissionsScreen';
import { LibraryScreen } from './student/LibraryScreen';
import { CareersScreen } from './student/CareersScreen';
import {
  AttendanceScreen,
  CoursesScreen,
  GradesScreen,
  NotificationsScreen,
  ProfileScreen,
  RegistrationScreen,
  ScheduleScreen,
  StudentDashboardScreen,
} from './student/StudentScreens';
import {
  ThesisDetailScreen,
  ThesisProgressScreen,
  ThesisRegistrationScreen,
  ThesisTopicsScreen,
} from './thesis/ThesisScreens';
import type { ScreenName } from '../navigation/routes';
import type { MobileScreenProps } from '../navigation/types';

export const screenComponents: Record<ScreenName, ComponentType<MobileScreenProps>> = {
  'auth.signIn': SignInScreen,
  'dashboard.student': StudentDashboardScreen,
  schedule: ScheduleScreen,
  courses: CoursesScreen,
  grades: GradesScreen,
  attendance: AttendanceScreen,
  registration: RegistrationScreen,
  events: EventsScreen,
  learning: LearningScreen,
  admissions: AdmissionsScreen,
  library: LibraryScreen,
  careers: CareersScreen,
  notifications: NotificationsScreen,
  profile: ProfileScreen,
  'thesis.topics': ThesisTopicsScreen,
  'thesis.detail': ThesisDetailScreen,
  'thesis.registration': ThesisRegistrationScreen,
  'thesis.progress': ThesisProgressScreen,
  'assistant.chat': AssistantChatScreen,
  'admin.dashboard': AdminDashboardScreen,
  'admin.students': AdminStudentsScreen,
  'admin.lecturers': AdminLecturersScreen,
  'lecturer.dashboard': LecturerDashboardScreen,
  'lecturer.schedule': LecturerScheduleScreen,
  'lecturer.grading': LecturerGradingScreen,
  'lecturer.attendance': LecturerAttendanceScreen,
};
