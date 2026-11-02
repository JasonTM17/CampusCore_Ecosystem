const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.W13_SRC_ROOT
  ? path.resolve(process.env.W13_SRC_ROOT)
  : path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function maxLineLength(source) {
  return Math.max(...source.split('\n').map((line) => line.length));
}

// --- UX polish: admin/assistant-knowledge ---

const assistantKnowledge = read('src/app/admin/assistant-knowledge/page.tsx');

test('assistant-knowledge page is decompressed into readable JSX', () => {
  // The former single-line JSX blob (one ~4000-char line) must be gone.
  assert.ok(
    maxLineLength(assistantKnowledge) <= 200,
    `no JSX line may exceed 200 chars, found ${maxLineLength(assistantKnowledge)}`,
  );
  // The page still renders through the canonical building blocks.
  assert.match(assistantKnowledge, /<AdminTableCard/);
  assert.match(assistantKnowledge, /<AdminTableScroll/);
  assert.match(assistantKnowledge, /<EmptyState/);
  assert.match(assistantKnowledge, /<LoadingState/);
  // Rich editor contract stays intact (see rich-editor.test.js).
  assert.match(assistantKnowledge, /<RichTextEditor/);
  assert.match(assistantKnowledge, /value=\{form\.content\}/);
  assert.match(assistantKnowledge, /minHeight="240px"/);
});

test('assistant-knowledge filters and form use the shared Select component', () => {
  assert.doesNotMatch(assistantKnowledge, /<select[\s>]/);
  assert.match(assistantKnowledge, /import \{ Select \} from '@\/components\/ui\/select';/);
  assert.match(assistantKnowledge, /<Select/);
});

