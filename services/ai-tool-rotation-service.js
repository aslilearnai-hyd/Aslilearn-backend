import AiToolGeneration from '../models/AiToolGeneration.js';
import AiToolRotationCursor from '../models/AiToolRotationCursor.js';
import { getToolDisplayTitle } from '../config/aiToolTemplates.js';
import {
  classLabelFilterForDb,
  subjectFilterForDb,
} from '../utils/curriculum-subject-validation.js';

/** Student slugs that may fall back to legacy stored toolName values (same tool family only). */
export const TOOL_ROTATION_ALIASES = Object.freeze({
  'project-idea-lab': ['activity-project-generator'],
  'activity-project-generator': ['project-idea-lab'],
  'study-schedule-maker': ['lesson-planner'],
  'lesson-planner': ['study-schedule-maker'],
  'reading-practice-room': ['story-passage-creator'],
  'story-passage-creator': ['reading-practice-room'],
  'my-study-decks': ['flashcard-generator'],
  'flashcard-generator': ['my-study-decks'],
  'mock-test-builder': ['exam-question-paper-generator'],
  'exam-question-paper-generator': ['mock-test-builder'],
});

/** Canonical slugs accepted for a dashboard tool request (includes legacy alias names). */
export function resolveToolSlugCandidates(toolSlug) {
  const normalized = normalize(toolSlug);
  if (!normalized) return [];
  const lower = normalized.toLowerCase();
  const aliases = TOOL_ROTATION_ALIASES[normalized] || TOOL_ROTATION_ALIASES[lower] || [];
  return [...new Set([normalized, lower, ...aliases.map((a) => normalize(a).toLowerCase())])].filter(Boolean);
}

function normalizeToolKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** DB values that may appear in toolName for a slug (slug + legacy aliases + display title). */
export function toolNameFilterValues(toolSlug) {
  const candidates = resolveToolSlugCandidates(toolSlug);
  const titles = candidates.map((c) => getToolDisplayTitle(c)).filter(Boolean);
  return [...new Set([...candidates, ...titles].map((v) => normalize(v)).filter(Boolean))];
}

function toolNameMatchFilter(toolSlug) {
  const values = toolNameFilterValues(toolSlug);
  if (!values.length) return {};
  return {
    toolName: {
      $in: values.map((v) => new RegExp(`^${escapeRegex(v)}$`, 'i')),
    },
  };
}

/** True when DB row toolName matches the tool the user opened (no cross-tool mixing). */
export function toolSlugMatches(storedToolName, requestedToolSlug) {
  const storedKey = normalizeToolKey(storedToolName);
  const requestedKey = normalizeToolKey(requestedToolSlug);
  if (!requestedKey) return false;
  if (!storedKey) return true;
  if (storedKey === requestedKey) return true;
  const allowed = new Set(
    resolveToolSlugCandidates(requestedToolSlug).flatMap((slug) => {
      const title = getToolDisplayTitle(slug);
      return [normalizeToolKey(slug), title ? normalizeToolKey(title) : ''].filter(Boolean);
    }),
  );
  return allowed.has(storedKey);
}

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
  const subjectNorm = subjectVariants(subject);
  const primarySubject = subjectNorm[0] || normalize(subject);
  const subjectDb = subjectNorm.length > 1 ? { $in: subjectNorm } : subjectFilterForDb(primarySubject);
  return {
    ...classLabelFilterForDb(normalizeClassLabel(classLabel)),
    subject: subjectDb,
    ...validContentFilter(),
    ...approvedFilter(),
  };
}

