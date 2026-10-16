import BookChunk from '../../../models/BookChunk.js';
import Book from '../../../models/Book.js';
import { generateEmbedding } from '../pdf/pdf-rag-service.js';
import {
  cosineSimilarity,
  retrievalTier,
  selectDiverseBookChunks,
} from './book-rag-ranking.js';
import {
  buildApprovedAssetMultimodalParts,
  formatBookAssetsForPrompt,
  retrieveApprovedBookAssets,
} from './book-multimodal-service.js';
import { findScopeMismatches, RETRIEVABLE_MAPPING_STATUSES } from './book-curriculum-mapper.js';
import { hasCurriculumMappedChunks, resolveSelectedCurriculumScope, resolveSelectionForBook } from './book-curriculum-service.js';

const DEFAULT_TOP_K = Number(process.env.BOOK_RAG_TOP_K || process.env.RAG_TOP_K || 4);
const DEFAULT_CANDIDATE_K = Number(process.env.BOOK_RAG_CANDIDATE_K || 16);
const DEFAULT_WHOLE_CHAPTER_TOP_K = Number(process.env.BOOK_RAG_WHOLE_CHAPTER_TOP_K || 6);
export function getBookRagMaxContextChars(audience = '') {
  const isStudent = String(audience || '').trim().toLowerCase() === 'student';
  const audienceEnv = Number(
    isStudent
      ? process.env.BOOK_RAG_STUDENT_MAX_CONTEXT_CHARS
      : process.env.BOOK_RAG_TEACHER_MAX_CONTEXT_CHARS,
  );
  if (Number.isFinite(audienceEnv) && audienceEnv > 0) return audienceEnv;
  const env = Number(process.env.BOOK_RAG_MAX_CONTEXT_CHARS);
  // Student tools need precise grounding, but not a long teacher reference
  // packet. Four focused passages fit safely in 6.5k characters.
  if (isStudent) return Number.isFinite(env) && env > 0 ? Math.min(env, 6500) : 6500;
  if (Number.isFinite(env) && env > 0) return env;
  const costSaver =
    String(process.env.AI_GENERATOR_COST_SAVER ?? 'false').trim().toLowerCase() !== 'false' &&
    String(process.env.AI_GENERATOR_COST_SAVER ?? 'false').trim().toLowerCase() !== '0';
  return costSaver ? 10000 : 18000;
}

