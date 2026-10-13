import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocateSmartQaSectionCounts,
  assembleSixSectionPrompt,
} from '../ai/prompt-versioning/assemble.js';
import { buildToolPack } from '../ai/prompt-versioning/tool-packs.js';
import { getBookGeneratorMaxInr } from '../ai/generators/_batch/book-generator-batch-orchestrator.js';
import { mapV2StructuredToLegacy } from '../utils/v2-structured-to-legacy.js';
import {
  finalizePracticeQaStructuredContent,
  practiceQaHasAllRequiredSections,
} from '../ai/generators/core/ai-content-engine-service.js';

test('Smart Q&A prompt allocates the exact requested count across all seven documented sections', () => {
  const counts = allocateSmartQaSectionCounts(10);
  assert.equal(Object.keys(counts).length, 7);
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 10);
  assert.ok(Object.values(counts).every((count) => count >= 1));

  const assembled = assembleSixSectionPrompt('smart-qa-practice-generator', {
    board: 'CBSE',
    classLabel: 'Class 8',
    subject: 'Mathematics',
    topic: 'Cubes and Cube Roots',
    subTopic: 'Cube Roots',
    questionCount: 10,
  });
  assert.match(assembled.prompt, /EXACTLY 10 questions across ALL seven sections A-G/);
  assert.match(assembled.prompt, /sectionF_case=1/);
  assert.match(assembled.prompt, /sectionG_hots=1/);
  assert.doesNotMatch(
    assembled.prompt,
    /EXACTLY 10 questions across sectionA_mcq \+ sectionB_fib.*sectionE_long/,
  );
});

test('Smart Q&A schema is compact and uses the client A-G taxonomy', () => {
  const pack = buildToolPack('smart-qa-practice-generator');
  assert.match(pack.responseSchema, /sectionC_short.*True.*False/s);
  assert.match(pack.responseSchema, /sectionF_case/);
  assert.match(pack.responseSchema, /sectionG_hots/);
  assert.match(pack.responseSchema, /"teacher": \{\}/);
  assert.doesNotMatch(pack.instructions, /Put HOTS\/analytical items in sectionE_long/);
});

test('Smart Q&A V2 mapping preserves the exact section labels and embedded answers', () => {
  const row = (question, answer, extra = {}) => [{ question, answer, marks: 1, ...extra }];
  const legacy = mapV2StructuredToLegacy('smart-qa-practice-generator', {
    schema: 'asli-v2-six-section',
    tool: 'smart-qa-practice-generator',
    core: {
      title: 'Cube Roots Practice',
      instructions: 'Attempt all questions.',
      sectionA_mcq: row('Which is a perfect cube?', 'A) 8', { options: ['A) 8', 'B) 9'] }),
      sectionB_fib: row('The cube root of 27 is ___.', '3'),
      sectionC_short: [
        ...row('True or false: 64 is a perfect cube.', 'True', { options: ['True', 'False'] }),
        ...row('Match each cube with its root.', '8-2, 27-3', {
          type: 'MATCH',
          matchPairs: [
            { left: '8', right: '2' },
            { left: '27', right: '3' },
          ],
        }),
      ],
      sectionD_application: row('Use the labelled cube to state its edge length.', '5 cm', {
        needsDiagram: true,
        imagePrompt: 'A cube labelled with volume 125 cm3.',
      }),
      sectionE_long: row('Explain why 216 is a perfect cube.', '216 = 6 cubed.'),
      sectionF_case: row('A cube has volume 343 cm3. Find its side.', '7 cm'),
      sectionG_hots: row('Determine the least multiplier that makes 54 a cube.', '4'),
    },
    objectives: { items: ['Apply cube roots', 'Reason about perfect cubes'] },
    differentiation: {},
    assessment: { answerKey: [] },
    teacher: {},
    reallife: {},
  });

  assert.deepEqual(
    legacy.sections.map((section) => section.sectionName),
    [
      'Section A: MCQs',
      'Section B: Fill in the Blanks',
      'Section C: True or False',
      'Section D: Very Short Answer Questions',
      'Section E: Short Answer Questions',
      'Section F: Application / Case-based Questions',
      'Section G: HOTS / Analytical Questions',
    ],
  );
  assert.deepEqual(legacy.section_c_true_false, ['True or false: 64 is a perfect cube.']);
  assert.equal(legacy.sections[2].questions[1].matchPairs.length, 2);
  assert.equal(legacy.sections[3].questions[0].needsDiagram, true);
  assert.match(legacy.sections[3].questions[0].imagePrompt, /cube labelled/i);
  assert.match(legacy.answer_key_with_explanations, /7 cm/);

  const finalized = finalizePracticeQaStructuredContent(legacy, {
    subject: 'Mathematics',
    topic: 'Cube Roots',
    questionCount: 8,
  });
  const sectionC = finalized.sections.find((section) => section.sectionName.startsWith('Section C'));
  const sectionD = finalized.sections.find((section) => section.sectionName.startsWith('Section D'));
  assert.equal(sectionC.questions.find((question) => question.type === 'MATCH').matchPairs.length, 2);
  assert.equal(sectionD.questions[0].needsDiagram, true);
  assert.match(sectionD.questions[0].imagePrompt, /cube labelled/i);
  assert.equal(practiceQaHasAllRequiredSections(finalized), true);
});