test('assistant-knowledge state labels follow the vi/en copy-object pattern', () => {
  // The states list carries both locales like the domains list, so the
  // per-option ternary chain and the English-only label set are gone.
  assert.match(
    assistantKnowledge,
    /const states: Array<\{ value: '' \| AssistantKnowledgeState; en: string; vi: string \}> = \[/,
  );
  assert.match(assistantKnowledge, /value: '', en: 'All states', vi: 'T\u1ea5t c\u1ea3 tr\u1ea1ng th\u00e1i'/);
  assert.doesNotMatch(assistantKnowledge, /\{ value: '', label: 'All states' \}/);
  assert.doesNotMatch(assistantKnowledge, /vi && option\.value === '' \? '/);
});

// --- UX polish: admin/users ---

const adminUsers = read('src/app/admin/users/page.tsx');
const adminMessages = read('src/i18n/messages-admin-pages.ts');

test('admin users sentence-case copy lives in the central catalogue and is wired to the page', () => {
  // Title Case typos are gone (vi), and the shared keys read in sentence
  // case on the English side too.
  assert.match(adminMessages, /adminPermissionsTitle: 'Ph\u00e2n quy\u1ec1n qu\u1ea3n tr\u1ecb h\u1ec7 th\u1ed1ng'/);
  assert.match(adminMessages, /createStudentAction: '\+ T\u1ea1o t\u00e0i kho\u1ea3n sinh vi\u00ean'/);
  assert.match(adminMessages, /createLecturerAction: '\+ T\u1ea1o t\u00e0i kho\u1ea3n gi\u1ea3ng vi\u00ean'/);
  assert.match(adminMessages, /adminPermissionsTitle: 'System administration permissions'/);
  assert.match(adminMessages, /createStudentAction: '\+ Create student account'/);
  assert.match(adminMessages, /createLecturerAction: '\+ Create lecturer account'/);
  assert.match(adminUsers, /messages\.adminPages/);
  assert.match(adminUsers, /users: copy/);
  assert.doesNotMatch(adminUsers, /adminPermissionsTitle:\s*['"]/);
});

test('admin users page uses the shared Select and Button primitives', () => {
  assert.doesNotMatch(adminUsers, /<select[\s>]/);
  assert.match(adminUsers, /import \{ Select \} from '@\/components\/ui\/select';/);
  // The cohort, curriculum, faculty, academic-title, department, and role
  // fields are all Select-driven now.
  assert.equal(adminUsers.match(/<Select[\s\n]/g)?.length >= 6, true);
  // The 7 former raw buttons (4 role filter tabs + 3 modal role switcher
  // chips) are compact shared-Button chips.
  assert.doesNotMatch(adminUsers, /<button[\s>]/);
  assert.match(adminUsers, /function RoleTabButton\(/);
  assert.match(adminUsers, /aria-pressed=\{active\}/);
  // Server-guard contract pins stay untouched by the swap.
  assert.match(adminUsers, /disabled=\{isSelfEditing\}/);
});

// --- UX polish: admin/editor shim ---

const adminEditor = read('src/app/admin/editor/page.tsx');
const localizedAdminEditor = read('src/app/[locale]/admin/editor/page.tsx');

test('admin editor shim matches the shared client-redirect pattern', () => {
  assert.match(adminEditor, /'use client';/);
  assert.match(adminEditor, /import \{ LoadingState \} from '@\/components\/ui\/state-block';/);
  assert.match(adminEditor, /router\.replace\(/);
  // The announcements console deep-links with ?editId=..., so the shim must
  // forward the incoming query string.
  assert.match(adminEditor, /window\.location\.search/);
  assert.match(localizedAdminEditor, /export \{ default \} from '\.\.\/\.\.\/\.\.\/admin\/editor\/page';/);
});

// --- UX polish: admin/enrollments filter copy ---

const enrollmentsPage = read('src/app/admin/enrollments/page.tsx');

test('admin enrollments filter fallback copy lives in the dictionary', () => {
  const messagesSource = read('src/i18n/messages.ts');
  const splitAt = messagesSource.indexOf('export const vi');
  assert.ok(splitAt > 0, 'messages.ts must declare both locales');
  const [en, vi] = [messagesSource.slice(0, splitAt), messagesSource.slice(splitAt)];

  assert.match(en, /filterLoadFailed: 'Semester or course filter options could not be fully loaded\.'/);
  assert.match(vi, /filterLoadFailed: 'B\u1ed9 l\u1ecdc h\u1ecdc k\u1ef3 ho\u1eb7c m\u00f4n h\u1ecdc ch\u01b0a t\u1ea3i \u0111\u01b0\u1ee3c \u0111\u1ea7y \u0111\u1ee7\.'/);

  // The page consumes the key and no longer carries the inline pair.
  assert.match(enrollmentsPage, /messages\.admin\.enrollments\.filterLoadFailed/);
  assert.doesNotMatch(enrollmentsPage, /ch\u01b0a t\u1ea3i \u0111\u01b0\u1ee3c \u0111\u1ea7y \u0111\u1ee7/);
  // The reference-loader contract (phase-six-repair) is untouched.
  assert.match(enrollmentsPage, /setReferenceError\(/);
  assert.match(enrollmentsPage, /setSectionReferenceError\(/);
});

// --- W13-DEEPSEEK-WEB-B: audit disclosure + locale-aware counts ---

const adminAudit = read('src/app/admin/audit/page.tsx');

test('the audit detail disclosure is a real button, not an aria-expanded row', () => {
  assert.doesNotMatch(adminAudit, /<tr\b[^>]*aria-expanded/, 'aria-expanded leaves the table row');
  assert.doesNotMatch(adminAudit, /<tr\b[^>]*tabIndex/, 'the row is no longer a focusable control');
  assert.match(
    adminAudit,
    /<button\b[^>]*aria-expanded=\{expanded === entry\.id\}/,
    'the disclosure button carries the expanded state',
  );
  assert.match(
    adminAudit,
    /aria-controls=\{`audit-detail-\$\{entry\.id\}`\}/,
    'the button points at the detail row it owns',
  );
  assert.match(adminAudit, /id={`audit-detail-\$\{entry\.id\}`}/, 'the detail row keeps its id');
});

const adminAnnouncements = read('src/app/admin/announcements/page.tsx');

test('admin announcement length errors format counts with the active locale', () => {
  assert.match(adminMessages, /contentTooLong: "Nội dung vượt quá giới hạn \{limit\} ký tự \(cần bỏ bớt \{excess\} ký tự\)\./);
  assert.match(adminMessages, /contentTooLong: "The content exceeds the \{limit\} character limit by \{excess\} characters\./);
  assert.doesNotMatch(adminAnnouncements, /toLocaleString\(['"](?:vi-VN|en-US)['"]\)/);
  assert.match(adminAnnouncements, /copy\.contentTooLong[\s\S]*?\.replace\('\{limit\}', \(\) => formatNumber\(overflow\.limit\)\)[\s\S]*?\.replace\('\{excess\}', \(\) => formatNumber\(overflow\.excessChars\)\)/);
});
