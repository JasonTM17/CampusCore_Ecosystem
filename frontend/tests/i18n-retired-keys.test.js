const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadModule(relativePath, aliases = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.hasOwn(aliases, specifier) ? aliases[specifier] : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

function loadMessages() {
  const aliases = { '@/i18n/config': {} };
  for (const [specifier, relativePath] of [
    ['@/i18n/messages-thesis-workflow', 'src/i18n/messages-thesis-workflow.ts'],
    ['@/i18n/messages-dean-overview', 'src/i18n/messages-dean-overview.ts'],
    ['@/i18n/messages-content', 'src/i18n/messages-content.ts'],
    ['@/i18n/messages-attendance-geofence', 'src/i18n/messages-attendance-geofence.ts'],
    ['@/i18n/messages-teaching-pages', 'src/i18n/messages-teaching-pages.ts'],
    ['@/i18n/messages-admin-pages', 'src/i18n/messages-admin-pages.ts'],
    ['@/i18n/messages-student-pages', 'src/i18n/messages-student-pages.ts'],
  ]) {
    aliases[specifier] = loadModule(relativePath);
  }
  return loadModule('src/i18n/messages.ts', aliases);
}

function hasPath(value, parts) {
  let current = value;
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) {
      return false;
    }
    current = current[part];
  }
  return true;
}

const messages = loadMessages();
const { thesisWorkflowEn, thesisWorkflowVi } = loadModule('src/i18n/messages-thesis-workflow.ts');

const RETIRED_AUTH_PATHS = [
  ['login', 'featureTitles'],
  ['login', 'featureDescriptions'],
  ['login', 'portals', 'student', 'featureTitles'],
  ['login', 'portals', 'student', 'featureDescriptions'],
  ['login', 'portals', 'lecturer', 'featureTitles'],
  ['login', 'portals', 'lecturer', 'featureDescriptions'],
  ['login', 'portals', 'dean', 'featureTitles'],
  ['login', 'portals', 'dean', 'featureDescriptions'],
  ['login', 'portals', 'admin', 'opsMark'],
  ['login', 'portals', 'admin', 'featureTitles'],
  ['login', 'portals', 'admin', 'featureDescriptions'],
  ['forgotPassword', 'featureTitles'],
  ['forgotPassword', 'featureDescriptions'],
  ['resetPassword', 'featureTitles'],
  ['resetPassword', 'featureDescriptions'],
  ['dashboardShell', 'signOutPage', 'eyebrow'],
  ['dashboardShell', 'signOutPage', 'progress'],
];

const RETIRED_THESIS_KEYS = [
  'viewReportDocument',
  'leaderLabel',
  'topicCodeLabel',
  'groupCodeLabel',
  'fileSizeLabel',
  'fileTypeLabel',
];

test('auth copy carries no retired feature lists or sign-out progress labels', () => {
  for (const locale of ['en', 'vi']) {
    for (const parts of RETIRED_AUTH_PATHS) {
      assert.equal(
        hasPath(messages.getMessages(locale), parts),
        false,
        `${locale}.${parts.join('.')} must stay removed`,
      );
    }
  }
});

test('thesis workflow copy omits retired report metadata labels', () => {
  for (const [locale, catalogue] of [['en', thesisWorkflowEn], ['vi', thesisWorkflowVi]]) {
    for (const key of RETIRED_THESIS_KEYS) {
      assert.equal(
        Object.hasOwn(catalogue.page, key),
        false,
        `${locale}.page.${key} must stay removed`,
      );
    }
  }
});
