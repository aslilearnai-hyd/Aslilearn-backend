import AiToolGeneration from '../../../models/AiToolGeneration.js';
import AiToolRotationCursor from '../../../models/AiToolRotationCursor.js';
import { getToolDisplayTitle } from '../../../config/aiToolTemplates.js';
import {
  buildAiToolDataScopeFilter,
  buildSubtopicFieldMongoFilter,
  buildTopicFieldMongoFilter,
  mergeMongoFilters,
  normalizeMatchText,
  resolveLookupBoard,
  subtopicTextMatches,
  topicTextMatches,
} from '../../shared/ai-tool-data-match.js';
import { applyProductCategoryMongoFilter } from '../../shared/ai-tool-topic-taxonomy.js';

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
  return normalizeMatchText(value);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasUsableContent(doc) {
  const meta = doc?.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
  if (meta.mergedInto) return false;
  const review = String(doc?.reviewStatus || '').toLowerCase();
  if (review === 'rejected' || review === 'archived') return false;
  const text = String(doc?.generatedContent || doc?.content || '').trim();
  if (text && !/no activities\/projects found|no projects available|no data available/i.test(text)) {
    return true;
  }
  if (meta.legacyStructuredContent && typeof meta.legacyStructuredContent === 'object') return true;
  const structured = meta.structuredContent;
  if (structured && typeof structured === 'object' && structured.schema === 'asli-v2-six-section') {
    return true;
  }
  return false;
}

/** Keep Mongo filters simple — regex `$not` here was causing multiplanner timeouts. */
function validContentFilter() {
  return {
    $or: [
      { generatedContent: { $exists: true, $nin: ['', null] } },
      { content: { $exists: true, $nin: ['', null] } },
      { 'metadata.structuredContent.schema': 'asli-v2-six-section' },
      { 'metadata.legacyStructuredContent': { $exists: true, $ne: null } },
    ],
  };
}

function approvedFilter() {
  return {
    status: { $nin: ['archived', 'inactive', 'deleted'] },
  };
}

function scopeFilter({ classLabel, subject, board, productCategory, strictBoard = true }) {
  let scope = buildAiToolDataScopeFilter({
    classLabel,
    subject,
    board: strictBoard ? board : '',
  });
  if (productCategory !== undefined && productCategory !== null) {
    scope = applyProductCategoryMongoFilter(scope, productCategory);
  }
  return mergeMongoFilters(scope, validContentFilter(), approvedFilter());
}

function rotationKey({ classLabel, subject, topic, subtopic, toolName, scope, board, productCategory }) {
  return [
    'ai-tool-data-rotation',
    normalize(scope) || '*',
    normalize(board) || '*',
    String(productCategory ?? '*'),
    normalize(classLabel),
    normalize(subject),
    normalize(topic),
    normalize(subtopic),
    normalize(toolName) || '*',
  ].join('|');
}

/** Keep rotation snappy: never load every historical generation for a chapter. */
const EXACT_CANDIDATE_LIMIT = 24;
const FUZZY_POOL_LIMIT = 80;
/** Atlas multiplanner + compound filters need headroom; catch timeouts and continue. */
const QUERY_MAX_TIME_MS = 25_000;

async function findAiToolCandidates(filter, limit) {
  try {
    return await AiToolGeneration.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean();
  } catch (err) {
    console.warn(
      '[ai-tool-rotation] candidate query failed:',
      String(err?.message || err).slice(0, 200),
    );
    return [];
  }
}

async function nextCursorIndex(key, total) {
  if (total <= 1) return 0;
  try {
    const current = await AiToolRotationCursor.findOneAndUpdate(
      { key },
      { $inc: { cursor: 1 }, $set: { lastServedAt: new Date() } },
      { upsert: true, new: true },
    ).lean();
    return Math.abs(Number(current?.cursor || 0)) % total;
  } catch {
    return 0;
  }
}

