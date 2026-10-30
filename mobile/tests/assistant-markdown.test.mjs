import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-assistant-markdown-'));
const { outputText } = ts.transpileModule(fs.readFileSync(path.join(mobileRoot, 'src/assistant/markdown.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
fs.writeFileSync(path.join(tempRoot, 'markdown.mjs'), outputText);
const md = await import(pathToFileURL(path.join(tempRoot, 'markdown.mjs')).href);

const text = (spans) => md.spansToText(spans);

test('headings, paragraphs, quotes and lists parse into blocks', () => {
  const blocks = md.parseMarkdown('# Tiêu đề\n\nĐoạn một.\n\n> Trích dẫn\n\n- một\n- hai\n\n1. a\n2. b');
  assert.deepEqual(blocks.map((block) => block.type), ['heading', 'paragraph', 'quote', 'list', 'list']);
  assert.equal(text(blocks[0].spans), 'Tiêu đề');
  assert.equal(blocks[3].ordered, false);
  assert.equal(blocks[3].items.length, 2);
  assert.equal(blocks[4].ordered, true);
});

test('inline bold, italic and code keep their text', () => {
  const [paragraph] = md.parseMarkdown('Học phí **bắt buộc**, *nên* xem `mã`.');
  const spans = paragraph.spans;
  assert.ok(spans.some((span) => span.bold && span.text === 'bắt buộc'));
  assert.ok(spans.some((span) => span.italic && span.text === 'nên'));
  assert.ok(spans.some((span) => span.code && span.text === 'mã'));
});

test('only https links with a real host become links', () => {
  assert.equal(md.safeLinkUrl('https://example.edu/quy-che'), 'https://example.edu/quy-che');
  for (const bad of [
    'http://example.edu',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'https://user:pass@example.edu',
    'https://localhost/x',
    'https://example.edu/a b',
    'https://example.edu/"onclick',
    '//example.edu',
    '',
  ]) {
    assert.equal(md.safeLinkUrl(bad), null, bad);
  }
  const [paragraph] = md.parseMarkdown('Xem [quy chế](https://example.edu/q) và [bẫy](javascript:alert(1)).');
  assert.ok(paragraph.spans.some((span) => span.type === 'link' && span.url === 'https://example.edu/q'));
  assert.ok(paragraph.spans.every((span) => span.type !== 'link' || span.url.startsWith('https://')));
  assert.ok(text(paragraph.spans).includes('bẫy'));
});

test('raw html is kept as literal text, never as markup', () => {
  const [paragraph] = md.parseMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.equal(paragraph.type, 'paragraph');
  assert.ok(paragraph.spans.every((span) => span.type === 'text'));
  assert.ok(text(paragraph.spans).includes('<script>'));
});

test('fenced code is literal and tables keep header and rows', () => {
  const blocks = md.parseMarkdown('```\n**không in đậm**\n```\n\n| Môn | Điểm |\n| --- | --- |\n| Toán | 9 |');
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].text, '**không in đậm**');
  assert.equal(blocks[1].type, 'table');
  assert.equal(blocks[1].header.length, 2);
  assert.equal(text(blocks[1].rows[0][1]), '9');
});

test('streaming hides unfinished syntax at the tail only', () => {
  assert.equal(md.trimIncompleteSyntax('Xem [quy chế](https://exa'), 'Xem ');
  assert.equal(md.trimIncompleteSyntax('Học phí **'), 'Học phí ');
  assert.equal(md.trimIncompleteSyntax('Xong.'), 'Xong.');
  const open = '```\ncode dang viet';
  assert.equal(md.trimIncompleteSyntax(open), open);
  const [paragraph] = md.parseMarkdown('Xem [quy chế](https://exa', { streaming: true });
  assert.equal(text(paragraph.spans).trim(), 'Xem');
});

test('empty and whitespace input yield no blocks', () => {
  assert.deepEqual(md.parseMarkdown(''), []);
  assert.deepEqual(md.parseMarkdown('  \n \n'), []);
});
