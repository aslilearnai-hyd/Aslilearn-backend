import AiToolGeneration from '../models/AiToolGeneration.js';
import { BOOK_GENERATOR_UNIQUENESS_TARGET } from '../config/bookBasedTools.js';
import { buildBookScopeQuery } from '../utils/book-grounded-record.js';

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