function setCursorIndex(key, idx) {
  // Fire-and-forget — never block saved-content delivery on cursor writes.
  void AiToolRotationCursor.updateOne(
    { key },
    { $set: { cursor: idx, lastServedAt: new Date() } },
    { upsert: true },
  ).catch(() => {});
}

function filterHasToolName(filter) {
  if (!filter) return false;
  if (filter.toolName) return true;
  if (Array.isArray(filter.$and)) {
    return filter.$and.some((clause) => clause?.toolName);
  }
  return false;
}

function buildAttemptFilters({ classLabel, subject, topic, subtopic, board, productCategory, strictBoard }) {
  const bf = scopeFilter({ classLabel, subject, board, productCategory, strictBoard });
  const normalizedTopic = normalize(topic);
  // Treat UI sentinel / "Whole chapter" as empty so we match Super Admin whole-chapter rows
  // (stored as "" or "Whole chapter"), not a literal "__WHOLE_CHAPTER__" subtopic.
  const rawSubtopic = normalize(subtopic);
  const isWholeChapter =
    !rawSubtopic ||
    /^whole[\s_-]*chapter$/i.test(rawSubtopic) ||
    rawSubtopic === '__WHOLE_CHAPTER__' ||
    /^__\s*whole\s*chapter\s*__$/i.test(rawSubtopic);
  const normalizedSubtopic = isWholeChapter ? '' : rawSubtopic;

  const exactFilter = mergeMongoFilters(
    bf,
    normalizedTopic ? buildTopicFieldMongoFilter(normalizedTopic) : { topic: '' },
    normalizedSubtopic
      ? buildSubtopicFieldMongoFilter(normalizedSubtopic)
      : {
          // Match empty subtopic OR Super Admin "Whole chapter" saves
          $or: [
            { subtopic: '' },
            { subtopic: { $exists: false } },
            { subtopic: null },
            { subtopic: { $regex: /^whole[\s_-]*chapter$/i } },
          ],
        },
  );

  const topicOnlyFilter = mergeMongoFilters(
    bf,
    normalizedTopic ? buildTopicFieldMongoFilter(normalizedTopic) : {},
  );

  return { bf, exactFilter, topicOnlyFilter, normalizedTopic, normalizedSubtopic };
}

