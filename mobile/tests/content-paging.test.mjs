import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const paging = await loadTs('src/screens/content/content-paging.ts');
const errors = await loadTs('src/screens/content/content-errors.ts');
const rules = await loadTs('src/screens/content/content-rules.ts');
const richText = await loadTs('src/screens/content/rich-text.ts');
const records = await loadTs('src/screens/content/records-model.ts');

const keyOf = (item) => item.id;

test('envelopeToPage reads the legacy { data, meta } body and the 1-based page', () => {
  const page = paging.envelopeToPage({ data: [{ id: 'a' }], meta: { total: 45, page: 1, limit: 20, totalPages: 3 } }, { page: 0, limit: 20 });
  assert.deepEqual(page, { items: [{ id: 'a' }], total: 45, hasMore: true });
  const last = paging.envelopeToPage({ data: [], meta: { total: 45, page: 3, limit: 20, totalPages: 3 } }, { page: 2, limit: 20 });
  assert.equal(last.hasMore, false);
});

test('envelopeToPage falls back to total, then to a full page, and rejects other bodies', () => {
  assert.equal(paging.envelopeToPage({ data: [{ id: 'a' }], meta: { total: 2 } }, { page: 0, limit: 1 }).hasMore, true);
  assert.equal(paging.envelopeToPage({ data: [{ id: 'a' }], meta: { total: 1 } }, { page: 0, limit: 1 }).hasMore, false);
  assert.equal(paging.envelopeToPage({ data: [1, 2] }, { page: 0, limit: 2 }).hasMore, true);
  assert.throws(() => paging.envelopeToPage([{ id: 'a' }], { page: 0, limit: 20 }), TypeError);
  assert.throws(() => paging.envelopeToPage(null, { page: 0, limit: 20 }), TypeError);
});

test('mergeUnique keeps order, refreshes a repeated key and never duplicates a row', () => {
  const merged = paging.mergeUnique([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], [{ id: 'b', v: 2 }, { id: 'c', v: 1 }], keyOf);
  assert.deepEqual(merged, [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 1 }]);
});

test('appendPage lands only the window it asked for and survives a duplicate response', () => {
  const first = paging.startView({ items: [{ id: 'a' }], total: 3, hasMore: true }, keyOf);
  assert.equal(first.nextPage, 1);
  const second = paging.appendPage(first, { items: [{ id: 'b' }], hasMore: true }, 1, keyOf);
  assert.deepEqual(second.items.map(keyOf), ['a', 'b']);
  assert.equal(second.total, 3);
  assert.equal(paging.appendPage(second, { items: [{ id: 'b' }], hasMore: true }, 1, keyOf), second, 'stale window is ignored');
  assert.equal(paging.appendPage(second, { items: [{ id: 'z' }], hasMore: true }, 5, keyOf), second, 'future window is ignored');
  const end = paging.appendPage(second, { items: [], hasMore: true }, 2, keyOf);
  assert.equal(end.hasMore, false, 'an empty page ends paging even if the server says more');
});

test('patchItems edits and removes rows and keeps the total honest', () => {
  const view = paging.startView({ items: [{ id: 'a', read: false }, { id: 'b', read: false }], total: 2, hasMore: false }, keyOf);
  const read = paging.patchItems(view, (item) => (item.id === 'a' ? { ...item, read: true } : item));
  assert.equal(read.items[0].read, true);
  const removed = paging.patchItems(view, (item) => (item.id === 'a' ? null : item));
  assert.deepEqual(removed.items.map(keyOf), ['b']);
  assert.equal(removed.total, 1);
});

