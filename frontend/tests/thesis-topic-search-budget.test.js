const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTsModule(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, require);
  return moduleRecord.exports;
}

const { isTopicSearchWithinBudget } = loadTsModule('src/lib/thesis-topic-search.ts');

function tokens(count, separator) {
  return Array.from({ length: count }, (_, index) => 't' + index).join(separator);
}

test('the search budget accepts exactly 200 characters and rejects 201', () => {
  assert.equal(isTopicSearchWithinBudget('z'.repeat(200)), true);
  assert.equal(isTopicSearchWithinBudget('z'.repeat(201)), false);
});

test('the search budget accepts exactly 16 tokens and rejects 17', () => {
  assert.equal(isTopicSearchWithinBudget(tokens(16, ' ')), true);
  assert.equal(isTopicSearchWithinBudget(tokens(17, ' ')), false);
});

test('the budget is measured on the trimmed query the page sends', () => {
  assert.equal(isTopicSearchWithinBudget('  alpha  '), true);
  assert.equal(
    isTopicSearchWithinBudget('  ' + 'z'.repeat(200) + '  '),
    true,
    'the page sends the trimmed 200-character query, which the API accepts',
  );
  assert.equal(
    isTopicSearchWithinBudget(' ' + 'z'.repeat(201)),
    false,
    'trimming must not let an over-length query through',
  );
  assert.equal(isTopicSearchWithinBudget('  ' + tokens(17, ' ') + '  '), false);
});

test('the budget counts the ECMAScript whitespace set as token separators', () => {
  assert.equal(isTopicSearchWithinBudget('a\u00a0b'), true, 'U+00A0 separates tokens');
  assert.equal(isTopicSearchWithinBudget(tokens(16, '\u00a0')), true);
  assert.equal(isTopicSearchWithinBudget(tokens(17, '\u00a0')), false);
  assert.equal(isTopicSearchWithinBudget(tokens(16, '\u3000')), true, 'U+3000 separates tokens');
  assert.equal(isTopicSearchWithinBudget(tokens(17, '\u3000')), false);
  assert.equal(
    isTopicSearchWithinBudget('\u00a0\u3000' + 'z'.repeat(200) + '\u3000\u00a0'),
    true,
    'unicode whitespace is trimmed before the length check',
  );
});

test('the catalogue page measures submissions with the shared budget', () => {
  const source = read('src/components/dashboard/thesis/ThesisTopicCatalogPage.tsx');
  assert.match(
    source,
    /isTopicSearchWithinBudget,\s*TOPIC_SEARCH_MAX_LENGTH,\s*\} from '@\/lib\/thesis-topic-search';/,
  );
  assert.match(source, /maxLength=\{TOPIC_SEARCH_MAX_LENGTH\}/);
  assert.match(source, /isTopicSearchWithinBudget\(searchInput\)/);
  assert.doesNotMatch(source, /function isTopicSearchWithinBudget/);
});
