import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readSources } from './helpers/read-sources.mjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('student live JSON uses new registration contract and profile APIs', () => {
  const client = fs.readFileSync(path.join(mobileRoot, 'src/api/client.ts'), 'utf8');
  const screens = readSources(mobileRoot,'src/screens/student',/^(StudentDashboard|Schedule|Courses|Grades|Attendance|Registration|Notifications|Profile)Screen\.tsx$|^shared\//);
  const operations = readSources(mobileRoot,'src/screens/operations',/^(AdminScreens|AttendanceRosterRow|GradeRowCard|lecturer-(ui|api|model|csv)|Lecturer(Dashboard|Schedule|Attendance|Grading)Screen)\.tsx?$|^shared\//);

  assert.match(client, /Idempotency-Key/);
  assert.match(client, /\/me\/enrollments/);
  assert.match(client, /\/me\/registration\/sections/);
  assert.match(client, /\/enrollments\/my\/transcript/);
  assert.match(client, /\/announcements\/my/);
  assert.match(client, /\/auth\/profile/);
  assert.match(client, /oldPassword/);
  assert.match(screens, /campusApi\.announcements/);
  assert.match(screens, /campusApi\.updateProfile/);
  assert.match(screens, /campusApi\.changePassword/);
  // Lecturer lanes call the live academic APIs (mobile-policy §4) — the only
  // static surface left is the admin web-only panel.
  assert.match(operations, /campusApi\.lecturerSchedule/);
  assert.match(operations, /campusApi\.saveSectionAttendance/);
  assert.match(operations, /campusApi\.saveSectionGrades/);
  assert.match(operations, /campusApi\.publishSectionGrades/);

  const registrationStart = screens.indexOf('export function RegistrationScreen');
  const registrationEnd = screens.indexOf('export function', registrationStart + 1);
  const registrationScreen = registrationEnd === -1
    ? screens.slice(registrationStart)
    : screens.slice(registrationStart, registrationEnd);
  const academicApi = fs.readFileSync(path.join(mobileRoot, 'src/screens/academic/academic-api.ts'), 'utf8');
  assert.match(registrationScreen, /academicApi\.registrationWorkspace/);
  assert.match(academicApi, /campusApi\.registrationSections/);
  assert.match(academicApi, /campusApi\.registrationRounds/);
  assert.doesNotMatch(registrationScreen + academicApi, /campusApi\.sections\(/);

  const gradesStart = screens.indexOf('export function GradesScreen');
  const gradesEnd = screens.indexOf('export function', gradesStart + 1);
  const gradesScreen = gradesEnd === -1
    ? screens.slice(gradesStart)
    : screens.slice(gradesStart, gradesEnd);
  assert.match(gradesScreen, /academicApi\.grades\(\)/);
  assert.doesNotMatch(gradesScreen, /await campusApi\.transcript\(\);/);
});

test('student screens key enrollment lists by semester and guard profile saves', () => {
  const screens = readSources(mobileRoot,'src/screens/student',/^(StudentDashboard|Schedule|Courses|Grades|Attendance|Registration|Notifications|Profile)Screen\.tsx$|^shared\//);

  const screenSlice = (name) => {
    // Read the named module so memoized exports retain the same semantic checks.
    return fs.readFileSync(path.join(mobileRoot, 'src/screens/student', `${name}.tsx`), 'utf8');
  };
  const dashboard = screenSlice('StudentDashboardScreen');
  const schedule = screenSlice('ScheduleScreen');
  const courses = screenSlice('CoursesScreen');
  const grades = screenSlice('GradesScreen');
  const profile = screenSlice('ProfileScreen');

  // Retaken courses repeat the same code across semesters, so list keys must
  // include the semester (or the unique grade record id) to stay unique.
  assert.match(dashboard, /key=\{`\$\{item\.semesterId \?\? 'na'\}-\$\{item\.code\}`\}/);
  const workspace = fs.readFileSync(path.join(mobileRoot, 'src/screens/academic/EnrollmentWorkspace.tsx'), 'utf8');
  assert.match(workspace, /key=\{`\$\{item\.semesterId\}-\$\{item\.id\}`\}/);
  assert.match(grades, /key=\{record\.id\}/);
  assert.doesNotMatch(screens + workspace, /key=\{item\.code\}|key=\{course\.code\}|key=\{grade\.code\}/);
  // Dashboard and courses speak for active enrollments, not dropped history.
  assert.match(dashboard, /liveEnrollments\.filter\(\(item\) => item\.status === 'ENROLLED'\)/);
  assert.match(dashboard, /String\(activeEnrollments\.length\)/);
  const academicModel = fs.readFileSync(path.join(mobileRoot, 'src/screens/academic/academic-model.ts'), 'utf8');
  assert.match(academicModel, /ACTIVE_STATUSES: readonly string\[\] = \['ENROLLED', 'PENDING', 'CONFIRMED'\]/);
  // Schedule times must build with the same separator the card parses.
  assert.match(screens, /item\.startTime\} – \$\{item\.endTime\}/);
  // Profile and password actions clear stale messages, validate input, and
  // disable their buttons while a save is in flight.
  assert.match(profile, /const \[isSavingProfile, setIsSavingProfile\] = useState\(false\)/);
  assert.match(profile, /const \[isSavingPassword, setIsSavingPassword\] = useState\(false\)/);
  assert.match(profile, /disabled=\{isSavingProfile\}/);
  assert.match(profile, /disabled=\{isSavingPassword\}/);
  assert.match(profile, /newPassword\.length < 8/);
  assert.match(profile, /setProfileMessage\(null\)/);
});

test('student screens translate service errors into student-friendly copy', () => {
  const screens = readSources(mobileRoot,'src/screens/student',/^(StudentDashboard|Schedule|Courses|Grades|Attendance|Registration|Notifications|Profile)Screen\.tsx$|^shared\//);

  assert.match(screens, /studentFriendlyErrorMessage/);
  assert.match(screens, /friendlyErrorMessageByCode/);
  assert.match(screens, /Registration is not open right now\./);
  assert.doesNotMatch(screens, /ApiClientError \? nextError\.message/);
  assert.doesNotMatch(screens, /nextError instanceof ApiClientError \? nextError\.message/);
  assert.doesNotMatch(screens, /Java API contract/);
});
