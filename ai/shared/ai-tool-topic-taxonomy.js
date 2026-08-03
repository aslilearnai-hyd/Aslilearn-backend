import AiToolTopic from '../../models/AiToolTopic.js';
import { boardMongoMatch, lockBoardKey } from '../../utils/board-label.js';
import { buildDisplayTopicName } from './ai-tool-topic-display.js';
import {
  compareAiToolTopicRows,
  orderedUniqueSubTopics,
  orderedUniqueTopics,
} from './ai-tool-topic-order.js';
import {
  applyClassLabelMongoFilter,
  buildHierarchyBoardMongoFilter,
  buildSubjectMongoFilter,
  buildTopicFieldMongoFilter,
  mergeMongoFilters,
  normalizeClassId,
  normalizeMatchText,
} from './ai-tool-data-match.js';
import { normalizeIitCategoryLoose } from '../../constants/products.js';

const NATURAL_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => NATURAL_COLLATOR.compare(a, b));
}

function mergeUniqueChapterLabels(primary = [], extra = []) {
  const seen = new Set();
  const out = [];
  for (const raw of [...primary, ...extra]) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => NATURAL_COLLATOR.compare(a, b));
}

/** Normalize query/storage value: '' = General. null = no filter. */
export function normalizeTopicProductCategory(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw || /^(NONE|GENERAL|__GENERAL__)$/i.test(raw)) return '';
  return normalizeIitCategoryLoose(raw) || '';
}

/** Match General (empty / missing) or a specific product category code. */
export function applyProductCategoryMongoFilter(filter, productCategory) {
  const normalized = normalizeTopicProductCategory(productCategory);
  if (normalized === null) return filter;
  if (!normalized) {
    return mergeMongoFilters(filter, {
      $or: [
        { productCategory: { $in: ['', null, 'GENERAL', 'NONE', '__GENERAL__'] } },
        { productCategory: { $exists: false } },
      ],
    });
  }
  // Legacy: early IIT generations were saved without a track and were Alpha-only.
  // When looking up ALPHA, also serve untagged (empty/missing) records.
  if (normalized === 'ALPHA') {
    return mergeMongoFilters(filter, {
      $or: [
        { productCategory: 'ALPHA' },
        { productCategory: { $in: ['', null] } },
        { productCategory: { $exists: false } },
      ],
    });
  }
  return mergeMongoFilters(filter, { productCategory: normalized });
}