test('error mapping never leaks server text and picks copy by status', () => {
  const copy = { offline: 'off', signIn: 'in', denied: 'no', notFound: '404', rateLimited: 'slow', server: 'srv', generic: 'gen' };
  const withStatus = (status) => Object.assign(new Error('secret'), { status });
  assert.equal(errors.contentErrorMessage(copy, withStatus(401)), 'in');
  assert.equal(errors.contentErrorMessage(copy, withStatus(403)), 'no');
  assert.equal(errors.contentErrorMessage(copy, withStatus(404)), '404');
  assert.equal(errors.contentErrorMessage(copy, withStatus(429)), 'slow');
  assert.equal(errors.contentErrorMessage(copy, withStatus(503)), 'srv');
  assert.equal(errors.contentErrorMessage(copy, new TypeError('Network request failed')), 'off');
  assert.equal(errors.contentErrorMessage(copy, withStatus(409), 'custom'), 'custom');
  assert.equal(errors.contentErrorMessage(copy, new Error('secret')), 'gen');
  assert.equal(errors.isAbortError(Object.assign(new Error('x'), { code: 'REQUEST_ABORTED' })), true);
  assert.equal(errors.isAbortError(new Error('x')), false);
});

test('event action follows the server state, not the clock', () => {
  assert.equal(rules.eventAction({ status: 'REGISTRATION_OPEN', seatsRemaining: 3, myRegistrationStatus: null }), 'register');
  assert.equal(rules.eventAction({ status: 'REGISTRATION_OPEN', seatsRemaining: 0, myRegistrationStatus: null }), 'full');
  assert.equal(rules.eventAction({ status: 'REGISTRATION_OPEN', seatsRemaining: 0, myRegistrationStatus: 'REGISTERED', myRegistrationId: 'r1' }), 'cancel');
  assert.equal(rules.eventAction({ status: 'COMPLETED', seatsRemaining: 3, myRegistrationStatus: null }), 'none');
});

test('library and careers rules separate active work from history', () => {
  const statuses = (loans) => loans.map((loan) => loan.status);
  assert.deepEqual(statuses(rules.filterLoans([{ status: 'REQUESTED' }, { status: 'RETURNED' }, { status: 'ISSUED' }], 'active')), ['REQUESTED', 'ISSUED']);
  assert.deepEqual(statuses(rules.filterLoans([{ status: 'REQUESTED' }, { status: 'RETURNED' }], 'history')), ['RETURNED']);
  assert.equal(rules.isLoanCancellable({ status: 'REQUESTED' }), true);
  assert.equal(rules.isLoanCancellable({ status: 'ISSUED' }), false);
  assert.equal(rules.firstAvailableCopy([{ id: 1, status: 'ON_LOAN' }, { id: 2, status: 'AVAILABLE' }, { id: 3, status: 'AVAILABLE' }]).id, 2);
  assert.equal(rules.firstAvailableCopy([{ id: 1, status: 'ON_LOAN' }]), null);
  assert.equal(rules.firstAvailableCopy(null), null);
  assert.equal(rules.isApplicationWithdrawable({ status: 'REVIEWING' }), true);
  assert.equal(rules.isApplicationWithdrawable({ status: 'REJECTED' }), false);
  assert.deepEqual([...rules.activeOpportunityIds([{ opportunityId: 'o1', status: 'SUBMITTED' }, { opportunityId: 'o2', status: 'WITHDRAWN' }])], ['o1']);
});

test('admissions phases gate editing and files; missing fields mirror the server completeness rule', () => {
  assert.equal(rules.admissionPhase('DRAFT'), 'editable');
  assert.equal(rules.admissionPhase('RETURNED'), 'returned');
  assert.equal(rules.admissionPhase('IN_REVIEW'), 'locked');
  assert.equal(rules.admissionPhase('SUBMITTED'), 'locked');
  for (const status of ['ACCEPTED', 'REJECTED', 'WITHDRAWN']) assert.equal(rules.admissionPhase(status), 'terminal');
  assert.equal(rules.canChangeAttachments('editable'), true);
  assert.equal(rules.canChangeAttachments('returned'), true);
  assert.equal(rules.canChangeAttachments('locked'), false);
  assert.equal(rules.canChangeAttachments('terminal'), false);
  assert.deepEqual(rules.missingAdmissionFields({ fullName: ' ', dateOfBirth: '2008-01-01', schoolName: 'A', intendedMajor: null }), ['fullName', 'intendedMajor']);
  assert.deepEqual(rules.missingAdmissionFields({ fullName: 'A', dateOfBirth: '2008-01-01', schoolName: 'B', intendedMajor: 'C' }), []);
});

