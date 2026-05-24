/**
 * Regex-based activity & project extraction from PDF text.
 * Wraps curiosity workbook parser with a standard export name.
 * @module services/pdf-activity-extract
 */

import { extractActivitiesFromCuriosityWorkbookPdf } from './curiosity-activity-pdf-parser.js';
import { splitPdfTextByMarkerLines, str } from './pdf-extract-utils.js';

const ACTIVITY_MARKER = /^Activity\s+\d+\b/i;

function parseSimpleActivityBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let title = '';
  const objectives = [];
  const materials = [];
  const steps = [];
  let section = '';

  for (const line of lines) {
    if (ACTIVITY_MARKER.test(line)) continue;
    if (/^2\.\s*Learning\s*Objectives/i.test(line)) {
      section = 'objectives';
      continue;
    }
    if (/^3\.\s*Materials/i.test(line)) {
      section = 'materials';
      continue;
    }
    if (/^4\.\s*Step/i.test(line)) {
      section = 'steps';
      continue;
    }
    if (/^1\.\s*Title/i.test(line)) {
      section = 'title';
      continue;
    }

    if (section === 'title' && !title && line.length >= 4) title = line;
    else if (section === 'objectives') objectives.push(line.replace(/^[-•*]\s+/, ''));
    else if (section === 'materials') materials.push(line.replace(/^[-•*]\s+/, ''));
    else if (section === 'steps') steps.push(line.replace(/^\d+[\.)]\s+/, ''));
    else if (!title && line.length >= 4 && line.length < 160) title = line;
  }

  if (!title && !steps.length) return null;

  return {
    sl_no: index + 1,
    title: title || `Activity ${index + 1}`,
    name: title || `Activity ${index + 1}`,
    learning_objectives: objectives,
    materials_required: materials,
    step_by_step_procedure: steps,
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=100]
 */
export function extractActivityProjectItemsFromPdfText(text, limit = 100) {
  const raw = str(text);
  if (!raw) return [];

  const workbook = extractActivitiesFromCuriosityWorkbookPdf(raw);
  if (workbook?.length) {
    return workbook
      .slice(0, limit)
      .map((row, i) => ({
        ...row,
        sl_no: row.sl_no ?? i + 1,
        title: str(row.title || row.name) || `Activity ${i + 1}`,
        _fromPdf: true,
      }));
  }

  const blocks = splitPdfTextByMarkerLines(raw, ACTIVITY_MARKER, 60);
  const out = [];
  for (const block of blocks) {
    if (out.length >= limit) break;
    const activity = parseSimpleActivityBlock(block, out.length);
    if (activity) out.push(activity);
  }

  return out.slice(0, limit);
}
