import {
  wordJaccardSimilarity,
  contentFingerprint,
  normalizeContentForDedup,
} from '../utils/ai-generator-dedup.js';
import { extractContentUnits, extractTitleFromStructured } from './ai-generator-content-extractor.js';

const QUESTION_TOOLS = new Set([
  'worksheet-mcq-generator',
  'homework-creator',
  'mock-test-builder',
  'exam-question-paper-generator',
  'smart-qa-practice-generator',
  'quick-assignment-builder',
]);

const STRUCTURED_QUESTION_ARRAY_KEYS = [
  'questions',
  'practice_questions',
  'concept_based_questions',
  'formative_assessment_questions',
  'section_a',
  'section_a_mcqs',
  'section_b',
  'section_b_fib',
  'section_c',
  'section_c_vsa',
  'section_d',
  'section_d_sa',
  'section_e',
  'section_e_competency',
  'cards',
  'application_hots_cards',
];

function questionTextFromRow(row) {
  if (typeof row === 'string') return row.trim();
  if (!row || typeof row !== 'object') return '';
  return String(row.question || row.prompt || row.text || row.front || '').trim();
}

function filterQuestionRows(rows, seen) {
  if (!Array.isArray(rows)) return rows;
  const kept = [];
  for (const row of rows) {
    const text = questionTextFromRow(row);
    if (!text) {
      kept.push(row);
      continue;
    }
    const fp = contentFingerprint(text);
    if (seen.has(fp)) continue;
    seen.add(fp);
    kept.push(row);
  }
  return kept;
}

export function renumberIntraRecordQuestions(toolSlug, structured) {
  const slug = String(toolSlug || '').trim();
  if (!QUESTION_TOOLS.has(slug) || !structured || typeof structured !== 'object' || Array.isArray(structured)) {
    return structured;
  }
  const out = { ...structured };

  function renumberRows(rows) {
    if (!Array.isArray(rows)) return rows;
    return rows.map((row, idx) => {
      if (!row || typeof row !== 'object') return row;
      const n = idx + 1;
      return { ...row, question_number: n, questionNumber: n, sl_no: n };
    });
  }

  for (const key of STRUCTURED_QUESTION_ARRAY_KEYS) {
    if (Array.isArray(out[key])) {
      out[key] = renumberRows(out[key]);
    }
  }

  if (Array.isArray(out.sections)) {
    out.sections = out.sections.map((sec) => {
      if (!sec || typeof sec !== 'object') return sec;
      const questions = renumberRows(sec.questions);
      return { ...sec, questions, count: questions.length };
    });
    const flat = out.sections.flatMap((sec) => (Array.isArray(sec.questions) ? sec.questions : []));
    if (flat.length) out.questions = flat;
  }

  if (
    slug === 'worksheet-mcq-generator' &&
    Array.isArray(out.sections) &&
    out.sections.some((sec) => Array.isArray(sec?.questions) && sec.questions.length)
  ) {
    const legacyKeys = [
      'section_a_mcqs',
      'section_b_fib',
      'section_c_vsa',
      'section_d_sa',
      'section_e_competency',
    ];
    out.sections.forEach((sec, idx) => {
      const key = legacyKeys[idx];
      if (!key) return;
      out[key] = Array.isArray(sec?.questions) ? [...sec.questions] : [];
    });
    out.questions = out.sections.flatMap((sec) =>
      Array.isArray(sec?.questions) ? sec.questions : [],
    );
  }

  if (Array.isArray(out.concepts)) {
    out.concepts = out.concepts.map((concept) => {
      if (!concept || typeof concept !== 'object') return concept;
      const next = { ...concept };
      for (const key of STRUCTURED_QUESTION_ARRAY_KEYS) {
        if (Array.isArray(next[key])) {
          next[key] = renumberRows(next[key]);
        }
      }
      return next;
    });
  }

  return out;
}

/** Remove duplicate MCQs/questions inside one structured record (keeps first occurrence). */
export function dedupeIntraRecordQuestions(toolSlug, structured) {
  const slug = String(toolSlug || '').trim();
  if (!QUESTION_TOOLS.has(slug) || !structured || typeof structured !== 'object' || Array.isArray(structured)) {
    return structured;
  }
  const out = { ...structured };
  const seen = new Set();

  if (
    slug === 'worksheet-mcq-generator' &&
    Array.isArray(out.sections) &&
    out.sections.some((sec) => Array.isArray(sec?.questions) && sec.questions.length)
  ) {
    out.sections = out.sections.map((sec) => {
      if (!sec || typeof sec !== 'object') return sec;
      const questions = filterQuestionRows(sec.questions, seen);
      return { ...sec, questions, count: questions.length };
    });
    const legacyKeys = [
      'section_a_mcqs',
      'section_b_fib',
      'section_c_vsa',
      'section_d_sa',
      'section_e_competency',
    ];
    out.sections.forEach((sec, idx) => {
      const key = legacyKeys[idx];
      if (!key) return;
      out[key] = Array.isArray(sec?.questions) ? [...sec.questions] : [];
    });
    out.questions = out.sections.flatMap((sec) =>
      Array.isArray(sec?.questions) ? sec.questions : [],
    );
    return out;
  }

  for (const key of STRUCTURED_QUESTION_ARRAY_KEYS) {
    if (Array.isArray(out[key])) {
      out[key] = filterQuestionRows(out[key], seen);
    }
  }

  if (Array.isArray(out.sections)) {
    out.sections = out.sections.map((sec) => {
      if (!sec || typeof sec !== 'object') return sec;
      return {
        ...sec,
        questions: filterQuestionRows(sec.questions, seen),
      };
    });
  }

  if (Array.isArray(out.concepts)) {
    out.concepts = out.concepts.map((concept) => {
      if (!concept || typeof concept !== 'object') return concept;
      const next = { ...concept };
      for (const key of STRUCTURED_QUESTION_ARRAY_KEYS) {
        if (Array.isArray(next[key])) {
          next[key] = filterQuestionRows(next[key], seen);
        }
      }
      return next;
    });
  }

  return out;
}

