import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { hasCapability, type Capability, type CapabilitySet } from '../auth/capabilities';

export type NavigationIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
export type UserRole = 'student' | 'lecturer' | 'admin';

export type ScreenName =
  | 'auth.signIn'
  | 'auth.forgotPassword'
  | 'auth.resetPassword'
  | 'auth.loggedOut'
  | 'dashboard.student'
  | 'schedule'
  | 'courses'
  | 'grades'
  | 'transcript'
  | 'curriculum'
  | 'enrollments'
  | 'attendance'
  | 'registration'
  | 'events'
  | 'learning'
  | 'admissions'
  | 'library'
  | 'careers'
  | 'news'
  | 'docs'
  | 'notifications'
  | 'announcements'
  | 'conduct'
  | 'certificates'
  | 'profile'
  | 'thesis.topics'
  | 'thesis.detail'
  | 'thesis.registration'
  | 'thesis.progress'
  | 'assistant.chat'
  | 'admin.dashboard'
  | 'admin.students'
  | 'admin.lecturers'
  | 'lecturer.dashboard'
  | 'lecturer.schedule'
  | 'lecturer.grading'
  | 'lecturer.attendance';

/**
 * Flag-gated lane screens. They are deliberately not `ScreenName` members:
 * the registry above stays the always-on surface, and a lane screen exists
 * only for a session whose capability set grants it.
 */
export type LaneScreenId =
  | 'dean.overview'
  | 'staff.applyReview'
  | 'staff.careersDesk'
  | 'staff.libraryDesk'
  | 'admin.overview'
  | 'admin.attendance'
  | 'admin.audit'
  | 'admin.creditLimits'
  | 'admin.enrollments'
  | 'admin.events'
  | 'admin.notifications';

export interface LaneScreenDefinition {
  id: LaneScreenId;
  title: string;
  /** UI role the lane renders under; null = any signed-in role (per-desk grant). */
  role: UserRole | null;
  capability: Capability;
  icon: NavigationIconName;
}

export type ScreenFamily =
  | 'auth'
  | 'student'
  | 'thesis'
  | 'assistant'
  | 'staff';

export interface ScreenDefinition {
  name: ScreenName;
  title: string;
  family: ScreenFamily;
  roles: readonly UserRole[];
  icon: NavigationIconName;
}

export interface BottomNavigationItem {
  route: ScreenName;
  label: string;
  icon: NavigationIconName;
}

export interface StitchMobileReference {
  id: string;
  title: string;
}

const allRoles: readonly UserRole[] = ['student', 'lecturer', 'admin'];
const studentRoles: readonly UserRole[] = ['student'];
const lecturerRoles: readonly UserRole[] = ['lecturer'];
const adminRoles: readonly UserRole[] = ['admin'];