function normalizeSpaces(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Store embedding vector on a book chunk document.
 */
export async function storeEmbedding(chunkId, text) {
  const { embedding, embeddingModel } = await generateEmbedding(text);
  await BookChunk.updateOne(
    { _id: chunkId },
    { $set: { embedding, embeddingModel, content: String(text || '').trim() } },
  );
  return { embedding, embeddingModel };
}

/** Update embedding for an existing chunk. */
export async function updateEmbedding(chunkId, text) {
  return storeEmbedding(chunkId, text);
}

/** Remove all chunk embeddings for a book. */
export async function deleteEmbedding(bookId) {
  const result = await BookChunk.deleteMany({ bookId });
  return { deletedCount: result.deletedCount || 0 };
}

/**
 * Vector search over BookChunk collection (MongoDB-stored embeddings).
 * @param {{ query: string, bookId?: string, board?: string, class?: string, subject?: string, chapter?: string, topic?: string, subtopic?: string, topK?: number }}
 */
function getBookRagCandidateLimit(bookId) {
  const env = Number(process.env.BOOK_RAG_CANDIDATE_LIMIT);
  if (Number.isFinite(env) && env > 0) return Math.min(2000, Math.floor(env));
  return bookId ? 600 : 2000;
}

export async function searchRelevantChunks({
  query,
  bookId,
  board,
  class: classLabel,
  subject,
  chapter,
  topic,
  subtopic,
  corpusId,
  difficultyBand,
  aiTopicKey,
  aiSubtopicId,
  aiSubtopicIds,
  topK = DEFAULT_TOP_K,
  queryEmbedding: queryEmbeddingInput = null,
}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const filter = {};
  // Curriculum IDs are hard constraints; embeddings only rank inside them.
  if (aiTopicKey || aiSubtopicId || (Array.isArray(aiSubtopicIds) && aiSubtopicIds.length)) {
    filter.mappingStatus = { $in: RETRIEVABLE_MAPPING_STATUSES };
    if (aiTopicKey) filter.aiTopicKey = aiTopicKey;
    if (aiSubtopicId) filter.aiSubtopicId = aiSubtopicId;
    else if (Array.isArray(aiSubtopicIds) && aiSubtopicIds.length) filter.aiSubtopicId = { $in: aiSubtopicIds };
  }
  if (bookId) filter.bookId = bookId;
  if (board) filter.board = board;
  if (classLabel) filter.class = classLabel;
  if (subject) filter.subject = subject;
  if (chapter) filter.chapter = chapter;
  if (topic) filter.topic = topic;
  if (subtopic) filter.subtopic = subtopic;
  if (corpusId) filter.corpusId = corpusId;
  if (difficultyBand) filter.difficultyBand = difficultyBand;
  // Legacy chunks predate approvalStatus; keep them available until reindexed,
  // while excluding explicitly rejected/archived sources.
  filter.approvalStatus = { $nin: ['rejected', 'archived'] };

  const queryEmbedding = Array.isArray(queryEmbeddingInput) && queryEmbeddingInput.length
    ? queryEmbeddingInput
    : (await generateEmbedding(q)).embedding;
  const candidates = await BookChunk.find(filter).select(
    'content embedding embeddingModel chapter topic subtopic chunkIndex bookId subject class board corpusId sourcePriority sourceType difficultyBand approvalStatus assetIds sourcePage aiTopicKey aiTopicName aiSubtopicId aiSubtopicName mappingStatus mappingConfidence sourcePageStart sourcePageEnd',
  ).limit(getBookRagCandidateLimit(bookId)).lean();

  return candidates
    .map((c) => ({
      ...c,
      chunkText: c.content,
      rawScore: cosineSimilarity(queryEmbedding, c.embedding || []),
      score: cosineSimilarity(queryEmbedding, c.embedding || []),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, topK)));
}

/**
 * Format retrieved chunks for Gemini prompt injection (textbook-primary source).
 */
export function formatBookContextForPrompt(chunks = [], meta = {}) {
  if (!Array.isArray(chunks) || !chunks.length) return '';

  const header = [
    '<<<TEXTBOOK_INSTRUCTIONS>>>',
    'TEXTBOOK CONTENT (PRIMARY SOURCE — use this as the main factual basis):',
    'Priority: (1) Uploaded Book  (2) Uploaded Notes  (3) General knowledge only when the book is silent.',
    'Use terminology, definitions, formulae, and examples from the passages below only.',
    '<<<END_TEXTBOOK_INSTRUCTIONS>>>',
    meta.bookTitle ? `Book: ${meta.bookTitle}` : '',
    meta.subject ? `Subject: ${meta.subject}` : '',
    meta.class ? `Class: ${meta.class}` : '',
  ].filter(Boolean).join('\n');

  const blocks = [];
  let used = 0;
  const maxContextChars = getBookRagMaxContextChars(meta.audience);
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    const label = (c.aiTopicName
      ? [c.aiTopicName, c.aiSubtopicName]
      : [c.chapter, c.topic, c.subtopic]
    ).filter(Boolean).join(' › ') || `Passage ${i + 1}`;
    const sourceId = String(c._id || c.chunkId || '').trim();
    const sourceTag = sourceId ? ` | sourceChunkId=${sourceId}` : '';
    const block = `[${i + 1}] (${label}${sourceTag})\n${normalizeSpaces(c.content || c.chunkText || '')}`;
    if (used + block.length > maxContextChars) {
      // Never return an ungrounded prompt just because one stored chunk is
      // unusually large. Keep the start of the highest-ranked passage.
      if (blocks.length === 0) blocks.push(block.slice(0, maxContextChars));
      break;
    }
    blocks.push(block);
    used += block.length;
  }

  return `${header}\n\n${blocks.join('\n\n')}`;
}

