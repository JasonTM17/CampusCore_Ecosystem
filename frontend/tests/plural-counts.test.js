const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

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

const messages = loadMessages();
const thesisWorkflow = loadModule('src/i18n/messages-thesis-workflow.ts');
const studentPages = loadModule('src/i18n/messages-student-pages.ts');
const studentPortal = loadModule('src/i18n/messages-student-portal.ts');
const adminAcademics = loadModule('src/i18n/messages-admin-academics.ts');
const homeMarketing = loadModule('src/i18n/messages-home.ts');
const editorSurfaces = loadModule('src/i18n/messages-editor.ts');

const plural = (() => {
  const output = ts.transpileModule(read('src/lib/plural.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
})();

const EN = {
  courseRegistration: messages.getMessages('en').courseRegistration,
  curriculum: messages.getMessages('en').curriculum,
  notifications: messages.getMessages('en').dashboardShell.notifications,
  mailCompose: messages.getMessages('en').mailCompose,
  thesis: thesisWorkflow.thesisWorkflowEn,
  studentPages: studentPages.studentPagesEn,
  studentPortal: studentPortal.studentPortalEn,
  adminAcademics: adminAcademics.adminAcademicsEn,
  homeMarketing: homeMarketing.homeMarketingEn,
  editorSurfaces: editorSurfaces.editorSurfacesEn,
};

const VI = {
  courseRegistration: messages.getMessages('vi').courseRegistration,
  curriculum: messages.getMessages('vi').curriculum,
  notifications: messages.getMessages('vi').dashboardShell.notifications,
  mailCompose: messages.getMessages('vi').mailCompose,
  thesis: thesisWorkflow.thesisWorkflowVi,
  studentPages: studentPages.studentPagesVi,
  studentPortal: studentPortal.studentPortalVi,
  adminAcademics: adminAcademics.adminAcademicsVi,
  homeMarketing: homeMarketing.homeMarketingVi,
  editorSurfaces: editorSurfaces.editorSurfacesVi,
};

const CASES = [
  {
    id: 'assistant.rateLimited',
    group: 'assistant',
    singularKey: 'rateLimitedOne',
    pluralKey: 'rateLimited',
    placeholder: '{seconds}',
    singular: 'Too many requests — please wait 1 second and retry.',
    plural: 'Too many requests — please wait 2 seconds and retry.',
    files: ['src/components/assistant/AssistantPanel.tsx'],
  },
  {
    id: 'courseRegistration.registeredMissingSchedules',
    group: 'courseRegistration',
    singularKey: 'registeredMissingSchedulesOne',
    pluralKey: 'registeredMissingSchedules',
    placeholder: '{count}',
    singular: '1 registered class has no published schedule yet.',
    plural: '2 registered classes have no published schedule yet.',
    files: ['src/components/registration/registered-courses-panel.tsx'],
  },
  {
    id: 'courseRegistration.creditLimitRemaining',
    group: 'courseRegistration',
    singularKey: 'creditLimitRemainingOne',
    pluralKey: 'creditLimitRemaining',
    placeholder: '{count}',
    singular: '1 credit remains available this term.',
    plural: '2 credits remain available this term.',
    files: ['src/app/dashboard/register/page.tsx'],
  },
  {
    id: 'courseRegistration.groupSectionCount',
    group: 'courseRegistration',
    singularKey: 'groupSectionCountOne',
    pluralKey: 'groupSectionCount',
    placeholder: '{count}',
    singular: '1 class',
    plural: '2 classes',
    files: [
      'src/app/dashboard/register/page.tsx',
      'src/components/registration/registered-courses-panel.tsx',
    ],
  },
  {
    id: 'courseRegistration.seatsOpen',
    group: 'courseRegistration',
    singularKey: 'seatsOpenOne',
    pluralKey: 'seatsOpen',
    placeholder: '{count}',
    singular: '1 seat open',
    plural: '2 seats open',
    files: ['src/app/dashboard/register/page.tsx'],
  },
  {
    id: 'curriculum.openSections',
    group: 'curriculum',
    singularKey: 'openSectionsOne',
    pluralKey: 'openSections',
    placeholder: '{count}',
    singular: '1 section open this term',
    plural: '2 sections open this term',
    files: ['src/app/dashboard/curriculum/page.tsx'],
  },
  {
    id: 'curriculum.chainsExpand',
    group: 'curriculum',
    singularKey: 'chainsExpandOne',
    pluralKey: 'chainsExpand',
    placeholder: '{count}',
    singular: 'Show 1 chain',
    plural: 'Show 2 chains',
    files: ['src/app/dashboard/curriculum/page.tsx'],
  },
  {
    id: 'dashboardShell.notifications.updatedCount',
    group: 'notifications',
    singularKey: 'updatedCountOne',
    pluralKey: 'updatedCount',
    placeholder: '{count}',
    singular: '1 notification marked as read.',
    plural: '2 notifications marked as read.',
    files: ['src/components/dashboard/NotificationsCenterPage.tsx'],
  },
  {
    id: 'mailCompose.fields.charCount',
    group: 'mailCompose',
    path: 'fields',
    singularKey: 'charCountOne',
    pluralKey: 'charCount',
    placeholder: '{count}',
    singular: '1 character',
    plural: '2 characters',
    files: ['src/app/dashboard/lecturer/mail/page.tsx'],
  },
  {
    id: 'thesisWorkflow.page.submissionStatus.deadlineChip',
    group: 'thesis',
    path: 'page.submissionStatus',
    singularKey: 'deadlineChipOne',
    pluralKey: 'deadlineChip',
    placeholder: '{days}',
    singular: 'Deadline: 1 day left',
    plural: 'Deadline: 2 days left',
    files: ['src/features/thesis/components/SubmissionStatusTimeline.tsx'],
  },
  {
    id: 'thesisWorkflow.page.assignedTopicsCount',
    group: 'thesis',
    path: 'page',
    singularKey: 'assignedTopicsCountOne',
    pluralKey: 'assignedTopicsCount',
    placeholder: '{count}',
    singular: '1 assigned topic',
    plural: '2 assigned topics',
    files: ['src/features/thesis/components/CouncilDefenseWorkspace.tsx'],
  },
  {
    id: 'thesisWorkflow.page.groupsCount',
    group: 'thesis',
    path: 'page',
    singularKey: 'groupsCountOne',
    pluralKey: 'groupsCount',
    placeholder: '{count}',
    singular: '1 group',
    plural: '2 groups',
    files: ['src/app/dashboard/thesis/page.tsx'],
  },
  {
    id: 'thesisWorkflow.page.councilsCount',
    group: 'thesis',
    path: 'page',
    singularKey: 'councilsCountOne',
    pluralKey: 'councilsCount',
    placeholder: '{count}',
    singular: '1 council',
    plural: '2 councils',
    files: ['src/app/dashboard/thesis/page.tsx'],
  },
  {
    id: 'thesisWorkflow.page.reportsCount',
    group: 'thesis',
    path: 'page',
    singularKey: 'reportsCountOne',
    pluralKey: 'reportsCount',
    placeholder: '{count}',
    singular: '1 report',
    plural: '2 reports',
    files: [
      'src/app/dashboard/thesis/page.tsx',
      'src/features/thesis/components/ThesisRepositoryWorkspace.tsx',
    ],
  },
  {
    id: 'studentPages.conduct.activitiesCount',
    group: 'studentPages',
    path: 'conduct',
    singularKey: 'activitiesCountOne',
    pluralKey: 'activitiesCount',
    placeholder: '{count}',
    singular: '1 record',
    plural: '2 records',
    files: ['src/app/dashboard/conduct/page.tsx'],
  },
  {
    id: 'studentPortal.home.pendingBadge',
    group: 'studentPortal',
    path: 'home',
    singularKey: 'pendingBadgeOne',
    pluralKey: 'pendingBadge',
    placeholder: '{count}',
    singular: '1 registration pending',
    plural: '2 registrations pending',
    files: ['src/app/dashboard/page.tsx'],
  },
  {
    id: 'adminAcademics.enrollments.enrollmentsCount',
    group: 'adminAcademics',
    path: 'enrollments',
    singularKey: 'enrollmentsCountOne',
    pluralKey: 'enrollmentsCount',
    placeholder: '{count}',
    singular: '1 enrollment',
    plural: '2 enrollments',
    files: ['src/app/admin/enrollments/page.tsx'],
  },
  {
    id: 'homeMarketing.news.articleCount',
    group: 'homeMarketing',
    path: 'news',
    singularKey: 'articleCountOne',
    pluralKey: 'articleCount',
    placeholder: '{count}',
    singular: '1 article',
    plural: '2 articles',
    files: ['src/components/home/HomeNewsSection.tsx'],
  },
  {
    id: 'homeMarketing.news.viewMore',
    group: 'homeMarketing',
    path: 'news',
    singularKey: 'viewMoreOne',
    pluralKey: 'viewMore',
    placeholder: '{count}',
    singular: 'View 1 More Story',
    plural: 'View 2 More Stories',
    files: ['src/components/home/HomeNewsSection.tsx'],
  },
  {
    id: 'editorSurfaces.tinyMce.tooManyInlineImages',
    group: 'editorSurfaces',
    path: 'tinyMce',
    singularKey: 'tooManyInlineImagesOne',
    pluralKey: 'tooManyInlineImages',
    placeholder: '{count}',
    singular:
      'At most 1 inline image per announcement fits the server character budget. Remove one or link to it instead.',
    plural:
      'At most 2 inline images per announcement fit the server character budget. Remove one or link to it instead.',
    files: ['src/components/ui/tinymce-editor.tsx'],
  },
  {
    id: 'editorSurfaces.studio.notifications.blocksApplied',
    group: 'editorSurfaces',
    path: 'studio.notifications',
    singularKey: 'blocksAppliedOne',
    pluralKey: 'blocksApplied',
    placeholder: '{count}',
    singular: 'Applied 1 structured block into document!',
    plural: 'Applied 2 structured blocks into document!',
    files: ['src/app/dashboard/editor/page.tsx'],
  },
];

function groupCopy(locale, group) {
  if (group === 'assistant') return messages.getMessages(locale).assistant;
  return locale === 'en' ? EN[group] : VI[group];
}

function atPath(value, pathParts) {
  if (!pathParts) return value;
  return pathParts.split('.').reduce((current, key) => current?.[key], value);
}

function placeholders(value) {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)]
    .map((match) => match[1])
    .sort();
}

