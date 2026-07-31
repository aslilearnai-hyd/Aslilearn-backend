import AiToolGeneration from '../../../models/AiToolGeneration.js';
import { BOOK_GENERATOR_UNIQUENESS_TARGET } from '../shared/bookBasedTools.js';
import { buildBookScopeQuery } from '../../rag/books/book-grounded-record.js';
import { buildHistoricalGenerationContext } from '../shared/ai-generator-historical-index.js';

/**
 * Full historical dedup context for book-grounded batches (RAG Fix Brief §4, §6).
 */
export async function buildBookHistoricalGenerationContext(scope) {
  const query = buildBookScopeQuery(scope);
  const existingCount = await AiToolGeneration.countDocuments(query);
  const historical = await buildHistoricalGenerationContext({
    ...scope,
    toolSlug: scope.toolSlug,
    subtopic: scope.subtopic,
  });

  return {
    existingCount,
    saturation: historical.saturation,
    promptBlock: historical.promptBlock,
    titles: historical.titles,
    questionSnippets: historical.questionSnippets,
    uniquenessTarget: BOOK_GENERATOR_UNIQUENESS_TARGET,
    forbiddenOpenings: historical.forbiddenOpenings,
  };
}
