import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadTs } from './helpers/load-ts.mjs';
import { createWebModuleLoader } from './helpers/load-web-module.mjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loadTree = createWebModuleLoader(mobileRoot, fs.mkdtempSync(path.join(os.tmpdir(), 'campus-failure-title-')));

const stream = await loadTs('src/api/assistant-stream.ts');
const failureTitleModule = await import(pathToFileURL(loadTree(path.join(mobileRoot, 'src/screens/assistant/failure-title.ts'))).href);
const { failureTitle, RATE_LIMIT_FALLBACK_SECONDS } = failureTitleModule;
const { assistantMessages } = await loadTs('src/i18n/assistant-messages.ts');

test('Retry-After seconds are whole, at least one, and unusable values are dropped', () => {
  assert.equal(stream.parseRetryAfterSeconds('45'), 45);
  assert.equal(stream.parseRetryAfterSeconds(' 45 '), 45);
  assert.equal(stream.parseRetryAfterSeconds('45.2'), 46);
  assert.equal(stream.parseRetryAfterSeconds('0'), null);
  assert.equal(stream.parseRetryAfterSeconds('-5'), null);
  assert.equal(stream.parseRetryAfterSeconds(''), null);
  assert.equal(stream.parseRetryAfterSeconds(null), null);
  assert.equal(stream.parseRetryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT'), null);
});

test('the buffered transport keeps the response retry window on its error event', async () => {
  const transport = stream.createBufferedTransport(async () => {
    throw Object.assign(new Error('rate limited'), {
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
      retryable: true,
      retryAfter: '45',
    });
  });
  const events = [];
  for await (const event of transport.stream({ message: 'Hỏi', locale: 'vi', clientRequestId: 'req-1' })) {
    events.push(event);
  }
  assert.deepEqual(events, [{ type: 'error', code: 'RATE_LIMIT_EXCEEDED', retryable: true, retryAfterSeconds: 45 }]);
});

test('the rate-limit title renders the server window and falls back only when it is absent', () => {
  assert.equal(RATE_LIMIT_FALLBACK_SECONDS, 30);
  const withWindow = failureTitle(assistantMessages.vi, { kind: 'rate', retryAfterSeconds: 45 }, 'fallback');
  assert.match(withWindow, /45 giây/);
  assert.doesNotMatch(withWindow, /30/);
  const fallback = failureTitle(assistantMessages.vi, { kind: 'rate' }, 'fallback');
  assert.match(fallback, /30 giây/);
  assert.equal(failureTitle(assistantMessages.en, null, 'Assistant unavailable'), 'Assistant unavailable');
});

test('the rate-limit title uses the singular second for a one-second window', () => {
  assert.equal(
    failureTitle(assistantMessages.en, { kind: 'rate', retryAfterSeconds: 1 }, 'fallback'),
    'Too many requests. Try again in 1 second.',
  );
  assert.equal(
    failureTitle(assistantMessages.vi, { kind: 'rate', retryAfterSeconds: 1 }, 'fallback'),
    'Bạn vừa gửi quá nhiều yêu cầu. Hãy thử lại sau 1 giây.',
  );
});

test('the rate-limit title keeps the plural second beyond one', () => {
  assert.equal(
    failureTitle(assistantMessages.en, { kind: 'rate', retryAfterSeconds: 2 }, 'fallback'),
    'Too many requests. Try again in 2 seconds.',
  );
  assert.equal(
    failureTitle(assistantMessages.en, { kind: 'rate', retryAfterSeconds: 0 }, 'fallback'),
    'Too many requests. Try again in 0 seconds.',
  );
});

test('the assistant rate-limit copy keeps a one/other pair in both locales', () => {
  assert.equal(assistantMessages.en.rateLimitedOne, 'Too many requests. Try again in {seconds} second.');
  assert.equal(assistantMessages.vi.rateLimitedOne, assistantMessages.vi.rateLimited);
});
