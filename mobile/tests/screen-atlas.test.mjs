import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routes = fs.readFileSync(path.join(mobileRoot, 'src/navigation/routes.ts'), 'utf8');
const tokens = fs.readFileSync(path.join(mobileRoot, 'src/design/tokens.ts'), 'utf8');
const readme = fs.readFileSync(path.join(mobileRoot, 'README.md'), 'utf8');
const navigator = fs.readFileSync(path.join(mobileRoot, 'src/navigation/MobileNavigator.tsx'), 'utf8');
const bottomNavigation = fs.readFileSync(path.join(mobileRoot, 'src/components/BottomNavigation.tsx'), 'utf8');
const signIn = fs.readFileSync(path.join(mobileRoot, 'src/screens/auth/SignInScreen.tsx'), 'utf8');
const screenAssistant = fs.readFileSync(path.join(mobileRoot, 'src/screens/assistant/AssistantScreen.tsx'), 'utf8');
const navigationTypes = fs.readFileSync(path.join(mobileRoot, 'src/navigation/types.ts'), 'utf8');
const screenComponents = fs.readFileSync(path.join(mobileRoot, 'src/screens/index.ts'), 'utf8');
const stitchMetadata = JSON.parse(
  fs.readFileSync(path.join(mobileRoot, '..', 'frontend', '.stitch', 'metadata.json'), 'utf8'),
);

