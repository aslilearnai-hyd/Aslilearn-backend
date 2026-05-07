import AiToolGeneration from '../models/AiToolGeneration.js';
import AiToolRotationCursor from '../models/AiToolRotationCursor.js';

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactCaseInsensitive(value) {
  const normalized = normalize(value);
  if (!normalized) return '';
  return { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' };
}

function looseNormalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function looseIncludesEitherWay(a, b) {
  const x = looseNormalize(a);
  const y = looseNormalize(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

function hasUsableContent(doc) {
  const text = String(doc?.generatedContent || doc?.content || '').trim();
  if (!text) return false;
  if (/no activities\/projects found|no projects available|no data available/i.test(text)) {
    return false;
  }
  return true;
}

function normalizeClassLabel(value) {
  const v = normalize(value);
  if (!v) return v;
  if (v === 'IIT-6' || v === 'Class-6-IIT') return 'IIT-6';
  const digits = v.match(/\d+/)?.[0];
  if (digits) return `Class ${digits}`;
  return v;
}

function subjectVariants(value) {
  const v = normalize(value);
  if (!v) return [];
  const lower = v.toLowerCase();
  if (lower === 'maths' || lower === 'mathematics' || lower === 'math') {
    return ['Maths', 'Mathematics'];
  }
  if (lower === 'social science' || lower === 'social studies' || lower === 'sst') {
    return ['Social Science', 'Social Studies'];
  }
  return [v];
}

function validContentFilter() {
  return {
    $or: [
      {
        generatedContent: {
          $exists: true,
          $nin: ['', null],
          $not: /no activities\/projects found|no projects available|no data available/i,
        },
      },
      {
        content: {
          $exists: true,
          $nin: ['', null],
          $not: /no activities\/projects found|no projects available|no data available/i,
        },
      },
    ],
  };
}

function approvedFilter() {
  return {
    $or: [
      { reviewStatus: 'approved' },
      { reviewStatus: 'draft' },
      { reviewStatus: 'under_review' },
      { reviewStatus: { $exists: false } },
    ],
  };
}

function baseFilter({ classLabel, subject }) {
  const subjectSet = subjectVariants(subject);
  return {
    sourceType: { $ne: 'ai_pdf' },
    classLabel: normalizeClassLabel(classLabel),
    ...(subjectSet.length > 1 ? { subject: { $in: subjectSet } } : { subject: subjectSet[0] || normalize(subject) }),
    ...validContentFilter(),
    ...approvedFilter(),
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
  const normalizedTopic = normalize(topic);
  const normalizedSubtopic = normalize(subtopic);
  const normalizedTool = normalize(toolName);
  const bf = baseFilter({ classLabel, subject });

  const topicFilter = normalizedTopic ? { topic: exactCaseInsensitive(normalizedTopic) } : { topic: '' };
  const subtopicFilter = normalizedSubtopic ? { subtopic: exactCaseInsensitive(normalizedSubtopic) } : { subtopic: '' };
  const exactFilter = { ...bf, ...topicFilter, ...subtopicFilter };

  const attempts = [];
  if (normalizedTool) attempts.push({ matchType: 'exact-with-tool', filter: { ...exactFilter, toolName: normalizedTool } });
  attempts.push({ matchType: 'exact-any-tool', filter: exactFilter });

  if (!normalizedSubtopic && normalizedTopic) {
    const topicOnlyFilter = { ...bf, topic: exactCaseInsensitive(normalizedTopic) };
    if (normalizedTool) attempts.push({ matchType: 'topic-with-tool', filter: { ...topicOnlyFilter, toolName: normalizedTool } });
    attempts.push({ matchType: 'topic-any-tool', filter: topicOnlyFilter });
  }

  if (!normalizedSubtopic && !normalizedTopic) {
    if (normalizedTool) attempts.push({ matchType: 'subject-with-tool', filter: { ...bf, toolName: normalizedTool } });
    attempts.push({ matchType: 'subject-any-tool', filter: bf });
  }

  const selectByRotation = async (docs, matchType, keyToolName = normalizedTool) => {
    const key = rotationKey({
      classLabel,
      subject,
      topic: normalizedTopic,
      subtopic: normalizedSubtopic,
      toolName: keyToolName,
    });
    const idx = await nextCursorIndex(key, docs.length);
    return {
      doc: docs[idx] || docs[0],
      matchType,
      totalCandidates: docs.length,
      selectedIndex: idx,
    };
  };

  for (const attempt of attempts) {
    const docs = (await AiToolGeneration.find(attempt.filter).sort({ createdAt: 1 }).lean()).filter(hasUsableContent);
    if (docs.length > 0) {
      return selectByRotation(
        docs,
        attempt.matchType,
        attempt.matchType.includes('any-tool') ? '' : normalizedTool,
      );
    }
  }

  // Final fallback: fuzzy match topic/subtopic text among same class+subject (+tool when available).
  const fuzzyBases = [];
  if (normalizedTool) fuzzyBases.push({ matchType: 'fuzzy-with-tool', filter: { ...bf, toolName: normalizedTool }, keyTool: normalizedTool });
  fuzzyBases.push({ matchType: 'fuzzy-any-tool', filter: bf, keyTool: '' });

  for (const base of fuzzyBases) {
    const pool = (await AiToolGeneration.find(base.filter).sort({ createdAt: -1 }).limit(500).lean()).filter(hasUsableContent);
    if (!pool.length) continue;

    const fuzzyMatches = pool.filter((doc) => {
      const topicOk = !normalizedTopic || looseIncludesEitherWay(doc.topic || '', normalizedTopic);
      const subtopicOk = !normalizedSubtopic || looseIncludesEitherWay(doc.subtopic || '', normalizedSubtopic);
      return topicOk && subtopicOk;
    });

    if (fuzzyMatches.length > 0) {
      return selectByRotation(fuzzyMatches, base.matchType, base.keyTool);
    }
  }

  return { doc: null, matchType: null, totalCandidates: 0, selectedIndex: -1 };
}

