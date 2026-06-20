import AiToolTopic from '../models/AiToolTopic.js';
import { boardMongoMatch } from './board-label.js';
import { buildDisplayTopicName } from './ai-tool-topic-display.js';
import { orderedUniqueSubTopics } from './ai-tool-topic-order.js';
import {
  applyClassLabelMongoFilter,
  buildSubjectMongoFilter,
  mergeMongoFilters,
  normalizeMatchText,
} from './ai-tool-data-match.js';

const NATURAL_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => NATURAL_COLLATOR.compare(a, b));
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
  classLabel = '',
  subject = '',
  topicName = '',
} = {}) {
  let filter = { isActive: true };
  const boardText = normalizeMatchText(board);
  if (boardText) {
    filter.board = boardMongoMatch(boardText);
  }

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
    topics: uniqueSorted(rows.map((r) => buildDisplayTopicName(r.label, r.topicName))),
    subTopics: orderedUniqueSubTopics(rows),
    labels: uniqueSorted(rows.map((r) => r.label)),
  };
}

export async function queryAiToolTopicTaxonomy(params = {}) {
  const filter = buildAiToolTopicTaxonomyFilter(params);
  return AiToolTopic.find(filter)
    .select('board classLabel subject label topicName subTopic sortOrder createdAt')
    .lean();
}

/** Prefer board-scoped rows; fall back to class-only when board filter returns nothing. */
export async function resolveAiToolTopicTaxonomy(params = {}) {
  const board = normalizeMatchText(params.board);
  let rows = await queryAiToolTopicTaxonomy(params);
  if (rows.length === 0 && board) {
    rows = await queryAiToolTopicTaxonomy({ ...params, board: '' });
  }
  if (rows.length === 0 && board) {
    // Some rows store full board labels like "IIT / NEET" while UI sends "IIT".
    rows = await queryAiToolTopicTaxonomy({ ...params, board: 'IIT / NEET' });
  }
  return formatAiToolTopicTaxonomy(rows);
}
