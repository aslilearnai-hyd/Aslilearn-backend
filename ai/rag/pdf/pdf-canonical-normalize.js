/**
 * Universal PDF text normalization — single pass before canonical extraction.
 * No Gemini. Used by pdf-canonical-extract v2.
 * @module services/pdf-canonical-normalize
 */

import { cleanPdfEducationalContent } from './pdf-content-cleaner.js';

const PAGE_FOOTER_RE = /^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gim;
const PAGE_NUM_RE = /^\s*(?:page\s*)?\d{1,3}\s*(?:of\s+\d{1,3})?\s*$/gim;
const WATERMARK_PATTERNS = [
  /\bnep[\s-]*ncf\b/gi,
  /\bworksheet\s*&\s*mcq\b/gi,
  /\|\s*page\s*\d+\s*$/gi,
  /\b\d+\s+a\s+lakh\s+varieties!\b/gi,
];

/**
 * @param {string} rawText
 * @returns {string}
 */
export function normalizePdfRawText(rawText) {
  let t = cleanPdfEducationalContent(rawText, { stripTrailer: true });
  if (!t.trim()) return '';

  t = t.replace(PAGE_FOOTER_RE, '\n');
  t = t.replace(PAGE_NUM_RE, '\n');
  for (const re of WATERMARK_PATTERNS) {
    t = t.replace(re, ' ');
  }
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}

/**
 * @param {string[]} lines
 * @returns {string[]}
 */
export function dedupePdfLines(lines = []) {
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) {
      out.push('');
      continue;
    }
    const key = line.toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/**
 * @param {string} text
 * @returns {{ lines: string[], lineCount: number, charCount: number }}
 */
export function splitNormalizedPdfLines(text) {
  const normalized = normalizePdfRawText(text);
  const lines = dedupePdfLines(normalized.split('\n'));
  return {
    lines,
    lineCount: lines.filter((l) => l.trim()).length,
    charCount: normalized.length,
  };
}