/** Build retrieval query from generation scope. */
export function buildBookRetrievalQuery(scope = {}) {
  return [
    scope.board,
    scope.className || scope.classLabel || scope.class,
    scope.subjectName || scope.subject,
    scope.topicName || scope.topic,
    scope.subtopicName || scope.subtopic,
  ].filter(Boolean).join(' — ');
}

function buildCurriculumTargetBlock(scope = {}) {
  const hasSubtopic = Boolean(String(scope.subtopicName || scope.subtopic || '').trim());
  const subTopicList = Array.isArray(scope.subTopics)
    ? scope.subTopics.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const lines = [
    'USER-SELECTED CURRICULUM (generate content for this exact scope):',
    scope.board ? `Board: ${scope.board}` : '',
    scope.className || scope.classLabel || scope.class ? `Class: ${scope.className || scope.classLabel || scope.class}` : '',
    scope.subjectName || scope.subject ? `Subject: ${scope.subjectName || scope.subject}` : '',
    scope.topicName || scope.topic ? `Topic / Chapter: ${scope.topicName || scope.topic}` : '',
    hasSubtopic
      ? `Sub-topic: ${scope.subtopicName || scope.subtopic}`
      : subTopicList.length > 1
        ? `Subtopics (COMBINED — cover ALL): ${subTopicList.join(' | ')}`
        : 'Scope: WHOLE CHAPTER — cover the full Topic/Chapter fairly across sections (not one narrow sub-topic only).',
    scope.toolSlug || scope.toolName ? `Tool: ${scope.toolSlug || scope.toolName}` : '',
    hasSubtopic
      ? 'Use the textbook passages below as the PRIMARY source. Every question and explanation must stay on this sub-topic.'
      : 'Use the textbook passages below as the PRIMARY source. Distribute questions across the major ideas in this chapter.',
    'Ask directly about definitions, formulas, numericals, and explanations from the book — no scenario or role-play framing.',
  ].filter(Boolean);
  return lines.join('\n');
}

function topicMatchTokens(value = '') {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);
}

function metadataMatchBonus(chunk = {}, scope = {}) {
  let bonus = 0;
  const board = String(scope.board || '').trim().toLowerCase();
  const subject = String(scope.subjectName || scope.subject || '').trim().toLowerCase();
  const classLabel = String(scope.className || scope.classLabel || scope.class || '').trim().toLowerCase();
  const topic = String(scope.topicName || scope.topic || '').trim().toLowerCase();
  const subtopic = String(scope.subtopicName || scope.subtopic || '').trim().toLowerCase();
  const content = String(chunk.content || chunk.chunkText || '').toLowerCase();

  if (board && String(chunk.board || '').trim().toLowerCase() === board) bonus += 0.04;
  if (subject && String(chunk.subject || '').trim().toLowerCase().includes(subject)) bonus += 0.05;
  if (classLabel) {
    const chunkClass = String(chunk.class || '').trim().toLowerCase();
    const classDigits = classLabel.match(/\d+/)?.[0] || '';
    if (chunkClass === classLabel || (classDigits && chunkClass.includes(classDigits))) bonus += 0.04;
  }
  if (topic && (content.includes(topic) || String(chunk.topic || '').toLowerCase().includes(topic))) bonus += 0.08;
  if (subtopic && (content.includes(subtopic) || String(chunk.subtopic || '').toLowerCase().includes(subtopic))) {
    bonus += 0.12;
  }
  // Lower sourcePriority numbers represent more authoritative curriculum
  // sources (for example, textbook before coaching notes/question banks).
  const sourcePriority = Number(chunk.sourcePriority);
  if (Number.isFinite(sourcePriority) && sourcePriority > 0) {
    bonus += Math.max(0, 0.06 - Math.min(sourcePriority, 100) * 0.0006);
  }
  const sourcePreferences = Array.isArray(scope.sourceTypePreference)
    ? scope.sourceTypePreference.map((value) => String(value || '').trim().toLowerCase())
    : [];
  const sourceType = String(chunk.sourceType || '').trim().toLowerCase();
  const sourceIndex = sourcePreferences.indexOf(sourceType);
  if (sourceIndex >= 0) bonus += Math.max(0.01, 0.05 - sourceIndex * 0.01);
  for (const token of [...new Set([...topicMatchTokens(topic), ...topicMatchTokens(subtopic)])]) {
    if (content.includes(token)) bonus += 0.05;
  }
  return bonus;
}

