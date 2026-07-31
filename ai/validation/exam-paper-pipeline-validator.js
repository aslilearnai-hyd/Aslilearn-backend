/**
 * Exam / mock test pipeline validation.
 * Hard failures block save; warnings do not (generation retry may still use them).
 * @module services/exam-paper-pipeline-validator
 */

import { validateSubjectContent, hasScaffoldRows } from '../../services/subject-content-validator.js';
import { detectBannedPhrase } from '../prompt-engine/shared/banned-phrases.js';

function collectQuestionStems(structured) {
  const stems = [];
  const pools = [];
  for (const key of ['section_a', 'section_b', 'section_c', 'section_d', 'section_e']) {
    if (Array.isArray(structured?.[key])) pools.push(...structured[key]);
  }
  if (Array.isArray(structured?.sections)) {
    for (const sec of structured.sections) {
      if (Array.isArray(sec?.questions)) pools.push(...sec.questions);
    }
  }
  for (const q of pools) {
    const stem = String(q?.question || q?.text || '').trim();
    if (stem.length > 10) stems.push(stem);
  }
  return stems;
}

function normalizeStem(stem) {
  return String(stem || '')
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findDuplicateStems(stems) {
  const seen = new Map();
  const dupes = [];
  for (const stem of stems) {
    const key = normalizeStem(stem);
    if (!key || key.length < 12) continue;
    if (seen.has(key)) dupes.push(stem);
    else seen.set(key, true);
  }
  return dupes;
}

function answerKeyDuplicatesAnswerKey(structured) {
  const key = String(structured?.answer_key || '').trim();
  if (!key) return false;
  const lines = key.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 4) return false;
  const normalized = lines.map((l) => l.replace(/\s+/g, ' ').trim().toLowerCase());
  const unique = new Set(normalized);
  return unique.size < Math.ceil(lines.length * 0.6);
}

/**
 * @param {object} params
 * @param {{ blockSave?: boolean }} [opts]
 * @returns {{ valid: boolean, errors: string[], warnings: string[], score: number }}
 */
export function validateExamPaperPipeline(params = {}, opts = {}) {
  const blockSave = opts.blockSave !== false;
  const { subject = '', subtopic = '', structured } = params;
  const data =
    structured && typeof structured === 'object' && !Array.isArray(structured)
      ? structured
      : {};

  const subjectCheck = validateSubjectContent(subject, subtopic, data, { blockSave: false });
  const hardErrors = [...(subjectCheck.hardErrors || [])];
  const warnings = [...(subjectCheck.warnings || [])];

  const stems = collectQuestionStems(data);
  const dupes = findDuplicateStems(stems);
  if (dupes.length >= 2) {
    warnings.push(`Duplicate question stems detected (${dupes.length}).`);
  }

  if (answerKeyDuplicatesAnswerKey(data)) {
    hardErrors.push('Answer key repeats the same generic answer for multiple questions.');
  }

  for (const stem of stems.slice(0, 20)) {
    const { banned, reason } = detectBannedPhrase(stem);
    if (banned) {
      warnings.push(`Generic phrasing in question: ${reason}`);
      break;
    }
    if (/\[hands-on lab or demonstration/i.test(stem) && !/litmus|acid|base|hcl|naoh|reaction/i.test(stem)) {
      if (hasScaffoldRows(data)) {
        hardErrors.push('Question stem uses variant-angle filler without subject content.');
      } else {
        warnings.push('Question stem includes variant-angle bracket without chemistry terms.');
      }
      break;
    }
  }

  const score = Math.max(0, subjectCheck.score - hardErrors.length * 8 - warnings.length * 3);
  const valid = blockSave
    ? hardErrors.length === 0
    : hardErrors.length === 0 && warnings.length === 0;

  return {
    valid,
    errors: [...hardErrors, ...warnings],
    warnings,
    hardErrors,
    score,
  };
}