async function executeRotationSearch({
  classLabel,
  subject,
  topic,
  subtopic,
  toolName,
  board,
  productCategory,
  preferLatest,
  strictToolMatch,
  cursorScope,
  validator,
  strictBoard,
  exactOnly = false,
}) {
  const normalizedTool = normalize(toolName);
  const { bf, exactFilter, topicOnlyFilter, normalizedTopic, normalizedSubtopic } = buildAttemptFilters({
    classLabel,
    subject,
    topic,
    subtopic,
    board,
    productCategory,
    strictBoard,
  });

  const attempts = [];
  if (normalizedTool) {
    attempts.push({
      matchType: 'exact-with-tool',
      filter: mergeMongoFilters(exactFilter, toolNameMatchFilter(normalizedTool)),
    });
  }
  if (!exactOnly && !strictToolMatch) {
    attempts.push({ matchType: 'exact-any-tool', filter: exactFilter });

    if (!normalizedSubtopic && normalizedTopic) {
      if (normalizedTool) {
        attempts.push({
          matchType: 'topic-with-tool',
          filter: mergeMongoFilters(topicOnlyFilter, toolNameMatchFilter(normalizedTool)),
        });
      }
      attempts.push({ matchType: 'topic-any-tool', filter: topicOnlyFilter });
    }

    if (!normalizedSubtopic && !normalizedTopic) {
      if (normalizedTool) {
        attempts.push({
          matchType: 'subject-with-tool',
          filter: mergeMongoFilters(bf, toolNameMatchFilter(normalizedTool)),
        });
      }
      attempts.push({ matchType: 'subject-any-tool', filter: bf });
    }
  } else if (!exactOnly && normalizedTopic) {
    if (normalizedTool) {
      attempts.push({
        matchType: normalizedSubtopic ? 'topic-with-tool-fuzzy-subtopic' : 'topic-with-tool',
        filter: mergeMongoFilters(topicOnlyFilter, toolNameMatchFilter(normalizedTool)),
      });
      // Dashboard delivery: if this chapter has no row, still serve any saved
      // content for the same class + subject + tool (never block on "ready chapters").
      attempts.push({
        matchType: 'subject-with-tool',
        filter: mergeMongoFilters(bf, toolNameMatchFilter(normalizedTool)),
      });
    }
  } else if (!exactOnly && !normalizedSubtopic && !normalizedTopic && normalizedTool) {
    attempts.push({
      matchType: 'subject-with-tool',
      filter: mergeMongoFilters(bf, toolNameMatchFilter(normalizedTool)),
    });
  } else if (!exactOnly && normalizedTool) {
    // Subtopic-only edge case — still allow subject-wide delivery.
    attempts.push({
      matchType: 'subject-with-tool',
      filter: mergeMongoFilters(bf, toolNameMatchFilter(normalizedTool)),
    });
  }

  const selectByRotation = async (docs, matchType, keyToolName = normalizedTool) => {
    const key = rotationKey({
      classLabel,
      subject,
      topic: normalizedTopic,
      subtopic: normalizedSubtopic,
      toolName: keyToolName,
      scope: cursorScope,
      board: strictBoard ? board : '',
      productCategory,
    });

    const pickFromOrder = async (order) => {
      if (!validator) {
        const idx = order[0];
        // Persist cursor so the next Generate advances to a different variant.
        if (!preferLatest && docs.length > 1) {
          setCursorIndex(key, idx);
        }
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
            setCursorIndex(key, idx);
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
      // Records exist but failed strict pre-validation — deliver the first so the
      // controller can return a precise incomplete/wrong-tool message instead of NOT_FOUND.
      if (docs.length > 0) {
        return {
          doc: docs[order[0] ?? 0] || docs[0],
          matchType: `${matchType}-validation-fallback`,
          totalCandidates: docs.length,
          selectedIndex: order[0] ?? 0,
        };
      }
      return {
        doc: null,
        matchType,
        totalCandidates: docs.length,
        selectedIndex: -1,
      };
    };

    if (preferLatest) {
      // docs are sorted createdAt:-1 → index 0 is newest
      const order = Array.from({ length: docs.length }, (_, i) => i);
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
            filter: mergeMongoFilters(a.filter, toolNameMatchFilter(toolFilter)),
          })),
      );
    } else if (!strictToolMatch) {
      toolAttempts.push(...attempts);
    }
    for (const attempt of toolAttempts) {
      if (strictToolMatch && !filterHasToolName(attempt.filter)) continue;
      const docs = (await findAiToolCandidates(attempt.filter, EXACT_CANDIDATE_LIMIT)).filter(
        (doc) => {
          if (!hasUsableContent(doc) || !toolSlugMatches(doc.toolName, tryToolName || normalizedTool)) {
            return false;
          }
          if (attempt.matchType.includes('fuzzy-subtopic') && normalizedSubtopic) {
            const docSub = String(doc.subtopic || '').trim();
            // Topic-level saves (empty subtopic) apply to any subtopic under that chapter.
            if (!docSub) return true;
            return subtopicTextMatches(docSub, normalizedSubtopic);
          }
          return true;
        },
      );
      if (docs.length > 0) {
        docs.sort((a, b) => {
          const va = Number(
            a?.metadata?.generationVariant ??
              a?.metadata?.extraParams?.generationVariant ??
              0,
          );
          const vb = Number(
            b?.metadata?.generationVariant ??
              b?.metadata?.extraParams?.generationVariant ??
              0,
          );
          if (va !== vb) return va - vb;
          return (
            new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime()
          );
        });
        const picked = await selectByRotation(
          docs,
          attempt.matchType,
          attempt.matchType.includes('any-tool') ? '' : toolFilter || normalizedTool,
        );
        if (picked.doc) return picked;
      }
    }
  }

  if (exactOnly) {
    return { doc: null, matchType: null, totalCandidates: 0, selectedIndex: -1 };
  }

  const fuzzyBases = [];
  if (normalizedTool) {
    fuzzyBases.push({
      matchType: 'fuzzy-with-tool',
      filter: mergeMongoFilters(bf, toolNameMatchFilter(normalizedTool)),
      keyTool: normalizedTool,
    });
  }
  if (!strictToolMatch) {
    fuzzyBases.push({ matchType: 'fuzzy-any-tool', filter: bf, keyTool: '' });
  }

  for (const base of fuzzyBases) {
    const pool = (await findAiToolCandidates(base.filter, FUZZY_POOL_LIMIT)).filter(
      (doc) =>
        hasUsableContent(doc) &&
        (!strictToolMatch || toolSlugMatches(doc.toolName, base.keyTool || normalizedTool)),
    );
    if (!pool.length) continue;

    const fuzzyMatches = pool.filter((doc) => {
      const topicOk = !normalizedTopic || topicTextMatches(doc.topic || '', normalizedTopic);
      const docSub = String(doc.subtopic || '').trim();
      const subtopicOk =
        !normalizedSubtopic ||
        !docSub ||
        subtopicTextMatches(docSub, normalizedSubtopic);
      const toolOk =
        !strictToolMatch || toolSlugMatches(doc.toolName, base.keyTool || normalizedTool);
      return topicOk && subtopicOk && toolOk;
    });

    // If topic/subtopic fuzzy miss, still deliver any subject+tool row (dashboard UX).
    const deliverPool =
      fuzzyMatches.length > 0
        ? fuzzyMatches
        : strictToolMatch && normalizedTool
          ? pool
          : [];

    if (deliverPool.length > 0) {
      if (preferLatest) {
        return {
          doc: deliverPool[0],
          matchType: `${base.matchType}${fuzzyMatches.length ? '-latest' : '-subject-fallback-latest'}`,
          totalCandidates: deliverPool.length,
          selectedIndex: 0,
        };
      }
      const picked = await selectByRotation(
        deliverPool,
        fuzzyMatches.length ? base.matchType : `${base.matchType}-subject-fallback`,
        base.keyTool,
      );
      if (picked.doc) return picked;
    }
  }

  return { doc: null, matchType: null, totalCandidates: 0, selectedIndex: -1 };
}

