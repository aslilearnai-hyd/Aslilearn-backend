/**
 * Regex-based rubric / evaluation extraction from PDF text.
 * @module services/pdf-rubric-extract
 */

import { splitPdfTextByMarkerLines, str } from './pdf-extract-utils.js';

const RUBRIC_MARKER = /^(?:Rubric|Evaluation|Report\s*Card)\s+\d+\b/i;

function parseCriterionLine(line) {
  const t = str(line);
  if (!t) return null;

  const levels = {
    excellent: '',
    good: '',
    satisfactory: '',
    needs_improvement: '',
  };

  const dashParts = t.split(/\s*[-–—]\s*/);
  if (dashParts.length >= 2) {
    const name = dashParts[0].replace(/^(Excellent|Good|Average|Satisfactory|Needs?\s*improvement)\s*[:\-—]?\s*/i, '').trim();
    const level = dashParts[0].match(/^(Excellent|Good|Average|Satisfactory|Needs?\s*improvement)/i)?.[1]?.toLowerCase();
    const desc = dashParts.slice(1).join(' — ').trim();
    if (level?.startsWith('excellent')) levels.excellent = desc;
    else if (level?.startsWith('good')) levels.good = desc;
    else if (level?.startsWith('average') || level?.startsWith('satisfactory')) levels.satisfactory = desc;
    else if (level?.includes('need')) levels.needs_improvement = desc;
    else return { name: name || t, excellent: desc, good: '', satisfactory: '', needs_improvement: '' };
    return { name: name || 'Criterion', ...levels };
  }

  if (/^(Presentation|Communication|Teamwork|Criteria|Content|Accuracy)/i.test(t)) {
    return { name: t, excellent: '', good: '', satisfactory: '', needs_improvement: '' };
  }

  return null;
}

function parseRubricBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let title = '';
  const criteria = [];
  let inCriteria = false;

  for (const line of lines) {
    if (RUBRIC_MARKER.test(line)) continue;
    if (/^Criteria\s*[:\-—]?\s*$/i.test(line)) {
      inCriteria = true;
      continue;
    }
    if (!title && line.length >= 3 && line.length < 120 && !/^criteria\b/i.test(line)) {
      title = line;
      continue;
    }
    if (inCriteria || /Excellent|Good|Average|Satisfactory|Presentation|Communication/i.test(line)) {
      const row = parseCriterionLine(line);
      if (row) criteria.push(row);
    }
  }

  if (!title && !criteria.length) return null;

  return {
    sl_no: index + 1,
    title: title || `Rubric ${index + 1}`,
    criteria,
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=50]
 */
export function extractRubricItemsFromPdfText(text, limit = 50) {
  const blocks = splitPdfTextByMarkerLines(str(text), RUBRIC_MARKER, 40);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const rubric = parseRubricBlock(block, out.length);
    if (rubric) out.push(rubric);
  }

  if (!out.length) {
    const single = parseRubricBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.slice(0, limit);
}
