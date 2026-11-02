import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTs } from './helpers/load-ts.mjs';

const stream = await loadTs('src/api/assistant-stream.ts');
const { failureTitle, RATE_LIMIT_FALLBACK_SECONDS } = await loadTs('src/screens/assistant/failure-title.ts');
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
