const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

/**
 * Frozen browser oracle for the catalogue server contract. This preserves the
 * pre-migration predicate after the screen moves its filtering to the server,
 * so the Java and JS suites continue to compare against the shared fixture.
 */

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(root, '../contracts/thesis-topic-catalog-search-cases.json'), 'utf8'),
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTsModule(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, require);
  return moduleRecord.exports;
}

const topicBilingualKeywords = {
  'artificial intelligence': ['artificial intelligence', 'ai', 'trí tuệ nhân tạo'],
  'software & web': ['software', 'web', 'phần mềm'],
  'robotics & mechatronics': ['robotics', 'mechatronics', 'cơ điện tử', 'robot'],
  'information systems': ['information systems', 'hệ thống thông tin'],
  'iot & telecom': ['iot', 'telecom', 'viễn thông'],
  automotive: ['automotive', 'ô tô'],
  'civil engineering': ['civil engineering', 'xây dựng'],
};

const { plainTextThesisDescription } = loadTsModule('src/lib/thesis-text.ts');
const { normalizeVietnameseText } = loadTsModule('src/lib/registration-browse.ts');

function matchedTopics(topics, submittedQuery, showAll) {
  const searchActive = showAll || submittedQuery.trim().length > 0;
  if (!searchActive) return [];
  const normalizedQuery = submittedQuery.trim().toLowerCase();
  if (showAll || !normalizedQuery || normalizedQuery === 'all') return topics;

  const searchTerms = [normalizedQuery];
  for (const [key, synonyms] of Object.entries(topicBilingualKeywords)) {
    if (normalizedQuery.includes(key) || key.includes(normalizedQuery)) {
      searchTerms.push(...synonyms.map((synonym) => synonym.toLowerCase()));
    }
  }

  return topics.filter((topic) => {
    const fullText = normalizeVietnameseText(
      [topic.title, plainTextThesisDescription(topic.description)].filter(Boolean).join(' '),
    );
    return searchTerms.some((term) => {
      const foldedTerm = normalizeVietnameseText(term);
      if (!foldedTerm) return true;
      if (fullText.includes(foldedTerm)) return true;
      const tokens = foldedTerm.split(/\s+/).filter(Boolean);
      return tokens.length > 0 && tokens.every((token) => fullText.includes(token));
    });
  });
}

function matchedIds(topics, search, showAll) {
  return matchedTopics(topics, search, showAll).map((topic) => topic.id);
}

test('the frozen browser synonym dictionary matches the shared fixture', () => {
  assert.deepEqual(topicBilingualKeywords, fixture.dictionary);
  assert.deepEqual(Object.keys(topicBilingualKeywords), [
    'artificial intelligence',
    'software & web',
    'robotics & mechatronics',
    'information systems',
    'iot & telecom',
    'automotive',
    'civil engineering',
  ]);
});

test('the frozen browser predicate reproduces every golden case', () => {
  for (const item of fixture.cases) {
    assert.deepEqual(
      matchedIds(fixture.topics, item.search, item.showAll),
      item.expectedIds,
      item.name,
    );
  }
});

test('the frozen browser predicate reproduces the empty-catalogue cases', () => {
  for (const item of fixture.emptyCatalogue.cases) {
    assert.deepEqual(matchedIds([], item.search, item.showAll), item.expectedIds, item.name);
  }
});

test('fixture answers distinguish an empty catalogue from an empty result', () => {
  const noMatch = fixture.cases.find((item) => item.name === 'no matches');
  assert.ok(noMatch);
  assert.deepEqual(noMatch.expectedIds, []);
  assert.ok(fixture.topics.length > 0);
  assert.ok(fixture.cases.some((item) => item.expectedIds.length === fixture.topics.length));
});
