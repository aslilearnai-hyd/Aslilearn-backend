/**
 * Convert aiToolTemplates informal pdfExtractSchema → Gemini responseSchema (OpenAPI subset).
 */

function convertNode(node) {
  if (node == null) return { type: 'string' };

  if (typeof node === 'string') {
    const t = node.toLowerCase();
    if (t === 'number') return { type: 'number' };
    if (t === 'boolean') return { type: 'boolean' };
    return { type: 'string' };
  }

  if (Array.isArray(node)) {
    if (!node.length) return { type: 'array', items: { type: 'string' } };
    return { type: 'array', items: convertNode(node[0]) };
  }

  if (typeof node === 'object') {
    const properties = {};
    for (const [key, val] of Object.entries(node)) {
      properties[key] = convertNode(val);
    }
    return { type: 'object', properties };
  }

  return { type: 'string' };
}

/**
 * @param {Record<string, unknown>} informalSchema from aiToolTemplates gemini.pdfExtractSchema
 * @param {string} contentTypeDefault
 */
export function buildGeminiResponseSchemaForTool(informalSchema, contentTypeDefault = 'Generated Content') {
  const structured = convertNode(
    informalSchema && typeof informalSchema === 'object' ? informalSchema : {},
  );
  return {
    type: 'object',
    properties: {
      contentType: { type: 'string' },
      structuredContent: structured,
    },
    required: ['contentType', 'structuredContent'],
  };
}

export function isResponseSchemaEnabled(toolSlug) {
  const raw = String(process.env.AI_GENERATOR_RESPONSE_SCHEMA ?? 'true').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  return Boolean(String(toolSlug || '').trim());
}
