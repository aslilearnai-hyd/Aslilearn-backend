import AiToolGeneration from '../models/AiToolGeneration.js';
import { BOOK_GENERATOR_UNIQUENESS_TARGET } from '../config/bookBasedTools.js';
import { buildBookScopeQuery } from '../utils/book-grounded-record.js';

/**
 * Lightweight batch context — count only (no extra DB reads or prompt bloat).
 * Concept Mastery variety uses per-slot angles + rotated book passages (one LLM call each).
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
