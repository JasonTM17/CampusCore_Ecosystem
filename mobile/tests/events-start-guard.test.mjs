import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const rules = await loadTs('src/screens/content/content-rules.ts');

test('a started event no longer offers cancellation', () => {
  const startedAt = Date.parse('2026-11-10T09:00:00Z');
  const at = Date.parse('2026-11-10T09:10:00Z');
  const registered = {
    status: 'REGISTRATION_CLOSED',
    seatsRemaining: 0,
    myRegistrationStatus: 'REGISTERED',
    myRegistrationId: 'registration-1',
    startsAt: '2026-11-10T09:00:00Z',
  };

  assert.equal(rules.eventAction(registered, at), 'none');
  assert.equal(
    rules.eventAction({ ...registered, startsAt: '2026-11-10T10:00:00Z' }, at),
    'cancel',
    'an event that has not started still offers cancel',
  );
  assert.equal(rules.eventAction({ ...registered, startsAt: null }, at), 'cancel');
  assert.equal(
    rules.eventAction({ ...registered, status: 'COMPLETED' }, at + 48 * 60 * 60 * 1000),
    'none',
  );
  assert.equal(
    rules.eventAction({ ...registered, startsAt: 'not-a-date' }, startedAt),
    'cancel',
    'an unparseable start keeps the server as the only authority',
  );
});
