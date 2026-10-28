import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const thesisJava = path.resolve(
  mobileRoot,
  '../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis',
);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-thesis-'));
for (const file of ['screens/thesis/thesis-model.ts', 'screens/thesis/thesis-files.ts', 'i18n/thesis-messages.ts']) {
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(mobileRoot, 'src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  fs.writeFileSync(
    path.join(tempRoot, path.basename(file).replace('.ts', '.mjs')),
    outputText.replace(/from '\.\/([\w-]+)'/g, "from './$1.mjs'"),
  );
}
const load = (name) => import(pathToFileURL(path.join(tempRoot, `${name}.mjs`)).href);
const model = await load('thesis-model');
const files = await load('thesis-files');
const { thesisMessages, fillThesisCopy } = await load('thesis-messages');
const vi = thesisMessages.vi;
const en = thesisMessages.en;

const round = (id, status) => ({ id, status });

test('the default round is the selection, else registration, else published topics', () => {
  const rounds = [round('a', 'CANCELLED'), round('b', 'RESULTS_PUBLISHED'), round('c', 'PROPOSALS_PUBLISHED'), round('d', 'REGISTRATION_OPEN')];
  assert.equal(model.pickDefaultRound(rounds, 'b').id, 'b');
  assert.equal(model.pickDefaultRound(rounds, 'gone').id, 'd');
  assert.equal(model.pickDefaultRound(rounds.slice(0, 3)).id, 'c');
  assert.equal(model.pickDefaultRound([round('x', 'CANCELLED'), round('y', 'DRAFT')]).id, 'x');
  assert.equal(model.pickDefaultRound([]), null);
  assert.equal(model.isRegistrationOpen(round('d', 'REGISTRATION_OPEN')), true);
  assert.equal(model.isRegistrationOpen(round('c', 'PROPOSALS_PUBLISHED')), false);
});

test('topic search ignores case and Vietnamese accents over title, department and brief', () => {
  const topics = [
    { title: 'Trợ lý học vụ', description: 'Câu trả lời có nguồn', departmentId: 'CNTT' },
    { title: 'Thư viện di động', description: 'Mượn sách', departmentId: 'KTPM' },
  ];
  assert.equal(model.filterTopics(topics, 'tro ly hoc vu').length, 1);
  assert.equal(model.filterTopics(topics, 'MUON SACH')[0].title, 'Thư viện di động');
  assert.equal(model.filterTopics(topics, 'ktpm').length, 1);
  assert.equal(model.filterTopics(topics, '   ').length, 2);
  assert.equal(model.filterTopics(topics, 'khong co').length, 0);
  assert.equal(model.normalizeSearch('Đường'), 'duong');
});

test('advisors are grouped per lecturer from topic supervisors and sorted by name', () => {
  const row = (topic, ...supervisors) => ({ topic: { id: topic, title: `Đề tài ${topic}` }, supervisors });
  const nam = { lecturerId: 'l1', supervisorOrder: 1, lastName: 'Phạm', firstName: 'Nam', email: 'nam@example.edu' };
  const lan = { lecturerId: 'l2', supervisorOrder: 1, lastName: 'Võ', firstName: 'Lan', email: null };
  const directory = model.buildAdvisorDirectory([row('t1', nam), row('t2', lan, nam), row('t2', nam), row('t3')]);
  assert.deepEqual(directory.map((entry) => entry.lecturerId), ['l1', 'l2']);
  assert.deepEqual(directory[0].topics.map((topic) => topic.id), ['t1', 't2']);
  assert.equal(directory[0].email, 'nam@example.edu');
  assert.equal(directory[1].email, null);
  assert.equal(model.supervisorName({ lecturerId: 'x', supervisorOrder: 1, email: 'a@b.c' }), 'a@b.c');
});

