import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateAiToolSubjectForTool } from '../ai/shared/ai-tool-subject-rules.js';

describe('AI tool language subject availability', () => {
  it('allows Concept Mastery for managed Hindi and Telugu curricula', () => {
    assert.equal(validateAiToolSubjectForTool('concept-mastery-helper', 'Hindi'), null);
    assert.equal(validateAiToolSubjectForTool('concept-mastery-helper', 'Telugu'), null);
  });
});
