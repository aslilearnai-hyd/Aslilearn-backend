import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSchoolNameQuery,
  isNamedSchoolMetricQuery,
  schoolNameSearchTerms,
} from '../services/vidya-ai-control/school-overview-facts.js';

test('extracts school names from teacher-count questions', () => {
  assert.equal(
    extractSchoolNameQuery('how many teachers are there in brainfeed school').toLowerCase(),
    'brainfeed',
  );
  assert.equal(isNamedSchoolMetricQuery('how many teachers are there in brainfeed school'), true);
});

test('school search terms match Brainfeed High School from brainfeed school', () => {
  const terms = schoolNameSearchTerms('brainfeed school');
  assert.ok(terms.includes('brainfeed'));
  const regexes = terms.map((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.equal(regexes.some((regex) => regex.test('Brainfeed High School')), true);
  assert.equal(regexes.some((regex) => regex.test('Brainfeed High School')), true);
});

test('generic school counts are not treated as a named-school metric', () => {
  assert.equal(isNamedSchoolMetricQuery('how many teachers are there'), false);
  assert.equal(isNamedSchoolMetricQuery('how many schools are there'), false);
});
