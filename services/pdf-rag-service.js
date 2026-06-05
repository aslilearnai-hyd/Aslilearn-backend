import { PDFParse } from 'pdf-parse';
import { GoogleGenerativeAI } from '@google/generative-ai';
import PdfKnowledgeSource from '../models/PdfKnowledgeSource.js';
import PdfChunk from '../models/PdfChunk.js';
import AiContentEngineChunk from '../models/AiContentEngineChunk.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import geminiService, { generateStudentTool, generateTeacherTool } from './gemini-service.js';
import { getPdfBufferFromStorage } from './cloud-storage.js';

const DEFAULT_CHUNK_TOKENS = Number(process.env.RAG_CHUNK_TOKENS || 700);
const DEFAULT_CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP || 100);
const MAX_RETRIEVAL_K = Number(process.env.RAG_TOP_K || 8);
const LOCAL_EMBED_DIM = 256;

async function syncAiPdfMasterProcessingFields(source) {
  if (!source?._id) return;
  await AiToolGeneration.updateMany(
    {
      sourceType: 'ai_pdf',
      $or: [
        { 'metadata.contentEngineSourceId': String(source._id) },
        { 'metadata.aiPdfSourceId': String(source._id) },
      ],
    },
    {
      $set: {
        status: source.processingStatus,
        'metadata.processingStatus': source.processingStatus,
        'metadata.chunkCount': source.chunkCount || 0,
        'metadata.processingError': String(source.processingError || ''),
      },
    },
  );
}

function normalizeSpaces(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function estimateTokens(text) {
  const words = normalizeSpaces(text).split(' ').filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

function chunkTextByWordWindow(text, chunkTokens = DEFAULT_CHUNK_TOKENS, overlapTokens = DEFAULT_CHUNK_OVERLAP) {
  const clean = normalizeSpaces(text);
  if (!clean) return [];
  const words = clean.split(' ').filter(Boolean);
  const wordsPerChunk = Math.max(100, Math.floor(chunkTokens / 1.3));
  const overlapWords = Math.max(10, Math.floor(overlapTokens / 1.3));
  const stride = Math.max(20, wordsPerChunk - overlapWords);

  const chunks = [];
  let idx = 0;
  for (let start = 0; start < words.length; start += stride) {
    const slice = words.slice(start, start + wordsPerChunk);
    if (!slice.length) break;
    const chunkText = slice.join(' ');
    chunks.push({
      chunkIndex: idx,
      chunkText,
      tokenCount: estimateTokens(chunkText),
    });
    idx += 1;
    if (start + wordsPerChunk >= words.length) break;
  }
  return chunks;
}

function normalizeVector(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return [];
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return vec.map((x) => x / norm);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i += 1) dot += (a[i] || 0) * (b[i] || 0);
  return dot;
}

function localHashEmbedding(text, dimension = LOCAL_EMBED_DIM) {
  const vec = new Array(dimension).fill(0);
  const tokens = normalizeSpaces(text).toLowerCase().split(' ').filter(Boolean);
  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    const idx = Math.abs(hash) % dimension;
    vec[idx] += 1;
  }
  return normalizeVector(vec);
}

async function geminiEmbedding(text) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  const modelName = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.embedContent(text);
  const values = result?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Gemini embedding returned empty vector');
  }
  return normalizeVector(values);
}

async function ollamaEmbedding(text) {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  const response = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  });
  if (!response.ok) {
    throw new Error(`Ollama embedding failed (${response.status})`);
  }
  const json = await response.json();
  const values = json?.embedding;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Ollama returned empty embedding vector');
  }
  return normalizeVector(values);
}

