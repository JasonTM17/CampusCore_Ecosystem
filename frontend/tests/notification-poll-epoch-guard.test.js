const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const layout = fs.readFileSync(
  path.join(root, 'src/app/dashboard/layout.tsx'), 'utf8');

// WEB-06: the 3-minute unread-count poll used to apply whatever count came
// back as long as a logout had not started. A poll issued for user A that
// resolved after an account switch overwrote user B's badge with A's count.
// The poll must now carry the same epoch/sequence/user guard the manual
// reload already had.

const intervalStart = layout.indexOf('window.setInterval(() =>');
const intervalEnd = layout.indexOf('return () => window.clearInterval(timer);', intervalStart);
const poll = layout.slice(intervalStart, intervalEnd);

test('the poll captures the epoch, its own request sequence, and the user at dispatch', () => {
  assert.ok(intervalStart >= 0 && intervalEnd > intervalStart, 'poll interval exists');
  assert.match(poll, /notificationEpochRef\.current/,
    'poll must snapshot the epoch so an unmount/logout epoch bump invalidates it');
  assert.match(poll, /notificationPollRequestRef/,
    'poll needs its own sequence so a newer poll supersedes an in-flight older one');
  assert.match(poll, /notificationSessionRef\.current\.userId/,
    'poll must snapshot the user id at dispatch time');
});

test('a stale poll result can never reach setUnreadCount', () => {
  const apply = poll.slice(poll.indexOf('notificationsApi.unreadCount()'));
  assert.match(apply, /if \(isCurrent\(\)\) \{\s*setUnreadCount\(count\);/,
    'the count is applied only through the freshness guard');
  assert.doesNotMatch(apply, /if \(!notificationSessionRef\.current\.isLoggingOut\) \{\s*setUnreadCount/,
    'the old logout-only check must not come back');

  const guard = poll.slice(poll.indexOf('const isCurrent = () =>'), poll.indexOf('notificationsApi.unreadCount()'));
  assert.match(guard, /notificationEpochRef\.current === epoch/, 'epoch check');
  assert.match(guard, /notificationPollRequestRef\.current === sequence/, 'sequence check');
  assert.match(guard, /notificationSessionRef\.current\.userId === userId/, 'user check');
  assert.match(guard, /!notificationSessionRef\.current\.isLoggingOut/, 'logout check');
});

test('the epoch is still bumped on unmount so nothing applies after teardown', () => {
  assert.match(layout, /notificationEpochRef\.current \+= 1/);
});
