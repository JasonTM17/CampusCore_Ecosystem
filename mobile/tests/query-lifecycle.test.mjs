import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readSources } from './helpers/read-sources.mjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(mobileRoot, rel), 'utf8');

test('query lifecycle hook covers mount/focus/foreground/SWR/bounded-retry (§5)', () => {
  const hook = read('src/hooks/useScreenQuery.ts');
  const cache = read('src/hooks/query-cache.ts');

  assert.match(hook, /useFocusEffect/);
  assert.match(hook, /AppState\.addEventListener\('change'/);
  assert.match(hook, /readQueryCache[\s\S]*?writeQueryCache/);
  assert.match(hook, /isStale: cached !== undefined/);
  assert.match(hook, /errorStatus/);
  assert.match(cache, /\$\{accountId \?\? 'anonymous'\}:\$\{queryKey\}/);
  assert.match(cache, /clearQueryCache/);
  // Per-account keyspace — old account data is unreachable after switch.
  assert.match(hook, /queryCacheKey\(session\.accountId/);
  // Loop guard (review F1): `reload` must depend only on stable inputs —
  // a fresh `options` literal per render can never land in the dep array.
  assert.match(hook, /\}, \[cacheKey, enabled, boundary, isCurrent, update\]\);/);
  assert.match(hook, /optionsRef\.current = options/);
});

test('session teardown wipes the per-account cache', () => {
  const context = read('src/session/SessionContext.tsx');
  assert.match(context, /import \{[^}]*\bclearQueryCache\b[^}]*\} from '\.\.\/hooks\/query-cache'/);
  assert.match(context, /clearQueryCache\(\)/);
});

test('every data screen distinguishes loading/error/empty states', () => {
  const student = readSources(mobileRoot,'src/screens/student',/^(StudentDashboard|Schedule|Courses|Grades|Attendance|Registration|Notifications|Profile)Screen\.tsx$|^shared\//);
  const operations = readSources(mobileRoot,'src/screens/operations',/^(AdminScreens|AttendanceRosterRow|GradeRowCard|lecturer-(ui|api|model|csv)|Lecturer(Dashboard|Schedule|Attendance|Grading)Screen)\.tsx?$|^shared\//);

  for (const source of [student, operations]) {
    assert.match(source, /StatePanel/);
    assert.match(source, /kind=\{[^}]*'loading'/);
    assert.match(source, /kind="empty"|kind=\{[^}]*'empty'/);
  }
  // Denied + offline copy exists in both lanes.
  assert.match(student, /HTTP_403|ACCESS_DENIED/);
  assert.match(operations, /status === 403/);
  assert.match(operations, /status === 0/);
});

test('admin surfaces render the web-only state, never fake data (KM-8)', () => {
  const operations = readSources(mobileRoot,'src/screens/operations',/^(AdminScreens|AttendanceRosterRow|GradeRowCard|lecturer-(ui|api|model|csv)|Lecturer(Dashboard|Schedule|Attendance|Grading)Screen)\.tsx?$|^shared\//);
  assert.match(operations, /WebOnlyPanel/);
  // The registry admin screens are localized hand-offs to the portal route that owns the work.
  assert.match(operations, /title=\{copy\.adminDashboardTitle\} path="\/admin"/);
  assert.match(operations, /title=\{copy\.adminStudentsTitle\} path="\/admin\/users"/);
  assert.match(operations, /title=\{copy\.adminLecturersTitle\} path="\/admin\/lecturers"/);
  assert.match(operations, /EXPO_PUBLIC_PORTAL_URL/);
  // No admin screen may carry fabricated metrics or rosters.
  assert.doesNotMatch(operations, /12,418|12\.4k|486|Dr\. Le Minh|Nguyen Duc Minh.*Software Engineering · Year 4/);
});

test('lecturer lanes call the real academic APIs — no static operations data', () => {
  const operations = readSources(mobileRoot,'src/screens/operations',/^(AdminScreens|AttendanceRosterRow|GradeRowCard|lecturer-(ui|api|model|csv)|Lecturer(Dashboard|Schedule|Attendance|Grading)Screen)\.tsx?$|^shared\//);
  const client = read('src/api/client.ts');
  assert.match(operations, /campusApi\.lecturerSchedule/);
  assert.match(operations, /campusApi\.attendanceRoster/);
  assert.match(operations, /campusApi\.saveSectionAttendance/);
  assert.match(operations, /campusApi\.sectionGrades/);
  assert.match(operations, /campusApi\.publishSectionGrades/);
  assert.match(client, /\/sections\/my\/schedule/);
  assert.match(client, /\/attendance\/section\//);
  assert.match(client, /`\/sections\/\$\{encodeURIComponent\(sectionId\)\}\/grades`/);
  assert.match(client, /\/sections\/\$\{encodeURIComponent\(sectionId\)\}\/grades/);
});

test('preview pseudo-data stays out of SecureStore and the disk whitelist holds', () => {
  const context = read('src/session/SessionContext.tsx');
  const store = read('src/auth/session-store.ts');
  // Preview bootstrap skips all store I/O (KM-9).
  assert.match(context, /apiClient\.mode !== 'live'[\s\S]{0,200}return/);
  // Only the three whitelisted keys exist anywhere.
  assert.match(store, /'cu\.refresh'/);
  assert.match(store, /'cu\.install'/);
  assert.match(store, /'installMarker'/);
  assert.doesNotMatch(store, /AsyncStorage|getItem\('cu\.(?!refresh|install)/);
  const whitelist = new Set(
    [...store.matchAll(/const (?:REFRESH_KEY|INSTALL_KEY|MARKER_KEY) = '([^']+)'/g)]
      .map((m) => m[1]),
  );
  assert.deepEqual([...whitelist].sort(), ['cu.install', 'cu.refresh', 'installMarker']);
});