export async function generateEmbedding(text) {
  const provider = String(process.env.EMBEDDING_PROVIDER || 'local').toLowerCase();
  if (provider === 'gemini') {
    try {
      const vec = await geminiEmbedding(text);
      return { embedding: vec, embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004' };
    } catch (error) {
      console.warn('Gemini embedding failed, falling back to local hash:', error.message);
    }
  }
  if (provider === 'ollama') {
    try {
      const vec = await ollamaEmbedding(text);
      return { embedding: vec, embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text' };
    } catch (error) {
      console.warn('Ollama embedding failed, falling back to local hash:', error.message);
    }
  }
  return { embedding: localHashEmbedding(text), embeddingModel: `local-hash-${LOCAL_EMBED_DIM}` };
}

export async function processPdfSource(sourceId) {
  return processPdfSourceWithModels(sourceId, { sourceModel: PdfKnowledgeSource, chunkModel: PdfChunk });
}

/**
 * Phase 2.6 — re-upload hygiene.
 * After a new source is successfully processed, mark any OTHER source
 * with the same (subject, classLabel, chapter) as archived and delete
 * its chunks so students never see stale content.
 */
export async function archiveSupersededSources({ sourceModel, chunkModel, newSource }) {
  if (!newSource?._id) return { archivedCount: 0, deletedChunks: 0 };
  const filter = {
    _id: { $ne: newSource._id },
    subject: newSource.subject,
    classLabel: newSource.classLabel,
    chapter: newSource.chapter,
    archived: { $ne: true },
  };
  const olderSources = await sourceModel.find(filter).select('_id').lean().catch(() => []);
  if (olderSources.length === 0) return { archivedCount: 0, deletedChunks: 0 };
  const oldIds = olderSources.map((s) => s._id);
  const chunkResult = await chunkModel
    .deleteMany({ sourcePdfId: { $in: oldIds } })
    .catch(() => ({ deletedCount: 0 }));
  await sourceModel
    .updateMany(
      { _id: { $in: oldIds } },
      {
        $set: {
          archived: true,
          archivedAt: new Date(),
          archivedReason: `Replaced by newer upload (${newSource._id})`,
          supersededBy: newSource._id,
          chunkCount: 0,
        },
      }
    )
    .catch(() => null);
  return {
    archivedCount: oldIds.length,
    deletedChunks: chunkResult?.deletedCount || 0,
  };
}

export async function processPdfSourceWithModels(
  sourceId,
  { sourceModel = PdfKnowledgeSource, chunkModel = PdfChunk } = {}
) {
  const source = await sourceModel.findById(sourceId);
  if (!source) {
    throw new Error('PDF source not found');
  }

  source.processingStatus = 'processing';
  source.processingError = '';
  await source.save();
  await syncAiPdfMasterProcessingFields(source);

  try {
    const buffer = await getPdfBufferFromStorage({
      storageProvider: source.storageProvider,
      storageKey: source.storageKey,
      fileUrl: source.fileUrl,
    });
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    const text = normalizeSpaces(parsed?.text || '');
    await parser.destroy().catch(() => {});
    if (!text) {
      throw new Error('No extractable text found in PDF');
    }

    const chunks = chunkTextByWordWindow(text);
    await chunkModel.deleteMany({ sourcePdfId: source._id });

    const docs = [];
    for (const chunk of chunks) {
      const { embedding, embeddingModel } = await generateEmbedding(chunk.chunkText);
      docs.push({
        sourcePdfId: source._id,
        chunkIndex: chunk.chunkIndex,
        chunkText: chunk.chunkText,
        tokenCount: chunk.tokenCount,
        embedding,
        embeddingModel,
        subject: source.subject,
        classLabel: source.classLabel,
        chapter: source.chapter,
        topic: source.topic || source.chapter || '',
        subTopic: source.subTopic || '',
        toolType: source.toolType || '',
      });
    }
    if (docs.length > 0) {
      await chunkModel.insertMany(docs, { ordered: false });
    }

    source.processingStatus = 'processed';
    source.extractedTextLength = text.length;
    source.chunkCount = docs.length;
    source.lastProcessedAt = new Date();
    await source.save();
    await syncAiPdfMasterProcessingFields(source);

    return { sourceId: source._id, chunkCount: docs.length, extractedTextLength: text.length };
  } catch (error) {
    source.processingStatus = 'failed';
    source.processingError = error.message || 'Unknown processing error';
    await source.save();
    await syncAiPdfMasterProcessingFields(source);
    throw error;
  }
}

export async function retrieveRelevantChunks({ query, subject, classLabel, topK = MAX_RETRIEVAL_K }) {
  const { embedding: queryEmbedding } = await generateEmbedding(query);
  const filter = {
    ...(subject ? { subject } : {}),
    ...(classLabel ? { classLabel } : {}),
  };
  const select = 'chunkText embedding subject classLabel chapter sourcePdfId topic subTopic';
  const [primary, legacy] = await Promise.all([
    AiContentEngineChunk.find(filter).select(select).limit(1500).lean().catch(() => []),
    PdfChunk.find(filter).select(select).limit(500).lean().catch(() => []),
  ]);
  const candidates = [...primary, ...legacy];

  const scored = candidates
    .map((c) => ({ ...c, score: cosineSimilarity(queryEmbedding, c.embedding || []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, topK)));

  return scored;
}

function buildRagPrompt(query, chunks) {
  const context = chunks
    .map((c, i) => `(${i + 1}) [${c.subject} | ${c.classLabel} | ${c.chapter}]\n${c.chunkText}`)
    .join('\n\n');
  return `You are an educational AI assistant for ASLI Learn.\nUse ONLY the provided context if possible.\nIf context is insufficient, clearly mention assumptions.\n\nQuestion:\n${query}\n\nContext:\n${context}\n\nReturn concise, structured answer for student/teacher usage.`;
}

/**
 * Build retrieval context from raw PDF text for AI PDF generation (upload-time RAG).
 * Chunks the document, scores chunks against subject/topic query, returns top passages.
 */
export function buildPdfRagContextFromText(
  pdfText,
  { subject = '', topic = '', subTopic = '', topK = MAX_RETRIEVAL_K, maxChars = 120000 } = {},
) {
  const clean = normalizeSpaces(pdfText);
  if (!clean) return '';

  const chunks = chunkTextByWordWindow(clean);
  if (chunks.length <= 1) {
    return clean.slice(0, maxChars);
  }

  const query = [subject, topic, subTopic].filter(Boolean).join(' ').trim() || 'educational curriculum content';
  const queryVec = localHashEmbedding(query);
  const ranked = chunks
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryVec, localHashEmbedding(chunk.chunkText)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, topK)));

  const selected = [];
  let used = 0;
  for (const chunk of ranked) {
    const block = `[Chunk ${chunk.chunkIndex + 1}]\n${chunk.chunkText}`;
    if (used + block.length > maxChars) break;
    selected.push(block);
    used += block.length;
  }

  return selected.length ? selected.join('\n\n') : clean.slice(0, maxChars);
}

