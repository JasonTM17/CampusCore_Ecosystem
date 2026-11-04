import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(path.resolve(mobileRoot, '../contracts/assistant-link-policy-cases.json'), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-assistant-markdown-'));
for (const name of ['assistant-link-policy', 'markdown']) {
  const source = path.join(mobileRoot, `src/assistant/${name}.ts`);
  const { outputText } = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  fs.writeFileSync(path.join(tempRoot, `${name}.js`), outputText);
}
const require = createRequire(import.meta.url);
const md = require(path.join(tempRoot, 'markdown.js'));
const policy = require(path.join(tempRoot, 'assistant-link-policy.js'));

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

test('shared conformance fixture is enforced by the mobile policy', () => {
  assert.deepEqual([...policy.ASSISTANT_ALLOWED_DASHBOARD_ROUTES], fixture.dashboardRoutes);
  for (const item of fixture.cases) {
    assert.equal(policy.isAssistantMobileDestinationAllowed(item.destination), item.allowed, item.name);
    assert.equal(policy.resolveAssistantMobileTarget(item.destination), item.mobileTarget ?? null, item.name);
  }
});

test('only published docs and safe dashboard routes become native navigation spans', () => {
  assert.equal(md.safeLinkUrl('/docs/quy-che'), '/docs?slug=quy-che');
  assert.equal(md.safeLinkUrl('/dashboard/schedule'), '/schedule');
  for (const bad of [
    'https://example.edu',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'vbscript:msgbox(1)',
    'HTTPS://example.edu',
    'https://xn--e1afmkfd.example/docs/policy',
    '//example.edu/docs/policy',
    '/docs/%2f%2fexample.edu',
    '/docs/%252f%252fexample.edu',
    '/dashboard%2fschedule',
    '/dashboard/profile',
    ' /docs/quy-che',
    '\t/docs/quy-che',
    '',
  ]) {
    assert.equal(md.safeLinkUrl(bad), null, bad);
  }
  const [paragraph] = md.parseMarkdown('Xem [quy chế](/docs/quy-che) và [lịch](/dashboard/schedule), nhưng [bẫy](javascript:alert(1)) stays text.');
  assert.ok(paragraph.spans.some((span) => span.type === 'link' && span.url === '/docs?slug=quy-che'));
  assert.ok(paragraph.spans.some((span) => span.type === 'link' && span.url === '/schedule'));
  assert.ok(paragraph.spans.every((span) => span.type !== 'link' || span.url.startsWith('/')));
  assert.ok(text(paragraph.spans).includes('bẫy'));
  assert.ok(text(paragraph.spans).includes('stays text.'));
});

test('bare route strings link only when the complete route is allowlisted', () => {
  const [safe] = md.parseMarkdown('Open /docs/quy-che and /dashboard/schedule.');
  assert.ok(safe.spans.some((span) => span.type === 'link' && span.url === '/docs?slug=quy-che'));
  assert.ok(safe.spans.some((span) => span.type === 'link' && span.url === '/schedule'));
  const [denied] = md.parseMarkdown('Keep /dashboard/profile and /dashboard%2fschedule as text.');
  assert.ok(denied.spans.every((span) => span.type !== 'link'));
  assert.ok(text(denied.spans).includes('/dashboard%2fschedule'));
});

test('every SSE split boundary keeps denied links plain and allowed docs internal', () => {
  const denied = 'Before [outside](https://xn--e1afmkfd.example/docs/policy) after.';
  let accumulated = '';
  for (const character of denied) {
    accumulated += character;
    const blocks = md.parseMarkdown(accumulated, { streaming: true });
    assert.ok(blocks.every((block) => !('spans' in block) || block.spans.every((span) => span.type !== 'link')));
  }
  const finalDenied = md.parseMarkdown(accumulated);
  assert.ok(finalDenied.every((block) => !('spans' in block) || block.spans.every((span) => span.type !== 'link')));
  assert.ok(text(finalDenied[0].spans).includes('Before'));
  assert.ok(text(finalDenied[0].spans).includes('outside'));
  assert.ok(text(finalDenied[0].spans).includes('after.'));

  const allowed = 'Before [document](/docs/quy-che?rev=2) after.';
  accumulated = '';
  for (const character of allowed) {
    accumulated += character;
    md.parseMarkdown(accumulated, { streaming: true });
  }
  const finalAllowed = md.parseMarkdown(accumulated);
  assert.ok(finalAllowed[0].spans.some((span) => span.type === 'link' && span.url === '/docs?slug=quy-che&rev=2'));
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
