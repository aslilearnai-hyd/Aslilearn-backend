import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEACHING_FORMAT_RULES, tidyVidyaReply } from '../services/vidya-student/gemini-general-knowledge-service.js';

test('teaching rules demand a full lesson instead of a generic greeting', () => {
  assert.match(TEACHING_FORMAT_RULES, /Never write "Hello! Let's learn this simply"/);
  assert.match(TEACHING_FORMAT_RULES, /Worked example/);
  assert.match(TEACHING_FORMAT_RULES, /solve the next exercise/);
  assert.match(TEACHING_FORMAT_RULES, /inverse operations/);
  assert.match(TEACHING_FORMAT_RULES, /Enrichment/);
  assert.doesNotMatch(TEACHING_FORMAT_RULES, /You MUST format every reply exactly like this/);
});

test('tidyVidyaReply strips the old greeting and evens out spacing', () => {
  const raw = "Hello! Let's learn this simply.\n\n\n1. **Expressions**\n- Add left to right\n";
  const out = tidyVidyaReply(raw);
  assert.doesNotMatch(out, /let's learn this simply/i);
  assert.match(out, /^1\. \*\*Expressions\*\*/);
  assert.match(out, /• Add left to right/);
  assert.doesNotMatch(out, /\n{3,}/);
});