function rerankBookChunks(chunks = [], scope = {}, topK = DEFAULT_TOP_K) {
  return [...chunks]
    .map((chunk) => ({
      ...chunk,
      score: Number(chunk.score || 0) + metadataMatchBonus(chunk, scope),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, topK)));
}

export { rerankBookChunks, metadataMatchBonus };

export function canUseWeakSelectedBookChunks(scope = {}, candidateChunks = []) {
  return Boolean(scope.bookId) && candidateChunks.some(
    (chunk) => String(chunk?.content || '').trim().length >= 80,
  );
}

/**
 * Search a selected book strictly first, then tolerate legacy chunk metadata.
 *
 * Older books can have valid embeddings/content while their chunks predate the
 * normalized board/class/subject fields. An explicit bookId already provides a
 * hard corpus boundary, so retrying that same book without metadata filters is
 * safe. Never apply this fallback to corpus-wide retrieval.
 */
export async function searchSelectedBookWithLegacyMetadataFallback({
  bookId,
  strictScope = {},
  search,
}) {
  const strictChunks = await search(strictScope);
  if (strictChunks.length || !bookId) {
    return { chunks: strictChunks, usedLegacyMetadataFallback: false };
  }

  const legacyChunks = await search({});
  return {
    chunks: legacyChunks,
    usedLegacyMetadataFallback: legacyChunks.length > 0,
  };
}

function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

function isRequestedSubtopicList(scope = {}) {
  return Array.isArray(scope.subTopics) && scope.subTopics.filter((s) => String(s || '').trim()).length > 1;
}

/**
 * Decide how to retrieve for this scope:
 * - strict  → book/corpus is curriculum-mapped; hard-filter by AI Tools IDs.
 * - legacy  → nothing mapped yet (pre-migration books); old behaviour.
 * - blocked → fail closed before any embedding/Gemini call.
 */
