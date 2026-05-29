/**
 * Regex-based activity & project extraction from PDF text.
 * @module services/pdf-activity-extract
 */

import { extractActivitiesFromCuriosityWorkbookPdf } from './curiosity-activity-pdf-parser.js';
import { extractActivityItemsByCanonicalHeadings } from './pdf-activity-canonical-parse.js';
import {
  extractActivityTitleFromBlock,
  looksLikeValidActivityTitle,
  repairActivityItemTitlesFromPdf,
  splitActivityBlocksByTitleSection,
} from './activity-title-utils.js';
import { splitPdfTextByMarkerLines, str } from './pdf-extract-utils.js';

const ACTIVITY_MARKER = /^Activity\s+\d+\b/i;

/** Map PIL-shaped workbook rows to teacher tool fields when needed. */
export function mapActivityRowForToolSlug(row, toolSlug = 'project-idea-lab') {
  if (!row || typeof row !== 'object') return row;
  if (toolSlug !== 'activity-project-generator') return row;

  const out = { ...row };
  if (!out.assessment_criteria_rubric?.length && Array.isArray(out.self_assessment_rubric)) {
    out.assessment_criteria_rubric = [...out.self_assessment_rubric];
  }
  if (!str(out.differentiation) && str(out.differentiation_support_extension)) {
    out.differentiation = out.differentiation_support_extension;
  }
  return out;
}

function parseSimpleActivityBlock(block, index) {
  const title = extractActivityTitleFromBlock(block);
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const objectives = [];
  const materials = [];
  const steps = [];
  let section = '';

  for (const line of lines) {
    if (ACTIVITY_MARKER.test(line)) continue;
    if (/^2\.\s*Learning\s*Objectives/i.test(line) || /Learning Objectives/i.test(line)) {
      section = 'objectives';
      continue;
    }
    if (/^3\.\s*Materials/i.test(line) || /Materials Required/i.test(line)) {
      section = 'materials';
      continue;
    }
    if (/^4\.\s*Step/i.test(line) || /Step-by-step/i.test(line)) {
      section = 'steps';
      continue;
    }
    if (/^1\.\s*Title/i.test(line) || /^1\.\s*Project/i.test(line)) {
      section = 'title';
      continue;
    }

    if (section === 'objectives') objectives.push(line.replace(/^[-•*]\s+/, ''));
    else if (section === 'materials') materials.push(line.replace(/^[-•*]\s+/, ''));
    else if (section === 'steps') steps.push(line.replace(/^\d+[\.)]\s+/, ''));
  }

  if (!title && !steps.length && !objectives.length) return null;

  const safeTitle = title && looksLikeValidActivityTitle(title) ? title : '';

  return {
    sl_no: index + 1,
    title: safeTitle || `Activity ${index + 1}`,
    name: safeTitle || `Activity ${index + 1}`,
    learning_objectives: objectives,
    materials_required: materials,
    step_by_step_procedure: steps,
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=100]
 * @param {string} [toolSlug='project-idea-lab']
 */
export function extractActivityProjectItemsFromPdfText(text, limit = 100, toolSlug = 'project-idea-lab') {
  const raw = str(text);
  if (!raw) return [];

  const slug = str(toolSlug) || 'project-idea-lab';

  const workbook = extractActivitiesFromCuriosityWorkbookPdf(raw);
  if (workbook?.length) {
    const rows = repairActivityItemTitlesFromPdf(workbook, raw)
      .slice(0, limit)
      .map((row, i) =>
        mapActivityRowForToolSlug(
          {
            ...row,
            sl_no: row.sl_no ?? i + 1,
            title: str(row.title || row.name) || `Activity ${i + 1}`,
            _fromPdf: true,
          },
          slug,
        ),
      );
    return rows;
  }

  const titleSectionBlocks = splitActivityBlocksByTitleSection(raw);
  if (titleSectionBlocks.length > 1) {
    const fromSections = [];
    for (const block of titleSectionBlocks) {
      if (fromSections.length >= limit) break;
      const title = extractActivityTitleFromBlock(block);
      if (!title) continue;
      const curiosity = extractActivitiesFromCuriosityWorkbookPdf(block);
      const body =
        curiosity?.[0] && typeof curiosity[0] === 'object'
          ? { ...curiosity[0], title, name: title }
          : { title, name: title, _fromPdf: true };
      fromSections.push(body);
    }
    if (fromSections.length) {
      return repairActivityItemTitlesFromPdf(
        fromSections.map((row, i) =>
          mapActivityRowForToolSlug(
            { ...row, sl_no: row.sl_no ?? i + 1, _fromPdf: true },
            slug,
          ),
        ),
        raw,
      );
    }
  }

  const canonical = extractActivityItemsByCanonicalHeadings(raw, slug, limit);
  if (canonical.length) {
    return repairActivityItemTitlesFromPdf(
      canonical.map((row, i) =>
        mapActivityRowForToolSlug(
          {
            ...row,
            sl_no: row.sl_no ?? i + 1,
            title: str(row.title || row.name) || `Activity ${i + 1}`,
            _fromPdf: true,
          },
          slug,
        ),
      ),
      raw,
    );
  }

  const blocks = splitPdfTextByMarkerLines(raw, ACTIVITY_MARKER, 60);
  const out = [];
  for (const block of blocks) {
    if (out.length >= limit) break;
    const activity = parseSimpleActivityBlock(block, out.length);
    if (activity) out.push(mapActivityRowForToolSlug(activity, slug));
  }

  return repairActivityItemTitlesFromPdf(out.slice(0, limit), raw);
}
