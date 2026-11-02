/**
 * Frozen browser oracle for the W19 archive server search.
 *
 * The predicate below is preserved from the page implementation at db83f21d.
 * The production page now sends this query to the server, so keeping the
 * historical browser behavior here lets the JS and Java suites continue to
 * compare against the same golden fixture after removing client-side filtering.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, '..', 'contracts', 'thesis-archive-search-cases.json'), 'utf8'),
);

// The fixture stores DTO-shaped rows; the predicate reads root and child values.
const reports = fixture.reports.map((report) => ({
  ...report,
  supervisors: (report.supervisors || []).map((supervisor) => ({ displayName: supervisor.displayName })),
  members: (report.members || []).map((member) => ({
    displayName: member.displayName,
    studentNumber: member.studentNumber,
  })),
}));

function predicate(repositorySearch, repositoryReports) {
  const raw = repositorySearch.trim();
  if (!raw) return repositoryReports;
  const fold = (value) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase();
  const foldedQuery = fold(raw);
  const queryTokens = foldedQuery.split(/\s+/).filter(Boolean);
  return repositoryReports.filter((report) => {
    const haystack = fold(
      [
        report.topicTitle || report.title || '',
        report.topicDescription || '',
        report.note || '',
        report.fileName || '',
        report.departmentName || '',
        report.submittedByDisplayName || '',
        report.submittedByStudentNumber || '',
        ...report.supervisors.map((supervisor) => supervisor.displayName || ''),
        ...report.members.map((member) => (member.displayName || '') + ' ' + (member.studentNumber || '')),
      ].join(' '),
    );
    return queryTokens.every((token) => haystack.includes(token));
  });
}

test('the frozen archive oracle keeps normalization and searchable-field behavior', () => {
  const source = predicate.toString();
  assert.match(source, /normalize\('NFD'\)/);
  assert.match(source, /\\u0300-\\u036f/);
  assert.match(source, /replace\(\/đ\/g, 'd'\)/);
  assert.match(source, /topicTitle \|\| report\.title \|\| ''/);
  assert.match(source, /report\.supervisors\.map/);
  assert.match(source, /report\.members\.map/);
});

test('the fixture is a real freeze, not an empty placeholder', () => {
  assert.ok(fixture.cases.length >= 25, 'fixture must keep the fail-first case table');
  const matching = fixture.cases.filter((item) => item.expect.length > 0);
  assert.ok(matching.length >= 15, 'most cases must pin at least one report');
  assert.deepEqual(fixture.summary, {
    total: reports.length,
    files: reports.filter((report) => typeof report.fileName === 'string' && report.fileName !== '').length,
    urls: reports.filter((report) => typeof report.url === 'string' && report.url !== '').length,
  });
});

for (const item of fixture.cases) {
  test('frozen web predicate reproduces "' + item.name + '"', () => {
    const ids = predicate(item.search, reports).map((report) => report.id);
    assert.deepEqual(ids, item.expect);
  });
}