export async function resolveCurriculumRetrievalRoute(scope = {}, deps = {}) {
  const hasMapped = deps.hasMapped || hasCurriculumMappedChunks;
  const resolveSelection = deps.resolveSelection || (async (s) => {
    if (!s.bookId) return resolveSelectedCurriculumScope(s);
    const book = await Book.findById(s.bookId).select('board class subject productCategory').lean();
    return book ? resolveSelectionForBook(book, s) : null;
  });
  if (!envFlag('BOOK_RAG_CURRICULUM_ID_FILTER', true)) return { mode: 'legacy', reason: 'id_filter_disabled' };
  const requireMapping = envFlag('BOOK_RAG_REQUIRE_CURRICULUM_MAPPING', false);

  const mappedFilter = scope.bookId
    ? { bookId: scope.bookId }
    : {
        board: scope.board,
        class: scope.className || scope.classLabel || scope.class,
        subject: scope.subjectName || scope.subject,
      };
  const mapped = await hasMapped(mappedFilter).catch(() => false);
  if (!mapped) {
    return requireMapping
      ? { mode: 'blocked', status: 'curriculum_unmapped', reason: 'book_not_mapped' }
      : { mode: 'legacy', reason: 'book_not_mapped' };
  }

  const curriculum = scope.curriculum !== undefined
    ? scope.curriculum
    : await resolveSelection(scope).catch(() => null);
  if (!curriculum?.aiTopicKey) {
    return requireMapping
      ? { mode: 'blocked', status: 'curriculum_scope_unknown', reason: 'selection_not_in_curriculum' }
      : { mode: 'legacy', reason: 'selection_not_in_curriculum' };
  }

  const subtopicName = String(scope.subtopicName || scope.subtopic || '').trim();
  if (subtopicName) {
    if (!curriculum.aiSubtopicId) {
      // The chapter is known but this subtopic name is not in the book's
      // curriculum: use that chapter's passages, ranked for the subtopic.
      const invariant = { aiTopicKey: curriculum.aiTopicKey };
      return { mode: 'strict', filter: invariant, invariant, curriculum, fallback: 'topic', reason: 'subtopic_not_in_book_curriculum' };
    }
    const invariant = { aiTopicKey: curriculum.aiTopicKey, aiSubtopicId: curriculum.aiSubtopicId };
    return { mode: 'strict', filter: invariant, invariant, curriculum };
  }
  if (isRequestedSubtopicList(scope)) {
    const ids = curriculum.aiSubtopicIds || [];
    if (!ids.length) {
      // None of the selected names is in the book's curriculum: use the chapter.
      const invariant = { aiTopicKey: curriculum.aiTopicKey };
      return { mode: 'strict', filter: invariant, invariant, curriculum, fallback: 'topic', reason: 'subtopics_not_in_book_curriculum' };
    }
    return {
      mode: 'strict',
      filter: { aiTopicKey: curriculum.aiTopicKey, aiSubtopicIds: ids },
      invariant: { aiTopicKey: curriculum.aiTopicKey },
      curriculum,
    };
  }
  // Whole chapter: every chunk mapped to the topic, including topic-level ones.
  const invariant = { aiTopicKey: curriculum.aiTopicKey };
  return { mode: 'strict', filter: invariant, invariant, curriculum };
}

/**
 * Effective mapping status: "ready" only when the stored status is ready AND
 * most curriculum subtopics actually have text (a book whose headings do not
 * match the AI Tools topics can map 0/28 subtopics yet report "ready").
 */
export async function bookMappingStatus(bookId, deps = {}) {
  try {
    const book = deps.book || await Book.findById(bookId)
      .select('curriculumMapping.status curriculumMapping.mappedSubtopics curriculumMapping.totalSubtopics')
      .lean();
    const m = book?.curriculumMapping || {};
    const status = m.status || 'not_mapped';
    if (status !== 'ready') return status;
    const total = Number(m.totalSubtopics) || 0;
    const mapped = Number(m.mappedSubtopics) || 0;
    const minRatio = Number(process.env.BOOK_MAPPING_READY_MIN_SUBTOPIC_RATIO) || 0.8;
    return total > 0 && mapped / total < minRatio ? 'needs_review' : 'ready';
  } catch {
    return 'unknown';
  }
}

function emptyCurriculumResult(scope, query, route = {}) {
  return {
    chunks: [],
    candidateChunks: [],
    contextText: buildCurriculumTargetBlock(scope),
    chunkCount: 0,
    hasBookPassages: false,
    retrievalQuery: query,
    retrievalStatus: route.status || 'rag_scope_empty',
    retrievalTier: 'weak',
    curriculumMode: route.mode === 'blocked' ? 'blocked' : route.mode || 'strict',
    curriculumReason: route.reason || route.status || '',
    curriculum: route.curriculum || null,
    sourceChunkIds: [],
    assets: [],
    multimodalParts: [],
    sourceAssetIds: [],
  };
}

