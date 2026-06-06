/**
 * Project one generation block → tool structured content (zero LLM).
 * @module services/pdf-generation-projector
 */

import { extractToolItemsFromPdfText } from './pdf-tool-extract.js';
import { canonicalizeBulkItems } from './tool-formatters/index.js';
import { postProcessCanonicalBulkItems } from './pdf-canonical-mapper.js';
import { extractQuickAssignmentItemsFromPdfText } from './pdf-quick-assignment-extract.js';
import { formatItemToContent } from '../controllers/aiToolsController.js';

/**
 * @param {string} toolSlug
 * @param {string} blockText
 * @param {Record<string, unknown>} [params]
 */
export function projectGenerationBlock(toolSlug, blockText, params = {}) {
  const slug = String(toolSlug || '').trim();
  const text = String(blockText || '').trim();
  if (!text) return [];

  let items = [];
  if (slug === 'quick-assignment-builder') {
    items = extractQuickAssignmentItemsFromPdfText(text, 1, params);
  } else {
    items = extractToolItemsFromPdfText(slug, text, { limit: 5, ...params });
  }

  if (!items.length) {
    items = [
      {
        title: params.generationTitle || params.topic || 'Content',
        text: text.slice(0, 50000),
        learning_objectives: [],
      },
    ];
  }

  items = postProcessCanonicalBulkItems(slug, items, text, params);
  return canonicalizeBulkItems(slug, items, text);
}

/**
 * @param {string} toolSlug
 * @param {Record<string, unknown>} structured
 * @param {number} index
 */
export function generationBlockToContentString(toolSlug, structured, index = 0) {
  return formatItemToContent(toolSlug, structured, index);
}