export function summarizeUniquenessErrors(errors = []) {
  const list = Array.isArray(errors) ? errors : [];
  if (!list.length) return '';
  const intra = list.filter((e) => String(e).includes('Duplicate question within record'));
  if (intra.length === list.length) {
    return `Duplicate questions in record (${intra.length}) — removed duplicates before save`;
  }
  return list.slice(0, 2).join('; ') + (list.length > 2 ? ` (+${list.length - 2} more)` : '');
}

export function getQuestionSimilarityThreshold() {
  const n = Number(process.env.AI_GENERATOR_QUESTION_SIMILARITY_THRESHOLD);
  if (Number.isFinite(n) && n > 0 && n < 1) return n;
  return 0.75;
}

export function getTitleSimilarityThreshold() {
  const n = Number(process.env.AI_GENERATOR_TITLE_SIMILARITY_THRESHOLD);
  if (Number.isFinite(n) && n > 0 && n < 1) return n;
  return 0.82;
}

/**
 * @param {string} candidate
 * @param {string[]} existingTexts
 * @param {number} threshold
 */
export function findSimilarText(candidate, existingTexts = [], threshold = 0.75) {
  const texts = Array.isArray(existingTexts) ? existingTexts : [];
  let bestSim = 0;
  let matchIndex = -1;
  for (let i = 0; i < texts.length; i += 1) {
    const sim = wordJaccardSimilarity(candidate, texts[i]);
    if (sim > bestSim) {
      bestSim = sim;
      matchIndex = i;
    }
    if (sim >= threshold) {
      return { duplicate: true, similarity: sim, matchIndex, matchedText: texts[i] };
    }
  }
  return { duplicate: false, similarity: bestSim, matchIndex, matchedText: texts[matchIndex] || '' };
}

/**
 * @param {string} toolSlug
 * @param {Record<string, unknown>} structured
 * @param {{ batchTexts?: string[], historicalTexts?: string[], historicalTitles?: string[] }} ctx
 */
export function validateRecordUniqueness(toolSlug, structured, ctx = {}) {
  const errors = [];
  const slug = String(toolSlug || '').trim();
  const qThreshold = getQuestionSimilarityThreshold();
  const titleThreshold = getTitleSimilarityThreshold();

  const batchTexts = Array.isArray(ctx.batchTexts) ? ctx.batchTexts : [];
  const historicalTexts = Array.isArray(ctx.historicalTexts) ? ctx.historicalTexts : [];
  const historicalTitles = Array.isArray(ctx.historicalTitles) ? ctx.historicalTitles : [];
  const batchTitles = Array.isArray(ctx.batchTitles) ? ctx.batchTitles : [];

  const title = extractTitleFromStructured(structured);
  if (title) {
    const againstTitles = [...batchTitles, ...historicalTitles];
    const titleDup = findSimilarText(title, againstTitles, titleThreshold);
    if (titleDup.duplicate) {
      errors.push(
        `Title too similar to existing (${Math.round(titleDup.similarity * 100)}%): "${titleDup.matchedText?.slice(0, 60)}"`,
      );
    }
  }

  if (!QUESTION_TOOLS.has(slug)) {
    return { valid: errors.length === 0, errors, duplicates: [] };
  }

  const units = extractContentUnits(slug, structured).filter(
    (u) => u.contentType === 'question' || u.contentType === 'flashcard',
  );
  const seenInRecord = new Set();
  const duplicates = [];

  for (const unit of units) {
    const text = String(unit.text || '').trim();
    if (!text) continue;
    const fp = contentFingerprint(text);
    if (seenInRecord.has(fp)) {
      errors.push(`Duplicate question within record: "${text.slice(0, 60)}..."`);
      duplicates.push({ scope: 'intra-record', text, similarity: 1 });
      continue;
    }
    seenInRecord.add(fp);

    const batchDup = findSimilarText(text, batchTexts, qThreshold);
    if (batchDup.duplicate) {
      errors.push(
        `Question duplicates current batch (${Math.round(batchDup.similarity * 100)}%): "${text.slice(0, 60)}..."`,
      );
      duplicates.push({ scope: 'batch', text, similarity: batchDup.similarity });
      continue;
    }

    const histDup = findSimilarText(text, historicalTexts, qThreshold);
    if (histDup.duplicate) {
      errors.push(
        `Question duplicates historical content (${Math.round(histDup.similarity * 100)}%): "${text.slice(0, 60)}..."`,
      );
      duplicates.push({ scope: 'historical', text, similarity: histDup.similarity });
    }
  }

  return { valid: errors.length === 0, errors, duplicates };
}

export function collectQuestionTextsFromStructured(structured) {
  return extractContentUnits('', structured)
    .filter((u) => u.contentType === 'question' || u.contentType === 'flashcard')
    .map((u) => String(u.text || '').trim())
    .filter(Boolean);
}

export function collectTitleTexts(batchTitles, historicalTitles) {
  return [...batchTitles, ...historicalTitles].map((t) => String(t || '').trim()).filter(Boolean);
}
