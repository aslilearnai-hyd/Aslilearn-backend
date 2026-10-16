/**
 * DB glue for book → AI Tools curriculum mapping: loads the curriculum tree,
 * resolves a user's Topic/Subtopic selection to AiToolTopic IDs, and keeps
 * denormalised names on chunks/assets in sync when admins rename topics.
 */
import BookChunk from '../../../models/BookChunk.js';
import BookAsset from '../../../models/BookAsset.js';
import AiToolTopic from '../../../models/AiToolTopic.js';
import { queryAiToolTopicRowsForScope } from '../../shared/ai-tool-topic-taxonomy.js';
import { buildAiTopicKey, buildCurriculumTree, lexicalSimilarity, RETRIEVABLE_MAPPING_STATUSES } from './book-curriculum-mapper.js';
import { canonicalTopicKey } from '../../shared/ai-tool-topic-order.js';

function scopeParams({ board, classLabel, className, class: cls, subject, subjectName, productCategory }) {
  return {
    board: String(board || '').trim(),
    classLabel: String(classLabel || className || cls || '').trim(),
    subject: String(subject || subjectName || '').trim(),
    // undefined = "any track"; '' = General only. Books always carry a value.
    productCategory: productCategory === undefined || productCategory === null ? '' : String(productCategory),
  };
}

export async function loadCurriculumTreeForScope(scope = {}) {
  const rows = await queryAiToolTopicRowsForScope(scopeParams(scope));
  return buildCurriculumTree(rows);
}

export async function loadCurriculumTreeForBook(book = {}) {
  return loadCurriculumTreeForScope({
    board: book.board,
    classLabel: book.class,
    subject: book.subject,
    productCategory: book.productCategory || '',
  });
}

