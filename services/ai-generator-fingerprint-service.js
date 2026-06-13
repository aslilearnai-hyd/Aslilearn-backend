import AiGenerationFingerprint from '../models/AiGenerationFingerprint.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import { contentFingerprint, normalizeContentForDedup } from '../utils/ai-generator-dedup.js';
import { extractContentUnits, extractTitleFromStructured } from './ai-generator-content-extractor.js';
import { boardMongoMatch } from '../utils/board-label.js';

function normalizeScope(scope = {}) {
  return {
    toolSlug: String(scope.toolSlug || '').trim(),
    board: String(scope.board || '').trim(),
    className: String(scope.className || scope.classLabel || '').trim(),
    subject: String(scope.subject || scope.subjectName || '').trim(),
    topic: String(scope.topic || scope.topicName || '').trim(),
    subtopic: String(scope.subtopic || scope.subtopicName || scope.subTopic || '').trim(),
  };
}

function scopeQuery(scope) {
  const s = normalizeScope(scope);
  const q = {
    toolName: s.toolSlug,
    classLabel: s.className,
    subject: s.subject,
    sourceType: { $ne: 'ai_pdf' },
  };
  if (s.board) q.board = boardMongoMatch(s.board);
  if (s.topic) q.topic = s.topic;
  if (s.subtopic) q.subtopic = s.subtopic;
  return q;
}

/**
 * @param {Record<string, unknown>} scope
 * @returns {Promise<number>}
 */
export async function countExistingGenerations(scope) {
  return AiToolGeneration.countDocuments(scopeQuery(scope));
}

/**
 * Build fingerprint rows + metadata block for a saved record.
 * @param {string} toolSlug
 * @param {Record<string, unknown>} structured
 * @param {Record<string, unknown>} scope
 * @param {import('mongoose').Types.ObjectId} generationId
 */
export async function persistGenerationFingerprints(toolSlug, structured, scope, generationId) {
  const s = normalizeScope(scope);
  const units = extractContentUnits(toolSlug, structured);
  const title = extractTitleFromStructured(structured);
  const allUnits = title
    ? [{ contentType: 'title', text: title, path: 'title' }, ...units]
    : units;

  const questionFingerprints = [];
  const objectiveFingerprints = [];
  const activityFingerprints = [];
  let contentFingerprintMain = '';

  const docs = [];
  for (const unit of allUnits) {
    const fp = contentFingerprint(unit.text);
    if (!fp) continue;
    docs.push({
      toolSlug: s.toolSlug,
      board: s.board,
      className: s.className,
      subject: s.subject,
      topic: s.topic,
      subtopic: s.subtopic,
      contentType: unit.contentType,
      fingerprint: fp,
      originalText: String(unit.text).slice(0, 500),
      generationId,
    });
    if (unit.contentType === 'question' || unit.contentType === 'flashcard') {
      questionFingerprints.push(fp);
    } else if (unit.contentType === 'objective') {
      objectiveFingerprints.push(fp);
    } else if (unit.contentType === 'activity') {
      activityFingerprints.push(fp);
    } else if (unit.contentType === 'title') {
      contentFingerprintMain = fp;
    }
  }

  if (!contentFingerprintMain && title) {
    contentFingerprintMain = contentFingerprint(title);
  }

  if (docs.length) {
    await AiGenerationFingerprint.insertMany(docs, { ordered: false }).catch((err) => {
      if (err?.code !== 11000) throw err;
    });
  }

  return {
    contentFingerprint: contentFingerprintMain,
    questionFingerprints,
    objectiveFingerprints,
    activityFingerprints,
  };
}

/**
 * Load historical fingerprints for duplicate checks.
 * @param {Record<string, unknown>} scope
 * @param {{ limit?: number }} [opts]
 */
export async function loadHistoricalFingerprints(scope, opts = {}) {
  const s = normalizeScope(scope);
  const limit = Math.min(Number(opts.limit) || 5000, 20000);
  const rows = await AiGenerationFingerprint.find({
    toolSlug: s.toolSlug,
    className: s.className,
    subject: s.subject,
    ...(s.board ? { board: s.board } : {}),
    ...(s.topic ? { topic: s.topic } : {}),
    ...(s.subtopic ? { subtopic: s.subtopic } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const byType = {
    title: [],
    question: [],
    objective: [],
    activity: [],
    flashcard: [],
    all: [],
  };
  for (const row of rows) {
    byType.all.push(row);
    const t = row.contentType || 'other';
    if (byType[t]) byType[t].push(row);
    else byType.all.push(row);
  }
  return byType;
}

export async function fingerprintExists(fingerprint, contentType, scope) {
  if (!fingerprint) return false;
  const s = normalizeScope(scope);
  const hit = await AiGenerationFingerprint.findOne({
    fingerprint,
    contentType,
    toolSlug: s.toolSlug,
    className: s.className,
    subject: s.subject,
    ...(s.subtopic ? { subtopic: s.subtopic } : {}),
  })
    .select('_id')
    .lean();
  return Boolean(hit);
}

export { normalizeScope, scopeQuery, contentFingerprint, normalizeContentForDedup };