for (const entry of CASES) {
  test(`${entry.id} has an English singular twin selected by the count helper`, () => {
    const enCopy = atPath(groupCopy('en', entry.group), entry.path);
    const viCopy = atPath(groupCopy('vi', entry.group), entry.path);
    const singularTemplate = enCopy[entry.singularKey];
    const pluralTemplate = enCopy[entry.pluralKey];

    assert.equal(
      typeof singularTemplate,
      'string',
      `${entry.id}: ${entry.singularKey} must exist in the English catalogue`,
    );
    assert.equal(
      typeof pluralTemplate,
      'string',
      `${entry.id}: ${entry.pluralKey} must exist in the English catalogue`,
    );
    assert.deepEqual(
      placeholders(singularTemplate),
      placeholders(pluralTemplate),
      `${entry.id}: the singular twin keeps the same placeholders`,
    );

    assert.equal(
      plural.countLabel(1, singularTemplate, pluralTemplate).replace(entry.placeholder, '1'),
      entry.singular,
    );
    assert.equal(
      plural.countLabel(2, singularTemplate, pluralTemplate).replace(entry.placeholder, '2'),
      entry.plural,
    );

    assert.equal(
      viCopy[entry.singularKey],
      viCopy[entry.pluralKey],
      `${entry.id}: Vietnamese is uninflected, so the one form repeats the plural`,
    );
  });

  test(`${entry.id} call sites select the singular twin through countLabel`, () => {
    for (const file of entry.files) {
      const source = read(file);
      const wiring = new RegExp(
        `countLabel\\([\\s\\S]{0,240}?\\b${entry.singularKey}\\b[\\s\\S]{0,240}?\\b${entry.pluralKey}\\b`,
      );
      assert.match(
        source,
        wiring,
        `${file} must pass ${entry.singularKey} and ${entry.pluralKey} to countLabel`,
      );
    }
  });
}
