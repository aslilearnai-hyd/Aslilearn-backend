import AiContentEngineChunk from '../models/AiContentEngineChunk.js';
import PdfChunk from '../models/PdfChunk.js';
import { generateEmbedding } from './pdf-rag-service.js';

const CANDIDATE_LIMIT = Number(process.env.RAG_CANDIDATE_LIMIT || 1500);
const TOP_K = Number(process.env.RAG_TOP_K || 6);

const STRONG_THRESHOLD = Number(process.env.RAG_STRONG_THRESHOLD || 0.78);
const WEAK_THRESHOLD = Number(process.env.RAG_WEAK_THRESHOLD || 0.55);

const cosine = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i += 1) dot += (a[i] || 0) * (b[i] || 0);
  return dot;
};

const buildFilter = ({ subject, classLabel }) => ({
  ...(subject ? { subject } : {}),
  ...(classLabel ? { classLabel } : {}),
});

const loadCandidates = async (filter) => {
  const select =
    'chunkText embedding subject classLabel chapter topic subTopic sourcePdfId';
  const [primary, legacy] = await Promise.all([
    AiContentEngineChunk.find(filter)
      .select(select)
      .limit(CANDIDATE_LIMIT)
      .lean()
      .catch(() => []),
    PdfChunk.find(filter)
      .select(select)
      .limit(Math.min(500, CANDIDATE_LIMIT))
      .lean()
      .catch(() => []),
  ]);
  const tagged = [
    ...primary.map((c) => ({ ...c, _src: 'AiContentEngineChunk' })),
    ...legacy.map((c) => ({ ...c, _src: 'PdfChunk' })),
  ];
  return tagged;
};

export const retrieveLibraryChunks = async ({
  query,
  subject,
  classLabel,
  topK = TOP_K,
}) => {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return { chunks: [], topScore: 0, priorityTier: 0 };
  }

  const { embedding } = await generateEmbedding(cleanQuery);
  let candidates = await loadCandidates(buildFilter({ subject, classLabel }));
  if (candidates.length === 0 && (subject || classLabel)) {
    candidates = await loadCandidates(buildFilter({ subject }));
  }
  if (candidates.length === 0) {
    candidates = await loadCandidates({});
  }

  const scored = candidates
    .map((c) => ({
      ...c,
      score: cosine(embedding, c.embedding || []),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, topK)));

  const topScore = scored[0]?.score || 0;

  let priorityTier = 0;
  if (topScore >= STRONG_THRESHOLD) priorityTier = 1;
  else if (topScore >= WEAK_THRESHOLD) priorityTier = 2;
  else priorityTier = 3;

  const passing = scored.filter((c) => c.score >= WEAK_THRESHOLD);

  return {
    chunks: passing.length ? passing : [],
    topScore,
    priorityTier,
    rawScored: scored,
  };
};

export const buildCitations = (chunks) =>
  (chunks || []).slice(0, 5).map((c, i) => ({
    index: i + 1,
    subject: c.subject || '',
    classLabel: c.classLabel || '',
    chapter: c.chapter || '',
    topic: c.topic || '',
    score: Number(c.score || 0).toFixed(3),
    preview: String(c.chunkText || '').slice(0, 220),
    sourcePdfId: c.sourcePdfId ? String(c.sourcePdfId) : '',
  }));

export const STRONG_RAG_THRESHOLD = STRONG_THRESHOLD;
export const WEAK_RAG_THRESHOLD = WEAK_THRESHOLD;

export default { retrieveLibraryChunks, buildCitations };
