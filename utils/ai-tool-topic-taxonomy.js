import AiToolTopic from '../models/AiToolTopic.js';
import { boardMongoMatch } from './board-label.js';
import { buildDisplayTopicName } from './ai-tool-topic-display.js';
import {
  compareAiToolTopicRows,
  orderedUniqueSubTopics,
  orderedUniqueTopics,
} from './ai-tool-topic-order.js';
import {
  applyClassLabelMongoFilter,
  buildSubjectMongoFilter,
  mergeMongoFilters,
  normalizeMatchText,
} from './ai-tool-data-match.js';
import { normalizeIitCategoryLoose } from '../constants/products.js';

const NATURAL_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => NATURAL_COLLATOR.compare(a, b));
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
        { productCategory: { $in: ['', null] } },
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
  if (boardText) {
    filter.board = boardMongoMatch(boardText);
  }

  filter = applyProductCategoryMongoFilter(filter, productCategory);
  filter = applyClassLabelMongoFilter(filter, classLabel, boardText);

  const subjectClause = buildSubjectMongoFilter(subject);
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
  return formatAiToolTopicTaxonomy(rows);
}