/**
 * Priority source for Teacher/Student tool pages.
 * Matches AI Tool Topics scope: board + class + subject + topic + subtopic (+tool).
 *
 * @param {{ fastDelivery?: boolean }} opts
 *   When true (dashboards), try a single exact findOne-style hit first so saved
 *   content returns in ~1s before heavier fuzzy/rotation scans.
 */
export async function fetchRotatingAiToolData(rawOpts) {
  const opts = await applyCategoryShareToOpts(rawOpts);
  try {
    return await fetchRotatingAiToolDataInner(opts);
  } catch (err) {
    console.warn(
      '[ai-tool-rotation] fetchRotatingAiToolData failed:',
      String(err?.message || err).slice(0, 200),
    );
    // Last resort: simplest possible class+subject+tool query (avoids multiplanner).
    try {
      const simple = await findSimpleSubjectToolDoc(opts);
      if (simple) return simple;
    } catch {
      /* ignore */
    }
    return { doc: null, matchType: null, totalCandidates: 0, selectedIndex: -1 };
  }
}

/**
 * A category can be configured to reuse another category's content
 * (e.g. IIT Beta Class 6 Biology reads Alpha's). Swap before any lookup.
 */
async function applyCategoryShareToOpts(opts) {
  if (!opts || opts.productCategory === undefined || opts.productCategory === null) return opts;
  try {
    const { resolveSharedProductCategory } = await import('../../shared/ai-tool-category-share.js');
    const resolved = await resolveSharedProductCategory({
      board: opts.board,
      classLabel: opts.classLabel,
      subject: opts.subject,
      productCategory: opts.productCategory,
    });
    if (resolved === opts.productCategory) return opts;
    return { ...opts, productCategory: resolved };
  } catch (err) {
    console.warn(
      '[ai-tool-rotation] category share skipped:',
      String(err?.message || err).slice(0, 200),
    );
    return opts;
  }
}