test('native registry keeps the Stitch mobile atlas above the 20-screen requirement', () => {
  const registeredRoutes = [...routes.matchAll(/\{ name: '([^']+)'/g)].map((match) => match[1]);
  const componentRoutes = [
    ...screenComponents.matchAll(/^\s*(?:'([^']+)'|([A-Za-z][\w.]*))\s*:/gm),
  ].map((match) => match[1] ?? match[2]);
  const screenCount = registeredRoutes.length;

  assert.equal(screenCount, 37);
  assert.equal(new Set(registeredRoutes).size, screenCount);
  assert.deepEqual(componentRoutes.sort(), [...registeredRoutes].sort());
  for (const requiredRoute of [
    'auth.signIn',
    'dashboard.student',
    'thesis.topics',
    'assistant.chat',
    'admin.dashboard',
    'lecturer.grading',
  ]) {
    assert.match(routes, new RegExp(`name: '${requiredRoute.replace('.', '\\.')}'`));
  }
  assert.match(readme, /37 navigable screens/);
});

test('native tokens preserve the institutional portal contract', () => {
  assert.match(tokens, /"background": "#F9F9FF"/);
  assert.match(tokens, /"primary": "#003F87"/);
  assert.match(tokens, /"primaryContainer": "#0056B3"/);
  assert.match(tokens, /"accent": "#E5A900"/);
  assert.match(tokens, /"mobileGutter": 16/);
  assert.match(tokens, /"touchTarget": 44/);
  assert.match(tokens, /family: Platform\.select\(/);
});

test('native API seam fails closed until live mode is explicitly enabled', () => {
  const client = fs.readFileSync(path.join(mobileRoot, 'src/api/client.ts'), 'utf8');

  assert.match(client, /EXPO_PUBLIC_API_MODE === 'preview'/);
  assert.match(client, /MOBILE_API_PREVIEW/);
  assert.match(client, /mode: ApiMode/);
  assert.match(client, /refreshSession\?: \(\) => Promise<boolean>/);
  assert.match(client, /function shouldRefreshAfterUnauthorized\(_?path: string, status: number\)/);
  // OIDC lane: every 401 on the API host is a refresh candidate — the
  // legacy /auth/login|refresh|logout excludes are gone with those routes
  // (the comment naming them in the source is intentional provenance).
  assert.match(client, /return status === 401;/);
  assert.doesNotMatch(client, /normalizedPath\.startsWith\('\/auth\//);
  assert.match(client, /refreshSessionOnce\(\)/);
  assert.match(client, /options\.refreshSession\?\.\(\)/);
  assert.match(client, /shouldRefreshAfterUnauthorized\(path, response\.status\) && options\.refreshSession/);
  assert.match(client, /headers\.set\('Authorization', `Bearer \$\{rotated\}`\)/);
  assert.doesNotMatch(client, /refreshToken|LoginResponse|apiRoutes\.auth/);
  assert.match(client, /from '\.\.\/auth\/mobile-session-store'/);
  assert.match(client, /export type AssistantLocale = 'en' \| 'vi'/);
  assert.match(client, /assistantChat: \(/);
  assert.match(client, /conversationId\?: string/);
  assert.match(client, /assistantConversations: async \(\)/);
  assert.match(client, /assistantConversationMessages: async \(conversationId: string\)/);
  assert.match(client, /deleteAssistantConversation: \(conversationId: string\)/);
  assert.match(client, /apiClient\.post<AssistantReply>\(/);
});

test('mobile role navigation rejects unauthorized routes and uses role-specific primary navigation', () => {
  assert.match(routes, /export function canAccessScreen\(role: UserRole, route: ScreenName\)/);
  assert.match(routes, /const bottomNavigationByRole: Readonly<Record<UserRole, readonly BottomNavigationItem\[\]>>/);
  assert.match(routes, /lecturer:\s*\[[\s\S]*?route: 'lecturer\.grading'/);
  assert.match(routes, /admin:\s*\[[\s\S]*?route: 'admin\.students'/);
  assert.match(navigator, /if \(!canAccessScreen\(role, nextRoute\)\) \{[\s\S]*?setRoute\(roleHome\[role\]\)/);
  assert.match(navigator, /<BottomNavigation[\s\S]*?role=\{role\}/);
  assert.match(bottomNavigation, /getBottomNavigation\(role\)/);
  assert.match(bottomNavigation, /role: UserRole/);
  assert.match(navigator, /if \(!hasActiveSession\) \{\s*return;/);
  assert.match(navigator, /if \(!isPreviewSession\) \{\s*return;/);
  assert.match(navigator, /type SessionKind = 'signedOut' \| 'preview' \| 'authenticated'/);
  assert.match(navigator, /const isAuthenticated = sessionKind === 'authenticated'/);
  assert.match(navigator, /if \(route !== 'auth\.signIn' \|\| apiClient\.mode !== 'preview'\)/);
  assert.match(navigator, /completeSignIn\(nextRole\) \{/);
  assert.match(navigator, /if \(route !== 'auth\.signIn' \|\| apiClient\.mode !== 'live'\)/);
  assert.match(navigator, /setSessionKind\('authenticated'\)/);
  assert.match(navigator, /if \(apiClient\.mode === 'live'\) \{/);
  assert.match(navigator, /void sessionStore\.signOut\(\)/);
  assert.match(navigationTypes, /enterPreview\(\): void/);
  assert.match(navigationTypes, /completeSignIn\(role: UserRole, accountId\?: string \| null\): void/);
});

test('Stitch mobile references stay traceable and live sign-in runs the OIDC PKCE flow', () => {
  const stitchReferenceIds = (routes.match(/id: '([0-9a-f]{32})'/g) ?? [])
    .map((match) => match.slice(5, -1));
  const metadataIds = new Set(
    Object.values(stitchMetadata.screens).map((screen) => screen.id),
  );

  assert.equal(stitchReferenceIds.length, 19);
  // The web atlas grew by three legitimate boards on 2026-09-20/21
  // (web-thesis-submission-workspace, web-assistant-mascot-brand,
  // web-lecturer-grade-entry): 22 -> 25 total. On 2026-10-23 the seven
  // CampusUTE ecosystem domain lanes were generated in the live Stitch
  // project 8459672847959457355 under the CampusCore Institutional Mobile
  // System: 25 -> 32 total, mobile 13 -> 20. The legacy project
  // 16486483525927292845 is not in the active Stitch account; its records
  // stay as reference only.
  assert.equal(stitchMetadata.activeProjectId, '8459672847959457355');
  assert.equal(stitchMetadata.inventory.screenCount, 32);
  assert.equal(stitchMetadata.inventory.mobileCount, 20);
  assert.equal(Object.keys(stitchMetadata.screens).length, 32);
  assert.equal(
    Object.values(stitchMetadata.screens).filter((screen) => screen.deviceType === 'MOBILE').length,
    20,
  );
  for (const referenceId of stitchReferenceIds) {
    assert.ok(metadataIds.has(referenceId), `Missing Stitch metadata for ${referenceId}`);
  }
  // Every ecosystem domain lane resolves to a screen in the live project.
  const domainLaneRefs = {
    news: '62e1c33865dc4baea955a00cc8bfb311',
    docs: '02b1eec59ef749e199392e724ed6ca11',
    events: 'fc5427a8d03549878d4acb90e696d646',
    learning: '44f28aa4f58a4cd2bbba9ee6efa534f5',
    admissions: 'bff380e5f2474201b169d6d6b3e7330c',
    library: '46104df5b291438d828c9d1d85042e6a',
    careers: '11bb52c7330c44428c503d35c343e2ff',
  };
  for (const [lane, referenceId] of Object.entries(domainLaneRefs)) {
    assert.match(routes, new RegExp(`${lane}: \\[[\\s\\S]*?${referenceId}`), `Missing Stitch reference for ${lane}`);
    const record = Object.values(stitchMetadata.screens).find((screen) => screen.id === referenceId);
    assert.ok(record, `Missing Stitch metadata for ${lane} screen ${referenceId}`);
    assert.equal(record.projectId, '8459672847959457355', `${lane} screen is not in the live CampusUTE project`);
    assert.equal(record.deviceType, 'MOBILE');
  }
  assert.match(routes, /export const stitchMobileReferences/);
  assert.doesNotMatch(routes, /thesis\.evaluation|3073bce589eb4d4e97ef9775e921a506/);
  assert.match(routes, /'admin\.lecturers': \[[\s\S]*?36c60dec6ed9458a80bc5b1cfe6f82a5/);
  // OIDC PKCE sign-in (mobile-policy §3): the system browser owns credentials;
  // the screen stores the refresh via session-store and completes through the
  // navigation adapter. Preview keeps the local pseudo-session entry (KM-9).
  assert.match(signIn, /const isPreview = apiClient\.mode === 'preview'/);
  assert.match(signIn, /Explore preview/);
  assert.match(signIn, /Sign in with CampusUTE ID/);
  assert.match(signIn, /navigation\.enterPreview\(\)/);
  assert.match(signIn, /signInWithOidc\(/);
  assert.match(signIn, /sessionStore\.saveRefresh\(outcome\.refreshToken\)/);
  assert.match(signIn, /navigation\.completeSignIn\(outcome\.role, outcome\.accountId\)/);
  assert.match(signIn, /session\.markBlocked\(outcome\.reason\)/);
  assert.doesNotMatch(signIn, /campusApi\.login|password|setSessionTokens/);
  assert.doesNotMatch(signIn, /navigation\.navigate\('dashboard\.student'\)/);
  assert.match(readme, /role-specific bottom bar/);
});

test('mobile assistant keeps preview local and calls the Java route only in live mode', () => {
  const chat = fs.readFileSync(path.join(mobileRoot, 'src/screens/assistant/useAssistantChat.ts'), 'utf8');
  const guards = fs.readFileSync(path.join(mobileRoot, 'src/assistant/chat-helpers.ts'), 'utf8');
  const api = fs.readFileSync(path.join(mobileRoot, 'src/api/assistant-api.ts'), 'utf8');
  const messages = fs.readFileSync(path.join(mobileRoot, 'src/i18n/assistant-messages.ts'), 'utf8');
  const composer = fs.readFileSync(path.join(mobileRoot, 'src/screens/assistant/AssistantComposer.tsx'), 'utf8');
  const bubble = fs.readFileSync(path.join(mobileRoot, 'src/screens/assistant/MessageBubble.tsx'), 'utf8');

  assert.match(chat, /const isPreview = apiClient\.mode === 'preview'/);
  assert.match(chat, /if \(isPreview \|\| !orchestrator\) \{/);
  assert.match(chat, /copy\.previewReply/);
  assert.match(messages, /previewReply:/);
  assert.match(api, /POST|post<BufferedAssistantReply>|post</);
  assert.match(api, /\/assistant\/chat|apiRoutes\.assistant\.chat/);
  assert.match(chat, /degraded/);
  assert.match(bubble, /citation\.excerpt/);
  assert.match(chat, /reasonCode/);
  assert.match(messages, /The assistant could not answer|errorTitle:/);
  assert.match(composer, /loading=\{busy\}/);
  assert.match(chat, /orchestrator\.cancel\(\)/);
  assert.match(chat, /QUOTA_EXCEEDED/);
  assert.match(guards, /safeText/);
  assert.match(screenAssistant, /SegmentedControl/);
});