/** Match topic dropdown value against stored topicName / label combinations. */
export function buildTopicNameMatchFilter(value) {
  const tn = normalizeMatchText(value);
  if (!tn) return null;
  return {
    $or: [
      { topicName: { $regex: `^${tn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      {
        $expr: {
          $eq: [
            tn,
            {
              $let: {
                vars: {
                  label: { $trim: { input: { $ifNull: ['$label', ''] } } },
                  topic: { $trim: { input: { $ifNull: ['$topicName', ''] } } },
                },
                in: {
                  $cond: {
                    if: { $eq: ['$$label', ''] },
                    then: '$$topic',
                    else: {
                      $cond: {
                        if: { $eq: [{ $indexOfCP: ['$$topic', { $concat: ['$$label', ' - '] }] }, 0] },
                        then: '$$topic',
                        else: { $concat: ['$$label', ' - ', '$$topic'] },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    ],
  };
}

export function buildAiToolTopicTaxonomyFilter({
  board = '',
  productCategory = undefined,
  classLabel = '',
  subject = '',
  topicName = '',
} = {}) {
  let filter = { isActive: true };
  const boardText = normalizeMatchText(board);
  const classText = normalizeMatchText(classLabel);

  filter = applyProductCategoryMongoFilter(filter, productCategory);

  // Avoid top-level board:/iit/ + Class 6 empty-board $or (empty rows never matched).
  if (classText) {
    filter = applyClassLabelMongoFilter(filter, classText, boardText);
    const isIitClass6 =
      lockBoardKey(boardText) === 'IIT/NEET' && normalizeClassId(classText) === 'Class 6';
    if (boardText && !isIitClass6) {
      filter = mergeMongoFilters(filter, { board: boardMongoMatch(boardText) });
    }
  } else if (boardText) {
    filter = mergeMongoFilters(
      filter,
      buildHierarchyBoardMongoFilter(boardText, {
        boardField: 'board',
        classField: 'classLabel',
      }),
    );
  }

  const subjectClause = buildSubjectMongoFilter(subject, boardText);
  if (subjectClause && Object.keys(subjectClause).length > 0) {
    filter = mergeMongoFilters(filter, subjectClause);
  }

  const topicMatch = buildTopicNameMatchFilter(topicName);
  if (topicMatch) {
    filter = mergeMongoFilters(filter, topicMatch);
  }

  return filter;
}

export function formatAiToolTopicTaxonomy(rows) {
  return {
    subjects: uniqueSorted(rows.map((r) => r.subject)),
    topics: orderedUniqueTopics(rows, (row) => buildDisplayTopicName(row.label, row.topicName)),
    subTopics: orderedUniqueSubTopics(rows),
    labels: uniqueSorted(rows.map((r) => r.label)),
    productCategories: uniqueSorted(
      rows.map((r) => normalizeIitCategoryLoose(r.productCategory)).filter(Boolean),
    ),
  };
}

/** Board-scoped tree: class → subject → topic → ordered sub-topics. */
export function buildAiToolTopicHierarchyTree(rows) {
  const sorted = [...rows].sort(compareAiToolTopicRows);
  const tree = {};

  for (const row of sorted) {
    const classLabel = String(row?.classLabel || '').trim();
    const subject = String(row?.subject || '').trim();
    const topic = buildDisplayTopicName(row?.label, row?.topicName);
    const subTopic = String(row?.subTopic || '').trim();
    if (!classLabel || !subject || !topic || !subTopic) continue;

    if (!tree[classLabel]) tree[classLabel] = {};
    if (!tree[classLabel][subject]) tree[classLabel][subject] = {};
    if (!tree[classLabel][subject][topic]) tree[classLabel][subject][topic] = [];

    const list = tree[classLabel][subject][topic];
    if (!list.includes(subTopic)) list.push(subTopic);
  }

  // Rebuild topic key order chapter-wise so Object.keys is 1,2,…10,11 (not 1,11,2).
  for (const classLabel of Object.keys(tree)) {
    for (const subject of Object.keys(tree[classLabel])) {
      const topicMap = tree[classLabel][subject];
      const topicNames = Object.keys(topicMap).sort((a, b) =>
        a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }),
      );
      const rebuilt = {};
      for (const topic of topicNames) {
        rebuilt[topic] = [...topicMap[topic]].sort((a, b) =>
          a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }),
        );
      }
      tree[classLabel][subject] = rebuilt;
    }
  }

  return tree;
}

export async function queryAiToolTopicTaxonomy(params = {}) {
  const filter = buildAiToolTopicTaxonomyFilter(params);
  const rows = await AiToolTopic.find(filter)
    .select('board productCategory classLabel subject label topicName subTopic sortOrder createdAt')
    .sort({ sortOrder: 1, createdAt: 1, _id: 1 })
    .lean();
  return rows;
}

/** Prefer board-scoped rows; try board label aliases only — never drop board filter. */
export async function resolveAiToolTopicTaxonomy(params = {}) {
  const board = normalizeMatchText(params.board);
  let rows = await queryAiToolTopicTaxonomy(params);
  if (rows.length === 0 && board) {
    const compact = board.toUpperCase().replace(/[\s/\\-]+/g, '');
    if (compact.includes('IIT') || compact.includes('NEET') || compact.includes('JEE')) {
      for (const alias of ['IIT / NEET', 'IIT/NEET', 'IIT', 'NEET']) {
        rows = await queryAiToolTopicTaxonomy({ ...params, board: alias });
        if (rows.length > 0) break;
      }
    } else if (compact === 'CBSE' || compact === 'CBSC') {
      rows = await queryAiToolTopicTaxonomy({ ...params, board: 'CBSE' });
    }
  }

  const formatted = formatAiToolTopicTaxonomy(rows);
  const classLabel = normalizeMatchText(params.classLabel);
  const subject = normalizeMatchText(params.subject);
  const topicName = normalizeMatchText(params.topicName);

  // Union chapters/subtopics that already have AiToolGeneration rows so tools
  // still list content when AI Tool Topics seed is incomplete.
  if (classLabel && subject) {
    try {
      const fromGenerations = await distinctTopicsFromGenerations({
        board,
        productCategory: params.productCategory,
        classLabel,
        subject,
        topicName,
      });
      if (topicName) {
        formatted.subTopics = mergeUniqueChapterLabels(
          formatted.subTopics,
          fromGenerations.subTopics,
        );
      } else {
        formatted.topics = mergeUniqueChapterLabels(formatted.topics, fromGenerations.topics);
      }
      formatted.subjects = mergeUniqueChapterLabels(formatted.subjects, fromGenerations.subjects);
    } catch (err) {
      console.warn(
        '[ai-tool-topic-taxonomy] generation union skipped:',
        String(err?.message || err).slice(0, 200),
      );
    }
  }

  // Union NCERT / hardcoded curriculum chapters so AI Generator topic dropdowns
  // are not empty when AiToolTopic seed is missing for CBSE Class 6–10, etc.
  try {
    const compactBoard = String(board || '')
      .toUpperCase()
      .replace(/[\s/\\-]+/g, '');
    const isIitBoard =
      compactBoard.includes('IIT') || compactBoard.includes('NEET') || compactBoard.includes('JEE');
    const classNumMatch = String(classLabel || '').match(/(\d+)/);
    const classNum = classNumMatch ? parseInt(classNumMatch[1], 10) : NaN;
    const classKey =
      isIitBoard && normalizeClassId(classLabel) === 'Class 6'
        ? 'IIT-6'
        : Number.isFinite(classNum) && classNum >= 5 && classNum <= 10
          ? String(classNum)
          : '';

    if (classKey) {
      const {
        getChaptersForSubject,
        getSubtopicsForChapter,
        getSubjectsForClass,
      } = await import('../../services/hardcoded-content-service.js');

      if (!subject) {
        const subjects = await getSubjectsForClass(classKey);
        formatted.subjects = mergeUniqueChapterLabels(formatted.subjects, subjects);
      } else if (topicName) {
        const subs = await getSubtopicsForChapter(classKey, subject, topicName);
        formatted.subTopics = mergeUniqueChapterLabels(formatted.subTopics, subs);
      } else {
        const chapters = await getChaptersForSubject(classKey, subject);
        const chapterNames = chapters
          .map((row) => String(row?.chapterName || '').trim())
          .filter(Boolean);
        formatted.topics = mergeUniqueChapterLabels(formatted.topics, chapterNames);
      }
    }
  } catch (err) {
    console.warn(
      '[ai-tool-topic-taxonomy] hardcoded curriculum union skipped:',
      String(err?.message || err).slice(0, 200),
    );
  }

  return formatted;
}

async function distinctTopicsFromGenerations({
  board = '',
  productCategory,
  classLabel,
  subject,
  topicName = '',
}) {
  const AiToolGeneration = (await import('../../models/AiToolGeneration.js')).default;
  const boardText = normalizeMatchText(board);
  const classText = normalizeMatchText(classLabel);
  const subjectText = normalizeMatchText(subject);

  let filter = {
    status: { $nin: ['archived', 'inactive', 'deleted'] },
  };
  filter = applyClassLabelMongoFilter(filter, classText, boardText);
  const isIitClass6 =
    lockBoardKey(boardText) === 'IIT/NEET' && normalizeClassId(classText) === 'Class 6';
  if (boardText && !isIitClass6) {
    filter = mergeMongoFilters(filter, { board: boardMongoMatch(boardText) });
  }
  filter = mergeMongoFilters(filter, buildSubjectMongoFilter(subjectText, boardText));
  filter = applyProductCategoryMongoFilter(filter, productCategory);

  if (topicName) {
    filter = mergeMongoFilters(filter, buildTopicFieldMongoFilter(topicName));
    const subTopics = (await AiToolGeneration.distinct('subtopic', filter))
      .map((v) => String(v || '').trim())
      .filter(Boolean);
    return { topics: [], subTopics, subjects: [] };
  }

  const [topics, subjects] = await Promise.all([
    AiToolGeneration.distinct('topic', filter),
    AiToolGeneration.distinct('subject', filter),
  ]);

  return {
    topics: topics.map((v) => String(v || '').trim()).filter(Boolean),
    subTopics: [],
    subjects: subjects.map((v) => String(v || '').trim()).filter(Boolean),
  };
}
