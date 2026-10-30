#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scannerScript = path.join(repoRoot, 'scripts', 'check-text-encoding.mjs');

const mojibake = {
  tildeA: String.fromCodePoint(0x00c3, 0x00a0),
  dStroke: String.fromCodePoint(0x00c4, 0x0090),
  uHorn: String.fromCodePoint(0x00c6, 0x00b0),
  threeByte: String.fromCodePoint(0x00e1, 0x00bb, 0x008d),
  threeByteAlt: String.fromCodePoint(0x00e1, 0x00ba, 0x00a3),
  vietnameseLead: String.fromCodePoint(0x00e1, 0x00bb),
  smartQuoteOpen: String.fromCodePoint(0x00e2, 0x20ac, 0x009c),
  smartQuoteClose: String.fromCodePoint(0x00e2, 0x20ac, 0x009d),
  replacement: String.fromCodePoint(0xfffd),
  corruptedMark: String.fromCodePoint(0x003f),
};

function makeTree(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'text-encoding-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${content}\n`, 'utf8');
}

function runScanner(cwd) {
  const result = spawnSync(process.execPath, [scannerScript, cwd], {
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test('valid Vietnamese uppercase vowels and punctuation pass', (t) => {
  const dir = makeTree(t);
  write(
    dir,
    'frontend/src/i18n/messages.ts',
    [
      "    officialHeader: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',",
      "    statusLine: 'ĐÃ XÁC THỰC ĐIỆN TỬ',",
      "    centerName: 'TRUNG TÂM THÔNG BÁO CHÍNH THỨC',",
      "    bankLine: 'NGÂN HÀNG NHÀ NƯỚC',",
      "    gradeNote: 'KẾT QUẢ CÁ NHÂN ĐÃ CẬP NHẬT',",
      "    europeanLine: 'chứng chỉ châu Âu',",
      "    motto: 'TẤT CẢ VÌ SINH VIÊN',",
      "    aVowels: 'À Á Ả Ã Ạ Ă Ằ Ắ Ẳ Ẵ Ặ Â Ầ Ấ Ẩ Ẫ Ậ',",
      "    eVowels: 'È É Ẻ Ẽ Ẹ Ê Ề Ế Ể Ễ Ệ',",
      "    iVowels: 'Ì Í Ỉ Ĩ Ị',",
      "    oVowels: 'Ò Ó Ỏ Õ Ọ Ô Ồ Ố Ổ Ỗ Ộ Ơ Ờ Ớ Ở Ỡ Ợ',",
      "    uVowels: 'Ù Ú Ủ Ũ Ụ Ư Ừ Ứ Ử Ữ Ự',",
      "    yVowels: 'Ỳ Ý Ỷ Ỹ Ỵ Đ',",
      '    quotedDone: "\u201cĐÃ\u201d đã xong",',
      "    foreignNames: 'JÄRVI HÄLLÖ À-la-carte',",
    ].join('\n'),
  );
  const { status, output } = runScanner(dir);
  assert.equal(status, 0, output);
  assert.match(output, /passed/);
});

test('legitimate question marks in localized lines pass', (t) => {
  const dir = makeTree(t);
  write(
    dir,
    'frontend/src/i18n/messages.ts',
    [
      "        { href: '/login?portal=student', label: 'Cổng Sinh viên' },",
      "        { href: '/dashboard/thesis?tab=repository', label: 'Thesis Repository' },",
      "        { href: '/en/dashboard/register?tab=registered&semester=2024', label: 'Register' },",
      "        { href: '/register?keep=academic#ctx', label: 'Giữ chỗ' },",
    ].join('\n'),
  );
  write(
    dir,
    'scripts/dependency-baseline.mjs',
    "  const workflows = walkFiles(root, '.github/workflows', (name) => /\\.ya?ml$/i.test(name));",
  );
  const { status, output } = runScanner(dir);
  assert.equal(status, 0, output);
});

test('standalone vowels pass while rendered UTF-8 byte sequences fail', (t) => {
  const dir = makeTree(t);
  write(dir, 'valid.txt', 'labels: ĐÃ Â Ả');
  write(
    dir,
    'corrupt.txt',
    `labels: ${mojibake.tildeA} ${mojibake.dStroke} ${mojibake.uHorn}`,
  );
  const { status, output } = runScanner(dir);
  assert.equal(status, 1, output);
  assert.match(output, /corrupt\.txt/);
  assert.ok(
    !output.includes('valid.txt'),
    'standalone Vietnamese vowels must not be flagged',
  );
});

test('genuine multi-codepoint mojibake sequences are flagged by path', (t) => {
  const dir = makeTree(t);
  const fixtures = [
    ['corrupt/tilde-a.txt', `greeting: ch${mojibake.tildeA}o`],
    ['corrupt/d-stroke.txt', `name: ${mojibake.dStroke}ông`],
    ['corrupt/three-byte.txt', `term: h${mojibake.threeByte}c k${mojibake.threeByteAlt}`],
    ['corrupt/smart.txt', `quote: ${mojibake.smartQuoteOpen}hi${mojibake.smartQuoteClose}`],
    ['corrupt/replacement.txt', `broken: d${mojibake.replacement}a`],
    ['corrupt/vietnamese.txt', `word: h${mojibake.vietnameseLead}c`],
  ];
  for (const [fixturePath, content] of fixtures) {
    write(dir, fixturePath, content);
  }
  const { status, output } = runScanner(dir);
  assert.equal(status, 1, output);
  for (const [fixturePath] of fixtures) {
    const fileName = fixturePath.split('/').pop();
    assert.match(
      output,
      new RegExp(fileName.replace('.', '\\.')),
      `${fixturePath} should be reported`,
    );
  }
});

test('corrupted question mark inside a localized word fails', (t) => {
  const dir = makeTree(t);
  write(
    dir,
    'messages.ts',
    `label: 'Sinh vi${mojibake.corruptedMark}n đăng ký'`,
  );
  const { status, output } = runScanner(dir);
  assert.equal(status, 1, output);
  assert.match(output, /suspicious question mark/);
});

test('generated, runtime, skill and vendored trees are not scanned', (t) => {
  const dir = makeTree(t);
  const excluded = [
    'node_modules/pkg/index.js',
    'dist/app.js',
    'build/out.js',
    'target/classes/x.sql',
    'artifacts/baseline/a.txt',
    'plans/reports/x.md',
    'reports/daily/x.md',
    '.agents/skills/ak-x/SKILL.md',
    '.claude/skills/ak-x/SKILL.md',
    '.codex/skills/ak-x/SKILL.md',
    '.devin/skills/ak-x/SKILL.md',
    '.agentkit/state/x.md',
    'frontend/public/tinymce/plugin.min.js',
    'scratch/tmp.txt',
    'generated/api/client.ts',
    'coverage/lcov-report/index.html',
    'backups/db/backup.sql',
    'ops/secrets/note.txt',
    'logs/run.txt',
    'tmp/x.txt',
  ];
  for (const fixturePath of excluded) {
    write(dir, fixturePath, `corrupt: ${mojibake.tildeA} ${mojibake.replacement}`);
  }
  write(dir, 'src/app.ts', 'export const ok = true;');
  const { status, output } = runScanner(dir);
  assert.equal(status, 0, output);
});

test('scanner never reads secret-named files', (t) => {
  const dir = makeTree(t);
  const secretFiles = [
    '.env',
    '.env.local',
    '.env.production',
    'prod.env',
    'credentials.json',
    'service_account.json',
    'service-account.json',
    'auth.json',
    'oauth.json',
    'client_secret_1.json',
    'secrets.json',
  ];
  for (const name of secretFiles) {
    write(dir, name, `PAYLOAD=${mojibake.tildeA} ${mojibake.replacement}`);
  }
  write(dir, 'src/app.ts', 'export const ok = true;');
  const { status, output } = runScanner(dir);
  assert.equal(status, 0, output);
});

test('public environment templates remain guarded', (t) => {
  const dir = makeTree(t);
  write(dir, '.env.example', `EXAMPLE=ch${mojibake.tildeA}o`);
  const { status, output } = runScanner(dir);
  assert.equal(status, 1, output);
  assert.match(output, /\.env\.example/);
});

test('sentinel marker exemption applies only to the named assertion file', (t) => {
  const dir = makeTree(t);
  write(
    dir,
    'mobile/tests/assistant-xhr-transport.test.mjs',
    `assert.equal(events.every((e) => !JSON.stringify(e).includes('${mojibake.replacement}')), true);`,
  );
  const clean = runScanner(dir);
  assert.equal(clean.status, 0, clean.output);
  write(
    dir,
    'mobile/tests/other.test.mjs',
    `const corrupted = 'd${mojibake.replacement}a';`,
  );
  const flagged = runScanner(dir);
  assert.equal(flagged.status, 1, flagged.output);
  assert.match(flagged.output, /other\.test\.mjs/);
});