function sameText(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * Resolve a generation selection (names from the request) to DB IDs/labels.
 * Returns null when the selection does not exist in AI Tools topics, in which
 * case callers keep legacy behaviour.
 *
 * @returns {Promise<null | {
 *   aiTopicKey: string, topicName: string,
 *   aiSubtopicId: string, subtopicName: string,
 *   aiSubtopicIds: string[], subtopicNames: string[],
 * }>}
 */
export async function resolveSelectedCurriculumScope(scope = {}) {
  const topicName = String(scope.topicName || scope.topic || '').trim();
  if (!topicName) return null;
  const params = scopeParams(scope);
  let rows = await queryAiToolTopicRowsForScope({ ...params, topicName });
  if (!rows.length && params.productCategory) {
    // Some tracks reuse General topics.
    rows = await queryAiToolTopicRowsForScope({ ...params, productCategory: '', topicName });
  }
  if (!rows.length) return null;
  return resolveSelectionFromRows(rows, scope);
}

/** Pure part of resolveSelectedCurriculumScope (unit-testable). */
export function resolveSelectionFromRows(rows = [], scope = {}) {
  if (!rows.length) return null;
  // All rows share one topic key unless the DB holds duplicates across tracks;
  // prefer the requested track.
  const wantedCategory = String(scope.productCategory || '').trim().toUpperCase();
  const preferred = rows.filter((r) => String(r.productCategory || '').toUpperCase() === wantedCategory);
  const pool = preferred.length ? preferred : rows;
  const topicKey = buildAiTopicKey(pool[0]);
  const topicRows = pool.filter((r) => buildAiTopicKey(r) === topicKey);

  const subtopicName = String(scope.subtopicName || scope.subtopic || '').trim();
  const requestedList = Array.isArray(scope.subTopics) ? scope.subTopics.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const pick = (name) => topicRows.find((r) => sameText(r.subTopic, name));
  const single = subtopicName ? pick(subtopicName) : null;
  const listRows = requestedList.map(pick).filter(Boolean);

  return {
    aiTopicKey: topicKey,
    topicName: String(topicRows[0].topicName || '').trim(),
    // Missing subtopic row → '' so retrieval can fail closed instead of guessing.
    aiSubtopicId: single ? String(single._id) : '',
    subtopicName: single ? String(single.subTopic || '').trim() : '',
    subtopicRequested: Boolean(subtopicName),
    subtopicFound: Boolean(single),
    aiSubtopicIds: listRows.map((r) => String(r._id)),
    subtopicNames: listRows.map((r) => String(r.subTopic || '').trim()),
  };
}

/** True when the book (or any book in the corpus filter) has ID-mapped chunks. */
export async function hasCurriculumMappedChunks(filter = {}) {
  const doc = await BookChunk.findOne({
    ...filter,
    aiTopicKey: { $ne: '' },
    mappingStatus: { $in: RETRIEVABLE_MAPPING_STATUSES },
  })
    .select('_id')
    .lean();
  return Boolean(doc);
}

/**
 * Keep denormalised names on chunks/assets current after an AiToolTopic row is
 * edited. The row _id (= aiSubtopicId) never changes on edit, so mappings stay
 * valid; only labels and, for a topic rename, the topic key move.
 */
export async function syncCurriculumLabelsForTopicRow(before = {}, after = {}) {
  if (!after?._id) return { chunks: 0, assets: 0 };
  const id = String(after._id);
  const nextKey = buildAiTopicKey(after);
  const set = {
    aiTopicKey: nextKey,
    aiTopicName: String(after.topicName || '').trim(),
    aiSubtopicName: String(after.subTopic || '').trim(),
  };
  const [chunks, assets] = await Promise.all([
    BookChunk.updateMany({ aiSubtopicId: id }, { $set: set }),
    BookAsset.updateMany({ aiSubtopicId: id }, { $set: set }),
  ]);
  let topicLevel = 0;
  const prevKey = before?._id ? buildAiTopicKey(before) : '';
  const oldTopicStillUsed = prevKey && prevKey !== nextKey
    ? await AiToolTopic.exists({
        _id: { $ne: after._id },
        isActive: true,
        board: before.board,
        productCategory: before.productCategory || '',
        classLabel: before.classLabel,
        subject: before.subject,
        topicName: before.topicName,
      })
    : null;
  if (prevKey && prevKey !== nextKey && !oldTopicStillUsed) {
    // Topic-level (whole-chapter) chunks have no subtopic id; move them with the topic.
    const res = await BookChunk.updateMany(
      { aiTopicKey: prevKey, aiSubtopicId: '' },
      { $set: { aiTopicKey: nextKey, aiTopicName: set.aiTopicName } },
    );
    topicLevel = res.modifiedCount || 0;
  }
  return { chunks: (chunks.modifiedCount || 0) + topicLevel, assets: assets.modifiedCount || 0 };
}

function normalizedName(value = '') {
  return canonicalTopicKey(String(value || '')) || String(value || '').trim().toLowerCase();
}

/**
 * Find the user's Topic/Subtopic (by name) inside a given curriculum tree.
 * Pure; used with the BOOK's own tree so generation resolves to exactly the
 * IDs the book was mapped against, whatever board/track the form had selected.
 */
export function resolveSelectionInTree(tree, { topicName = '', subtopicName = '', subTopics } = {}) {
  const wanted = normalizedName(topicName);
  if (!tree?.topics?.length || !wanted) return null;
  let topic = tree.topics.find((t) => sameText(t.topicName, topicName))
    || tree.topics.find((t) => normalizedName(t.topicName) === wanted);
  if (!topic) {
    const scored = tree.topics
      .map((t) => ({ t, score: lexicalSimilarity(topicName, t.topicName) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0]?.score >= 0.85 && (!scored[1] || scored[0].score - scored[1].score >= 0.05)) topic = scored[0].t;
  }
  if (!topic) return null;
  const findSub = (name) => topic.subtopics.find((s) => sameText(s.name, name))
    || topic.subtopics.find((s) => normalizedName(s.name) === normalizedName(name));
  const requested = String(subtopicName || '').trim();
  const single = requested ? findSub(requested) : null;
  const list = (Array.isArray(subTopics) ? subTopics : []).map((n) => findSub(n)).filter(Boolean);
  return {
    aiTopicKey: topic.topicKey,
    topicName: topic.topicName,
    aiSubtopicId: single ? single.id : '',
    subtopicName: single ? single.name : '',
    subtopicRequested: Boolean(requested),
    subtopicFound: Boolean(single),
    aiSubtopicIds: list.map((s) => s.id),
    subtopicNames: list.map((s) => s.name),
    resolvedFrom: 'book_tree',
  };
}

/** Resolve a generation selection against the book's own curriculum tree. */
export async function resolveSelectionForBook(book, selection = {}) {
  const tree = await loadCurriculumTreeForBook(book);
  return resolveSelectionInTree(tree, selection);
}
