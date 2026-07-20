import BookChunk from '../models/BookChunk.js';
import { generateEmbedding } from './pdf-rag-service.js';

const DEFAULT_TOP_K = Number(process.env.BOOK_RAG_TOP_K || process.env.RAG_TOP_K || 4);
function getBookRagMaxContextChars() {
  const env = Number(process.env.BOOK_RAG_MAX_CONTEXT_CHARS);
  if (Number.isFinite(env) && env > 0) return env;
  const costSaver =
    String(process.env.AI_GENERATOR_COST_SAVER ?? 'true').trim().toLowerCase() !== 'false' &&
    String(process.env.AI_GENERATOR_COST_SAVER ?? 'true').trim().toLowerCase() !== '0';
  return costSaver ? 10000 : 18000;
}

function normalizeSpaces(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i += 1) dot += (a[i] || 0) * (b[i] || 0);
  return dot;
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

  const queryEmbedding = Array.isArray(queryEmbeddingInput) && queryEmbeddingInput.length
    ? queryEmbeddingInput
    : (await generateEmbedding(q)).embedding;
  const candidates = await BookChunk.find(filter).select(
    'content embedding embeddingModel chapter topic subtopic chunkIndex bookId subject class board',
  ).limit(getBookRagCandidateLimit(bookId)).lean();

  return candidates
    .map((c) => ({
      ...c,
      chunkText: c.content,
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
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    const label = [c.chapter, c.topic, c.subtopic].filter(Boolean).join(' › ') || `Passage ${i + 1}`;
    const block = `[${i + 1}] (${label})\n${normalizeSpaces(c.content || c.chunkText || '')}`;
    if (used + block.length > getBookRagMaxContextChars()) break;
    blocks.push(block);
    used += block.length;
  }

  return `${header}\n\n${blocks.join('\n\n')}`;
}

/** Build retrieval query from generation scope. */
export function buildBookRetrievalQuery(scope = {}) {
  return [
    scope.subjectName || scope.subject,
    scope.topicName || scope.topic,
    scope.subtopicName || scope.subtopic,
    scope.toolSlug || scope.toolName,
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
  const topK = Number(scope.topK) || DEFAULT_TOP_K;
  const { embedding: queryEmbedding } = await generateEmbedding(query);

  const baseSearch = (extra = {}) =>
    searchRelevantChunks({
      query,
      queryEmbedding,
      bookId: scope.bookId,
      topK: Math.max(topK, 12),
      ...extra,
    });

  // Chunk metadata stores PDF chapter titles, not curriculum topic/subtopic labels — semantic search first.
  let chunks = rerankBookChunks(
    await baseSearch({
      board: scope.board,
      subject: scope.subjectName || scope.subject,
    }),
    scope,
    topK,
  );

  if (!chunks.length) {
    chunks = rerankBookChunks(await baseSearch({ subject: scope.subjectName || scope.subject }), scope, topK);
  }

  if (!chunks.length) {
    chunks = rerankBookChunks(await baseSearch(), scope, topK);
  }

  const bookContext = formatBookContextForPrompt(chunks, {
    bookTitle: scope.bookTitle,
    subject: scope.subjectName || scope.subject,
    class: scope.className || scope.class,
  });
  const curriculumBlock = buildCurriculumTargetBlock(scope);
  const contextText = bookContext
    ? `${curriculumBlock}\n\n${bookContext}`
    : curriculumBlock;
  return {
    chunks,
    contextText,
    chunkCount: chunks.length,
    hasBookPassages: chunks.length > 0,
    retrievalQuery: query,
  };
}

/**
 * Rotate textbook passages per batch variant so Concept Mastery slots see different source emphasis.
 */
export function buildBookContextTextForVariant(ragBase, scope = {}, variantIndex = 1) {
  const chunks = Array.isArray(ragBase?.chunks) ? ragBase.chunks : [];
  const curriculumBlock = buildCurriculumTargetBlock(scope);
  if (!chunks.length) {
    return ragBase?.contextText || curriculumBlock;
  }

  const windowSize = Math.max(2, Math.min(4, DEFAULT_TOP_K));
  const stride = Math.max(1, Math.floor(windowSize / 2));
  const start = ((Math.max(1, variantIndex) - 1) * stride) % chunks.length;
  const selected = [];
  for (let i = 0; i < windowSize; i += 1) {
    selected.push(chunks[(start + i) % chunks.length]);
  }

  const bookContext = formatBookContextForPrompt(selected, {
    bookTitle: scope.bookTitle,
    subject: scope.subjectName || scope.subject,
    class: scope.className || scope.class,
  });
  const variantNote =
    variantIndex > 1
      ? `\nVARIANT ${variantIndex}: Emphasise different textbook facts, numerical values, and question stems for the same sub-topic — direct exam-style wording only.`
      : '';
  return bookContext ? `${curriculumBlock}${variantNote}\n\n${bookContext}` : `${curriculumBlock}${variantNote}`;
}
