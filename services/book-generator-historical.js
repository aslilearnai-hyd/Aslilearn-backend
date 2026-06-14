import AiToolGeneration from '../models/AiToolGeneration.js';
import { BOOK_GENERATOR_UNIQUENESS_TARGET } from '../config/bookBasedTools.js';

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
 * Lightweight batch context — count only (no Gemini prompt bloat, no loading past records).
 * Uniqueness within the current batch is handled locally in the orchestrator.
 */
export async function buildBookHistoricalGenerationContext(scope) {
  const query = buildBookScopeQuery(scope);
  const existingCount = await AiToolGeneration.countDocuments(query);

  return {
    existingCount,
    saturation: null,
    promptBlock: '',
    titles: [],
    questionSnippets: [],
    uniquenessTarget: BOOK_GENERATOR_UNIQUENESS_TARGET,
  };
}