export async function retrieveBookContextForGeneration(scope = {}) {
  const query = buildBookRetrievalQuery(scope);
  const isWholeChapter = !String(scope.subtopicName || scope.subtopic || '').trim();
  const topK = Number(scope.topK) || (isWholeChapter ? DEFAULT_WHOLE_CHAPTER_TOP_K : DEFAULT_TOP_K);
  const candidateK = Math.max(topK, Math.min(20, Number(scope.candidateK) || DEFAULT_CANDIDATE_K));

  if (!scope.bookId) {
    const required = [
      scope.board,
      scope.className || scope.classLabel || scope.class,
      scope.subjectName || scope.subject,
    ];
    if (required.some((value) => !String(value || '').trim())) {
      const curriculumBlock = buildCurriculumTargetBlock(scope);
      return {
        chunks: [],
        candidateChunks: [],
        contextText: curriculumBlock,
        chunkCount: 0,
        hasBookPassages: false,
        retrievalQuery: query,
        retrievalStatus: 'insufficient_scope',
        retrievalTier: 'weak',
      };
    }
  }

  // Route before embedding the query: a blocked scope must not spend a call.
  let curriculumRoute = await resolveCurriculumRetrievalRoute(scope);
  if (curriculumRoute.mode === 'blocked') {
    return emptyCurriculumResult(scope, query, curriculumRoute);
  }
  const { embedding: queryEmbedding } = await generateEmbedding(query);

  const baseSearch = (extra = {}) =>
    searchRelevantChunks({
      query,
      queryEmbedding,
      bookId: scope.bookId,
      corpusId: scope.corpusId,
      difficultyBand: scope.difficultyBand,
      topK: candidateK,
      ...extra,
    });

  let candidateChunks;
  let chunks;
  let scoreTier;
  let bestRawScore;
  let weakContextFallbackUsed = false;
  let usedLegacyMetadataFallback = false;

  if (curriculumRoute.mode === 'strict') {
    // ID-first: only chunks mapped to the selected Topic/Subtopic are eligible;
    // similarity just orders them. No broadening to neighbouring subtopics.
    const scoped = await baseSearch(curriculumRoute.filter);
    candidateChunks = rerankBookChunks(scoped, scope, candidateK);
    bestRawScore = Math.max(0, ...candidateChunks.map((chunk) => Number(chunk.rawScore) || 0));
    scoreTier = retrievalTier(bestRawScore, {
      strong: process.env.BOOK_RAG_STRONG_SCORE,
      acceptable: process.env.BOOK_RAG_ACCEPTABLE_SCORE,
    });
    chunks = selectDiverseBookChunks(candidateChunks, topK, {
      lambda: process.env.BOOK_RAG_MMR_LAMBDA,
      coveragePenalty: isWholeChapter ? 0.1 : 0.04,
    });
    // Subtopic has no mapped text in this book: use the same chapter's
    // passages ranked for the subtopic. Never broadens past the chapter.
    // No text carries this subtopic's own heading. Books often teach it inside
    // a neighbouring section (e.g. "Ecological Pyramids" inside "Flow of
    // Energy"), so use the same chapter's passages ranked for the subtopic.
    // Never broadens past the chapter.
    const mappingStatus = !chunks.length && scope.bookId ? await bookMappingStatus(scope.bookId) : 'ready';
    const subtopicScoped = Boolean(curriculumRoute.filter.aiSubtopicId || curriculumRoute.filter.aiSubtopicIds?.length);
    if (!chunks.length && subtopicScoped && envFlag('BOOK_RAG_SUBTOPIC_TOPIC_FALLBACK', true)) {
      const topicScoped = await baseSearch({ aiTopicKey: curriculumRoute.curriculum.aiTopicKey });
      candidateChunks = rerankBookChunks(topicScoped, scope, candidateK);
      chunks = selectDiverseBookChunks(candidateChunks, topK, {
        lambda: process.env.BOOK_RAG_MMR_LAMBDA,
        coveragePenalty: 0.04,
      });
      if (chunks.length) {
        curriculumRoute = {
          ...curriculumRoute,
          invariant: { aiTopicKey: curriculumRoute.curriculum.aiTopicKey },
          fallback: 'topic',
        };
        bestRawScore = Math.max(0, ...candidateChunks.map((chunk) => Number(chunk.rawScore) || 0));
      }
    }
    if (!chunks.length) {
      // A book whose mapping is incomplete must not lose generation it had
      // before mapping existed: fall back to the old book-wide search. Only a
      // fully mapped ("ready") book fails closed.
      if (mappingStatus === 'ready' || !envFlag('BOOK_RAG_INCOMPLETE_MAPPING_LEGACY_FALLBACK', true)) {
        return emptyCurriculumResult(scope, query, { ...curriculumRoute, status: 'rag_scope_empty' });
      }
      curriculumRoute = { mode: 'legacy', reason: `mapping_${mappingStatus}_no_scope_content`, curriculum: curriculumRoute.curriculum };
    }
  }
  if (curriculumRoute.mode === 'strict') {
    const mismatches = findScopeMismatches([...candidateChunks, ...chunks], curriculumRoute.invariant);
    if (mismatches.length) {
      console.error('[book-rag] RAG_SCOPE_MISMATCH', {
        expected: curriculumRoute.invariant,
        chunkIds: mismatches.map((c) => String(c._id || '')),
      });
      return emptyCurriculumResult(scope, query, { ...curriculumRoute, status: 'rag_scope_mismatch' });
    }
  } else {
    // Formal exam mode fails closed: never broaden from the selected curriculum
    // to subject-only or unfiltered chunks.
    const scopedSearch = await searchSelectedBookWithLegacyMetadataFallback({
      bookId: scope.bookId,
      strictScope: {
        board: scope.board,
        class: scope.className || scope.classLabel || scope.class,
        subject: scope.subjectName || scope.subject,
      },
      search: baseSearch,
    });
    candidateChunks = rerankBookChunks(
      scopedSearch.chunks,
      scope,
      candidateK,
    );

    bestRawScore = Math.max(0, ...candidateChunks.map((chunk) => Number(chunk.rawScore) || 0));
    scoreTier = retrievalTier(bestRawScore, {
      strong: process.env.BOOK_RAG_STRONG_SCORE,
      acceptable: process.env.BOOK_RAG_ACCEPTABLE_SCORE,
    });
    const allowWeak = String(process.env.BOOK_RAG_ALLOW_WEAK_CONTEXT || 'false').toLowerCase() === 'true';
    // An explicitly selected book is already a hard corpus boundary. If vector
    // similarity is weak (common for "Whole chapter" or translated labels), use
    // the best passages from that book instead of failing before the first model
    // call. Corpus-wide retrieval still fails closed.
    const allowSelectedBookFallback = canUseWeakSelectedBookChunks(scope, candidateChunks);
    weakContextFallbackUsed = scoreTier === 'weak' && !allowWeak && allowSelectedBookFallback;
    chunks = scoreTier === 'weak' && !allowWeak && !allowSelectedBookFallback
      ? []
      : selectDiverseBookChunks(candidateChunks, topK, {
          lambda: process.env.BOOK_RAG_MMR_LAMBDA,
          coveragePenalty: isWholeChapter ? 0.1 : 0.04,
        });
    usedLegacyMetadataFallback = scopedSearch.usedLegacyMetadataFallback;
  }
  const multimodalEnabled = String(process.env.BOOK_MULTIMODAL_RAG ?? 'true').toLowerCase() !== 'false';
  const assets = multimodalEnabled
    ? await retrieveApprovedBookAssets(
        { ...scope, curriculumFilter: curriculumRoute.mode === 'strict' ? curriculumRoute.invariant : null },
        Number(scope.assetK) || 4,
      )
    : [];
  const needsVisualInput = scope.visualRequired === true || assets.some((asset) =>
    ['figure', 'graph', 'table', 'chemical_structure'].includes(String(asset.type || '')),
  );
  const multimodalParts = multimodalEnabled && needsVisualInput
    ? await buildApprovedAssetMultimodalParts({
        bookId: scope.bookId,
        assets,
        maxPages: Number(scope.maxVisualPages) || 2,
      }).catch((error) => {
        console.warn('[book-rag] approved visual source loading failed:', error?.message || error);
        return [];
      })
    : [];

  const bookContext = formatBookContextForPrompt(chunks, {
    bookTitle: scope.bookTitle,
    subject: scope.subjectName || scope.subject,
    class: scope.className || scope.class,
    audience: scope.audience,
  });
  const curriculumBlock = buildCurriculumTargetBlock(scope);
  const assetContext = formatBookAssetsForPrompt(assets);
  const contextText = [curriculumBlock, bookContext, assetContext].filter(Boolean).join('\n\n');
  return {
    chunks,
    candidateChunks,
    contextText,
    chunkCount: chunks.length,
    hasBookPassages: chunks.length > 0,
    retrievalQuery: query,
    retrievalStatus: chunks.length
      ? curriculumRoute.fallback === 'topic'
        ? 'ready_topic_fallback'
        : weakContextFallbackUsed
          ? 'ready_selected_book_fallback'
          : 'ready'
      : candidateChunks.length
        ? 'weak_context'
        : 'no_context',
    retrievalTier: scoreTier,
    bestScore: bestRawScore,
    weakContextFallbackUsed,
    usedLegacyMetadataFallback,
    curriculumMode: curriculumRoute.mode,
    curriculumReason: curriculumRoute.reason || '',
    curriculum: curriculumRoute.curriculum || null,
    sourceChunkIds: chunks.map((chunk) => String(chunk._id || '')).filter(Boolean),
    assets,
    multimodalParts,
    sourceAssetIds: assets.map((asset) => String(asset.assetId || '')).filter(Boolean),
  };
}

