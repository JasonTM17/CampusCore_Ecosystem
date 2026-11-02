import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTs } from './helpers/load-ts.mjs';

const locale = await loadTs('src/i18n/locale.ts');
const { academicMessages, fillCopy } = await loadTs('src/i18n/academic-messages.ts');
const { shellMessages, fillShellCopy } = await loadTs('src/i18n/shell-messages.ts');
const { operationsMessages } = await loadTs('src/i18n/operations-messages.ts');
const { checkinMessages } = await loadTs('src/i18n/checkin-messages.ts');
const { eventsMessages } = await loadTs('src/i18n/events-messages.ts');

const vi = {
  dashboard: shellMessages.vi.dashboard,
  academic: academicMessages.vi,
  operations: operationsMessages.vi,
  checkin: checkinMessages.vi,
  events: eventsMessages.vi,
};
const en = {
  dashboard: shellMessages.en.dashboard,
  academic: academicMessages.en,
  operations: operationsMessages.en,
  checkin: checkinMessages.en,
  events: eventsMessages.en,
};

test('countForm keeps the singular for exactly one and the plural otherwise', () => {
  assert.equal(locale.countForm(1, 'one', 'other'), 'one');
  assert.equal(locale.countForm(2, 'one', 'other'), 'other');
  assert.equal(locale.countForm(0, 'one', 'other'), 'other');
  assert.equal(locale.countForm(1.5, 'one', 'other'), 'other');
});

test('English count copy uses the singular noun for one', () => {
  assert.equal(fillShellCopy(en.dashboard.activeSectionsOne, { n: 1 }), '1 active section');
  assert.equal(fillShellCopy(en.dashboard.announcementsOne, { n: 1 }), '1 campus announcement');
  assert.equal(fillCopy(en.academic.creditsOne, { n: 1 }), '1 credit');
  assert.equal(fillCopy(en.academic.seatsLeftOne, { n: 1 }), '1 seat left');
  assert.equal(fillCopy(en.academic.registeredOne, { n: 1 }), '1 section registered');
  assert.equal(fillCopy(en.academic.exportReadyOne, { n: 1 }), '1 session ready to export');
  assert.equal(fillCopy(en.operations.studentsCountOne, { n: 1 }), '1 student');
  assert.equal(fillCopy(en.operations.todayClassesCountOne, { n: 1 }), '1 class scheduled today');
  assert.equal(fillCopy(en.operations.scoresPendingOne, { n: 1 }), '1 score pending');
  assert.equal(fillCopy(en.operations.savedOne, { n: 1 }), '1 record saved');
  assert.equal(fillCopy(en.operations.unsavedOne, { n: 1 }), '1 unsaved change');
  assert.equal(fillCopy(en.operations.changesCountOne, { n: 1 }), '1 unsaved change');
  assert.equal(fillCopy(en.operations.scoresSavedOne, { n: 1 }), 'Scores saved for 1 student');
  assert.equal(fillCopy(en.operations.exportReadyOne, { n: 1 }), 'CSV sheet, 1 row');
  assert.equal(fillCopy(en.checkin.entryDetailOne, { n: 1 }), '1 open check-in session');
  assert.equal(fillCopy(en.events.seatsOne, { n: 1 }), '1 seat left');
});

