/**
 * Classroom math/chem display — convert ASCII ^2 / H2O into Unicode for PDFs & exports.
 * Keep in sync with client/mobile exam-text-normalize.ts.
 */

const SUBSCRIPT_DIGITS = {
  0: '₀',
  1: '₁',
  2: '₂',
  3: '₃',
  4: '₄',
  5: '₅',
  6: '₆',
  7: '₇',
  8: '₈',
  9: '₉',
};

const SUPERSCRIPT_DIGITS = {
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '+': '⁺',
  '-': '⁻',
  '−': '⁻',
  '(': '⁽',
  ')': '⁾',
};

const GREEK_WORD_MAP = [
  [/\btheta\b/gi, 'θ'],
  [/\balpha\b/gi, 'α'],
  [/\bbeta\b/gi, 'β'],
  [/\bgamma\b/gi, 'γ'],
  [/\bdelta\b/gi, 'δ'],
  [/\bpi\b/gi, 'π'],
  [/\bomega\b/gi, 'ω'],
  [/\bphi\b/gi, 'φ'],
  [/\blambda\b/gi, 'λ'],
  [/\bmu\b/gi, 'μ'],
  [/\bsigma\b/gi, 'σ'],
];

function toSuperscriptRun(raw) {
  return String(raw || '')
    .split('')
    .map((ch) => SUPERSCRIPT_DIGITS[ch] ?? ch)
    .join('');
}

function toSubscriptRun(raw) {
  return String(raw || '')
    .split('')
    .map((ch) => SUBSCRIPT_DIGITS[ch] ?? ch)
    .join('');
}

function isChemOrScienceSubject(subject) {
  const s = String(subject || '')
    .trim()
    .toLowerCase();
  return /chem|science|biology|bio|physics/.test(s);
}

export function formatAsciiMathToUnicode(text) {
  const s = text == null ? '' : String(text);
  if (!s) return '';
  const parts = s.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g);
  return parts
    .map((part) => {
      if (!part) return part;
      if (part.startsWith('$')) return part;
      let out = part;
      for (const [re, sym] of GREEK_WORD_MAP) out = out.replace(re, sym);
      out = out.replace(/\^\{([^{}]+)\}/g, (_m, body) => toSuperscriptRun(body));
      out = out.replace(/\^(-?\d+)/g, (_m, digits) => toSuperscriptRun(digits));
      out = out.replace(/\^([A-Za-z])/g, (_m, letter) => SUPERSCRIPT_DIGITS[letter] || `^${letter}`);
      out = out.replace(/_\{([^{}]+)\}/g, (_m, body) => toSubscriptRun(body));
      out = out.replace(/_(\d+)/g, (_m, digits) => toSubscriptRun(digits));
      return out;
    })
    .join('');
}

export function formatChemicalFormulasInText(text) {
  const s = text == null ? '' : String(text);
  if (!s) return '';
  return s.replace(/\b([A-Z][a-z]?(?:\d+[A-Z]?[a-z]?)*\d*[A-Za-z0-9]*)\b/g, (token) => {
    if (!/\d/.test(token)) return token;
    if (/^[A-Z]{3,}\d+$/.test(token) && token.length <= 6) return token;
    return token.replace(/([A-Za-z\)])(\d+)/g, (_m, prefix, digits) => `${prefix}${toSubscriptRun(digits)}`);
  });
}

export function formatClassroomScienceText(value, subject) {
  let s = value == null ? '' : String(value);
  s = formatAsciiMathToUnicode(s);
  s = formatChemicalFormulasInText(s);
  if (isChemOrScienceSubject(subject)) {
    s = s.replace(/([A-Za-z\)])(\d+)/g, (_m, prefix, digits) => `${prefix}${toSubscriptRun(digits)}`);
  }
  return s;
}

/** Deep-walk strings in structured content for exports / PDF bodies. */
export function formatClassroomScienceDeep(value, subject) {
  if (value == null) return value;
  if (typeof value === 'string') return formatClassroomScienceText(value, subject);
  if (Array.isArray(value)) return value.map((v) => formatClassroomScienceDeep(v, subject));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = formatClassroomScienceDeep(v, subject);
    }
    return out;
  }
  return value;
}
