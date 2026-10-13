import BookChunk from '../../../models/BookChunk.js';
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
  topK = DEFAULT_TOP_K,
  queryEmbedding: queryEmbeddingInput = null,
}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const filter = {};
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
    'content embedding embeddingModel chapter topic subtopic chunkIndex bookId subject class board corpusId sourcePriority sourceType difficultyBand approvalStatus assetIds sourcePage',
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
    const label = [c.chapter, c.topic, c.subtopic].filter(Boolean).join(' › ') || `Passage ${i + 1}`;
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

export async function retrieveBookContextForGeneration(scope = {}) {
  const query = buildBookRetrievalQuery(scope);
  const isWholeChapter = !String(scope.subtopicName || scope.subtopic || '').trim();
  const topK = Number(scope.topK) || (isWholeChapter ? DEFAULT_WHOLE_CHAPTER_TOP_K : DEFAULT_TOP_K);
  const candidateK = Math.max(topK, Math.min(20, Number(scope.candidateK) || DEFAULT_CANDIDATE_K));
  const { embedding: queryEmbedding } = await generateEmbedding(query);

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

  // Formal exam mode fails closed: never broaden from the selected curriculum
  // to subject-only or unfiltered chunks.
  const candidateChunks = rerankBookChunks(
    await baseSearch({
      board: scope.board,
      class: scope.className || scope.classLabel || scope.class,
      subject: scope.subjectName || scope.subject,
    }),
    scope,
    candidateK,
  );

  const bestRawScore = Math.max(0, ...candidateChunks.map((chunk) => Number(chunk.rawScore) || 0));
  const scoreTier = retrievalTier(bestRawScore, {
    strong: process.env.BOOK_RAG_STRONG_SCORE,
    acceptable: process.env.BOOK_RAG_ACCEPTABLE_SCORE,
  });
  const allowWeak = String(process.env.BOOK_RAG_ALLOW_WEAK_CONTEXT || 'false').toLowerCase() === 'true';
  const chunks = scoreTier === 'weak' && !allowWeak
    ? []
    : selectDiverseBookChunks(candidateChunks, topK, {
        lambda: process.env.BOOK_RAG_MMR_LAMBDA,
        coveragePenalty: isWholeChapter ? 0.1 : 0.04,
      });
  const multimodalEnabled = String(process.env.BOOK_MULTIMODAL_RAG ?? 'true').toLowerCase() !== 'false';
  const assets = multimodalEnabled
    ? await retrieveApprovedBookAssets(scope, Number(scope.assetK) || 4)
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
    retrievalStatus: chunks.length ? 'ready' : candidateChunks.length ? 'weak_context' : 'no_context',
    retrievalTier: scoreTier,
    bestScore: bestRawScore,
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
