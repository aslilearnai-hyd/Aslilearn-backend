/**
 * Curriculum Knowledge Resolver — Step 1 & 2 of Generation Pipeline V2.
 * Never generate assessment content from chapter title alone when avoidable.
 * @module services/curriculum-context-service
 */

import { retrieveRelevantChunks } from './pdf-rag-service.js';
import { getHardcodedContent } from './hardcoded-content-service.js';
import AiToolGeneration from '../models/AiToolGeneration.js';

const ASSESSMENT_TOOL_SLUGS = new Set([
  'exam-question-paper-generator',
  'mock-test-builder',
  'worksheet-mcq-generator',
  'smart-qa-practice-generator',
  'homework-creator',
  'quick-assignment-builder',
]);

const KNOWLEDGE_SOURCE_TOOLS = [
  'concept-mastery-helper',
  'short-notes-summaries-maker',
  'worksheet-mcq-generator',
  'smart-study-guide-generator',
  'chapter-summary-creator',
  'key-points-formula-extractor',
];

function parseClassNumber(classLabel) {
  const raw = String(classLabel || '').trim();
  const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function truncate(text, max = 4000) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function extractTextFromHardcoded(data, depth = 0) {
  if (depth > 6 || data == null) return '';
  if (typeof data === 'string') return data.trim();
  if (Array.isArray(data)) {
    return data
      .slice(0, 40)
      .map((item) => extractTextFromHardcoded(item, depth + 1))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof data === 'object') {
    const parts = [];
    for (const [k, v] of Object.entries(data)) {
      if (/^(id|_id|slug|metadata|createdAt|updatedAt)$/i.test(k)) continue;
      const piece = extractTextFromHardcoded(v, depth + 1);
      if (piece) parts.push(`${k}: ${piece}`);
    }
    return parts.join('\n');
  }
  return '';
}

async function loadHardcodedKnowledge(classNumber, subject, topic, subTopic) {
  const blocks = [];
  for (const toolType of KNOWLEDGE_SOURCE_TOOLS) {
    try {
      const data = await getHardcodedContent(classNumber, subject, topic || subTopic, toolType, {
        silent: true,
      });
      if (!data) continue;
      const text = truncate(extractTextFromHardcoded(data), 2500);
      if (text.length > 80) {
        blocks.push(`[Hardcoded ${toolType}]\n${text}`);
      }
    } catch {
      /* optional source */
    }
  }
  return blocks;
}

async function loadApprovedGenerationKnowledge({ classLabel, subject, topic, subTopic, board }) {
  const doc = await AiToolGeneration.findOne({
    classLabel,
    subject,
    topic: topic || '',
    subtopic: subTopic || '',
    ...(board ? { board } : {}),
    reviewStatus: { $in: ['approved', undefined] },
    status: { $nin: ['archived', 'deleted', 'inactive'] },
    toolName: { $in: KNOWLEDGE_SOURCE_TOOLS },
    $or: [
      { generatedContent: { $exists: true, $nin: ['', null] } },
      { content: { $exists: true, $nin: ['', null] } },
    ],
  })
    .sort({ createdAt: -1 })
    .lean()
    .catch(() => null);

  if (!doc) return '';
  const raw = String(doc.generatedContent || doc.content || '').trim();
  const structured = doc.metadata?.structuredContent;
  if (structured && typeof structured === 'object') {
    return truncate(extractTextFromHardcoded(structured), 3000);
  }
  return truncate(raw, 3000);
}

async function loadVectorKnowledge({ subject, classLabel, topic, subTopic }) {
  const query = [subject, topic, subTopic].filter(Boolean).join(' — ');
  const chunks = await retrieveRelevantChunks({
    query,
    subject,
    classLabel,
    topK: 10,
  });
  if (!chunks.length) return { text: '', chunkCount: 0 };

  const blocks = chunks.map(
    (c, i) =>
      `[Chunk ${i + 1} | ${c.chapter || c.topic || 'chapter'} | score ${Number(c.score || 0).toFixed(2)}]\n${String(c.chunkText || '').trim()}`,
  );
  return {
    text: truncate(blocks.join('\n\n'), 12000),
    chunkCount: chunks.length,
  };
}

/**
 * Resolve curriculum knowledge for generation.
 * @param {object} params
 * @returns {Promise<{ contextText: string, sources: string[], hasMinimumContext: boolean, chunkCount: number }>}
 */
export async function resolveCurriculumKnowledgeContext(params = {}) {
  const {
    board = 'CBSE',
    classLabel = '',
    subject = '',
    topic = '',
    subTopic = '',
    subtopic = '',
    toolSlug = '',
  } = params;

  const subtopicResolved = String(subTopic || subtopic || '').trim();
  const topicResolved = String(topic || '').trim();
  const classNum = parseClassNumber(classLabel);
  const sources = [];
  const blocks = [];

  const vector = await loadVectorKnowledge({
    subject,
    classLabel,
    topic: topicResolved,
    subTopic: subtopicResolved,
  });
  if (vector.text) {
    blocks.push(`NCERT / TEXTBOOK CHUNKS (use as primary factual source):\n${vector.text}`);
    sources.push(`vector:${vector.chunkCount}`);
  }

  if (classNum) {
    const hardcoded = await loadHardcodedKnowledge(
      classNum,
      subject,
      topicResolved,
      subtopicResolved,
    );
    if (hardcoded.length) {
      blocks.push(...hardcoded);
      sources.push(`hardcoded:${hardcoded.length}`);
    }
  }

  const approved = await loadApprovedGenerationKnowledge({
    board,
    classLabel,
    subject,
    topic: topicResolved,
    subTopic: subtopicResolved,
  });
  if (approved) {
    blocks.push(`[Prior approved curriculum content]\n${approved}`);
    sources.push('approved-generation');
  }

  const contextText = blocks.join('\n\n---\n\n');
  const minLen = ASSESSMENT_TOOL_SLUGS.has(String(toolSlug || '').trim()) ? 400 : 120;
  const hasMinimumContext = contextText.length >= minLen;

  return {
    contextText,
    sources,
    hasMinimumContext,
    chunkCount: vector.chunkCount || 0,
  };
}

/**
 * Build prompt block injected before Gemini generation.
 * @param {object} params
 * @returns {Promise<string>}
 */
export async function buildCurriculumContextPromptBlock(params = {}) {
  const { contextText, hasMinimumContext, sources } = await resolveCurriculumKnowledgeContext(params);
  const subtopic = String(params.subTopic || params.subtopic || '').trim();
  const topic = String(params.topic || '').trim();

  const header = [
    'CURRICULUM KNOWLEDGE (mandatory — all questions MUST use these facts, terms, reactions, and examples):',
    `Board: ${params.board || 'CBSE'} | Class: ${params.classLabel || ''} | Subject: ${params.subject || ''}`,
    `Topic: ${topic} | Subtopic: ${subtopic}`,
    `Sources loaded: ${sources.length ? sources.join(', ') : 'NONE'}`,
  ].join('\n');

  if (!hasMinimumContext) {
    return [
      header,
      '',
      'WARNING: Insufficient chapter knowledge was retrieved. You MUST still generate accurate subject-specific content using verified NCERT/CBSE knowledge for this exact subtopic.',
      'NEVER use generic scientific-method options (belief without evidence, superstition) unless the subtopic is literally the scientific method.',
      'NEVER repeat the subtopic title as the question — ask about specific concepts (e.g. litmus, HCl, NaOH, neutralization, pH, metal + acid reactions).',
      'If you cannot write real subject questions, return empty question arrays — do NOT fill with placeholders.',
    ].join('\n');
  }

  return `${header}\n\n${contextText}`;
}

export function isAssessmentToolSlug(toolSlug) {
  return ASSESSMENT_TOOL_SLUGS.has(String(toolSlug || '').trim());
}

export function isExamScaffoldPaddingAllowed() {
  const raw = String(process.env.AI_EXAM_ALLOW_SCAFFOLD ?? 'false').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}