test('English count copy keeps the plural noun beyond one', () => {
  assert.equal(fillShellCopy(en.dashboard.activeSections, { n: 2 }), '2 active sections');
  assert.equal(fillShellCopy(en.dashboard.announcements, { n: 2 }), '2 campus announcements');
  assert.equal(fillCopy(en.academic.credits, { n: 2 }), '2 credits');
  assert.equal(fillCopy(en.academic.seatsLeft, { n: 2 }), '2 seats left');
  assert.equal(fillCopy(en.academic.registered, { n: 2 }), '2 sections registered');
  assert.equal(fillCopy(en.academic.exportReady, { n: 2 }), '2 sessions ready to export');
  assert.equal(fillCopy(en.operations.studentsCount, { n: 2 }), '2 students');
  assert.equal(fillCopy(en.operations.todayClassesCount, { n: 2 }), '2 classes scheduled today');
  assert.equal(fillCopy(en.operations.scoresPending, { n: 2 }), '2 scores pending');
  assert.equal(fillCopy(en.operations.saved, { n: 2 }), '2 records saved');
  assert.equal(fillCopy(en.operations.unsaved, { n: 2 }), '2 unsaved changes');
  assert.equal(fillCopy(en.operations.changesCount, { n: 2 }), '2 unsaved changes');
  assert.equal(fillCopy(en.operations.scoresSaved, { n: 2 }), 'Scores saved for 2 students');
  assert.equal(fillCopy(en.operations.exportReady, { n: 2 }), 'CSV sheet, 2 rows');
  assert.equal(fillCopy(en.checkin.entryDetail, { n: 2 }), '2 open check-in sessions');
  assert.equal(fillCopy(en.events.seats, { n: 2 }), '2 seats left');
});

test('Vietnamese count copy does not inflect', () => {
  assert.equal(fillShellCopy(vi.dashboard.activeSectionsOne, { n: 1 }), '1 lớp đang học');
  assert.equal(fillShellCopy(vi.dashboard.activeSections, { n: 2 }), '2 lớp đang học');
  assert.equal(fillCopy(vi.academic.creditsOne, { n: 1 }), '1 tín chỉ');
  assert.equal(fillCopy(vi.academic.credits, { n: 2 }), '2 tín chỉ');
  assert.equal(fillCopy(vi.academic.seatsLeftOne, { n: 1 }), 'Còn 1 chỗ');
  assert.equal(fillCopy(vi.academic.registeredOne, { n: 1 }), 'Đã đăng ký 1 lớp');
  assert.equal(fillCopy(vi.academic.exportReadyOne, { n: 1 }), '1 buổi học sẵn sàng xuất');
  assert.equal(fillCopy(vi.operations.studentsCountOne, { n: 1 }), '1 sinh viên');
  assert.equal(fillCopy(vi.operations.todayClassesCountOne, { n: 1 }), '1 lớp giảng dạy hôm nay');
  assert.equal(fillCopy(vi.operations.scoresPendingOne, { n: 1 }), '1 điểm chờ nhập');
  assert.equal(fillCopy(vi.operations.savedOne, { n: 1 }), 'Đã lưu 1 bản ghi');
  assert.equal(fillCopy(vi.operations.unsavedOne, { n: 1 }), '1 thay đổi chưa lưu');
  assert.equal(fillCopy(vi.operations.changesCountOne, { n: 1 }), '1 thay đổi chưa lưu');
  assert.equal(fillCopy(vi.operations.scoresSavedOne, { n: 1 }), 'Đã lưu điểm của 1 sinh viên');
  assert.equal(fillCopy(vi.operations.exportReadyOne, { n: 1 }), 'Bảng CSV 1 dòng');
  assert.equal(fillCopy(vi.checkin.entryDetailOne, { n: 1 }), '1 buổi điểm danh đang mở');
  assert.equal(fillCopy(vi.events.seatsOne, { n: 1 }), 'Còn 1 chỗ');
});

test('every one/other pair exists in both locales and changes only the noun', () => {
  const catalogues = [
    ['vi', vi], ['en', en],
  ];
  for (const [code, copy] of catalogues) {
    for (const [group, values] of Object.entries(copy)) {
      for (const key of Object.keys(values)) {
        if (!key.endsWith('One')) continue;
        const base = key.slice(0, -3);
        assert.ok(base in values, `${code}.${group}.${key} has no ${base}`);
        assert.notEqual(String(values[key]).trim(), '', `${code}.${group}.${key} is empty`);
      }
    }
  }
  for (const [group] of Object.entries(vi)) {
    for (const key of Object.keys(vi[group])) {
      if (!key.endsWith('One')) continue;
      const base = key.slice(0, -3);
      assert.equal(vi[group][key], vi[group][base], `vi.${group}.${key} must repeat the same text`);
    }
  }
});
