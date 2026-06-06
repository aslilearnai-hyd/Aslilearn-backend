/**
 * Educational PDF content cleaner — removes metadata, footers, trailers, duplicates.
 * Used before canonical extraction and tool-specific regex parsers.
 * @module services/pdf-content-cleaner
 */

import { str } from './pdf-extract-utils.js';

/** Lines to drop entirely (trimmed line match). */
const DROP_LINE_PATTERNS = [
  /^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/i,
  /^\s*page\s+\d+\s*(?:of\s+\d+)?\s*$/i,
  /^\s*\d{1,3}\s+of\s+\d{1,3}\s*$/i,
  /^\s*class\s+\d+\s+.*\|\s*chapter\s+/i,
  /^\s*class\s+\d+\s+.*\|\s*subtopic\s+/i,
  /^\s*student\s+completion\s+checklist\s*$/i,
  /^\s*how\s+i\s+should\s+use\s+these\s+\d*\s*assignments?\s*$/i,
  /^\s*how\s+to\s+use\s+these\s+assignments?\s*$/i,
  /^\s*generated\s+content\s*$/i,
  /^\s*nep[\s-]*ncf\b/i,
];

/** Inline fragments stripped from any line. */
const INLINE_STRIP_PATTERNS = [
  /--\s*\d+\s+of\s+\d+\s*--/gi,
  /\bclass\s+\d+\s+[^|]+\|\s*chapter\s+[^|]+\|\s*subtopic\s+[^|]+\s*page\s+\d+/gi,
  /\bclass\s+\d+\s+[^|]+\|\s*chapter\s+[^|]+\s*page\s+\d+/gi,
  /\|\s*page\s*\d+\s*$/gi,
];

/** Start of document trailer — cut everything from here. */
const TRAILER_START_RE =
  /(?:^|\n)\s*(?:student\s+completion\s+checklist|how\s+i\s+should\s+use\s+these\s+\d*\s*assignments?)\b/i;

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isPdfMetadataLine(line) {
  const t = str(line);
  if (!t) return false;
  return DROP_LINE_PATTERNS.some((re) => re.test(t));
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripInlinePdfPollution(text) {
  let t = String(text || '');
  for (const re of INLINE_STRIP_PATTERNS) {
    t = t.replace(re, ' ');
  }
  return t.replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Remove document trailer (checklists, bulk-PDF usage notes).
 * @param {string} text
 */
export function stripDocumentTrailer(text) {
  const t = String(text || '');
  const m = t.match(TRAILER_START_RE);
  if (!m || m.index == null) return t;
  return t.slice(0, m.index).trim();
}

/**
 * @param {string[]} lines
 * @returns {string[]}
 */
export function dedupeParagraphs(lines = []) {
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const line = str(raw);
    if (!line) {
      out.push('');
      continue;
    }
    const key = line.toLowerCase().replace(/\s+/g, ' ').slice(0, 280);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/**
 * @param {string} rawText
 * @param {{ stripTrailer?: boolean }} [options]
 * @returns {string}
 */
export function cleanPdfEducationalContent(rawText, options = {}) {
  let t = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!t.trim()) return '';

  if (options.stripTrailer !== false) {
    t = stripDocumentTrailer(t);
  }

  const lines = t.split('\n');
  const cleaned = [];
  for (const raw of lines) {
    let line = stripInlinePdfPollution(raw);
    if (!line || isPdfMetadataLine(line)) continue;
    cleaned.push(line);
  }

  const deduped = options.dedupeParagraphs === false ? cleaned : dedupeParagraphs(cleaned);
  return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Replace unfilled template placeholders with upload topic/subtopic.
 * @param {string} text
 * @param {{ topic?: string, subtopic?: string, subject?: string }} [params]
 */
export function contextualizeAssignmentPlaceholders(text, params = {}) {
  const topic = str(params.subtopic || params.topic || params.subject || '');
  const chapter = str(params.topic || '');
  if (!topic && !chapter) return String(text || '');

  let t = String(text || '');
  const conceptLabel = topic || chapter;

  t = t.replace(
    /explain\s+in\s+your\s+own\s+words\s+how\s+[^.?\n]+/gi,
    conceptLabel
      ? `Explain in your own words what ${conceptLabel} means and give two examples`
      : 'Explain the main concept in your own words with examples',
  );
  t = t.replace(/\bfinal\s+mastery\s+assignment\s+in\s+([^.,;\n]+)/gi, (_, tail) => {
    const tailTrim = str(tail);
    return conceptLabel && tailTrim.toLowerCase() === conceptLabel.toLowerCase()
      ? `${conceptLabel} Assignment`
      : conceptLabel
        ? `${conceptLabel} Assignment (${tailTrim})`
        : `Assignment on ${tailTrim}`;
  });
  t = t.replace(/\bfinal\s+mastery\s+assignment\b/gi, conceptLabel ? `${conceptLabel} Assignment` : 'this assignment');
  t = t.replace(
    /\bshowing\s+complete\s+understanding\s+of\s+[^.,;\n]+/gi,
    conceptLabel ? `understanding ${conceptLabel}` : 'understanding the concept',
  );
  t = t.replace(/\bextend\s+final\s+mastery\s+assignment\b/gi, conceptLabel ? `extend ${conceptLabel}` : 'extend the concept');
  t = t.replace(
    /\bsquare\s+numbers\s+through\s+final\s+mastery\s+assignment\b/gi,
    conceptLabel ? `${conceptLabel} in daily life` : 'this topic in daily life',
  );

  return t.trim();
}

/** Checklist / bulk-PDF usage bullets that must not appear in assignment sections. */
const CHECKLIST_BULLET_RE =
  /^(?:complete\s+one\s+generation|revise\s+squares|use\s+diagrams|avoid\s+repeating|before\s+submitting|how\s+i\s+should\s+use)/i;

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isAssignmentChecklistLine(line) {
  const t = str(line);
  if (!t) return false;
  if (CHECKLIST_BULLET_RE.test(t)) return true;
  if (/student\s+completion\s+checklist/i.test(t)) return true;
  return false;
}

/**
 * @param {string[]} lines
 * @returns {string[]}
 */
export function filterChecklistBullets(lines = []) {
  return (Array.isArray(lines) ? lines : []).filter((line) => !isAssignmentChecklistLine(line));
}

/**
 * @param {string} text
 * @returns {string}
 */
export function sanitizeAssignmentTextField(text) {
  return stripInlinePdfPollution(
    String(text || '')
      .split('\n')
      .filter((line) => !isPdfMetadataLine(line) && !isAssignmentChecklistLine(line))
      .join('\n'),
  );
}