export const screenRegistry: readonly ScreenDefinition[] = [
  { name: 'auth.signIn', title: 'Sign in', family: 'auth', roles: allRoles, icon: 'login' },
  { name: 'auth.forgotPassword', title: 'Forgot password', family: 'auth', roles: allRoles, icon: 'lock-question' },
  { name: 'auth.resetPassword', title: 'Reset password', family: 'auth', roles: allRoles, icon: 'lock-reset' },
  { name: 'auth.loggedOut', title: 'Signed out', family: 'auth', roles: allRoles, icon: 'logout' },
  { name: 'dashboard.student', title: 'Dashboard', family: 'student', roles: studentRoles, icon: 'home-variant' },
  { name: 'schedule', title: 'Schedule', family: 'student', roles: studentRoles, icon: 'calendar-week' },
  { name: 'courses', title: 'Courses', family: 'student', roles: studentRoles, icon: 'book-open-page-variant' },
  { name: 'grades', title: 'Grades', family: 'student', roles: studentRoles, icon: 'chart-box-outline' },
  { name: 'transcript', title: 'Transcript', family: 'student', roles: studentRoles, icon: 'file-document-outline' },
  { name: 'curriculum', title: 'Curriculum', family: 'student', roles: studentRoles, icon: 'book-education-outline' },
  { name: 'enrollments', title: 'Enrollments', family: 'student', roles: studentRoles, icon: 'clipboard-list-outline' },
  { name: 'attendance', title: 'Attendance', family: 'student', roles: studentRoles, icon: 'clipboard-check-outline' },
  { name: 'registration', title: 'Registration', family: 'student', roles: studentRoles, icon: 'book-plus-outline' },
  { name: 'events', title: 'Events', family: 'student', roles: studentRoles, icon: 'calendar-star' },
  { name: 'learning', title: 'Materials & assignments', family: 'student', roles: studentRoles, icon: 'book-education-outline' },
  { name: 'admissions', title: 'Admissions (simulated)', family: 'student', roles: studentRoles, icon: 'account-edit-outline' },
  { name: 'library', title: 'Library (simulated)', family: 'student', roles: studentRoles, icon: 'bookshelf' },
  { name: 'careers', title: 'Careers (simulated)', family: 'student', roles: studentRoles, icon: 'briefcase-search-outline' },
  { name: 'news', title: 'Campus news', family: 'student', roles: studentRoles, icon: 'newspaper-variant-outline' },
  { name: 'docs', title: 'Public documents', family: 'student', roles: studentRoles, icon: 'file-document-outline' },
  { name: 'notifications', title: 'Notifications', family: 'student', roles: allRoles, icon: 'bell-outline' },
  { name: 'announcements', title: 'Academic announcements', family: 'student', roles: studentRoles, icon: 'bullhorn-outline' },
  { name: 'conduct', title: 'Conduct score', family: 'student', roles: studentRoles, icon: 'medal-outline' },
  { name: 'certificates', title: 'Certificates', family: 'student', roles: studentRoles, icon: 'certificate-outline' },
  { name: 'profile', title: 'Profile', family: 'student', roles: allRoles, icon: 'account-circle-outline' },
  { name: 'thesis.topics', title: 'Thesis topics', family: 'thesis', roles: studentRoles, icon: 'lightbulb-on-outline' },
  { name: 'thesis.detail', title: 'Topic detail', family: 'thesis', roles: studentRoles, icon: 'text-box-search-outline' },
  { name: 'thesis.registration', title: 'Thesis registration', family: 'thesis', roles: studentRoles, icon: 'account-group-outline' },
  { name: 'thesis.progress', title: 'Thesis progress', family: 'thesis', roles: studentRoles, icon: 'chart-timeline-variant' },
  { name: 'assistant.chat', title: 'CampusCore assistant', family: 'assistant', roles: allRoles, icon: 'robot-outline' },
  { name: 'admin.dashboard', title: 'Admin dashboard', family: 'staff', roles: adminRoles, icon: 'shield-account-outline' },
  { name: 'admin.students', title: 'Manage students', family: 'staff', roles: adminRoles, icon: 'school-outline' },
  { name: 'admin.lecturers', title: 'Manage lecturers', family: 'staff', roles: adminRoles, icon: 'account-tie-outline' },
  { name: 'lecturer.dashboard', title: 'Lecturer dashboard', family: 'staff', roles: lecturerRoles, icon: 'view-dashboard-outline' },
  { name: 'lecturer.schedule', title: 'Teaching schedule', family: 'staff', roles: lecturerRoles, icon: 'calendar-account-outline' },
  { name: 'lecturer.grading', title: 'Gradebook', family: 'staff', roles: lecturerRoles, icon: 'notebook-edit-outline' },
  { name: 'lecturer.attendance', title: 'Class attendance', family: 'staff', roles: lecturerRoles, icon: 'account-check-outline' },
];

export const laneScreenRegistry: readonly LaneScreenDefinition[] = [
  { id: 'dean.overview', title: 'Faculty thesis overview', role: 'lecturer', capability: 'dean.overview', icon: 'school-outline' },
  { id: 'staff.applyReview', title: 'Admissions review', role: null, capability: 'staff.applyReview', icon: 'account-edit-outline' },
  { id: 'staff.careersDesk', title: 'Careers desk', role: null, capability: 'staff.careersDesk', icon: 'briefcase-search-outline' },
  { id: 'staff.libraryDesk', title: 'Library desk', role: null, capability: 'staff.libraryDesk', icon: 'bookshelf' },
  { id: 'admin.overview', title: 'Oversight', role: 'admin', capability: 'admin.oversight', icon: 'shield-account-outline' },
  { id: 'admin.attendance', title: 'Attendance oversight', role: 'admin', capability: 'admin.oversight', icon: 'account-check-outline' },
  { id: 'admin.audit', title: 'Audit log', role: 'admin', capability: 'admin.oversight', icon: 'clipboard-text-clock-outline' },
  { id: 'admin.creditLimits', title: 'Credit limit applications', role: 'admin', capability: 'admin.oversight', icon: 'credit-card-check-outline' },
  { id: 'admin.enrollments', title: 'Enrollments', role: 'admin', capability: 'admin.oversight', icon: 'book-plus-outline' },
  { id: 'admin.events', title: 'Event desk', role: 'admin', capability: 'admin.oversight', icon: 'calendar-star' },
  { id: 'admin.notifications', title: 'Notification desk', role: 'admin', capability: 'admin.oversight', icon: 'bell-outline' },
];

const bottomNavigationByRole: Readonly<Record<UserRole, readonly BottomNavigationItem[]>> = {
  student: [
    { route: 'dashboard.student', label: 'Home', icon: 'home-variant' },
    { route: 'schedule', label: 'Schedule', icon: 'calendar-week' },
    { route: 'registration', label: 'Register', icon: 'book-plus-outline' },
    { route: 'notifications', label: 'Alerts', icon: 'bell-outline' },
  ],
  lecturer: [
    { route: 'lecturer.dashboard', label: 'Home', icon: 'home-variant' },
    { route: 'lecturer.schedule', label: 'Schedule', icon: 'calendar-account-outline' },
    { route: 'lecturer.grading', label: 'Gradebook', icon: 'notebook-edit-outline' },
    { route: 'notifications', label: 'Alerts', icon: 'bell-outline' },
  ],
  admin: [
    { route: 'admin.dashboard', label: 'Home', icon: 'shield-account-outline' },
    { route: 'admin.students', label: 'Students', icon: 'school-outline' },
    { route: 'admin.lecturers', label: 'Lecturers', icon: 'account-tie-outline' },
    { route: 'notifications', label: 'Alerts', icon: 'bell-outline' },
  ],
};

