/** Shared JSON extraction for Gemini structured outputs. */

export function extractJsonObject(text) {
  const raw = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const normalizeLooseJson = (value) =>
    String(value || '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u00A0/g, ' ')
      .replace(/,\s*([}\]])/g, '$1')
      .trim();

  const parseCandidate = (value) => {
    const cleaned = normalizeLooseJson(value);
    if (!cleaned) return null;
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  };

  const pickObject = (parsed) => {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed)) {
      const firstObject = parsed.find((row) => row && typeof row === 'object' && !Array.isArray(row));
      return firstObject || {};
    }
    return null;
  };

  const direct = pickObject(parseCandidate(raw));
  if (direct) return direct;

  const startIndices = [];
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '{' || ch === '[') startIndices.push(i);
  }

  for (const start of startIndices) {
    const open = raw[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === open) depth += 1;
      else if (ch === close) depth -= 1;

      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        const parsed = pickObject(parseCandidate(candidate));
        if (parsed) return parsed;
        break;
      }
    }
  }

  throw new Error('Gemini returned invalid JSON payload');
}
