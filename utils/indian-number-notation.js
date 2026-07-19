/**
 * Indian place-value notation helpers for Class 6–8 Maths.
 *
 * CRITICAL: never rewrite numbers that are already Indian-grouped
 * (e.g. 10,00,000). A naive Western regex matches the trailing ",00,000"
 * and collapses it to "10,0" — that regression showed up in client audits.
 *
 * Safe policy:
 * - Convert only CLEAR Western groupings with 2+ groups of exactly 3
 *   (e.g. 1,234,567 → 12,34,567).
 * - Leave 2-part forms alone (10,000 / 1,000 — same in both systems).
 * - Do not touch bare integers inside place-value / power-of-ten expressions.
 */

const CLEAR_WESTERN_RE = /\b\d{1,3}(?:,\d{3}){2,}\b/g;

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

/** True when every group after the first is exactly 3 digits (Western). */
export function isClearWesternGrouping(s) {
  const parts = String(s || '').split(',');
  if (parts.length < 3) return false; // 10,000 is ambiguous — leave alone
  if (!/^\d{1,3}$/.test(parts[0])) return false;
  return parts.slice(1).every((p) => /^\d{3}$/.test(p));
}

/** Detect broken / corrupted place-value comma patterns from bad rewrites. */
export function hasBrokenIndianNotation(text) {
  const t = String(text || '');
  // e.g. 3 x 10,0  or  7 × 10,00
  if (/\d\s*[x×*]\s*10,\d{1,2}(?!\d)/i.test(t)) return true;
  // e.g. 9,4,027 or 2,1,009 (single-digit middle group)
  if (/\b\d{1,2},\d,\d{3}\b/.test(t)) return true;
  // e.g. 3 x 1,00,0 (truncated Indian period)
  if (/\d\s*[x×*]\s*\d{1,2},\d{2},\d(?!\d)/i.test(t)) return true;
  return false;
}

function rewriteClearWestern(match) {
  if (!isClearWesternGrouping(match)) return match;
  const n = parseGroupedInteger(match);
  if (n == null) return match;
  return formatIndianNumber(n);
}

/** Prefer Indian place-name vocabulary in prose (light touch). */
function rewritePlaceNames(text) {
  return String(text || '')
    .replace(/\bten\s+millions?\b/gi, 'crore')
    .replace(/\bhundred\s+millions?\b/gi, 'ten crore')
    .replace(/\bone\s+billion\b/gi, 'hundred crore')
    .replace(/\bbillions?\b/gi, 'hundred crore')
    .replace(/\bone\s+million\b/gi, 'ten lakh')
    .replace(/\ba\s+million\b/gi, 'ten lakh')
    .replace(/\bmillions?\b/gi, 'ten lakh')
    .replace(/\bhundred\s+thousands?\b/gi, 'lakh');
}

/**
 * Convert CLEAR Western thousands commas → Indian grouping.
 * Does NOT rewrite bare integers (avoids breaking 10000 in "3 x 10000").
 * Does NOT rewrite already-Indian numbers.
 */
export function standardizeIndianNumberText(text, { rewriteNames = true } = {}) {
  let t = String(text || '');
  // Protect place-value / power-of-ten expressions from any rewrite.
  const shields = [];
  t = t.replace(
    /(\d+\s*[x×*]\s*10(?:\s*\^\s*\d+|\s*to\s+the\s+power\s+\d+)?|\b10\s*\^\s*\d+)/gi,
    (m) => {
      const i = shields.length;
      shields.push(m);
      return `\u0000SHIELD${i}\u0000`;
    },
  );

  t = t.replace(CLEAR_WESTERN_RE, rewriteClearWestern);

  for (let i = 0; i < shields.length; i += 1) {
    t = t.split(`\u0000SHIELD${i}\u0000`).join(shields[i]);
  }
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

/** Apply safe Indian number notation across a V2 structuredContent tree. */
export function applyIndianNotationToStructured(structured, opts = {}) {
  if (!structured || typeof structured !== 'object') return structured;
  return deepMapStrings(structured, (s) => standardizeIndianNumberText(s, opts));
}

/** True when class is typically taught with Indian system emphasis (6–8). */
export function shouldUseIndianNotation(classLabel, subject = '') {
  const cls = Number(String(classLabel || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(cls) || cls < 1) return true;
  if (cls >= 6 && cls <= 10) return true;
  const sub = String(subject || '').toLowerCase();
  return /math|mathematics|arith/.test(sub) && cls <= 12;
}

export default {
  formatIndianNumber,
  parseGroupedInteger,
  isClearWesternGrouping,
  hasBrokenIndianNotation,
  standardizeIndianNumberText,
  applyIndianNotationToStructured,
  shouldUseIndianNotation,
};