// Direct references only. The seven ecosystem domain lanes resolve to the live
// CampusUTE Stitch project (8459672847959457355, CampusCore Institutional
// Mobile System); the capstone-era lanes reference the legacy project kept in
// frontend/.stitch/metadata.json. Other registry screens derive from the same
// token and interaction contract until a dedicated Stitch screen is added.
export const stitchMobileReferences: Readonly<
  Partial<Record<ScreenName, readonly StitchMobileReference[]>>
> = {
  'auth.signIn': [
    { id: '67e517e324ef454c810e2b41b4acdc99', title: 'Đăng nhập - Hệ thống Quản lý Đề tài' },
  ],
  events: [
    { id: 'fc5427a8d03549878d4acb90e696d646', title: 'CampusCore - Sự kiện & Đoàn-Hội' },
  ],
  learning: [
    { id: '44f28aa4f58a4cd2bbba9ee6efa534f5', title: 'CampusCore - Học tập & LMS' },
  ],
  admissions: [
    { id: 'bff380e5f2474201b169d6d6b3e7330c', title: 'CampusCore - Tuyển sinh (Mô phỏng)' },
  ],
  library: [
    { id: '46104df5b291438d828c9d1d85042e6a', title: 'CampusCore - Thư viện & Học liệu' },
  ],
  careers: [
    { id: '11bb52c7330c44428c503d35c343e2ff', title: 'CampusCore - Việc làm & Hướng nghiệp' },
  ],
  news: [
    { id: '62e1c33865dc4baea955a00cc8bfb311', title: 'CampusCore - Tin tức & Thông báo' },
  ],
  docs: [
    { id: '02b1eec59ef749e199392e724ed6ca11', title: 'CampusCore - Tài liệu & Biểu mẫu' },
  ],
  'dashboard.student': [
    { id: '55abc697e13e416aa87c89fd331e6c62', title: 'Dashboard - Mobile App' },
    { id: '89b8434a99dd4fcb87ce3c84469e3186', title: 'Trang chủ - Dashboard' },
  ],
  registration: [
    { id: '05a2b1b196034830bc559ae72b82b6f9', title: 'Danh sách Đợt đăng ký' },
    { id: '4f5dfbb559504aa38f58b22599f361e4', title: 'Danh sách đợt đăng ký - Mobile App' },
  ],
  notifications: [
    { id: 'a8940ff416834cf59245e878780e2135', title: 'Trung tâm thông báo - Mobile App' },
  ],
  profile: [
    { id: '1a12e27f4365459eb1d4ed274514d04d', title: 'Hồ sơ Sinh viên - Mobile App' },
  ],
  'thesis.topics': [
    { id: '3d1a0cf1dd494919ab9095b738f0c8e4', title: 'Danh sách Đề tài' },
  ],
  'thesis.detail': [
    { id: 'be1ea000e675492d829254077907039a', title: 'Chi tiết Đề tài' },
  ],
  'thesis.registration': [
    { id: '4ac0f22ff9c14155b071bf3c8ffa699c', title: 'Đăng ký Đề tài - Mobile App' },
  ],
  'thesis.progress': [
    { id: '5cb62add07304fa689a98c8512495482', title: 'Theo dõi tiến độ - Mobile App' },
  ],
  'admin.lecturers': [
    { id: '36c60dec6ed9458a80bc5b1cfe6f82a5', title: 'Danh sách Giảng viên - Mobile App' },
  ],
};

export const menuSections = [
  {
    title: 'Student workspace',
    families: ['student', 'thesis', 'assistant'] as const,
  },
  {
    title: 'Staff',
    families: ['staff'] as const,
  },
] as const;

export function getScreenDefinition(route: ScreenName) {
  return screenRegistry.find((screen) => screen.name === route);
}

export function canAccessScreen(role: UserRole, route: ScreenName) {
  return getScreenDefinition(route)?.roles.includes(role) ?? false;
}

export function getBottomNavigation(role: UserRole) {
  return bottomNavigationByRole[role];
}

export function getLaneScreen(id: LaneScreenId) {
  return laneScreenRegistry.find((screen) => screen.id === id);
}

/**
 * Whether a lane screen is reachable for this surface role + capability set.
 * Staff desks are granted per desk by the server, so they are not tied to the
 * UI role; every other lane also needs its own UI role.
 */
export function canAccessLaneScreen(
  role: UserRole,
  capabilities: CapabilitySet,
  id: LaneScreenId,
) {
  const screen = getLaneScreen(id);
  if (!screen || !hasCapability(capabilities, screen.capability)) {
    return false;
  }
  return screen.role === null || screen.role === role;
}

/** Lane entries to show in menus; an empty capability set shows none. */
export function getLaneNavigation(role: UserRole, capabilities: CapabilitySet) {
  return laneScreenRegistry.filter((screen) => canAccessLaneScreen(role, capabilities, screen.id));
}