test('supervisor reads run with bounded concurrency and keep input order', async () => {
  let running = 0;
  let peak = 0;
  const results = await model.mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], model.THESIS_ADVISOR_CONCURRENCY, async (value) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running -= 1;
    return value * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  assert.ok(peak <= model.THESIS_ADVISOR_CONCURRENCY, `peak ${peak}`);
  assert.deepEqual(await model.mapWithConcurrency([], 4, async () => 1), []);
});

test('progress follows the server milestones', () => {
  const progress = { completedMilestones: ['ROUND_SELECTED', 'GROUP_CREATED', 'TOPIC_ASSIGNED'], currentMilestone: 'GROUP_APPROVED' };
  assert.equal(model.milestoneState(progress, 'GROUP_CREATED'), 'done');
  assert.equal(model.milestoneState(progress, 'GROUP_APPROVED'), 'current');
  assert.equal(model.milestoneState(progress, 'RESULTS_PUBLISHED'), 'pending');
  assert.equal(model.progressPercent(progress), 38);
  assert.equal(model.progressPercent({ completedMilestones: [...model.THESIS_MILESTONES] }), 100);
  assert.equal(model.progressPercent(null), 0);
  for (const milestone of model.THESIS_MILESTONES) {
    assert.ok(vi.milestones[milestone] && en.milestones[milestone], milestone);
  }
});

test('group size and writes follow the server rules', () => {
  assert.equal(model.groupSizeState(2), 'tooSmall');
  assert.equal(model.groupSizeState(3), 'ok');
  assert.equal(model.groupSizeState(4), 'ok');
  assert.equal(model.groupSizeState(5), 'full');
  assert.equal(model.isGroupLeader({ leaderStudentId: 's1' }, 's1'), true);
  assert.equal(model.isGroupLeader({ leaderStudentId: 's1' }, 's2'), false);
  assert.equal(model.isGroupLeader(null, 's1'), false);
  assert.equal(model.isGroupEditable({ status: 'ASSIGNED', approvalStatus: 'PENDING' }), true);
  assert.equal(model.isGroupEditable({ status: 'ASSIGNED', approvalStatus: 'APPROVED' }), false);
  assert.equal(model.isGroupEditable({ status: 'CANCELLED', approvalStatus: 'PENDING' }), false);
  assert.equal(model.canWriteReport({ status: 'SUBMITTED', approvalStatus: 'APPROVED' }, true), true);
  assert.equal(model.canWriteReport({ status: 'SUBMITTED', approvalStatus: 'APPROVED' }, false), false);
  assert.equal(model.canWriteReport({ status: 'ASSIGNED', approvalStatus: 'PENDING' }, true), false);
});

test('report input mirrors the server limits and requires an artifact', () => {
  const ok = { title: 'Báo cáo', note: 'Ghi chú', url: 'https://example.edu/r' };
  assert.deepEqual(model.validateReportInput(ok, false), []);
  assert.deepEqual(model.validateReportInput({ ...ok, url: '' }, true), []);
  assert.deepEqual(model.validateReportInput({ ...ok, url: '' }, false), ['artifactRequired']);
  assert.deepEqual(model.validateReportInput({ ...ok, url: 'ftp://x.edu/r' }, false), ['urlInvalid']);
  assert.deepEqual(model.validateReportInput({ ...ok, url: 'javascript:alert(1)' }, true), ['urlInvalid']);
  assert.deepEqual(model.validateReportInput({ ...ok, title: 'a'.repeat(240) }, false), []);
  assert.deepEqual(model.validateReportInput({ ...ok, title: 'a'.repeat(241) }, false), ['titleLong']);
  assert.deepEqual(model.validateReportInput({ ...ok, note: 'a'.repeat(501) }, false), ['noteLong']);
  assert.equal(model.isHttpUrl('http://example.edu/r'), true);
  assert.equal(model.isHttpUrl('https://exa mple.edu'), false);
});

