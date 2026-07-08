/**
 * Extended content quality checks for Prompt Engine outputs.
 * @module prompts/quality-content-check
 */

import { scanStructuredForBannedPhrases } from './shared/banned-phrases.js';

const MIN_MEANINGFUL_LEN = 24;

/** Fields that must contain teacher-script specificity when present. */
const TEACHER_SCRIPT_FIELDS = new Set([
  'introduction_warmup',
  'teacher_talk_points',
  'teacher_instructions',
  'pre_reading_activity',
  'step_by_step_procedure',
  'teaching_activities',
]);

/** Fields that should reference misconceptions when present. */
const MISCONCEPTION_FIELDS = new Set([
  'common_mistakes',
  'common_mistakes_to_avoid',
  'common_confusions',
  'common_misconceptions',
  'prior_knowledge_diagnostic',
]);

function isThinContent(text) {
  const t = String(text || '').trim();
  if (t.length < MIN_MEANINGFUL_LEN) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 5) return true;
  return false;
}

function walkFieldValues(obj, fn, path = '') {
  if (obj == null) return;
  if (typeof obj === 'string') {
    fn(path, obj);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkFieldValues(item, fn, `${path}[${i}]`));
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const key = path ? `${path}.${k}` : k;
      if (typeof v === 'string') fn(key, v);
      else walkFieldValues(v, fn, key);
    }
  }
}

/**
 * Prompt-engine quality scan — banned phrases + thin teacher-script fields.
 * @param {string} toolSlug
 * @param {unknown} structured
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function runPromptEngineQualityCheck(toolSlug, structured) {
  const errors = [];
  const data =
    structured && typeof structured === 'object' && !Array.isArray(structured)
      ? structured
      : {};

  errors.push(...scanStructuredForBannedPhrases(data));

  walkFieldValues(data, (key, text) => {
    const field = key.split('.').pop() || key;
    if (TEACHER_SCRIPT_FIELDS.has(field) && !isThinContent(text)) {
      const hasSpecificity =
        /\b(teacher|say|ask|display|hold|show|minute|min\.|step \d|students? (say|answer|respond))/i.test(
          text,
        );
      if (!hasSpecificity && text.length > 40) {
        errors.push(
          `${key}: lacks classroom specificity (add Teacher dialogue, timing, or expected answers)`,
        );
      }
    }
    if (MISCONCEPTION_FIELDS.has(field) && !isThinContent(text)) {
      const namesMisconception =
        /\b(misconception|confus|mistaken|wrong(ly)?|students? (often|think|believe)|trap|error)/i.test(
          text,
        );
      if (!namesMisconception && text.length > 30) {
        errors.push(`${key}: name specific misconceptions — not vague "students may struggle"`);
      }
    }
  });

  const unique = [...new Set(errors)];
  return {
    valid: unique.length === 0,
    errors: unique.slice(0, 10),
  };
}
