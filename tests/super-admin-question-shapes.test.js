import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeExamQuestionOptions,
  questionTypeRequiresOptions,
} from '../controllers/superAdminExamController.js';

test('assertion-reason imports receive the canonical four options', () => {
  const options = normalizeExamQuestionOptions('assertion_reason', []);
  assert.equal(options.length, 4);
  assert.match(options[0].text, /Both A and R are true/);
  assert.equal(questionTypeRequiresOptions('assertion_reason', {}), true);
});

test('structured match-the-following questions do not require MCQ options', () => {
  const matter = {
    matchColumnI: [{ key: 'A', text: 'Force' }, { key: 'B', text: 'Work' }],
    matchColumnII: [{ key: '1', text: 'Newton' }, { key: '2', text: 'Joule' }],
  };
  assert.equal(questionTypeRequiresOptions('match_following', matter), false);
  assert.equal(questionTypeRequiresOptions('match_following', { ...matter, matchColumnII: [] }), true);
});