test('Smart Q&A repair keeps the count stable and restores a required Section C TF item', () => {
  const sectionNames = [
    'Section A: MCQs',
    'Section B: Fill in the Blanks',
    'Section C: True or False',
    'Section D: Very Short Answer Questions',
    'Section E: Short Answer Questions',
    'Section F: Application / Case-based Questions',
    'Section G: HOTS / Analytical Questions',
  ];
  const input = {
    title: 'Cube Roots Practice',
    sections: sectionNames.map((sectionName, index) => ({
      sectionName,
      questions: [{
        question: index === 2 ? 'Match each cube with its cube root.' : `Topic-grounded question ${index + 1}?`,
        answer: `Answer ${index + 1}`,
        type: index === 2 ? 'MATCH' : '',
        ...(index === 2 ? { matchPairs: [{ left: '8', right: '2' }, { left: '27', right: '3' }] } : {}),
      }],
    })),
  };
  assert.equal(practiceQaHasAllRequiredSections(input), false);
  const repaired = finalizePracticeQaStructuredContent(input, {
    subject: 'Mathematics',
    topic: 'Cube Roots',
    questionCount: 7,
  });
  assert.equal(repaired.sections.flatMap((section) => section.questions).length, 7);
  assert.equal(practiceQaHasAllRequiredSections(repaired), true);
});

test('book generator has a safe dynamic budget unless explicitly overridden', () => {
  const previous = process.env.BOOK_GENERATOR_MAX_INR;
  try {
    delete process.env.BOOK_GENERATOR_MAX_INR;
    assert.equal(getBookGeneratorMaxInr(4), 1);
    assert.equal(getBookGeneratorMaxInr(1), 1);
    process.env.BOOK_GENERATOR_MAX_INR = '';
    assert.equal(getBookGeneratorMaxInr(4), 1);
    process.env.BOOK_GENERATOR_MAX_INR = '3.5';
    assert.equal(getBookGeneratorMaxInr(20), 3.5);
    process.env.BOOK_GENERATOR_MAX_INR = '0';
    assert.equal(getBookGeneratorMaxInr(4), 1);
    process.env.BOOK_GENERATOR_MAX_INR = 'off';
    assert.equal(getBookGeneratorMaxInr(40), 1);
  } finally {
    if (previous === undefined) delete process.env.BOOK_GENERATOR_MAX_INR;
    else process.env.BOOK_GENERATOR_MAX_INR = previous;
  }
});