test('report files accept pdf, doc and docx up to 20 MB', () => {
  assert.equal(model.validateReportFile({ name: 'bao-cao.PDF', sizeBytes: 1024 }), null);
  assert.equal(model.validateReportFile({ name: 'a.doc', sizeBytes: 1 }), null);
  assert.equal(model.validateReportFile({ name: 'a.docx' }), null);
  assert.equal(model.validateReportFile({ name: 'a.exe', sizeBytes: 10 }), 'fileType');
  assert.equal(model.validateReportFile({ name: 'noext', sizeBytes: 10 }), 'fileType');
  assert.equal(model.validateReportFile({ name: 'a.pdf', sizeBytes: 0 }), 'fileEmpty');
  assert.equal(model.validateReportFile({ name: 'a.pdf', sizeBytes: model.THESIS_REPORT_FILE_MAX_BYTES }), null);
  assert.equal(model.validateReportFile({ name: 'a.pdf', sizeBytes: model.THESIS_REPORT_FILE_MAX_BYTES + 1 }), 'fileSize');
  assert.equal(model.reportMimeType('a.pdf'), 'application/pdf');
  assert.equal(model.reportMimeType('a.doc'), 'application/msword');
});

test('saving a report sends the fewest calls and never clears the stored file', () => {
  const input = { title: 'T', note: 'N', url: 'https://example.edu/r' };
  assert.deepEqual(model.planReportSave(null, input, false).steps, ['link']);
  const withFile = model.planReportSave(null, input, true);
  assert.deepEqual(withFile.steps, ['file', 'patch']);
  assert.deepEqual(withFile.patch, { url: 'https://example.edu/r' });
  assert.deepEqual(model.planReportSave(null, { ...input, url: '' }, true).steps, ['file']);

  const stored = { groupId: 'g', title: 'T', note: 'N', url: 'https://example.edu/r', fileName: 'a.pdf' };
  assert.deepEqual(model.planReportSave(stored, input, false).steps, []);
  assert.deepEqual(model.planReportSave(stored, { ...input, title: 'T2' }, false).patch, { title: 'T2' });
  assert.deepEqual(model.planReportSave(stored, { ...input, url: '' }, false).patch, { clearUrl: true });
  assert.deepEqual(model.planReportSave(stored, { ...input, url: 'https://example.edu/new' }, false).patch, { url: 'https://example.edu/new' });
  const replace = model.planReportSave(stored, { ...input, title: 'T3' }, true);
  assert.deepEqual(replace.steps, ['file']);
  assert.equal(replace.title, 'T3');
});

test('errors map to student-safe copy and never expose the server text', () => {
  const error = (status, code, message = 'raw server detail') => Object.assign(new Error(message), { status, code });
  const cases = [
    [error(401), 'session'],
    [error(403), 'forbidden'],
    [error(404), 'notFound'],
    [error(409), 'conflict'],
    [error(429), 'rate'],
    [error(503), 'unavailable'],
    [error(0, 'NETWORK_ERROR'), 'offline'],
    [new TypeError('fetch failed'), 'offline'],
    [error(0, 'REQUEST_ABORTED'), 'aborted'],
    [error(500, 'SESSION_CHANGED'), 'aborted'],
  ];
  for (const [value, kind] of cases) assert.equal(model.thesisErrorInfo(value).kind, kind);
  assert.equal(model.isAbortLike(error(0, 'REQUEST_ABORTED')), true);
  assert.equal(model.thesisErrorMessage(vi, error(409, 'GROUP_FULL')), vi.errors.codes.GROUP_FULL);
  assert.equal(model.thesisErrorMessage(en, error(409, 'REPORT_DEADLINE_PASSED')), en.errors.codes.REPORT_DEADLINE_PASSED);
  assert.equal(model.thesisErrorMessage(vi, error(500, 'SOMETHING_NEW')), vi.errors.unavailable);
  assert.equal(model.thesisErrorMessage(vi, error(400, 'UNKNOWN')), vi.errors.generic);
  for (const [value] of cases) {
    assert.ok(!model.thesisErrorMessage(vi, value).includes('raw server detail'));
  }
});

