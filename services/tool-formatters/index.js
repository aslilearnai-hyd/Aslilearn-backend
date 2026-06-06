/**
 * Tool formatters — canonical JSON → tool structuredContent (all 22 tools).
 * NO extraction logic; uses pdf-canonical-mapper for mapping then canonicalizes.
 * @module services/tool-formatters
 */

import { AI_TOOL_ORDERED_SLUGS } from '../../config/aiToolTemplates.js';
import { mapCanonicalPdfToToolBulkItems, postProcessCanonicalBulkItems } from '../pdf-canonical-mapper.js';
import { getToolFormatter, listRegisteredFormatters, TOOL_FORMATTER_REGISTRY } from './registry.js';

export { getToolFormatter, listRegisteredFormatters, TOOL_FORMATTER_REGISTRY };

/**
 * Map canonical → bulk items → post-process → canonicalize per tool.
 * @param {string} toolSlug
 * @param {Record<string, unknown>} canonical
 * @param {string} sourceText
 * @param {Record<string, unknown>} [params]
 */
export function formatCanonicalForTool(toolSlug, canonical, sourceText = '', params = {}) {
  const slug = String(toolSlug || '').trim();
  const mapped = mapCanonicalPdfToToolBulkItems(slug, canonical, sourceText, params);
  if (!mapped.items?.length) {
    return { items: [], parser: mapped.parser || 'none', mapped };
  }
  let items = postProcessCanonicalBulkItems(slug, mapped.items, sourceText, params);
  items = canonicalizeBulkItems(slug, items, sourceText);
  return { items, parser: mapped.parser || 'canonical-json', mapped };
}

/**
 * @param {string} toolSlug
 * @param {unknown[]} items
 * @param {string} [sourceText]
 */
export function canonicalizeBulkItems(toolSlug, items = [], sourceText = '') {
  const slug = String(toolSlug || '').trim();
  const fmt = getToolFormatter(slug);
  if (!fmt) return items;
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((item) => {
      const clean = item && typeof item === 'object' ? { ...item } : item;
      if (clean && typeof clean === 'object') {
        delete clean._fromPdf;
        delete clean._fromAiGeneration;
      }
      return fmt.needsSourceText
        ? fmt.canonicalize(clean, slug, sourceText)
        : fmt.canonicalize(clean, slug);
    });
}

/**
 * @param {string} toolSlug
 * @param {Record<string, unknown>} item
 * @param {string} [sourceText]
 */
export function buildToolRenderContent(toolSlug, item, sourceText = '') {
  const slug = String(toolSlug || '').trim();
  const fmt = getToolFormatter(slug);
  if (!fmt) return item;
  const row = item && typeof item === 'object' ? { ...item } : {};
  return fmt.needsSourceText ? fmt.render(row, slug, sourceText) : fmt.render(row, slug);
}

/** Verify all 22 AI tools have formatters registered. */
export function assertAllToolsHaveFormatters() {
  const missing = AI_TOOL_ORDERED_SLUGS.filter((slug) => !TOOL_FORMATTER_REGISTRY[slug]);
  if (missing.length) {
    throw new Error(`Missing tool formatters for: ${missing.join(', ')}`);
  }
  return true;
}
