import AiToolGeneration from '../models/AiToolGeneration.js';
import AiToolRotationCursor from '../models/AiToolRotationCursor.js';

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validContentFilter() {
  return {
    $or: [
      { generatedContent: { $exists: true, $nin: ['', null] } },
      { content: { $exists: true, $nin: ['', null] } },
    ],
  };
}

function baseFilter({ classLabel, subject, topic, subtopic }) {
  return {
    sourceType: { $ne: 'ai_pdf' },
    classLabel: normalize(classLabel),
    subject: normalize(subject),
    topic: normalize(topic),
    subtopic: normalize(subtopic),
    ...validContentFilter(),
  };
}

function rotationKey({ classLabel, subject, topic, subtopic, toolName }) {
  return [
    'ai-tool-data-rotation',
    normalize(classLabel),
    normalize(subject),
    normalize(topic),
    normalize(subtopic),
    normalize(toolName) || '*',
  ].join('|');
}

async function nextCursorIndex(key, total) {
  if (total <= 1) return 0;
  const current = await AiToolRotationCursor.findOne({ key }).lean();
  if (!current) {
    await AiToolRotationCursor.create({ key, cursor: 0, lastServedAt: new Date() });
    return 0;
  }
  const next = (Number(current.cursor || 0) + 1) % total;
  await AiToolRotationCursor.updateOne(
    { key },
    { $set: { cursor: next, lastServedAt: new Date() } },
  );
  return next;
}

/**
 * Priority source for Teacher/Student tool pages.
 * 1) exact class+subject+topic+subtopic (+tool when available)
 * 2) if no exact tool hit, retry exact path without toolName
 * 3) if multiple rows, rotate sequentially (1,2,3,...,1)
 */
export async function fetchRotatingAiToolData({
  classLabel,
  subject,
  topic,
  subtopic,
  toolName = '',
}) {
  const bf = baseFilter({ classLabel, subject, topic, subtopic });
  const exactToolFilter = normalize(toolName) ? { ...bf, toolName: normalize(toolName) } : bf;

  let docs = await AiToolGeneration.find(exactToolFilter).sort({ createdAt: 1 }).lean();
  let matchType = normalize(toolName) ? 'exact-with-tool' : 'exact';

  if (docs.length === 0 && normalize(toolName)) {
    docs = await AiToolGeneration.find(bf).sort({ createdAt: 1 }).lean();
    matchType = 'exact-without-tool';
  }
  if (docs.length === 0) return { doc: null, matchType: null, totalCandidates: 0, selectedIndex: -1 };

  const key = rotationKey({ classLabel, subject, topic, subtopic, toolName });
  const idx = await nextCursorIndex(key, docs.length);
  return {
    doc: docs[idx] || docs[0],
    matchType,
    totalCandidates: docs.length,
    selectedIndex: idx,
  };
}

