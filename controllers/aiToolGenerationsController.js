import mongoose from 'mongoose';
import AiToolGeneration from '../models/AiToolGeneration.js';
import AIGeneratorRecord from '../models/AIGeneratorRecord.js';
import AiContentEngineSource from '../models/AiContentEngineSource.js';
import AiContentEngineChunk from '../models/AiContentEngineChunk.js';
import { deleteFromConfiguredStorage } from '../services/cloud-storage.js';
import { boardMongoMatch, canonicalBoardLabel, lockBoardKey } from '../utils/board-label.js';
import { isDeprecatedAiToolIdentifier } from '../config/aiToolTemplates.js';
import { checkRecordSectionGap, getToolSectionGapSummary, getSectionGapSummariesByTool } from '../services/ai-tool-data-audit-service.js';
import { compareAiToolRecordsByVariantThenDate, sortGroupedGeneratorRecords } from '../utils/ai-tool-record-sort.js';
import { isWholeChapterSubtopic } from '../utils/questionComposition.js';
import {
  aggregateCache,
  aggregateInFlight,
  clearAiToolHierarchyCache,
} from '../utils/ai-tool-hierarchy-cache.js';
import {
  buildClassLabelMongoFilter,
  buildHierarchyBoardMongoFilter,
  buildSubjectMongoFilter,
  buildSubtopicFieldMongoFilter,
  buildTopicFieldMongoFilter,
  mergeMongoFilters,
  normalizeClassId,
  normalizeMatchText,
} from '../ai/shared/ai-tool-data-match.js';
import {
  applyProductCategoryMongoFilter,
  normalizeTopicProductCategory,
} from '../ai/shared/ai-tool-topic-taxonomy.js';
import { resolveAiToolRecordPdfBody } from '../utils/ai-tool-pdf-body.js';

const WHOLE_CHAPTER_LABEL = 'Whole chapter';

/** Matches nothing — used to drop a collection that cannot satisfy a filter. */
const MATCH_NONE = { _id: { $exists: false } };

/** Copy an optional productCategory filter from a request query onto a match. */
function applyProductCategoryQuery(query, match) {
  if ('productCategory' in query) {
    match.productCategory = query.productCategory ?? '';
  }
  return match;
}

function isWholeChapterStorageLabel(value) {
  return isWholeChapterSubtopic(value);
}

