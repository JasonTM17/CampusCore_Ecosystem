'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('MailDispatchResponse client type allows dispatchedAt to be string or null', () => {
  const apiSource = read('src/lib/api.ts');
  const typeMatch = apiSource.match(/export type MailDispatchResponse = \{([\s\S]*?)\};/);
  assert.ok(typeMatch, 'MailDispatchResponse type definition exists in api.ts');
  const typeBody = typeMatch[1];

  assert.match(
    typeBody,
    /dispatchedAt:\s*string\s*\|\s*null;/,
    'MailDispatchResponse.dispatchedAt must be typed as "string | null"',
  );
});

test('lecturer mail page checks response.success and does not show success card on failure', () => {
  const pageSource = read('src/app/dashboard/lecturer/mail/page.tsx');

  // Verify that page.tsx inspects response.success
  assert.match(
    pageSource,
    /if\s*\(\s*!response\.success\s*\)|if\s*\(\s*response\.success\s*===\s*false\s*\)/,
    'page must explicitly check response.success before treating dispatch as successful',
  );

  // Verify that server message is surfaced on failure
  assert.match(
    pageSource,
    /response\.message/,
    'page must capture or surface response.message when delivery fails',
  );

  // Verify that an alert element or error state displays the server error message
  assert.match(
    pageSource,
    /serverError|serverErrorMessage/,
    'page must track server error message in state for failed dispatch',
  );
});

test('lecturer mail page guards dispatchedAt before date formatting', () => {
  const pageSource = read('src/app/dashboard/lecturer/mail/page.tsx');

  // The success card must not pass null or unguarded dispatchedAt to formatDateTime
  assert.match(
    pageSource,
    /sent\.dispatchedAt\s*\?\s*formatDateTime\(sent\.dispatchedAt\)\s*:\s*['"]—['"]|sent\.dispatchedAt\s*&&\s*formatDateTime\(sent\.dispatchedAt\)/,
    'page must guard sent.dispatchedAt so null does not format as 1970 timestamp',
  );
});

test('simulation of mail dispatch flow honors response.success', () => {
  // Logic fixture mimicking handleSend dispatch handling
  function simulateDispatchResult(response) {
    let sent = null;
    let sentCount = 0;
    let serverError = null;
    let formCleared = false;

    if (!response.success) {
      serverError = response.message || 'Delivery failed';
      return { sent, sentCount, serverError, formCleared };
    }

    sent = {
      recipient: response.recipient,
      template: response.template,
      dispatchedAt: response.dispatchedAt,
    };
    sentCount += 1;
    formCleared = true;

    return { sent, sentCount, serverError, formCleared };
  }

  // 1. Success case
  const successResult = simulateDispatchResult({
    success: true,
    message: 'Notice delivered successfully',
    recipient: 'student@campuscore.edu',
    template: 'notice',
    dispatchedAt: '2026-10-30T09:00:00Z',
  });
  assert.ok(successResult.sent, 'success result populates sent record');
  assert.equal(successResult.sentCount, 1, 'success result increments sent count');
  assert.equal(successResult.serverError, null, 'success result has no server error');
  assert.equal(successResult.formCleared, true, 'success result clears form');

  // 2. Failure case (e.g. MAIL_ENABLED=false)
  const failureResult = simulateDispatchResult({
    success: false,
    message: 'SMTP delivery disabled on this campus deployment',
    recipient: 'student@campuscore.edu',
    template: 'notice',
    dispatchedAt: null,
  });
  assert.equal(failureResult.sent, null, 'failure result must not set sent record');
  assert.equal(failureResult.sentCount, 0, 'failure result must not increment sent count');
  assert.equal(
    failureResult.serverError,
    'SMTP delivery disabled on this campus deployment',
    'failure result must preserve server error message',
  );
  assert.equal(failureResult.formCleared, false, 'failure result must not clear form');
});
