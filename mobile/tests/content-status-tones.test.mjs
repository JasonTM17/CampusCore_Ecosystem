import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const rules = await loadTs('src/screens/content/content-rules.ts');

test('career opportunity statuses follow the board role map', () => {
  assert.equal(rules.careerOpportunityTone('DRAFT'), 'neutral');
  assert.equal(rules.careerOpportunityTone('IN_REVIEW'), 'warning');
  assert.equal(rules.careerOpportunityTone('PUBLISHED'), 'success');
  assert.equal(rules.careerOpportunityTone('PAUSED'), 'warning');
  assert.equal(rules.careerOpportunityTone('CLOSED'), 'neutral');
  assert.equal(rules.careerOpportunityTone('REJECTED'), 'error');
  assert.equal(rules.careerOpportunityTone('UNKNOWN'), 'neutral');
  assert.equal(rules.careerOpportunityTone(null), 'neutral');
});

test('career application statuses follow the board role map', () => {
  assert.equal(rules.careerApplicationTone('SUBMITTED'), 'warning');
  assert.equal(rules.careerApplicationTone('OFFER'), 'success');
  assert.equal(rules.careerApplicationTone('REJECTED'), 'error');
  assert.equal(rules.careerApplicationTone('WITHDRAWN'), 'neutral');
});

test('library loan statuses follow the catalogue role map', () => {
  assert.equal(rules.libraryLoanTone('REQUESTED'), 'warning');
  assert.equal(rules.libraryLoanTone('RETURNED'), 'success');
  assert.equal(rules.libraryLoanTone('CANCELLED'), 'neutral');
  assert.equal(rules.libraryLoanTone('UNKNOWN'), 'neutral');
});

test('library copy statuses follow the catalogue role map', () => {
  assert.equal(rules.libraryCopyTone('AVAILABLE'), 'success');
  assert.equal(rules.libraryCopyTone('RESERVED'), 'warning');
  assert.equal(rules.libraryCopyTone('RETIRED'), 'neutral');
});