/** Mongo match for Whole chapter + legacy empty / alias labels. */
function wholeChapterSubtopicMongoClause(field = 'subtopic') {
  return {
    $or: [
      { [field]: { $in: ['', WHOLE_CHAPTER_LABEL, 'whole-chapter', 'Whole Chapter'] } },
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: { $regex: /^whole[\s_-]*chapter$/i } },
    ],
  };
}
function previewFromContent(text, n = 220) {
  if (!text || typeof text !== 'string') return '';
  const plain = text.replace(/[#*_`[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length <= n ? plain : `${plain.slice(0, n)}…`;
}

function normalizeCombinedRecord(row) {
  const board = canonicalBoardLabel(row.board || row?.metadata?.board || '');
  return {
    _id: row._id,
    sourceType: row.sourceType,
    toolName: row.toolName ?? '',
    toolDisplayName: row.toolDisplayName ?? '',
    board,
    productCategory: String(row.productCategory ?? '').toUpperCase(),
    classLabel: row.classLabel ?? '',
    subject: row.subject ?? '',
    topic: row.topic ?? '',
    subtopic: row.subtopic ?? '',
    createdAt: row.createdAt || row.uploadDate || null,
    preview: previewFromContent(row.content || row.generatedContent || row.previewText || ''),
    content: row.content || row.generatedContent || row.previewText || '',
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : undefined,
  };
}

function mapLegacyAiGeneratorToCombined(doc) {
  if (!doc) return null;
  return normalizeCombinedRecord({
    _id: doc._id,
    sourceType: 'ai_generator',
    toolName: doc.toolSlug || doc.toolName || '',
    toolDisplayName: doc.toolName || doc.toolSlug || '',
    board: doc.board || '',
    classLabel: doc.className || '',
    subject: doc.subjectName || '',
    topic: doc.topicName || '',
    subtopic: doc.subtopicName || '',
    createdAt: doc.createdAt,
    content: doc.generatedContent || '',
    generatedContent: doc.generatedContent || '',
    metadata: {
      source: 'ai_generators_legacy_collection',
      createdByRole: doc.createdByRole || 'super-admin',
      createdByName: doc.createdByName || '',
    },
  });
}

const FULL_RECORD_FIELDS_MASTER =
  'toolName toolDisplayName sourceType classLabel subject topic subtopic content generatedContent createdAt metadata pdfFileUrl pdfFileName status board productCategory';
const FULL_RECORD_FIELDS_LEGACY =
  'toolSlug toolName className subjectName topicName subtopicName board generatedContent createdAt createdByRole createdByName';

const LEGACY_GROUP_FIELD = {
  toolName: 'toolSlug',
  classLabel: 'className',
  subject: 'subjectName',
  topic: 'topicName',
  subtopic: 'subtopicName',
};

const AGGREGATE_CACHE_TTL_MS = 30_000;

function buildMasterMongoFilter(match = {}) {
  const parts = [];
  if (match.toolName) parts.push({ toolName: match.toolName });

  if ('productCategory' in match) {
    const category = normalizeTopicProductCategory(match.productCategory);
    if (category !== null) parts.push(applyProductCategoryMongoFilter({}, category));
  }

  const hasBoard = 'board' in match;
  const hasClass = 'classLabel' in match;
  const boardVal = hasBoard ? String(match.board ?? '') : '';
  const classVal = hasClass ? String(match.classLabel ?? '') : '';

  if (hasClass) {
    if (classVal) {
      parts.push(buildClassLabelMongoFilter(classVal, boardVal));
      const isIitClass6 =
        lockBoardKey(boardVal) === 'IIT/NEET' && normalizeClassId(classVal) === 'Class 6';
      if (hasBoard && boardVal && !isIitClass6) {
        parts.push({ board: boardMongoMatch(boardVal) });
      } else if (hasBoard && !boardVal) {
        parts.push({ board: '' });
      }
    } else {
      parts.push({ classLabel: '' });
      if (hasBoard) {
        parts.push(
          boardVal
            ? buildHierarchyBoardMongoFilter(boardVal, {
                boardField: 'board',
                classField: 'classLabel',
              })
            : { board: '' },
        );
      }
    }
  } else if (hasBoard) {
    parts.push(
      boardVal
        ? buildHierarchyBoardMongoFilter(boardVal, {
            boardField: 'board',
            classField: 'classLabel',
          })
        : { board: '' },
    );
  }

  if ('subject' in match) {
    const subject = String(match.subject ?? '');
    parts.push(subject ? buildSubjectMongoFilter(subject, boardVal) : { subject: '' });
  }
  if ('topic' in match) {
    const topic = String(match.topic ?? '');
    parts.push(topic ? buildTopicFieldMongoFilter(topic) : { topic: '' });
  }
  if ('subtopic' in match) {
    const st = String(match.subtopic ?? '');
    if (isWholeChapterStorageLabel(st)) {
      parts.push(wholeChapterSubtopicMongoClause('subtopic'));
    } else if (st) {
      parts.push(buildSubtopicFieldMongoFilter(st));
    } else {
      parts.push({ subtopic: '' });
    }
  }

  return mergeMongoFilters(...parts);
}

function buildLegacyClassLabelFilter(classLabel, board = '') {
  const normalized = normalizeClassId(classLabel);
  if (!normalized) return {};
  const boardKey = lockBoardKey(board);
  const isIitClass6 = boardKey === 'IIT/NEET' && normalized === 'Class 6';
  if (isIitClass6) {
    const iitBoardMatch = boardMongoMatch(board || 'IIT');
    return {
      $or: [
        { className: { $in: ['IIT-6', 'Class-6-IIT'] } },
        { className: 'Class 6', board: iitBoardMatch },
        { className: 'Class 6', board: '' },
        { className: 'Class 6', board: { $exists: false } },
      ],
    };
  }
  const digits = normalized.match(/\d+/)?.[0];
  if (!digits) return { className: normalized };
  return {
    className: { $in: [`Class ${digits}`, digits, `-${digits}`, normalized] },
  };
}

function buildLegacySubjectFilter(subject) {
  const v = normalizeMatchText(subject);
  if (!v) return { subjectName: '' };
  const lower = v.toLowerCase();
  if (lower === 'maths' || lower === 'mathematics' || lower === 'math') {
    return { subjectName: { $regex: '^(maths|mathematics|math)$', $options: 'i' } };
  }
  if (lower === 'social science' || lower === 'social studies' || lower === 'sst') {
    return {
      subjectName: { $regex: '^(social\\s*science|social\\s*studies|sst)$', $options: 'i' },
    };
  }
  return { subjectName: { $regex: `^${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } };
}

function buildLegacyTopicFilter(topic) {
  const filter = buildTopicFieldMongoFilter(topic);
  if (filter.topic !== undefined) return { topicName: filter.topic };
  if (filter.$or) {
    return { $or: filter.$or.map((clause) => ({ topicName: clause.topic })) };
  }
  return { topicName: topic };
}

function buildLegacyMongoFilter(match = {}) {
  const parts = [];
  if (match.toolName) parts.push({ toolSlug: match.toolName });

  // The legacy collection has no productCategory field, so its rows are untagged.
  // Untagged reads as General, and as ALPHA for IIT (see applyProductCategoryMongoFilter).
  // Any other track therefore has no legacy rows at all.
  if ('productCategory' in match) {
    const category = normalizeTopicProductCategory(match.productCategory);
    if (category && category !== 'ALPHA') parts.push(MATCH_NONE);
  }

  const hasBoard = 'board' in match;
  const hasClass = 'classLabel' in match;
  const boardVal = hasBoard ? String(match.board ?? '') : '';
  const classVal = hasClass ? String(match.classLabel ?? '') : '';

  if (hasClass) {
    if (classVal) {
      parts.push(buildLegacyClassLabelFilter(classVal, boardVal));
      const isIitClass6 =
        lockBoardKey(boardVal) === 'IIT/NEET' && normalizeClassId(classVal) === 'Class 6';
      if (hasBoard && boardVal && !isIitClass6) {
        parts.push({ board: boardMongoMatch(boardVal) });
      } else if (hasBoard && !boardVal) {
        parts.push({ board: '' });
      }
    } else {
      parts.push({ className: '' });
      if (hasBoard) {
        parts.push(
          boardVal
            ? buildHierarchyBoardMongoFilter(boardVal, {
                boardField: 'board',
                classField: 'className',
              })
            : { board: '' },
        );
      }
    }
  } else if (hasBoard) {
    parts.push(
      boardVal
        ? buildHierarchyBoardMongoFilter(boardVal, {
            boardField: 'board',
            classField: 'className',
          })
        : { board: '' },
    );
  }

  if ('subject' in match) {
    parts.push(buildLegacySubjectFilter(match.subject ?? ''));
  }
  if ('topic' in match) {
    const topic = String(match.topic ?? '');
    parts.push(topic ? buildLegacyTopicFilter(topic) : { topicName: '' });
  }
  if ('subtopic' in match) {
    const st = String(match.subtopic ?? '');
    if (isWholeChapterStorageLabel(st)) {
      parts.push(wholeChapterSubtopicMongoClause('subtopicName'));
    } else {
      parts.push({ subtopicName: st });
    }
  }

  return mergeMongoFilters(...parts);
}

function groupFieldPath(model, groupField) {
  if (model === 'legacy') {
    return `$${LEGACY_GROUP_FIELD[groupField] || groupField}`;
  }
  return `$${groupField}`;
}

async function aggregateCollectionGroupCounts(Model, modelKey, match, groupField) {
  const filter = modelKey === 'legacy' ? buildLegacyMongoFilter(match) : buildMasterMongoFilter(match);
  const fieldPath = groupFieldPath(modelKey, groupField);
  return Model.aggregate([
    { $match: filter },
    { $group: { _id: { $ifNull: [fieldPath, ''] }, count: { $sum: 1 } } },
  ]);
}

function mergeGroupCountRows(masterGroups, legacyGroups, groupField) {
  const merged = new Map();
  for (const group of [...masterGroups, ...legacyGroups]) {
    let value = group._id ?? '';
    if (groupField === 'toolName' && isDeprecatedAiToolIdentifier(value)) continue;
    if (groupField === 'classLabel') {
      value = normalizeClassId(value) || value;
    }
    if (groupField === 'subject') {
      const normalized = normalizeMatchText(value);
      const lower = normalized.toLowerCase();
      if (lower === 'maths' || lower === 'mathematics' || lower === 'math') {
        value = 'Mathematics';
      } else if (lower === 'social science' || lower === 'social studies' || lower === 'sst') {
        value = 'Social Science';
      } else {
        value = normalized;
      }
    }
    if (groupField === 'subtopic' && isWholeChapterStorageLabel(value)) {
      value = WHOLE_CHAPTER_LABEL;
    }
    const mergeKey =
      groupField === 'subject' ? String(value).toLowerCase() : String(value);
    const prev = merged.get(mergeKey);
    if (prev) {
      prev.count += group.count;
    } else {
      merged.set(mergeKey, { value, count: group.count });
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => {
      if (groupField === 'subtopic') {
        if (a.value === WHOLE_CHAPTER_LABEL) return -1;
        if (b.value === WHOLE_CHAPTER_LABEL) return 1;
      }
      return String(a.value).localeCompare(String(b.value));
    })
    .map(({ value, count }) => ({ value, count }));
}

async function withAggregateCache(cacheKey, loader) {
  const cached = aggregateCache.get(cacheKey);
  if (cached && Date.now() - cached.at < AGGREGATE_CACHE_TTL_MS) {
    return cached.value;
  }

  const inFlight = aggregateInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = loader()
    .then((value) => {
      aggregateCache.set(cacheKey, { at: Date.now(), value });
      if (aggregateCache.size > 60) {
        const cutoff = Date.now() - AGGREGATE_CACHE_TTL_MS;
        for (const [key, entry] of aggregateCache) {
          if (entry.at < cutoff) aggregateCache.delete(key);
        }
      }
      return value;
    })
    .finally(() => {
      aggregateInFlight.delete(cacheKey);
    });

  aggregateInFlight.set(cacheKey, promise);
  return promise;
}

/** Count distinct hierarchy values in MongoDB — no full-document scans. */
async function aggregateCombinedGroupCounts(match = {}, groupField) {
  const cacheKey = `group:${groupField}:${JSON.stringify(match)}`;
  return withAggregateCache(cacheKey, async () => {
    const [masterGroups, legacyGroups] = await Promise.all([
      aggregateCollectionGroupCounts(AiToolGeneration, 'master', match, groupField),
      aggregateCollectionGroupCounts(AIGeneratorRecord, 'legacy', match, groupField),
    ]);
    return mergeGroupCountRows(masterGroups, legacyGroups, groupField);
  });
}

async function getCombinedMetaStats(match = {}) {
  const cacheKey = `meta:${JSON.stringify(match)}`;
  return withAggregateCache(cacheKey, async () => {
    const [toolGroups, masterTopics, legacyTopics] = await Promise.all([
      aggregateCombinedGroupCounts(match, 'toolName'),
      AiToolGeneration.distinct('topic', buildMasterMongoFilter(match)),
      AIGeneratorRecord.distinct('topicName', buildLegacyMongoFilter(match)),
    ]);

    const total = toolGroups.reduce((sum, item) => sum + item.count, 0);
    const topicsCount = new Set(
      [...masterTopics, ...legacyTopics]
        .map((topic) => String(topic || '').trim())
        .filter((topic) => topic.length > 0),
    ).size;

    return { total, topicsCount, toolGroups };
  });
}

export { clearAiToolHierarchyCache as clearHierarchyCache };

/**
 * Single source of truth: all AI Tool Data + Generator + PDF master rows live in aitoolgenerations.
 */
async function loadCombinedRecords(match = {}) {
  const [rows, legacyGeneratorRows] = await Promise.all([
    AiToolGeneration.find(buildMasterMongoFilter(match)).select(FULL_RECORD_FIELDS_MASTER).lean(),
    AIGeneratorRecord.find(buildLegacyMongoFilter(match)).select(FULL_RECORD_FIELDS_LEGACY).lean(),
  ]);

  const masterRows = rows.map((d) => {
    const st = d.sourceType || 'legacy';
    const pdfPreview =
      st === 'ai_pdf'
        ? typeof d.metadata?.renderContent === 'string'
          ? d.metadata.renderContent
          : JSON.stringify(d.metadata?.structuredContent || d.metadata?.renderContent || {}, null, 2)
        : '';
    return normalizeCombinedRecord({
      _id: d._id,
      sourceType: st,
      toolName: d.toolName || '',
      toolDisplayName: d.toolDisplayName || '',
      board: d.board || '',
      productCategory: d.productCategory || '',
      classLabel: d.classLabel || '',
      subject: d.subject || '',
      topic: d.topic || '',
      subtopic: d.subtopic || '',
      createdAt: d.createdAt,
      content: d.content || d.generatedContent || '',
      generatedContent: d.generatedContent || d.content || '',
      previewText: st === 'ai_pdf' ? pdfPreview : undefined,
      metadata: d.metadata,
    });
  });

  const legacyRowsNormalized = legacyGeneratorRows.map((r) => mapLegacyAiGeneratorToCombined(r));

  return [...masterRows, ...legacyRowsNormalized].filter(
    (row) =>
      !isDeprecatedAiToolIdentifier(row.toolName) && !isDeprecatedAiToolIdentifier(row.toolDisplayName),
  );
}

/**
 * Lazy hierarchy: which distinct field comes next based on which query keys are present.
 * Keys must be added in order: toolName → classLabel → subject → topic → subtopic
 */
export const listAiToolChildren = async (req, res) => {
  try {
    const q = req.query;
    const match = {};
    if ('toolName' in q) match.toolName = q.toolName;
    if ('board' in q) match.board = q.board ?? '';
    if ('classLabel' in q) match.classLabel = q.classLabel ?? '';
    if ('subject' in q) match.subject = q.subject ?? '';
    if ('topic' in q) match.topic = q.topic ?? '';
    if ('subtopic' in q) match.subtopic = q.subtopic ?? '';
    applyProductCategoryQuery(q, match);

    if (!('toolName' in q)) {
      const items = await aggregateCombinedGroupCounts(match, 'toolName');
      return res.json({
        success: true,
        data: {
          nextLevel: 'classLabel',
          items,
        },
      });
    }

    if (!('classLabel' in q)) {
      const items = await aggregateCombinedGroupCounts(match, 'classLabel');
      return res.json({
        success: true,
        data: {
          nextLevel: 'subject',
          items,
        },
      });
    }

    if (!('subject' in q)) {
      const items = await aggregateCombinedGroupCounts(match, 'subject');
      return res.json({
        success: true,
        data: {
          nextLevel: 'topic',
          items,
        },
      });
    }

    if (!('topic' in q)) {
      const items = await aggregateCombinedGroupCounts(match, 'topic');
      return res.json({
        success: true,
        data: {
          nextLevel: 'subtopic',
          items,
        },
      });
    }

    if (!('subtopic' in q)) {
      const items = await aggregateCombinedGroupCounts(match, 'subtopic');
      return res.json({
        success: true,
        data: {
          nextLevel: 'subtopic',
          items,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        nextLevel: 'leaf',
        leaf: true,
        matchSummary: match,
      },
    });
  } catch (error) {
    console.error('listAiToolChildren error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const listAiToolRecords = async (req, res) => {
  try {
    const { toolName, board, classLabel, subject, topic, subtopic, page = '1', limit = '25' } = req.query;
    if (!toolName || !('classLabel' in req.query) || !('subject' in req.query) || !('topic' in req.query) || !('subtopic' in req.query)) {
      return res.status(400).json({
        success: false,
        message: 'toolName, classLabel, subject, topic, and subtopic are required (use empty string if none).',
      });
    }

    const match = {
      toolName,
      classLabel: classLabel ?? '',
      subject: subject ?? '',
      topic: topic ?? '',
      subtopic: subtopic ?? '',
    };
    if ('board' in req.query) match.board = board ?? '';
    applyProductCategoryQuery(req.query, match);

    const p = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (p - 1) * lim;

    const rows = await loadCombinedRecords(match);
    rows.sort(compareAiToolRecordsByVariantThenDate);
    const total = rows.length;
    const items = rows.slice(skip, skip + lim).map((d) => {
      const sectionGap = checkRecordSectionGap(d);
      return {
        _id: d._id,
        sourceType: d.sourceType,
        toolName: d.toolName,
        toolDisplayName: d.toolDisplayName,
        classLabel: d.classLabel,
        board: d.board || '',
        productCategory: d.productCategory || '',
        subject: d.subject,
        topic: d.topic,
        subtopic: d.subtopic,
        createdAt: d.createdAt,
        preview: d.preview,
        content: d.content,
        metadata: d.metadata,
        sectionGap,
      };
    });

    res.json({
      success: true,
      data: {
        match,
        page: p,
        limit: lim,
        total,
        items,
      },
    });
  } catch (error) {
    console.error('listAiToolRecords error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAiToolGenerationById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    let doc = await AiToolGeneration.findById(id).lean();
    if (!doc) {
      const legacy = await AIGeneratorRecord.findById(id).lean();
      if (!legacy) return res.status(404).json({ success: false, message: 'Not found' });
      const mapped = mapLegacyAiGeneratorToCombined(legacy);
      return res.json({
        success: true,
        data: {
          ...mapped,
          content: mapped.content || '',
        },
      });
    }
    const content =
      doc.content ||
      doc.generatedContent ||
      (doc.sourceType === 'ai_pdf'
        ? typeof doc.metadata?.renderContent === 'string'
          ? doc.metadata.renderContent
          : JSON.stringify(doc.metadata?.structuredContent || doc.metadata?.renderContent || {}, null, 2)
        : '');
    return res.json({
      success: true,
      data: {
        ...doc,
        sourceType: doc.sourceType || 'legacy',
        content,
      },
    });
  } catch (error) {
    console.error('getAiToolGenerationById error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAiToolGenerationById = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, structuredContent } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const hasStructured =
      structuredContent != null && typeof structuredContent === 'object' && !Array.isArray(structuredContent);
    const hasContent = typeof content === 'string' && content.trim();

    if (!hasStructured && !hasContent) {
      return res.status(400).json({ success: false, message: 'content or structuredContent is required' });
    }

    const setDoc = {};
    if (hasContent) {
      setDoc.content = content.trim();
      setDoc.generatedContent = content.trim();
    }
    if (hasStructured) {
      setDoc['metadata.structuredContent'] = structuredContent;
    }

    let updated = await AiToolGeneration.findByIdAndUpdate(id, { $set: setDoc }, { new: true }).lean();
    if (!updated) {
      if (!hasContent) {
        return res.status(404).json({ success: false, message: 'Not found' });
      }
      const legacyUpdated = await AIGeneratorRecord.findByIdAndUpdate(
        id,
        { $set: { generatedContent: content.trim() } },
        { new: true },
      ).lean();
      if (!legacyUpdated) {
        return res.status(404).json({ success: false, message: 'Not found' });
      }
      const mapped = mapLegacyAiGeneratorToCombined(legacyUpdated);
      clearAiToolHierarchyCache();
      return res.json({ success: true, data: mapped });
    }

    if (updated.sourceType === 'ai_pdf' && updated.metadata?.contentEngineSourceId) {
      try {
        let structured = updated.metadata.structuredContent;
        if (hasContent) {
          try {
            const parsed = JSON.parse(content.trim());
            if (parsed && typeof parsed === 'object') structured = parsed;
          } catch {
            // keep existing structured content
          }
        }
        await AiContentEngineSource.findByIdAndUpdate(updated.metadata.contentEngineSourceId, {
          $set: {
            structuredContent: structured || {},
          },
        });
      } catch (e) {
        console.warn('updateAiToolGenerationById: could not sync to content engine source:', e.message);
      }
    }

    clearAiToolHierarchyCache();
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('updateAiToolGenerationById error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteAiToolGenerationById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const doc = await AiToolGeneration.findById(id).lean();
    if (!doc) {
      const legacyDeleted = await AIGeneratorRecord.findByIdAndDelete(id).lean();
      if (!legacyDeleted) {
        return res.status(404).json({ success: false, message: 'Not found' });
      }
      clearAiToolHierarchyCache();
      return res.json({ success: true, message: 'Record deleted' });
    }

    await AiToolGeneration.findByIdAndDelete(id);

    if (doc.sourceType === 'ai_pdf') {
      const sid = String(doc.metadata?.contentEngineSourceId || doc.metadata?.aiPdfSourceId || '').trim();
      if (sid && mongoose.Types.ObjectId.isValid(sid)) {
        const remaining = await AiToolGeneration.countDocuments({
          $or: [
            { 'metadata.contentEngineSourceId': sid },
            { 'metadata.aiPdfSourceId': sid },
          ],
        });
        if (remaining === 0) {
          const source = await AiContentEngineSource.findById(sid);
          if (source) {
            await AiContentEngineChunk.deleteMany({ sourcePdfId: source._id });
            await deleteFromConfiguredStorage({
              storageKey: source.storageKey,
              fileUrl: source.fileUrl,
              storageProvider: source.storageProvider,
            });
            await AiContentEngineSource.findByIdAndDelete(source._id);
          }
        }
      }
    }

    clearAiToolHierarchyCache();
    return res.json({ success: true, message: 'Record deleted' });
  } catch (error) {
    console.error('deleteAiToolGenerationById error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * For PDF: returns nested sections with full content (may be large).
 * Query: optional toolName, classLabel, subject, topic, subtopic — narrow the export.
 */
export const exportAiToolGenerationsBundle = async (req, res) => {
  try {
    const match = {};
    if (req.query.toolName) match.toolName = req.query.toolName;
    if ('board' in req.query) match.board = req.query.board ?? '';
    if ('classLabel' in req.query) match.classLabel = req.query.classLabel ?? '';
    if ('subject' in req.query) match.subject = req.query.subject ?? '';
    if ('topic' in req.query) match.topic = req.query.topic ?? '';
    if ('subtopic' in req.query) match.subtopic = req.query.subtopic ?? '';
    applyProductCategoryQuery(req.query, match);

    const max = Math.min(5000, Math.max(1, parseInt(req.query.maxDocs || '2000', 10) || 2000));
    const docs = await loadCombinedRecords(Object.keys(match).length ? match : {});
    docs.sort((a, b) => {
      if (a.toolName !== b.toolName) return String(a.toolName).localeCompare(String(b.toolName));
      if (a.classLabel !== b.classLabel) return String(a.classLabel).localeCompare(String(b.classLabel));
      if (a.subject !== b.subject) return String(a.subject).localeCompare(String(b.subject));
      if (a.topic !== b.topic) return String(a.topic).localeCompare(String(b.topic));
      if (a.subtopic !== b.subtopic) return String(a.subtopic).localeCompare(String(b.subtopic));
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    const limited = docs.slice(0, max).map((d) => ({
      ...d,
      content: resolveAiToolRecordPdfBody(d) || d.content || '',
    }));

    if (docs.length >= max) {
      return res.json({
        success: true,
        data: { truncated: true, maxDocs: max, records: limited, warning: `Export limited to ${max} documents.` },
      });
    }

    res.json({
      success: true,
      data: { truncated: false, records: limited },
    });
  } catch (error) {
    console.error('exportAiToolGenerationsBundle error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAiToolGenerationsMeta = async (req, res) => {
  try {
    const match = {};
    if ('board' in req.query) match.board = req.query.board ?? '';
    applyProductCategoryQuery(req.query, match);
    const { total, topicsCount } = await getCombinedMetaStats(match);
    res.json({ success: true, data: { total, topicsCount } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Meta + root tool list in one round trip for the Super Admin AI Tool Data page. */
export const getAiToolGenerationsBootstrap = async (req, res) => {
  try {
    const match = {};
    if ('board' in req.query) match.board = req.query.board ?? '';
    applyProductCategoryQuery(req.query, match);
    const { total, topicsCount, toolGroups } = await getCombinedMetaStats(match);
    res.json({
      success: true,
      data: {
        total,
        topicsCount,
        nextLevel: 'classLabel',
        items: toolGroups,
      },
    });
  } catch (error) {
    console.error('getAiToolGenerationsBootstrap error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Product tracks for the AI Tool Data category filter.
 * Configured tracks are always listed (even at zero) so an admin can confirm a
 * track is empty; tracks only present in stored data are appended.
 */
export const listAiToolGenerationCategories = async (req, res) => {
  try {
    const match = {};
    if ('board' in req.query) match.board = req.query.board ?? '';

    const [groups, legacyCount, activeCodes] = await Promise.all([
      AiToolGeneration.aggregate([
        { $match: buildMasterMongoFilter(match) },
        { $group: { _id: { $ifNull: ['$productCategory', ''] }, count: { $sum: 1 } } },
      ]),
      AIGeneratorRecord.countDocuments(buildLegacyMongoFilter(match)),
      import('../constants/products.js')
        .then((m) => m.getActiveProductCategoryCodes())
        .catch(() => []),
    ]);

    const counts = new Map([['', legacyCount || 0]]);
    for (const code of Array.isArray(activeCodes) ? activeCodes : []) {
      const value = normalizeTopicProductCategory(code) ?? '';
      if (value) counts.set(value, counts.get(value) || 0);
    }
    for (const group of groups) {
      const value = normalizeTopicProductCategory(group._id) ?? '';
      counts.set(value, (counts.get(value) || 0) + group.count);
    }

    const items = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => {
        if (a.value === '') return -1;
        if (b.value === '') return 1;
        return a.value.localeCompare(b.value);
      });

    res.json({ success: true, data: { items } });
  } catch (error) {
    console.error('listAiToolGenerationCategories error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Section gap summaries — one scan for all tools, or single tool when toolName is set. */
export const getToolSectionGapSummaryHandler = async (req, res) => {
  try {
    const scope = {};
    if ('board' in req.query) scope.board = req.query.board ?? '';
    if (req.query.limit) scope.limit = req.query.limit;

    const toolName = String(req.query.toolName || '').trim();
    const bypassCache = req.query.refresh === '1';

    if (toolName) {
      scope.toolName = toolName;
      const data = await getToolSectionGapSummary(scope);
      return res.json({ success: true, data });
    }

    const data = await getSectionGapSummariesByTool(scope, { bypassCache });
    res.json({ success: true, data });
  } catch (error) {
    console.error('getToolSectionGapSummaryHandler error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** List near-duplicate AI Tool Data groups for Super Admin review. */
export const listAiToolDuplicates = async (req, res) => {
  try {
    const { findAiToolDuplicateGroups } = await import('../services/ai-tool-duplicates-service.js');
    const data = await findAiToolDuplicateGroups({
      toolName: req.query.toolName,
      board: req.query.board,
      classLabel: req.query.classLabel,
      subject: req.query.subject,
      limit: req.query.limit,
      threshold: req.query.threshold ? Number(req.query.threshold) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('listAiToolDuplicates error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Merge duplicates: keep primary, archive selected duplicates.
 * Body: { primaryId, duplicateIds: string[] }
 */
export const mergeAiToolDuplicatesHandler = async (req, res) => {
  try {
    const { mergeAiToolDuplicates } = await import('../services/ai-tool-duplicates-service.js');
    const primaryId = String(req.body?.primaryId || '').trim();
    const duplicateIds = Array.isArray(req.body?.duplicateIds) ? req.body.duplicateIds : [];
    const mergedBy =
      req.user?.email || req.user?.id || req.user?._id || req.userId || 'super-admin';

    const data = await mergeAiToolDuplicates({ primaryId, duplicateIds, mergedBy });
    res.json({
      success: true,
      message: `Merged ${data.archivedCount} duplicate(s) into primary record.`,
      data,
    });
  } catch (error) {
    console.error('mergeAiToolDuplicatesHandler error:', error);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

/**
 * Merge all duplicate groups (suggested primary kept in each).
 * Body optional filters: { toolName, board, classLabel, subject }
 */
export const mergeAllAiToolDuplicatesHandler = async (req, res) => {
  try {
    const { mergeAllAiToolDuplicates } = await import('../services/ai-tool-duplicates-service.js');
    const mergedBy =
      req.user?.email || req.user?.id || req.user?._id || req.userId || 'super-admin';

    const data = await mergeAllAiToolDuplicates({
      toolName: req.body?.toolName,
      board: req.body?.board,
      classLabel: req.body?.classLabel,
      subject: req.body?.subject,
      mergedBy,
    });

    const failCount = Array.isArray(data.failures) ? data.failures.length : 0;
    res.json({
      success: true,
      message:
        failCount > 0
          ? `Merged ${data.groupsMerged} group(s), archived ${data.archivedCount} extra(s). ${failCount} group(s) failed.`
          : `Merged all ${data.groupsMerged} group(s) and archived ${data.archivedCount} extra record(s).`,
      data,
    });
  } catch (error) {
    console.error('mergeAllAiToolDuplicatesHandler error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