test('every copy key exists in Vietnamese and English with no empty text', () => {
  const flatten = (value, prefix = '') => Object.entries(value).flatMap(([key, entry]) => (
    entry !== null && typeof entry === 'object' ? flatten(entry, `${prefix}${key}.`) : [[`${prefix}${key}`, entry]]
  ));
  const viKeys = flatten(vi).map(([key]) => key).sort();
  const enKeys = flatten(en).map(([key]) => key).sort();
  assert.deepEqual(viKeys, enKeys);
  for (const [key, value] of flatten(vi)) {
    if (key === 'attention.NONE') continue;
    assert.ok(String(value).trim().length > 0, key);
  }
  assert.equal(fillThesisCopy(vi.topicCount, { count: 3 }), '3 đề tài');
  assert.equal(fillThesisCopy('{a}-{b}', { a: 1 }), '1-{b}');
  // The copy names the same limits the model enforces.
  assert.ok(vi.validation.titleLong.includes(String(model.THESIS_REPORT_TITLE_MAX)));
  assert.ok(vi.validation.noteLong.includes(String(model.THESIS_REPORT_NOTE_MAX)));
  assert.ok(vi.validation.fileSize.includes('20'));
  assert.ok(vi.groupRule.includes(String(model.THESIS_GROUP_MIN_MEMBERS)));
  assert.ok(vi.groupRule.includes(String(model.THESIS_GROUP_MAX_MEMBERS)));
});

const adapterWith = (overrides = {}) => ({
  capability: () => ({ available: true }),
  pick: async () => ({ status: 'cancelled' }),
  share: async () => ({ status: 'done' }),
  save: async () => ({ status: 'done' }),
  ...overrides,
});
const unavailable = adapterWith({
  capability: () => ({ available: false, reason: 'No file access.' }),
});

test('file pick and download are unavailable without an adapter and never fabricate a result', async () => {
  assert.deepEqual(await files.pickReportFile(unavailable), { status: 'unavailable', reason: 'No file access.' });
  let fetched = false;
  const outcome = await files.saveReportFile(unavailable, async () => { fetched = true; return { data: new ArrayBuffer(1), contentType: null, fileName: null }; }, 'report');
  assert.deepEqual(outcome, { status: 'unavailable', reason: 'No file access.' });
  assert.equal(fetched, false, 'nothing is downloaded when it cannot be saved');
});

test('a picked file is validated before any upload and keeps its declared type', async () => {
  const pick = (file) => files.pickReportFile(adapterWith({ pick: async () => ({ status: 'picked', file }) }));
  const good = { uri: 'file:///a/bao-cao.pdf', name: 'bao-cao.pdf', sizeBytes: 2048 };
  assert.deepEqual(await pick(good), { status: 'picked', file: good });
  assert.deepEqual(await pick({ ...good, name: 'x.zip' }), { status: 'invalid', issue: 'fileType' });
  assert.deepEqual(await pick({ ...good, sizeBytes: model.THESIS_REPORT_FILE_MAX_BYTES + 1 }), { status: 'invalid', issue: 'fileSize' });
  assert.deepEqual(await files.pickReportFile(adapterWith()), { status: 'cancelled' });
  assert.deepEqual(files.toReportPart(good), { uri: good.uri, name: good.name, type: 'application/pdf' });
});

test('a downloaded report is handed to the save sheet with a data uri and a safe name', async () => {
  let saved;
  const adapter = adapterWith({ save: async (target) => { saved = target; return { status: 'done' }; } });
  const bytes = new TextEncoder().encode('%PDF-1.4').buffer;
  const done = await files.saveReportFile(adapter, async () => ({ data: bytes, contentType: 'application/pdf', fileName: 'bao-cao.pdf' }), 'report');
  assert.deepEqual(done, { status: 'done' });
  assert.equal(saved.name, 'bao-cao.pdf');
  assert.equal(saved.mimeType, 'application/pdf');
  assert.equal(saved.uri, `data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}`);
  const empty = await files.saveReportFile(adapter, async () => ({ data: new ArrayBuffer(0), contentType: null, fileName: null }), 'report');
  assert.deepEqual(empty, { status: 'failed', reason: 'EMPTY' });
  const failed = await files.saveReportFile(adapter, async () => { throw Object.assign(new Error('x'), { code: 'NETWORK_ERROR' }); }, 'report');
  assert.deepEqual(failed, { status: 'failed', reason: 'NETWORK_ERROR' });
});

