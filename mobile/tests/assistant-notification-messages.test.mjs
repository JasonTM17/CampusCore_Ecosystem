import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-i18n-messages-'));

async function loadMessageModule(name) {
  const source = fs.readFileSync(path.join(mobileRoot, `src/i18n/${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  });
  const output = path.join(tempRoot, `${name}.mjs`);
  fs.writeFileSync(output, outputText);
  return import(pathToFileURL(output).href);
}

const { assistantMessages } = await loadMessageModule('assistant-messages');
const { notificationsMessages } = await loadMessageModule('notifications-messages');

function placeholderNames(value) {
  return [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
}

test('assistant English and Vietnamese message keys match the frozen R20 list', () => {
  const expected = [
    'streamingStatus', 'completedStatus', 'stoppedStatus', 'interruptedStatus',
    'retryAction', 'retryingStatus', 'busy', 'rateLimited', 'quotaExceeded',
    'streamInvalid', 'sessionExpired', 'forbidden', 'unavailable', 'cancelFailed',
    'a11yStreaming', 'a11yCompleted', 'a11yStopped', 'a11yInterrupted',
  ].sort();
  assert.deepEqual(Object.keys(assistantMessages.en).sort(), expected);
  assert.deepEqual(Object.keys(assistantMessages.vi).sort(), expected);
  assert.ok(Object.values(assistantMessages.en).every((value) => typeof value === 'string' && value.length > 0));
  assert.ok(Object.values(assistantMessages.vi).every((value) => typeof value === 'string' && value.length > 0));
});

test('assistant placeholders match in both locales and retain the seconds token', () => {
  assert.deepEqual(placeholderNames(assistantMessages.en.rateLimited), ['seconds']);
  assert.deepEqual(placeholderNames(assistantMessages.vi.rateLimited), ['seconds']);
  for (const key of Object.keys(assistantMessages.en)) {
    assert.deepEqual(placeholderNames(assistantMessages.vi[key]), placeholderNames(assistantMessages.en[key]), key);
  }
});

test('notification English and Vietnamese keys match the frozen R20 list', () => {
  const expected = [
    'permissionTitle', 'permissionRationale', 'enableAction', 'permissionDenied',
    'unavailable', 'registrationFailed', 'unregisterFailed', 'deviceUpdateFailed', 'openFailed',
  ].sort();
  assert.deepEqual(Object.keys(notificationsMessages.en).sort(), expected);
  assert.deepEqual(Object.keys(notificationsMessages.vi).sort(), expected);
  assert.ok(Object.values(notificationsMessages.en).every((value) => typeof value === 'string' && value.length > 0));
  assert.ok(Object.values(notificationsMessages.vi).every((value) => typeof value === 'string' && value.length > 0));
});

test('message keys are present in the frozen mobile excellence document', () => {
  const source = fs.readFileSync(path.join(mobileRoot, '../docs/ecosystem/mobile-excellence.md'), 'utf8');
  for (const key of Object.keys(assistantMessages.en)) assert.match(source, new RegExp('assistant `' + key + '`'));
  for (const key of Object.keys(notificationsMessages.en)) assert.match(source, new RegExp('notifications `' + key + '`'));
});
