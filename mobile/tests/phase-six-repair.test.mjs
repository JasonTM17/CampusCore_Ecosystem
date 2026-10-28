import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readSources } from './helpers/read-sources.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('selected thesis topic survives topic, detail, and registration navigation', () => {
  const types = read('src/navigation/types.ts');
  const navigator = read('src/navigation/MobileNavigator.tsx');
  const thesis = readSources(root, 'src/screens/thesis');

  assert.match(types, /thesisTopicId\?: string/);
  assert.match(types, /selectedThesisTopicId: string \| null/);
  assert.match(navigator, /setSelectedThesisTopicId\(options\.thesisTopicId\)/);
  assert.match(navigator, /selectedThesisTopicId=\{selectedThesisTopicId\}/);
  assert.match(thesis, /navigate\('thesis\.detail', \{ thesisTopicId: topic\.id \}\)/);
  assert.match(thesis, /navigate\('thesis\.registration', \{ thesisTopicId: topic\.id \}\)/);
  assert.match(thesis, /useThesisTopic\(selectedThesisTopicId \?\? undefined\)/);
  assert.match(thesis, /const topicId = selectedThesisTopicId \?\? undefined/);
  assert.doesNotMatch(thesis, /const topic = workspace\.topics\[0\]/);
});

test('shared mobile primitives announce headings, progress, and unread state', () => {
  const ui = read('src/components/Ui.tsx');
  const notifications = readSources(root,'src/screens/student',/^(StudentDashboard|Schedule|Courses|Grades|Attendance|Registration|Notifications|Profile)Screen\.tsx$|^shared\//);

  assert.match(ui, /accessibilityRole="header" variant="headlineLarge"/);
  assert.match(ui, /accessibilityRole="header" variant="headlineSmall"/);
  assert.match(ui, /accessibilityRole="progressbar"/);
  assert.match(ui, /accessibilityValue=\{\{ min: 0, max: 100, now: Math\.round\(boundedValue\) \}\}/);
  assert.match(ui, /unread \? 'Unread' : null/);
  assert.match(ui, />\s*Unread\s*</);
  assert.match(notifications, /accessibilityLiveRegion="polite"/);
});

test('student navigation and registration stay usable at a narrow mobile width', () => {
  const routes = read('src/navigation/routes.ts');
  const bottomNavigation = read('src/components/BottomNavigation.tsx');
  const studentScreens = readSources(root,'src/screens/student',/^(StudentDashboard|Schedule|Courses|Grades|Attendance|Registration|Notifications|Profile)Screen\.tsx$|^shared\//);

  assert.match(routes, /student:\s*\[[\s\S]*?route: 'registration', label: 'Register'/);
  assert.match(bottomNavigation, /accessibilityRole="tablist"/);
  assert.match(bottomNavigation, /accessibilityRole="tab"/);
  assert.match(bottomNavigation, /minWidth: 0/);
  assert.match(bottomNavigation, /adjustsFontSizeToFit/);
  assert.match(studentScreens, /registrationHeroHeader/);
  assert.match(studentScreens, /registrationMeta/);
  assert.match(studentScreens, /label=\{section\.seats\}/);
  assert.doesNotMatch(studentScreens, /ROUND 02|4 days left|next round closes in 4 days/i);
});

test('staff copy stays inside the retained academic course scope', () => {
  const copy = [
    'src/navigation/routes.ts',
    'src/components/MenuPanel.tsx',
    'src/screens/operations/OperationsScreens.tsx',
    'README.md',
  ].map(read).join('\n');

  assert.doesNotMatch(
    copy,
    /\b(?:finance|financial|billing|invoice|payment|reporting|operational|operations)\b/i,
  );
  assert.match(copy, /family: 'staff'/);
});

test('npm test runs the atlas and Phase 6 regressions explicitly', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.match(packageJson.scripts.test, /screen-atlas\.test\.mjs/);
  assert.match(packageJson.scripts.test, /phase-six-repair\.test\.mjs/);
});

test('mobile assistant keeps native transport buffered and owner-history operations explicit', () => {
  const client = read('src/api/client.ts');
  const assistant = [
    readSources(root, 'src/screens/assistant'),
    readSources(root, 'src/assistant'),
    read('src/api/assistant-api.ts'),
  ].join('\n');

  assert.match(client, /conversations: '\/assistant\/conversations'/);
  assert.match(client, /\/messages/);
  assert.match(client, /deleteAssistantConversation/);
  assert.match(client, /signal\?: AbortSignal|RequestInit/);
  assert.match(assistant, /conversationId/);
  assert.match(assistant, /deleteConversation/);
  assert.match(assistant, /canRetry/);
  assert.match(assistant, /citation\.excerpt/);
  assert.doesNotMatch(assistant, /EventSource|text\/event-stream/);
  assert.doesNotMatch(client, /DEEPSEEK_API_KEY|sk-[A-Za-z0-9]/);
});

test('mobile assistant preserves idempotency, server cancellation, pagination, and fixed feedback reasons', () => {
  const client = read('src/api/client.ts');
  const screens = readSources(root, 'src/screens/assistant');
  const assistant = [screens, readSources(root, 'src/assistant'), read('src/api/assistant-api.ts'), read('src/i18n/assistant-messages.ts')].join('\n');

  assert.match(client, /createAssistantClientRequestId/);
  assert.match(client, /clientRequestId:/);
  assert.match(client, /X-Next-Cursor/);
  assert.match(client, /requests: '\/assistant\/requests'/);
  assert.match(client, /cancelAssistantRequest/);
  assert.match(client, /AssistantFeedbackReason/);
  assert.match(client, /putAssistantFeedback/);
  // The turn orchestrator owns the same-key resubmit and the server cancel.
  assert.match(assistant, /createClientRequestId: createAssistantClientRequestId/);
  assert.match(assistant, /cancelRequest: \(clientRequestId\) => assistantApi\.cancel\(clientRequestId\)/);
  assert.match(assistant, /orchestrator\?\.dispose\(\)/);
  assert.match(assistant, /pendingDelete/);
  assert.match(assistant, /sessionExpired/);
  assert.match(assistant, /offline/);
});

test('mobile never replays a terminal or fenced request key', () => {
  const orchestrator = read('src/assistant/turn-orchestrator.ts');

  assert.match(orchestrator, /const FENCED_CODES = new Set\(\[/);
  for (const code of ['FAILED_AMBIGUOUS', 'TURN_TERMINAL_RACE', 'TURN_NOT_ACTIVE']) {
    assert.ok(orchestrator.includes(`'${code}'`), code);
  }
  assert.match(orchestrator, /FENCED_CODES\.has\(/);
  assert.match(orchestrator, /'TURN_CANCELLED'/);
  assert.match(orchestrator, /'TURN_PURGED'/);
});

test('mobile refreshes the session single-flight and exits to sign-in on expiry', () => {
  const client = read('src/api/client.ts');
  const navigator = read('src/navigation/MobileNavigator.tsx');
  const store = read('src/auth/session-store.ts');

  // Concurrent 401s must share one refresh rotation; independent refreshes race
  // the issuer rotation and revoke both tokens.
  assert.match(client, /let sessionRefreshPromise: Promise<boolean> \| null = null/);
  assert.match(client, /refreshSessionOnce\(\)/);
  assert.match(client, /options\.refreshSession\?\.\(\)/);
  assert.doesNotMatch(client, /refreshToken/);
  assert.match(client, /setOnSessionExpired\(handler: \(\(\) => void\) \| undefined\): void/);
  assert.match(client, /onSessionExpired\?\.\(\)/);
  // An in-flight refresh must not clobber a newer sign-in or sign-out — the
  // epoch gates live in session-store where the disk write happens (KM-6).
  assert.match(store, /sessionEpoch \+= 1/);
  assert.match(store, /if \(epoch !== sessionEpoch\)/);
  // A failed refresh must bridge back to the sign-in screen instead of a dead end.
  assert.match(navigator, /apiClient\.setOnSessionExpired\(/);
  assert.match(navigator, /setSessionKind\('signedOut'\)/);
});