export async function runHybridRagQuery({
  query,
  subject,
  classLabel,
  toolType,
  role = 'student',
  cacheKey,
  metadata = {},
}) {
  // Layer 1: cache/pre-generated
  const cacheFilter = {
    toolName: toolType || 'rag-query',
    classLabel: classLabel || '',
    subject: subject || '',
    topic: cacheKey || query.slice(0, 120),
  };
  const cached = await AiToolGeneration.findOne(cacheFilter).sort({ createdAt: -1 }).lean();
  if (cached?.generatedContent || cached?.content) {
    return {
      content: cached.generatedContent || cached.content,
      source: 'cache',
      chunksUsed: 0,
      citations: [],
    };
  }

  // Layer 2: RAG retrieval + generation
  const chunks = await retrieveRelevantChunks({ query, subject, classLabel, topK: 8 });
  if (chunks.length >= 2) {
    const ragPrompt = buildRagPrompt(query, chunks);
    const ragAnswer = await geminiService.generateStructuredContent(ragPrompt, 'text');
    const content = String(ragAnswer || '').trim();
    if (content) {
      await AiToolGeneration.create({
        toolName: toolType || 'rag-query',
        toolDisplayName: 'RAG Query',
        classLabel: classLabel || '',
        subject: subject || '',
        topic: cacheKey || query.slice(0, 120),
        content,
        generatedContent: content,
        metadata: {
          source: 'rag',
          chunkCount: chunks.length,
          ...metadata,
        },
      });
      return {
        content,
        source: 'rag',
        chunksUsed: chunks.length,
        citations: chunks.slice(0, 5).map((c, i) => ({
          index: i + 1,
          subject: c.subject,
          classLabel: c.classLabel,
          chapter: c.chapter,
          score: Number(c.score || 0).toFixed(3),
          preview: String(c.chunkText || '').slice(0, 220),
        })),
      };
    }
  }

  // Layer 3: fallback AI
  const fallbackPrompt = `User query: ${query}\nSubject: ${subject || 'General'}\nClass: ${classLabel || 'General'}\nProvide best effort educational answer.`;
  const fallback = role === 'teacher'
    ? await generateTeacherTool(toolType || 'concept-mastery-helper', {
      subject,
      topic: query,
      gradeLevel: classLabel,
    })
    : await generateStudentTool(toolType || 'concept-breakdown-explainer', {
      subject,
      topic: query,
      gradeLevel: classLabel,
    });
  const content = String(fallback || fallbackPrompt).trim();
  await AiToolGeneration.create({
    toolName: toolType || 'rag-query',
    toolDisplayName: 'RAG Query',
    classLabel: classLabel || '',
    subject: subject || '',
    topic: cacheKey || query.slice(0, 120),
    content,
    generatedContent: content,
    metadata: {
      source: 'ai-fallback',
      ...metadata,
    },
  });
  return { content, source: 'ai-fallback', chunksUsed: 0, citations: [] };
}

