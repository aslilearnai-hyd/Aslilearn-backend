import BookChunk from '../models/BookChunk.js';
import { generateEmbedding } from './pdf-rag-service.js';

const DEFAULT_TOP_K = Number(process.env.BOOK_RAG_TOP_K || process.env.RAG_TOP_K || 8);
const MAX_CONTEXT_CHARS = Number(process.env.BOOK_RAG_MAX_CONTEXT_CHARS || 48000);

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

  const { embedding: queryEmbedding } = await generateEmbedding(q);
  const candidates = await BookChunk.find(filter).select(
    'content embedding embeddingModel chapter topic subtopic chunkIndex bookId subject class board',
  ).limit(2000).lean();

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
    'TEXTBOOK CONTENT (PRIMARY SOURCE — use this as the main factual basis):',
    'Priority: (1) Uploaded Book  (2) Uploaded Notes  (3) General knowledge only when the book is silent.',
    'Follow textbook terminology, definitions, examples, formulae, and explanations.',
    'Do not invent facts that contradict the passages below.',
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
    if (used + block.length > MAX_CONTEXT_CHARS) break;
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
  const lines = [
    'USER-SELECTED CURRICULUM (generate content for this exact scope):',
    scope.board ? `Board: ${scope.board}` : '',
    scope.className || scope.classLabel || scope.class ? `Class: ${scope.className || scope.classLabel || scope.class}` : '',
    scope.subjectName || scope.subject ? `Subject: ${scope.subjectName || scope.subject}` : '',
    scope.topicName || scope.topic ? `Topic: ${scope.topicName || scope.topic}` : '',
    scope.subtopicName || scope.subtopic ? `Sub-topic: ${scope.subtopicName || scope.subtopic}` : '',
    scope.toolSlug || scope.toolName ? `Tool: ${scope.toolSlug || scope.toolName}` : '',
    'Use the textbook passages below as the PRIMARY source. Align output with this curriculum topic/sub-topic.',
  ].filter(Boolean);
  return lines.join('\n');
}

export async function retrieveBookContextForGeneration(scope = {}) {
  const query = buildBookRetrievalQuery(scope);
  const chunks = await searchRelevantChunks({
    query,
    bookId: scope.bookId,
    board: scope.board,
    class: scope.className || scope.classLabel || scope.class,
    subject: scope.subjectName || scope.subject,
    chapter: scope.topicName || scope.topic,
    topic: scope.topicName || scope.topic,
    subtopic: scope.subtopicName || scope.subtopic,
    topK: Number(scope.topK) || DEFAULT_TOP_K,
  });
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
  };
}
