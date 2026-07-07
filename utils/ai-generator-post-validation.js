/**
 * Post-generation content validators (RAG Fix Brief §6, §9).
 * Code-level checks before save — no extra LLM cost.
 */

import { wordJaccardSimilarity } from './ai-generator-dedup.js';

const HEDGING_RE =
  /\b(might|could|possibly|perhaps|may become|if\s+.+\s+then\s+possibly|it is possible that)\b/i;

const SCI_NOTATION_BROKEN_RE =
  /\d{2,}\^[\d\-+]+\s+\d{2,}\^[\d\-+]/;

const MAX_QUESTION_WORDS = Number(process.env.AI_GENERATOR_MAX_QUESTION_WORDS) || 55;

function walkQuestionRows(structured, out = []) {
  if (!structured || typeof structured !== 'object') return out;
  for (const q of structured.questions || []) {
    if (q && typeof q === 'object') out.push(q);
  }
  for (const sec of structured.sections || []) {
    for (const q of sec?.questions || []) {
      if (q && typeof q === 'object') out.push(q);
    }
  }
  return out;
}

export function validateQuestionFieldQuality(structured) {
  const errors = [];
  for (const q of walkQuestionRows(structured)) {
    const question = String(q.question || q.prompt || q.text || '').trim();
    const answer = String(q.answer || '').trim();
    if (!question) {
      errors.push('Question object missing non-empty question field');
      continue;
    }
    const words = question.split(/\s+/).filter(Boolean).length;
    if (words > MAX_QUESTION_WORDS) {
      errors.push(`Question stem too long (${words} words): "${question.slice(0, 80)}..."`);
    }
    if (answer) {
      const sim = wordJaccardSimilarity(question, answer);
      if (sim >= 0.82) {
        errors.push('Answer field too similar to question (echo)');
      }
    }
    const combined = `${question} ${answer}`;
    if (SCI_NOTATION_BROKEN_RE.test(combined)) {
      errors.push('Arithmetic/scientific notation may be missing operators between terms');
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateHotsHedgingLanguage(structured) {
  const errors = [];
  for (const q of walkQuestionRows(structured)) {
    const bloom = String(q.bloom_level || q.bloomLevel || '').toLowerCase();
    const isHots = bloom.includes('analyze') || bloom.includes('evaluate') || bloom.includes('create') || bloom.includes('hots');
    const answer = String(q.answer || q.explanation || '').trim();
    if (isHots && answer && HEDGING_RE.test(answer)) {
      errors.push(`HOTS answer contains hedging language: "${answer.slice(0, 80)}..."`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateDuplicateTopLevelSections(structured, keys = []) {
  const errors = [];
  if (!structured || typeof structured !== 'object') return { valid: true, errors };
  const watch = keys.length ? keys : ['day_period_topic_breakup', 'study_plan_table', 'timeline'];
  for (const key of watch) {
    const val = structured[key];
    if (typeof val !== 'string' || val.length < 40) continue;
    const half = Math.floor(val.length / 2);
    const a = val.slice(0, half).trim();
    const b = val.slice(half).trim();
    if (a.length > 30 && b.startsWith(a.slice(0, Math.min(40, a.length)))) {
      errors.push(`Possible duplicated content in field "${key}"`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * @param {string} toolSlug
 * @param {Record<string, unknown>} structured
 * @param {{ checkHots?: boolean }} opts
 */
export function runPostGenerationContentValidation(toolSlug, structured, opts = {}) {
  const allErrors = [];
  const qCheck = validateQuestionFieldQuality(structured);
  allErrors.push(...qCheck.errors);

  if (opts.checkHots !== false) {
    const hots = validateHotsHedgingLanguage(structured);
    allErrors.push(...hots.errors);
  }

  if (toolSlug === 'daily-class-plan-maker' || toolSlug === 'lesson-planner' || toolSlug === 'study-schedule-maker') {
    const dup = validateDuplicateTopLevelSections(structured);
    allErrors.push(...dup.errors);
  }

  return { valid: allErrors.length === 0, errors: allErrors };
}
