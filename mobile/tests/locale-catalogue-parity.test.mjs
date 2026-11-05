import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTs } from './helpers/load-ts.mjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CATALOGUES = [
  ['src/i18n/academic-messages.ts', 'academicMessages'],
  ['src/i18n/account-messages.ts', 'accountMessages'],
  ['src/i18n/admissions-messages.ts', 'admissionsMessages'],
  ['src/i18n/assistant-messages.ts', 'assistantMessages'],
  ['src/i18n/assistant-messages.ts', 'assistantChatMessages'],
  ['src/i18n/campus-messages.ts', 'campusMessages'],
  ['src/i18n/careers-messages.ts', 'careersMessages'],
  ['src/i18n/checkin-messages.ts', 'checkinMessages'],
  ['src/i18n/content-messages.ts', 'contentMessages'],
  ['src/i18n/events-messages.ts', 'eventsMessages'],
  ['src/i18n/lanes-messages.ts', 'lanesMessages'],
  ['src/i18n/learning-messages.ts', 'learningMessages'],
  ['src/i18n/library-messages.ts', 'libraryMessages'],
  ['src/i18n/locale.ts', 'uiMessages'],
  ['src/i18n/notifications-center-messages.ts', 'notificationsCenterMessages'],
  ['src/i18n/notifications-messages.ts', 'notificationsMessages'],
  ['src/i18n/operations-messages.ts', 'operationsMessages'],
  ['src/i18n/records-messages.ts', 'recordsMessages'],
  ['src/i18n/shell-messages.ts', 'shellMessages'],
  ['src/i18n/thesis-messages.ts', 'thesisMessages'],
];

const leaves = (value, prefix = '') =>
  Object.entries(value).flatMap(([key, entry]) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? leaves(entry, `${prefix}${key}.`)
      : [[`${prefix}${key}`, entry]],
  );

const holes = (text) => (String(text).match(/\{\w+\}/g) ?? []).sort().join(',');

for (const [file, exportName] of CATALOGUES) {
  const mod = await loadTs(file);
  const messages = mod[exportName];

  test(`mobile catalogue parity: ${exportName} (${file})`, () => {
    assert.ok(messages, `${exportName} must be exported from ${file}`);
    assert.ok(messages.vi, `${exportName}.vi must exist`);
    assert.ok(messages.en, `${exportName}.en must exist`);

    const viLeaves = leaves(messages.vi);
    const enLeaves = leaves(messages.en);

    const viKeys = viLeaves.map(([k]) => k).sort();
    const enKeys = enLeaves.map(([k]) => k).sort();

    assert.deepEqual(viKeys, enKeys, `${exportName} vi/en keys must match`);

    const enMap = new Map(enLeaves);
    for (const [key, text] of viLeaves) {
      const enText = enMap.get(key);
      if (Array.isArray(text)) {
        assert.ok(Array.isArray(enText), `${exportName}.${key} must be an array in both`);
        assert.equal(text.length, enText.length, `${exportName}.${key} length mismatch`);
        continue;
      }
      if (typeof text === 'string') {
        assert.equal(typeof enText, 'string', `${exportName}.${key} EN must be string`);
        // Allow empty sentinel values (1-based day arrays with empty index 0, or NONE attention status)
        if (!key.endsWith('.0') && !key.endsWith('.NONE')) {
          assert.ok(text.trim(), `${exportName}.vi.${key} must not be empty`);
          assert.ok(enText.trim(), `${exportName}.en.${key} must not be empty`);
        }
        assert.equal(holes(text), holes(enText), `${exportName}.${key} placeholders mismatch`);
      }
    }
  });
}

test('AccountFrame reads portal subtitle from accountMessages catalogue', () => {
  const source = fs.readFileSync(path.join(mobileRoot, 'src/screens/account/AccountFrame.tsx'), 'utf8');
  assert.doesNotMatch(
    source,
    /locale === 'vi' \? 'Cổng thông tin đào tạo' : 'Academic information portal'/,
    'AccountFrame must not contain inline bilingual string literal for portal subtitle',
  );
  assert.match(
    source,
    /accountMessages\[locale\]\.signIn\.portal/,
    'AccountFrame must read portal subtitle from accountMessages',
  );
});

const shellCopy = (await loadTs('src/i18n/shell-messages.ts')).shellMessages;

test('Vietnamese shell menu labels are localized', () => {
  assert.notEqual(shellCopy.vi.menu, shellCopy.en.menu, 'the Vietnamese bottom navigation label must be translated');
  assert.doesNotMatch(shellCopy.vi.openMenu, /\bmenu\b/i, 'the Vietnamese open-menu accessibility name must be translated');
  assert.doesNotMatch(shellCopy.vi.closeMenu, /\bmenu\b/i, 'the Vietnamese close-menu accessibility name must be translated');
});

test('AccountFrame accessibility name comes from its catalogue', () => {
  const read = (file) => fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const frame = read('src/screens/account/AccountFrame.tsx');
  assert.match(frame, /accessibilityLabel=\{accountMessages\[locale\]\.signIn\.institutionName\}/);
  assert.doesNotMatch(frame, /accessibilityLabel="HCMUTE"/);
});

test('SignInScreen brand logo accessibility name comes from its catalogue', () => {
  const read = (file) => fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const screen = read('src/screens/auth/SignInScreen.tsx');
  assert.match(screen, /accessibilityLabel=\{copy\.signIn\.institutionName\}/);
  assert.doesNotMatch(screen, /accessibilityLabel="HCMUTE"/);
});

test('language names come from the shell catalogue', () => {
  const read = (file) => fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const language = read('src/screens/account/LanguageSetting.tsx');
  assert.match(language, /shellMessages\[locale\]\.languageOptions/);
  assert.doesNotMatch(language, /label:\s*'(?:Tiếng Việt|English)'/);
});

test('transcript chart term prefix comes from the academic catalogue', () => {
  const read = (file) => fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const transcript = read('src/screens/academic/TranscriptScreen.tsx');
  assert.match(transcript, /copy\.trendTermPrefix/);
  assert.doesNotMatch(transcript, /locale === 'vi' \? 'HK' : 'T'/);
});

test('calendar export field labels come from the academic catalogue', () => {
  const read = (file) => fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const calendar = read('src/screens/academic/ical-export.ts');
  assert.match(calendar, /academicMessages\[locale\]\.calendar/);
  assert.doesNotMatch(calendar, /Môn học:|Course:|Lớp học phần:|Section:|Số tín chỉ:|Credits:|Giảng viên:|Lecturer:|Địa điểm:|Location:|Phòng \$\{room\}|Room \$\{room\}/);
});
