import AiToolGeneration from '../models/AiToolGeneration.js';
import { extractTitleFromStructured } from './ai-generator-content-extractor.js';
import { computeTopicSaturation } from './ai-generator-topic-saturation.js';
import { BOOK_GENERATOR_UNIQUENESS_TARGET } from '../config/bookBasedTools.js';

const ORIGINALITY_PREAMBLE = `ORIGINALITY REQUIREMENT (mandatory):
Generate completely original educational content grounded in the TEXTBOOK passages provided.
Do NOT repeat or closely resemble any previously generated content for this book + subtopic.
Create fresh examples, scenarios, and question phrasing while staying faithful to the book.`;

function getHistoricalPromptLimit() {
  const n = Number(process.env.BOOK_GENERATOR_HISTORICAL_LIMIT || process.env.AI_GENERATOR_HISTORICAL_PROMPT_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 20;
}

function buildBookScopeQuery(scope) {
  const q = {
    sourceType: 'book_rag',
    'metadata.bookId': String(scope.bookId || ''),
    toolName: scope.toolSlug,
    board: scope.board,
    classLabel: scope.className,
    subject: scope.subject,
    topic: scope.topic,
    subtopic: scope.subtopic,
  };
  return q;
}

/**
 * Historical context for book-grounded generations (50+ uniqueness target).
 */
export async function buildBookHistoricalGenerationContext(scope) {
  const query = buildBookScopeQuery(scope);
  const existingCount = await AiToolGeneration.countDocuments(query);
  const saturation = await computeTopicSaturation({
    toolSlug: scope.toolSlug,
    board: scope.board,
    className: scope.className,
    subject: scope.subject,
    topic: scope.topic,
    subtopic: scope.subtopic,
  });

  const promptLimit = getHistoricalPromptLimit();
  const recentRecords = await AiToolGeneration.find(query)
    .sort({ createdAt: -1 })
    .limit(promptLimit)
    .select('generatedContent metadata structuredContent title')
    .lean();

  const summaries = recentRecords.map((rec, i) => {
    const title = extractTitleFromStructured(rec.metadata?.structuredContent || rec) || rec.title || '';
    const snippet = String(rec.generatedContent || '').replace(/\s+/g, ' ').trim().slice(0, 280);
    return `Record ${i + 1}: ${title ? `Title: ${title}. ` : ''}${snippet}`;
  });

  const avoidBlock =
    summaries.length > 0
      ? `${ORIGINALITY_PREAMBLE}\n\nAvoid generating content similar to:\n${summaries.join('\n\n')}`
      : ORIGINALITY_PREAMBLE;

  const uniquenessTarget = BOOK_GENERATOR_UNIQUENESS_TARGET;
  const promptBlock = `${avoidBlock}\n\nExisting book-grounded records for this subtopic: ${existingCount}. Target: ${uniquenessTarget}+ unique variants.`;

  return {
    existingCount,
    saturation,
    promptBlock,
    titles: recentRecords.map((r) => extractTitleFromStructured(r.metadata?.structuredContent || r)).filter(Boolean),
    questionSnippets: [],
    uniquenessTarget,
  };
}
