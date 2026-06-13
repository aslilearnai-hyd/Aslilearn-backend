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
