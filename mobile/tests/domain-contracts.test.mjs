import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * P13 §1 native domain coverage: every simulated domain lane resolves to
 * a real native screen wired through the API client — never a button
 * that only opens the website. The labeled exception is the operations
 * staff handoff (complex staff flows stay on the portal by design).
 */
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(mobileRoot, rel), 'utf8');
const routes = read('src/navigation/routes.ts');
const routeMap = read('src/navigation/route-map.ts');
const screenComponents = read('src/screens/index.ts');
const client = read('src/api/client.ts');

// Content and service screens go through the contentApi facade (src/screens/content/content-api.ts),
// which wraps the shared client; `methods` are the facade entries each lane must expose.
const contentApiSource = read('src/screens/content/content-api.ts');
const contentSources = () => fs.readdirSync(path.join(mobileRoot, 'src/screens/content'))
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => read(`src/screens/content/${name}`))
  .join('\n');

const DOMAIN_SCREENS = {
  news: { file: 'src/screens/student/NewsScreen.tsx', methods: ['news', 'newsDetail'] },
  docs: { file: 'src/screens/student/DocsScreen.tsx', methods: ['docs', 'docDetail'] },
  events: { file: 'src/screens/student/EventsScreen.tsx', methods: ['events', 'registerEvent', 'cancelEventRegistration'] },
  learning: { file: 'src/screens/student/LearningScreen.tsx', methods: ['learningSections', 'learningAssignments', 'learningSubmit'] },
  admissions: { file: 'src/screens/student/AdmissionsScreen.tsx', methods: ['admissionsApplications', 'admissionsCreate', 'admissionsSubmit'] },
  library: { file: 'src/screens/student/LibraryScreen.tsx', methods: ['libraryCatalogue', 'libraryRequest', 'libraryLoans'] },
  careers: { file: 'src/screens/student/CareersScreen.tsx', methods: ['careersOpportunities', 'careersApply', 'careersWithdraw'] },
};

test('every domain lane registers a native screen + path + component', () => {
  for (const name of Object.keys(DOMAIN_SCREENS)) {
    assert.match(routes, new RegExp(`\\{ name: '${name}'`), `${name} missing from screenRegistry`);
    assert.match(routeMap, new RegExp(`${name}: '/`), `${name} missing from pathByScreen`);
    assert.match(screenComponents, new RegExp(`${name}: `), `${name} missing from screenComponents`);
  }
});

test('domain screens call the API client — no web-handoff shortcuts', () => {
  for (const [name, spec] of Object.entries(DOMAIN_SCREENS)) {
    const source = `${read(spec.file)}\n${contentSources()}`;
    assert.match(read(spec.file), /contentApi\.|content-api/, `${name} screen never reaches the API through contentApi`);
    assert.doesNotMatch(
      source,
      /Linking\.openURL|WebBrowser\.openBrowserAsync|openAuthSessionAsync/,
      `${name} screen must not hand off to the website`,
    );
    for (const method of spec.methods) {
      assert.match(contentApiSource, new RegExp(`${method}: `), `contentApi.${method} missing`);
    }
  }
});

test('every pathByScreen route resolves to a real app/ route file', () => {
  // expo-router is file-based: a pathByScreen entry with no matching
  // app/** file dead-ends at +not-found (P13 Wukong finding — five lanes
  // shipped unreachable). Walk the app tree and require a route file for
  // every declared path.
  const routeFiles = new Map(); // url path → file content
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.tsx')) continue;
      const rel = path.relative(path.join(mobileRoot, 'app'), full).replace(/\\/g, '/');
      const segments = rel.replace(/\.tsx$/, '').split('/')
        .filter((s) => !s.startsWith('(') && !s.startsWith('+'));
      if (segments[segments.length - 1] === 'index') segments.pop();
      routeFiles.set('/' + segments.join('/'), read('app/' + rel));
    }
  };
  walk(path.join(mobileRoot, 'app'));

  const block = routeMap.slice(routeMap.indexOf('pathByScreen'), routeMap.indexOf('};', routeMap.indexOf('pathByScreen')));
  const entries = [...block.matchAll(/^\s*'?([a-zA-Z.]+)'?: '(\/[^']+)'/gm)];
  assert.ok(entries.length >= 20, `pathByScreen parse drifted — only ${entries.length} entries`);
  for (const [, name, url] of entries) {
    const file = routeFiles.get(url);
    assert.ok(file, `${name} declares ${url} but no app route file exists — dead route`);
    if (!name.startsWith('auth.')) {
      assert.match(file, new RegExp(`ScreenRoute name="${name}"`), `${url} must render <ScreenRoute name="${name}" />`);
    }
  }
});

test('domain mutations carry Idempotency-Key server-side contract', () => {
  for (const method of ['registerEvent', 'cancelEventRegistration', 'learningOpenDraft',
    'learningSubmit', 'admissionsCreate', 'admissionsSubmit', 'libraryRequest',
    'libraryCancel', 'careersApply', 'careersWithdraw']) {
    const block = client.slice(client.indexOf(`${method}: (`));
    assert.match(block.slice(0, 700), /Idempotency-Key/, `${method} lacks Idempotency-Key`);
  }
});
