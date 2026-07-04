/** Shared JSON extraction for Gemini structured outputs. */

function normalizeLooseJson(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

/** Escape bare control characters inside JSON strings (common with Hindi/multiline model output). */
function escapeControlCharsInStrings(value) {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    const code = ch.charCodeAt(0);
    if (escape) {
      out += ch;
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      out += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      if (code < 0x20) {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** Close truncated JSON objects/arrays (model hit max tokens mid-object). */
function closeTruncatedJson(value) {
  let inString = false;
  let escape = false;
  const stack = [];
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack.length) stack.pop();
  }

  let out = value;
  if (inString) out += '"';
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

function parseCandidate(value) {
  const variants = [
    normalizeLooseJson(value),
    normalizeLooseJson(escapeControlCharsInStrings(value)),
    normalizeLooseJson(closeTruncatedJson(escapeControlCharsInStrings(value))),
    normalizeLooseJson(closeTruncatedJson(value)),
  ];

  for (const cleaned of variants) {
    if (!cleaned) continue;
    try {
      return JSON.parse(cleaned);
    } catch {
      /* try next repair */
    }
  }
  return null;
}

function pickObject(parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed)) {
    const firstObject = parsed.find((row) => row && typeof row === 'object' && !Array.isArray(row));
    return firstObject || {};
  }
  return null;
}

function stripMarkdownFences(text) {
  return String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Extract the first JSON object from model output.
 * Tolerates markdown fences, trailing commas, bare newlines in strings, and truncation.
 */
export function extractJsonObject(text) {
  const raw = stripMarkdownFences(text);

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
    let end = -1;

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
        end = i;
        break;
      }
    }

    const candidate =
      end >= start ? raw.slice(start, end + 1) : closeTruncatedJson(raw.slice(start));
    const parsed = pickObject(parseCandidate(candidate));
    if (parsed) return parsed;
  }

  // Last resort: from first `{` to end, with truncation repair.
  const brace = raw.indexOf('{');
  if (brace >= 0) {
    const parsed = pickObject(parseCandidate(closeTruncatedJson(raw.slice(brace))));
    if (parsed) return parsed;
  }

  throw new Error('Gemini returned invalid JSON payload');
}
