/**
 * Indian place-value notation for Class 6–8 Maths (and similar).
 * Western: 1,234,567  →  Indian: 12,34,567
 * Also normalises place names: million→ten lakh, billion→hundred crore, etc.
 */

const WESTERN_GROUPED_RE = /\b\d{1,3}(?:,\d{3})+\b/g;
const BARE_LARGE_INT_RE = /\b([1-9]\d{4,14})\b/g;

/** Format a non-negative integer with Indian comma grouping. */
export function formatIndianNumber(n) {
  const s = String(Math.trunc(Math.abs(Number(n))));
  if (!/^\d+$/.test(s) || s.length <= 3) return s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const parts = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(',')},${last3}`;
}

/** Strip commas and parse an integer (Indian or Western grouping). */
export function parseGroupedInteger(raw) {
  const cleaned = String(raw || '').replace(/,/g, '').trim();
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

function rewriteWesternGrouped(match) {
  const n = parseGroupedInteger(match);
  if (n == null) return match;
  return formatIndianNumber(n);
}

/** Prefer Indian place-name vocabulary in prose (case-preserving light touch). */
function rewritePlaceNames(text) {
  return String(text || '')
    .replace(/\bten\s+millions?\b/gi, 'crore')
    .replace(/\bhundred\s+millions?\b/gi, 'ten crore')
    .replace(/\bone\s+billion\b/gi, 'hundred crore')
    .replace(/\bbillions?\b/gi, 'hundred crore')
    .replace(/\bone\s+million\b/gi, 'ten lakh')
    .replace(/\ba\s+million\b/gi, 'ten lakh')
    .replace(/\bmillions?\b/gi, 'ten lakh')
    .replace(/\bhundred\s+thousands?\b/gi, 'lakh')
    .replace(/\bten\s+thousands?\b/gi, 'ten thousand');
}

/**
 * Convert Western thousands commas → Indian grouping in free text.
 * Leaves decimals and very short numbers alone.
 */
export function standardizeIndianNumberText(text, { rewriteNames = true } = {}) {
  let t = String(text || '');
  t = t.replace(WESTERN_GROUPED_RE, rewriteWesternGrouped);
  // Bare 5+ digit integers without commas → Indian commas (skip years 1900–2099).
  t = t.replace(BARE_LARGE_INT_RE, (m) => {
    const n = Number(m);
    if (n >= 1900 && n <= 2099) return m;
    return formatIndianNumber(n);
  });
  if (rewriteNames) t = rewritePlaceNames(t);
  return t;
}

function deepMapStrings(val, fn) {
  if (typeof val === 'string') return fn(val);
  if (Array.isArray(val)) return val.map((x) => deepMapStrings(x, fn));
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = deepMapStrings(v, fn);
    return out;
  }
  return val;
}

/** Apply Indian number notation across a V2 structuredContent tree. */
export function applyIndianNotationToStructured(structured, opts = {}) {
  if (!structured || typeof structured !== 'object') return structured;
  return deepMapStrings(structured, (s) => standardizeIndianNumberText(s, opts));
}

/** True when class is typically taught with Indian system emphasis (6–8). */
export function shouldUseIndianNotation(classLabel, subject = '') {
  const cls = Number(String(classLabel || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(cls) || cls < 1) return true; // default on for school content
  if (cls >= 6 && cls <= 10) return true;
  const sub = String(subject || '').toLowerCase();
  return /math|mathematics|arith/.test(sub) && cls <= 12;
}

export default {
  formatIndianNumber,
  parseGroupedInteger,
  standardizeIndianNumberText,
  applyIndianNotationToStructured,
  shouldUseIndianNotation,
};
