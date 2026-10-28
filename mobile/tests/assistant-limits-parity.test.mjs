import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webLib = path.resolve(mobileRoot, '../frontend/src/lib');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-assistant-limits-'));

function compile(sourcePath, outputName) {
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const target = path.join(tempRoot, outputName);
  fs.writeFileSync(target, outputText);
  return import(pathToFileURL(target).href);
}

const mobile = await compile(path.join(mobileRoot, 'src/api/assistant-limits.ts'), 'assistant-limits.mjs');
const web = await compile(path.join(webLib, 'assistant-stream-helpers.ts'), 'assistant-stream-helpers.mjs');

/** Reads `const NAME = 1_000;` from a web source file; fails loudly when the declaration moved. */
function webConstant(file, name) {
  const source = fs.readFileSync(file, 'utf8');
  const match = new RegExp(`const\\s+${name}\\s*=\\s*([\\d_]+)\\s*;`).exec(source);
  assert.ok(match, `${name} declaration not found in ${path.basename(file)}`);
  return Number(match[1].replaceAll('_', ''));
}

test('stream watchdog limits equal the web client', () => {
  const thesisApi = path.join(webLib, 'thesis-api.ts');
  assert.equal(mobile.ASSISTANT_STREAM_IDLE_TIMEOUT_MS, webConstant(thesisApi, 'IDLE_TIMEOUT_MS'));
  assert.equal(mobile.ASSISTANT_STREAM_TOTAL_TIMEOUT_MS, webConstant(thesisApi, 'STREAM_TIMEOUT_MS'));
});

test('cancel timeout and reconciliation budget equal the web helpers', () => {
  const helpers = path.join(webLib, 'assistant-stream-helpers.ts');
  assert.equal(mobile.ASSISTANT_CANCEL_TIMEOUT_MS, webConstant(helpers, 'CANCEL_REQUEST_TIMEOUT_MS'));
  assert.equal(mobile.ASSISTANT_RECONCILE_TOTAL_BUDGET_MS, webConstant(helpers, 'RECONCILE_TOTAL_BUDGET_MS'));
  assert.equal(mobile.ASSISTANT_RECONCILE_MAX_ATTEMPTS, webConstant(helpers, 'RECONCILE_MAX_ATTEMPTS'));
  assert.equal(mobile.ASSISTANT_RECONCILE_BACKOFF_BASE_MS, webConstant(helpers, 'RECONCILE_BACKOFF_BASE_MS'));
  assert.equal(mobile.ASSISTANT_CANCEL_TIMEOUT_MS, 8_000);
});

test('message length limit equals the web composer limit', () => {
  const composer = path.resolve(webLib, '../components/assistant/AssistantComposer.tsx');
  const match = /maxLength=\{(\d+)\}/.exec(fs.readFileSync(composer, 'utf8'));
  assert.ok(match, 'composer maxLength not found');
  assert.equal(mobile.ASSISTANT_MAX_MESSAGE_CHARS, Number(match[1]));
});

test('the mobile budget helpers reproduce the web attempt and backoff ladder', () => {
  const webBudget = web.startReconciliationBudget(1_000);
  const mobileBudget = mobile.startReconcileBudget(1_000);
  assert.deepEqual(mobileBudget, webBudget);
  const ladder = (budget, canAttempt, backoff) => {
    const steps = [];
    let now = 1_000;
    while (canAttempt(budget, now)) {
      budget.attemptsStarted += 1;
      steps.push(backoff(budget, now));
      now += 100;
    }
    return steps;
  };
  const expected = ladder(webBudget, web.canAttemptReconciliation, web.nextReconciliationBackoffMs);
  assert.deepEqual(
    ladder(mobileBudget, mobile.canAttemptReconcile, mobile.nextReconcileBackoffMs),
    expected,
  );
  assert.deepEqual(expected, [250, 500, 750, null]);
  const late = { deadline: 1_000 + 30_000, attemptsStarted: 1 };
  assert.equal(mobile.canAttemptReconcile(late, 31_000), web.canAttemptReconciliation(late, 31_000));
  assert.equal(mobile.nextReconcileBackoffMs(late, 30_800), web.nextReconciliationBackoffMs(late, 30_800));
  assert.equal(mobile.remainingReconcileMs(late, 40_000), web.remainingReconcileMs(late, 40_000));
});