test('learning rules: submission phase, deadline against an injected clock, and content check', () => {
  assert.equal(rules.submissionPhase(null), 'none');
  assert.equal(rules.submissionPhase('DRAFT'), 'draft');
  assert.equal(rules.submissionPhase('RESUBMITTED'), 'submitted');
  assert.equal(rules.submissionPhase('RETURNED'), 'returned');
  assert.equal(rules.deadlinePassed('2026-01-01T00:00:00Z', Date.parse('2026-01-02T00:00:00Z')), true);
  assert.equal(rules.deadlinePassed('2026-01-03T00:00:00Z', Date.parse('2026-01-02T00:00:00Z')), false);
  assert.equal(rules.deadlinePassed(null), false);
  assert.equal(rules.hasSubmissionContent('  ', false), false);
  assert.equal(rules.hasSubmissionContent('', true), true);
  assert.equal(rules.hasSubmissionContent('answer', false), true);
});

test('notification tabs map to the server read filter and unread is counted', () => {
  assert.equal(rules.notificationReadParam('all'), undefined);
  assert.equal(rules.notificationReadParam('unread'), false);
  assert.equal(rules.countUnread([{ isRead: false }, { isRead: true }, { isRead: false }]), 2);
});

test('htmlToPlainText drops markup and scripts and decodes entities', () => {
  const text = richText.htmlToPlainText('<p>Hello &amp; <b>welcome</b></p><script>alert(1)</script><ul><li>One</li><li>Two</li></ul><img src=x onerror=alert(1)>');
  assert.equal(text.includes('<'), false);
  assert.equal(text.includes('alert'), false);
  assert.match(text, /Hello & welcome/);
  assert.match(text, /• One/);
  assert.equal(richText.htmlToPlainText(null), '');
  assert.equal(richText.excerptOf(`<p></p><p>${'x'.repeat(300)}</p>`, 20).length, 20);
});

test('parseConduct tolerates the literal "null" student code, dedupes terms and rejects foreign bodies', () => {
  assert.equal(records.parseConduct({ unrelated: true }), null);
  assert.equal(records.parseConduct(null), null);
  const model = records.parseConduct({
    studentCode: 'null',
    cumulativeAverageScore: 84,
    currentSemester: { id: 't1', semesterName: 'HK1', totalScore: 80, criteria: [{ code: 'A', score: 8, maxScore: 10 }, { code: 'B', score: 'x' }] },
    history: [{ id: 't1', semesterName: 'HK1' }, { id: 't0', semesterName: 'HK0' }],
  });
  assert.equal(model.studentCode, null);
  assert.equal(model.cumulativeAverage, 84);
  assert.deepEqual(model.terms.map((term) => term.id), ['t1', 't0']);
  assert.equal(model.terms[0].criteria.length, 1);
});

test('composeCertificateInfo reports no data instead of inventing a certificate', () => {
  assert.equal(records.composeCertificateInfo(null, null).hasData, false);
  const info = records.composeCertificateInfo(
    { studentCode: '1', fullName: 'A', cumulativeAverage: 80, cumulativeClassificationVi: 'Tốt', terms: [] },
    { curriculum: { name: 'CS', totalCredits: 120 }, courses: [{ credits: 3, status: 'COMPLETED' }, { credits: 3, isMandatory: true, status: 'PENDING' }] },
  );
  assert.equal(info.hasData, true);
  assert.equal(info.creditsEarned, 3);
  assert.equal(info.creditsRequired, 120);
  assert.equal(info.mandatoryRemaining, 1);
});
