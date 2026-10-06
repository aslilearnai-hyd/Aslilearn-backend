import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { dedupeIntraRecordQuestions } from '../ai/generators/shared/ai-generator-uniqueness-engine.js';

describe('exam question paper cleanup', () => {
  it('keeps canonical section questions, removes instructions, and synchronizes counts', () => {
    const actualQuestion = { question: 'What is the value of 3 × 5?', marks: 1 };
    const result = dedupeIntraRecordQuestions('exam-question-paper-generator', {
      questions: [actualQuestion],
      sections: [
        {
          sectionName: 'Section A',
          questions: [
            { question: 'Read every question carefully before answering.' },
            actualQuestion,
            { question: 'What is the value of 3 × 5?', marks: 1 },
          ],
        },
      ],
      totalQuestions: 20,
    });

    assert.deepEqual(result.sections[0].questions, [actualQuestion]);
    assert.deepEqual(result.questions, [actualQuestion]);
    assert.equal(result.sections[0].count, 1);
    assert.equal(result.totalQuestions, 1);
    assert.equal(result.total_questions, 1);
    assert.equal(result.questionCount, 1);
  });
});