async function findSimpleSubjectToolDoc({
  classLabel,
  subject,
  toolName = '',
  board = '',
  preferLatest = true,
}) {
  const normalizedTool = normalize(toolName);
  if (!normalizedTool || !classLabel || !subject) return null;
  const lookupBoard = resolveLookupBoard(board, classLabel);
  const filter = mergeMongoFilters(
    buildAiToolDataScopeFilter({
      classLabel,
      subject,
      board: lookupBoard || '',
    }),
    toolNameMatchFilter(normalizedTool),
    { status: { $nin: ['archived', 'inactive', 'deleted'] } },
  );
  const docs = await findAiToolCandidates(filter, EXACT_CANDIDATE_LIMIT);
  const usable = docs.filter((d) => hasUsableContent(d));
  if (!usable.length) return null;
  return {
    doc: preferLatest ? usable[0] : usable[usable.length - 1] || usable[0],
    matchType: 'simple-subject-tool-fallback',
    totalCandidates: usable.length,
    selectedIndex: 0,
  };
}

async function fetchRotatingAiToolDataInner({
  classLabel,
  subject,
  topic,
  subtopic,
  toolName = '',
  board = '',
  productCategory,
  preferLatest = false,
  strictToolMatch = false,
  cursorScope = '',
  validator = null,
  fastDelivery = false,
}) {
  const lookupBoard = resolveLookupBoard(board, classLabel);
  const normalizedTool = normalize(toolName);

  if (fastDelivery && normalizedTool) {
    // Dashboards must rotate across saved variants — never pin preferLatest here
    // or every Generate returns the same Super Admin row.
    const fast = await executeRotationSearch({
      classLabel,
      subject,
      topic,
      subtopic,
      toolName,
      board: lookupBoard,
      productCategory,
      preferLatest: false,
      strictToolMatch: true,
      cursorScope,
      validator,
      strictBoard: Boolean(lookupBoard),
      exactOnly: true,
    });
    // Only short-circuit when we already have multiple variants to rotate through.
    // A single exact hit often means other batch variants are nearby under a slightly
    // different topic/subtopic string — continue into the full search.
    if (fast.doc && Number(fast.totalCandidates) > 1) {
      return {
        ...fast,
        matchType: fast.matchType ? `${fast.matchType}-fast` : 'exact-fast',
      };
    }
  }

  const withBoard = await executeRotationSearch({
    classLabel,
    subject,
    topic,
    subtopic,
    toolName,
    board: lookupBoard,
    productCategory,
    preferLatest,
    strictToolMatch,
    cursorScope,
    validator,
    strictBoard: Boolean(lookupBoard),
  });
  if (withBoard.doc) return withBoard;

  if (!lookupBoard) {
    const simple = await findSimpleSubjectToolDoc({
      classLabel,
      subject,
      toolName,
      board: lookupBoard,
      preferLatest: true,
    });
    return simple || withBoard;
  }

  const withoutBoard = await executeRotationSearch({
    classLabel,
    subject,
    topic,
    subtopic,
    toolName,
    board: lookupBoard,
    productCategory,
    preferLatest,
    strictToolMatch,
    cursorScope,
    validator,
    strictBoard: false,
  });
  if (withoutBoard.doc) return withoutBoard;

  const simple = await findSimpleSubjectToolDoc({
    classLabel,
    subject,
    toolName,
    board: lookupBoard,
    preferLatest: true,
  });
  return simple || withoutBoard;
}
