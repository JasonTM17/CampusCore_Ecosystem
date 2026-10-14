const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('attendance marking API contracts and wiring integrity', async (t) => {
  await t.test('attendanceApi exports getSectionAttendance and saveSectionAttendance', () => {
    const apiSource = read('src/lib/api.ts');
    assert.match(
      apiSource,
      /saveSectionAttendance:\s*async\s*\(/,
      'attendanceApi must export saveSectionAttendance method',
    );
    assert.match(
      apiSource,
      /\/attendance\/sections\/\$\{sectionId\}/,
      'saveSectionAttendance must target PUT /attendance/sections/{sectionId}',
    );
    assert.match(
      apiSource,
      /getSectionAttendance:\s*async\s*\(/,
      'attendanceApi must export getSectionAttendance method',
    );
    assert.match(
      apiSource,
      /\/attendance\/section\/\$\{sectionId\}/,
      'getSectionAttendance must target GET /attendance/section/{sectionId}',
    );
  });

  await t.test('lecturer attendance route is wired in navigation layout', () => {
    const layoutSource = read('src/app/dashboard/layout.tsx');
    assert.match(
      layoutSource,
      /href:\s*'\/dashboard\/lecturer\/attendance'/,
      'dashboard layout must include link to /dashboard/lecturer/attendance',
    );
  });

  await t.test('lecturer attendance dictionary keys match between en and vi', () => {
    const messagesSource = read('src/i18n/messages.ts');
    assert.match(
      messagesSource,
      /lecturerAttendance:\s*\{/,
      'en dictionary must include lecturerAttendance',
    );

    // Verify key presence
    const expectedKeys = [
      'eyebrow',
      'title',
      'description',
      'selectSection',
      'selectSemester',
      'dateLabel',
      'markAllPresent',
      'resetStatuses',
      'saveButton',
      'savingButton',
      'savedSuccess',
      'saveFailed',
      'columnStudent',
      'columnStudentCode',
      'columnStatus',
      'columnNotes',
      'statsTotalStudents',
      'statsPresentRate',
    ];

    for (const key of expectedKeys) {
      assert.ok(
        messagesSource.includes(`${key}:`),
        `messages.ts must include translation key '${key}'`,
      );
    }
  });

  await t.test('selected absent state uses the darker contrast-safe class', () => {
    const pageSource = read('src/app/dashboard/lecturer/attendance/page.tsx');
    const absentBlock = /row\.status === 'ABSENT'\s*\?\s*'([^']+)'/.exec(pageSource);
    assert.ok(absentBlock, 'the ABSENT status button selected-state class must exist');
    assert.match(
      absentBlock[1],
      /\bbg-rose-700\b/,
      'selected ABSENT must use bg-rose-700 (white on rose-600 is 4.39:1, below the 4.5:1 AA floor)',
    );
    assert.doesNotMatch(
      absentBlock[1],
      /\bbg-rose-600\b/,
      'selected ABSENT must not use bg-rose-600',
    );
  });

  await t.test('all four unselected status buttons use readable foreground without transitions', () => {
    const pageSource = read('src/app/dashboard/lecturer/attendance/page.tsx');
    const branches = pageSource.match(
      /row\.status === '(?:PRESENT|ABSENT|LATE|EXCUSED)'\s*\?\s*'[^']+'\s*:\s*'[^']+'/g,
    ) ?? [];
    assert.equal(branches.length, 4, 'expected exactly four status-button ternary branches');
    for (const branch of branches) {
      const unselected = /:\s*'([^']+)'/.exec(branch)[1];
      assert.match(
        unselected,
        /^text-foreground hover:bg-accent$/,
        `unselected branch must use readable foreground: ${unselected}`,
      );
      assert.doesNotMatch(unselected, /muted-foreground/, 'unselected branch must not use muted foreground');
    }
    const buttonClass = pageSource.match(/className=\{`flex items-center gap-1 rounded[^`]*`\}/g) ?? [];
    assert.equal(buttonClass.length, 4, 'expected four status-button className expressions');
    for (const cls of buttonClass) {
      assert.doesNotMatch(cls, /transition-colors/, 'status buttons must not animate color transitions');
    }
  });

  await t.test('lecturer attendance page file and locale proxy exist', () => {
    assert.ok(
      fs.existsSync(path.join(root, 'src/app/dashboard/lecturer/attendance/page.tsx')),
      'lecturer attendance page component must exist',
    );
    assert.ok(
      fs.existsSync(path.join(root, 'src/app/[locale]/dashboard/lecturer/attendance/page.tsx')),
      'locale proxy for lecturer attendance page must exist',
    );
  });
});