/**
 * Rotate textbook passages per batch variant so Concept Mastery slots see different source emphasis.
 */
export function buildBookContextForVariant(ragBase, scope = {}, variantIndex = 1) {
  const curriculumBlock = buildCurriculumTargetBlock(scope);
  if (!ragBase?.hasBookPassages) {
    return {
      contextText: ragBase?.contextText || curriculumBlock,
      chunks: [],
      sourceChunkIds: [],
    };
  }
  const candidateChunks = Array.isArray(ragBase?.candidateChunks) && ragBase.candidateChunks.length
    ? ragBase.candidateChunks
    : Array.isArray(ragBase?.chunks)
      ? ragBase.chunks
      : [];
  if (!candidateChunks.length) {
    return {
      contextText: ragBase?.contextText || curriculumBlock,
      chunks: [],
      sourceChunkIds: [],
    };
  }

  const wholeChapter = !String(scope.subtopicName || scope.subtopic || '').trim();
  const windowSize = Math.max(2, Math.min(wholeChapter ? 6 : 4, candidateChunks.length));
  const offset = (Math.max(1, Number(variantIndex) || 1) - 1) % candidateChunks.length;
  const rotated = candidateChunks.slice(offset).concat(candidateChunks.slice(0, offset));
  const selected = selectDiverseBookChunks(rotated, windowSize, {
    lambda: process.env.BOOK_RAG_MMR_LAMBDA,
    coveragePenalty: wholeChapter ? 0.1 : 0.04,
  });

  const bookContext = formatBookContextForPrompt(selected, {
    bookTitle: scope.bookTitle,
    subject: scope.subjectName || scope.subject,
    class: scope.className || scope.class,
    audience: scope.audience,
  });
  const variantNote =
    variantIndex > 1
      ? `\nVARIANT ${variantIndex}: Emphasise different textbook facts, numerical values, and question stems for the same sub-topic — direct exam-style wording only.`
      : '';
  const assetContext = formatBookAssetsForPrompt(ragBase?.assets || []);
  return {
    contextText: [
      `${curriculumBlock}${variantNote}`,
      bookContext,
      assetContext,
    ].filter(Boolean).join('\n\n'),
    chunks: selected,
    sourceChunkIds: selected.map((chunk) => String(chunk._id || chunk.chunkId || '')).filter(Boolean),
  };
}

export function buildBookContextTextForVariant(ragBase, scope = {}, variantIndex = 1) {
  return buildBookContextForVariant(ragBase, scope, variantIndex).contextText;
}