function rotationKey({ classLabel, subject, topic, subtopic, toolName, scope }) {
  return [
    'ai-tool-data-rotation',
    normalize(scope) || '*',
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

async function setCursorIndex(key, idx) {
  await AiToolRotationCursor.updateOne(
    { key },
    { $set: { cursor: idx, lastServedAt: new Date() } },
    { upsert: true },
  );
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
  preferLatest = false,
  /** When true (student/teacher dashboards), never return rows from a different tool. */
  strictToolMatch = false,
  /** Optional cursor scope (e.g. userId) so rotation is per-user. */
  cursorScope = '',
  /** When set, skip candidates that fail this check (tries all rows in the pool before giving up). */
  validator = null,
}) {
  const normalizedTopic = normalize(topic);
  const normalizedSubtopic = normalize(subtopic);
  const normalizedTool = normalize(toolName);
  const bf = baseFilter({ classLabel, subject });

  const topicFilter = normalizedTopic ? { topic: exactCaseInsensitive(normalizedTopic) } : { topic: '' };
  const subtopicFilter = normalizedSubtopic ? { subtopic: exactCaseInsensitive(normalizedSubtopic) } : { subtopic: '' };
  const exactFilter = { ...bf, ...topicFilter, ...subtopicFilter };

  const attempts = [];
  if (normalizedTool) {
    attempts.push({ matchType: 'exact-with-tool', filter: { ...exactFilter, ...toolNameMatchFilter(normalizedTool) } });
  }
  if (!strictToolMatch) {
    attempts.push({ matchType: 'exact-any-tool', filter: exactFilter });

    if (!normalizedSubtopic && normalizedTopic) {
      const topicOnlyFilter = { ...bf, topic: exactCaseInsensitive(normalizedTopic) };
      if (normalizedTool) {
        attempts.push({
          matchType: 'topic-with-tool',
          filter: { ...topicOnlyFilter, ...toolNameMatchFilter(normalizedTool) },
        });
      }
      attempts.push({ matchType: 'topic-any-tool', filter: topicOnlyFilter });
    }

    if (!normalizedSubtopic && !normalizedTopic) {
      if (normalizedTool) {
        attempts.push({ matchType: 'subject-with-tool', filter: { ...bf, ...toolNameMatchFilter(normalizedTool) } });
      }
      attempts.push({ matchType: 'subject-any-tool', filter: bf });
    }
  } else if (!normalizedSubtopic && normalizedTopic) {
    const topicOnlyFilter = { ...bf, topic: exactCaseInsensitive(normalizedTopic) };
    if (normalizedTool) {
      attempts.push({
        matchType: 'topic-with-tool',
        filter: { ...topicOnlyFilter, ...toolNameMatchFilter(normalizedTool) },
      });
    }
  } else if (!normalizedSubtopic && !normalizedTopic && normalizedTool) {
    attempts.push({ matchType: 'subject-with-tool', filter: { ...bf, ...toolNameMatchFilter(normalizedTool) } });
  }

  const selectByRotation = async (docs, matchType, keyToolName = normalizedTool) => {
    const key = rotationKey({
      classLabel,
      subject,
      topic: normalizedTopic,
      subtopic: normalizedSubtopic,
      toolName: keyToolName,
      scope: cursorScope,
    });

    const pickFromOrder = async (order) => {
      if (!validator) {
        const idx = order[0];
        return {
          doc: docs[idx] || docs[0],
          matchType: preferLatest ? `${matchType}-latest` : matchType,
          totalCandidates: docs.length,
          selectedIndex: idx,
        };
      }
      for (const idx of order) {
        const candidate = docs[idx];
        if (!candidate) continue;
        try {
          const ok = await validator(candidate);
          if (ok) {
            await setCursorIndex(key, idx);
            return {
              doc: candidate,
              matchType: preferLatest ? `${matchType}-latest` : matchType,
              totalCandidates: docs.length,
              selectedIndex: idx,
            };
          }
        } catch {
          /* try next candidate */
        }
      }
      return {
        doc: null,
        matchType,
        totalCandidates: docs.length,
        selectedIndex: -1,
      };
    };

    if (preferLatest) {
      const latestIdx = Math.max(0, docs.length - 1);
      const order = Array.from({ length: docs.length }, (_, i) => (latestIdx - i + docs.length) % docs.length);
      return pickFromOrder(order);
    }

    const startIdx = await nextCursorIndex(key, docs.length);
    const order = Array.from({ length: docs.length }, (_, i) => (startIdx + i) % docs.length);
    return pickFromOrder(order);
  };

  const toolNamesToTry = normalizedTool
    ? [normalizedTool, ...(TOOL_ROTATION_ALIASES[normalizedTool] || [])]
    : [''];

  for (const tryToolName of toolNamesToTry) {
    const toolFilter = normalize(tryToolName);
    const toolAttempts = [];
    if (toolFilter) {
      toolAttempts.push(
        ...attempts
          .filter((a) => !strictToolMatch || a.matchType.includes('with-tool'))
          .map((a) => ({
            matchType: `${a.matchType}-alias`,
            filter: { ...a.filter, ...toolNameMatchFilter(toolFilter) },
          })),
      );
    } else if (!strictToolMatch) {
      toolAttempts.push(...attempts);
    }
    for (const attempt of toolAttempts) {
      if (strictToolMatch && !attempt.filter?.toolName) continue;
      const docs = (await AiToolGeneration.find(attempt.filter).sort({ createdAt: 1 }).lean()).filter(
        (doc) => hasUsableContent(doc) && toolSlugMatches(doc.toolName, tryToolName || normalizedTool),
      );
      if (docs.length > 0) {
        return selectByRotation(
          docs,
          attempt.matchType,
          attempt.matchType.includes('any-tool') ? '' : toolFilter || normalizedTool,
        );
      }
    }
  }

  // Final fallback: fuzzy match topic/subtopic text among same class+subject (+tool when available).
  const fuzzyBases = [];
  if (normalizedTool) {
    fuzzyBases.push({
      matchType: 'fuzzy-with-tool',
      filter: { ...bf, ...toolNameMatchFilter(normalizedTool) },
      keyTool: normalizedTool,
    });
  }
  if (!strictToolMatch) {
    fuzzyBases.push({ matchType: 'fuzzy-any-tool', filter: bf, keyTool: '' });
  }

  for (const base of fuzzyBases) {
    const pool = (await AiToolGeneration.find(base.filter).sort({ createdAt: -1 }).limit(500).lean()).filter(
      (doc) =>
        hasUsableContent(doc) &&
        (!strictToolMatch || toolSlugMatches(doc.toolName, base.keyTool || normalizedTool)),
    );
    if (!pool.length) continue;

    const fuzzyMatches = pool.filter((doc) => {
      const topicOk = !normalizedTopic || looseIncludesEitherWay(doc.topic || '', normalizedTopic);
      const docSub = String(doc.subtopic || '').trim();
      const subtopicOk =
        !normalizedSubtopic ||
        !docSub ||
        looseIncludesEitherWay(docSub, normalizedSubtopic);
      const toolOk =
        !strictToolMatch || toolSlugMatches(doc.toolName, base.keyTool || normalizedTool);
      return topicOk && subtopicOk && toolOk;
    });

    if (fuzzyMatches.length > 0) {
      if (preferLatest) {
        return {
          doc: fuzzyMatches[0],
          matchType: `${base.matchType}-latest`,
          totalCandidates: fuzzyMatches.length,
          selectedIndex: 0,
        };
      }
      return selectByRotation(fuzzyMatches, base.matchType, base.keyTool);
    }
  }

  return { doc: null, matchType: null, totalCandidates: 0, selectedIndex: -1 };
}

