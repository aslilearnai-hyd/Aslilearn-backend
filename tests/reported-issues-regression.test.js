import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyExtractionValidation,
  splitInlineCaseStudyStem,
  stripInlineMatchColumnsFromStem,
} from '../services/exam-pdf-enrichment.js';
import {
  resolveAiToolRecordPdfBody,
  stripInternalAiToolPdfMetadata,
} from '../utils/ai-tool-pdf-body.js';
import { normalizePlannerFilters } from '../services/vidya-ai-control/db-access-layer.js';
import {
  getTrialUsageSnapshot,
  isUnpaidTrialMember,
  TRIAL_GENERATION_DAILY_LIMIT,
  TRIAL_VIDYA_CHAT_LIMIT,
} from '../utils/trialUsageLimits.js';

describe('12:59 reported issue regressions', () => {
  it('separates an inlined case passage from its question', () => {
    const stem = 'Case Study: A group of students sets up one closed laboratory demonstration on solutions. They dissolve salt in water and observe evaporation in a sealed flask. The teacher asks them to interpret the observations using particle behaviour and conservation of mass. In sample S, which identification is correct?';
    const split = splitInlineCaseStudyStem(stem);
    assert.ok(split);
    assert.match(split.passage, /^Case Study:/);
    assert.equal(split.question, 'In sample S, which identification is correct?');

    const [row] = applyExtractionValidation([{ questionText: stem, questionType: 'mcq', option1: 'A', option2: 'B', option3: 'C', option4: 'D', correctAnswer: 'C' }]);
    assert.equal(row.sharedMatterKind, 'case');
    assert.equal(row.questionText, 'In sample S, which identification is correct?');
  });

  it('removes duplicated inline match columns when structured columns exist', () => {
    const prompt = 'Match the situation/formula in Column I with the correct concept it represents in Column II.';
    const stem = `${prompt} Column I A. $N=m(g+a)$ B. $a=1$ Column II 1. Linear momentum 2. Acceleration`;
    assert.equal(stripInlineMatchColumnsFromStem(stem, [{ text: 'N' }, { text: 'a' }], [{ text: 'Momentum' }, { text: 'Acceleration' }]), prompt);
  });

  it('removes internal chunk and validation metadata from exported PDFs', () => {
    const raw = `Question: Find the value.\nAnswer: 2\nSlot Id: Q3\nExam Profile: BOARD\nDifficulty: medium\nConcept Ids:\n• What is Mathematics?\nSource Chunk Ids:\n• 6aa38d870561215657ff204f\n• 6aa38d870561215657ff2083\nValidation Flags:\nSection B — Fill In The Blanks:\nQuestion: The answer is ___.`;
    const clean = stripInternalAiToolPdfMetadata(raw);
    assert.doesNotMatch(clean, /Source Chunk|6aa38|Validation Flags|Exam Profile|Difficulty|Concept Id/i);
    assert.match(clean, /Question: Find the value/);
    assert.match(clean, /Section B/);
    assert.match(clean, /The answer is/);

    const resolved = resolveAiToolRecordPdfBody({ generatedContent: raw });
    assert.equal(resolved, clean);
  });

  it('normalizes safe Mongo-style planner filters without accepting arbitrary operators', () => {
    const [regex, range, unsafe] = normalizePlannerFilters([
      { field: 'fullName', value: { $regex: 'vijayalaxmi', $options: 'i' } },
      { field: 'createdAt', op: 'gte', value: 'days_ago_7' },
      { field: 'role', value: { $where: 'dangerous' } },
    ]);
    assert.deepEqual(regex, { field: 'fullName', op: 'regex', value: 'vijayalaxmi' });
    assert.deepEqual(range, { field: 'createdAt', op: 'gte', value: 'days_ago_7' });
    assert.deepEqual(unsafe, { field: 'role', value: { $where: 'dangerous' } });
  });

  it('keeps free-plan usage limits active only for unpaid individual accounts', () => {
    const trial = {
      isIndividualAccount: true,
      subscriptionStatus: 'trial',
      trialVidyaChatUsed: 1,
      trialGenerationCount: 2,
      trialGenerationWindowStartedAt: new Date(),
    };
    assert.equal(isUnpaidTrialMember(trial), true);
    const usage = getTrialUsageSnapshot(trial);
    assert.equal(usage.vidyaChat.limit, TRIAL_VIDYA_CHAT_LIMIT);
    assert.equal(usage.vidyaChat.remaining, 2);
    assert.equal(usage.generations.limit, TRIAL_GENERATION_DAILY_LIMIT);
    assert.equal(usage.generations.remaining, 1);
    assert.equal(getTrialUsageSnapshot({ ...trial, subscriptionStatus: 'active' }).applies, false);
    assert.equal(getTrialUsageSnapshot({ ...trial, isIndividualAccount: false }).applies, false);
  });
});