const javaConstant = (file, name) => {
  const source = fs.readFileSync(path.join(thesisJava, file), 'utf8');
  const match = new RegExp(`${name}\\s*=\\s*([\\d_L* ]+?);`).exec(source);
  assert.ok(match, `${name} declaration not found in ${file}`);
  return match[1].replaceAll('_', '').replaceAll('L', '').split('*').map((part) => Number(part.trim())).reduce((a, b) => a * b, 1);
};

test('thesis limits equal the Java service', () => {
  assert.equal(model.THESIS_GROUP_MIN_MEMBERS, javaConstant('service/ThesisMutationService.java', 'MIN_GROUP_MEMBERS'));
  assert.equal(model.THESIS_GROUP_MAX_MEMBERS, javaConstant('service/ThesisMutationService.java', 'MAX_GROUP_MEMBERS'));
  assert.equal(model.THESIS_REPORT_FILE_MAX_BYTES, javaConstant('service/ReportFilePolicy.java', 'MAX_FILE_BYTES'));
  const policy = fs.readFileSync(path.join(thesisJava, 'service/ReportFilePolicy.java'), 'utf8');
  const extensions = /ALLOWED_EXTENSIONS = Set\.of\(([^)]*)\)/.exec(policy)?.[1].match(/"(\w+)"/g)?.map((entry) => entry.replaceAll('"', ''));
  assert.deepEqual([...(extensions ?? [])].sort(), [...model.THESIS_REPORT_FILE_EXTENSIONS].sort());
  const reports = fs.readFileSync(path.join(thesisJava, 'service/ThesisReportService.java'), 'utf8');
  assert.ok(reports.includes(`blankToNull(title, ${model.THESIS_REPORT_TITLE_MAX})`));
  assert.ok(reports.includes(`blankToNull(note, ${model.THESIS_REPORT_NOTE_MAX})`));
});

test('thesis milestones equal the server progress contract', () => {
  const source = fs.readFileSync(path.join(thesisJava, 'service/ThesisProgressService.java'), 'utf8');
  const block = /List\.of\(([^;]*?)\);/s.exec(source.slice(source.indexOf('"ROUND_SELECTED"') - 40))?.[1] ?? '';
  const server = block.match(/"([A-Z_]+)"/g)?.map((entry) => entry.replaceAll('"', ''));
  assert.deepEqual(server, [...model.THESIS_MILESTONES]);
});

test('the screens use the thesis assistant scope and no secret reaches the app source', () => {
  const read = (relative) => fs.readFileSync(path.join(mobileRoot, relative), 'utf8');
  const ui = read('src/screens/thesis/thesis-ui.tsx');
  assert.match(ui, /requestAssistantEntryScope\('specialized'\)/);
  assert.match(ui, /navigation\.navigate\('assistant\.chat'\)/);
  for (const file of ['ThesisDetailScreen', 'ThesisProgressScreen']) {
    assert.match(read(`src/screens/thesis/${file}.tsx`), /AskAssistantButton/, file);
  }
  const everything = fs.readdirSync(path.join(mobileRoot, 'src/screens/thesis'))
    .map((name) => read(`src/screens/thesis/${name}`)).join('\n');
  assert.doesNotMatch(everything, /DEEPSEEK|API_KEY|sk-[A-Za-z0-9]/);
  assert.doesNotMatch(everything, /EventSource|text\/event-stream/);
});
