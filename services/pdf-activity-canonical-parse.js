/**
 * Canonical-heading activity parser for PDFs (teacher 13-section or PIL 14-section).
 * Used when workbook regex misses fields or PDF has no "Activity N" marker.
 */

import { matchCanonicalHeadingLine } from '../config/aiToolTemplates.js';
import {
  extractActivityTitleFromBlock,
  isActivityTemplateTitleLabel,
  isGenericActivityNumberTitle,
  isLikelyActivitySectionHeadingLine,
  looksLikeValidActivityTitle,
  parseActivityNameFromTitleLine,
  splitActivityBlocksByTitleSection,
} from './activity-title-utils.js';
import { str } from './pdf-extract-utils.js';

const ARRAY_HEADING_IDS = new Set([
  'learning_objectives',
  'materials',
  'procedure',
  'teacher_instructions',
  'student_instructions',
  'safety_instructions',
  'assessment_rubric',
]);

const TEACHER_FIELD_BY_HEADING = {
  title: 'title',
  subtopic_prior: 'subtopic_link_prior_knowledge',
  learning_objectives: 'learning_objectives',
  ncf_alignment: 'ncf_competency_alignment',
  materials: 'materials_required',
  procedure: 'step_by_step_procedure',
  teacher_instructions: 'teacher_instructions',
  student_instructions: 'student_instructions',
  differentiation: 'differentiation',
  assessment_rubric: 'assessment_criteria_rubric',
  expected_outcomes: 'expected_learning_outcomes',
  real_life: 'real_life_application',
  reflection: 'reflection_exit_ticket',
};

const PIL_FIELD_BY_HEADING = {
  title: 'title',
  subtopic_prior: 'subtopic_link_prior_knowledge',
  learning_objectives: 'learning_objectives',
  ncf_alignment: 'ncf_competency_alignment',
  materials: 'materials_required',
  procedure: 'step_by_step_procedure',
  safety_instructions: 'safety_care_instructions',
  observation_table: 'observation_data_recording_table',
  creative_output: 'creative_output_final_product',
  differentiation: 'differentiation_support_extension',
  assessment_rubric: 'self_assessment_rubric',
  expected_outcomes: 'expected_learning_outcomes',
  real_life: 'real_life_application',
  reflection: 'reflection_exit_ticket',
};

function fieldMapForTool(toolSlug) {
  return toolSlug === 'activity-project-generator' ? TEACHER_FIELD_BY_HEADING : PIL_FIELD_BY_HEADING;
}

function cleanLine(line) {
  return String(line || '')
    .replace(/^[\s•\-\u2022]+/u, '')
    .replace(/^\d+[\).\s]+/, '')
    .trim();
}

function bulletsFromLines(lines) {
  const out = [];
  for (const line of lines) {
    const c = cleanLine(line);
    if (c) out.push(c);
  }
  return out;
}

function parseTitleFromBlock(lines) {
  const fromBlock = extractActivityTitleFromBlock(lines.join('\n'));
  if (fromBlock) return fromBlock;

  for (let i = 0; i < Math.min(lines.length, 28); i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^Activity\s+\d+/i.test(line)) continue;

    const onSameLine = parseActivityNameFromTitleLine(line);
    if (onSameLine) return str(onSameLine);

    if (isActivityTemplateTitleLabel(line) || /^1\.\s*(?:Title|Project)/i.test(line)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
        const next = str(lines[j]);
        if (!next) continue;
        if (isActivityTemplateTitleLabel(next)) continue;
        const name = parseActivityNameFromTitleLine(next);
        if (name) return name;
        if (
          looksLikeValidActivityTitle(next) &&
          !/^2\.\s|^3\.\s|learning objective|materials required|subtopic/i.test(next)
        ) {
          return next;
        }
        break;
      }
      continue;
    }

    if (line.length >= 4 && line.length < 200 && !/^(?:class|subject|topic)\b/i.test(line)) {
      if (!/^2\.\s|^3\.\s|learning objective|materials required/i.test(line)) {
        const name = parseActivityNameFromTitleLine(line);
        if (name) return name;
      }
    }
  }
  return '';
}

/**
 * @param {string} block
 * @param {string} toolSlug
 * @returns {Record<string, unknown> | null}
 */
export function parseActivityBlockByCanonicalHeadings(block, toolSlug = 'project-idea-lab') {
  const raw = str(block);
  if (!raw || raw.length < 40) return null;

  const fieldByHeading = fieldMapForTool(toolSlug);
  const lines = raw.replace(/\r/g, '\n').split('\n').map((l) => l.trimEnd());
  const title = parseTitleFromBlock(lines);
  if (!title) return null;

  const item = { title, name: title, _fromPdf: true };
  let currentHeadingId = '';
  let bodyLines = [];

  const flush = () => {
    if (!currentHeadingId) return;
    const field = fieldByHeading[currentHeadingId];
    if (!field) {
      bodyLines = [];
      currentHeadingId = '';
      return;
    }
    const bullets = bulletsFromLines(bodyLines);
    const text = bullets.join('\n').trim() || bodyLines.join(' ').trim();
    if (field === 'title') {
      const name = parseActivityNameFromTitleLine(text) || (isActivityTemplateTitleLabel(text) ? '' : text);
      if (name && !isActivityTemplateTitleLabel(name)) {
        item.title = name;
        item.name = name;
      }
    } else if (ARRAY_HEADING_IDS.has(currentHeadingId)) {
      item[field] = bullets.length ? bullets : text ? [text] : [];
    } else {
      item[field] = text;
    }
    bodyLines = [];
    currentHeadingId = '';
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentHeadingId) bodyLines.push('');
      continue;
    }
    if (/^Activity\s+\d+/i.test(trimmed)) continue;

    const heading = isLikelyActivitySectionHeadingLine(trimmed)
      ? matchCanonicalHeadingLine(toolSlug, trimmed)
      : { headingId: null };
    if (heading.headingId && fieldByHeading[heading.headingId]) {
      flush();
      currentHeadingId = heading.headingId;
      if (heading.headingId === 'title') {
        const name = parseActivityNameFromTitleLine(trimmed);
        if (name) bodyLines.push(name);
      } else {
        const after = trimmed.replace(/^\d+[\.)]\s*/, '').trim();
        if (
          after.length > 4 &&
          !isActivityTemplateTitleLabel(after) &&
          !/^(title|learning|materials|step|teacher|student|safety|observation|creative|differentiation|assessment|expected|real|reflection)/i.test(
            after,
          )
        ) {
          bodyLines.push(after);
        }
      }
      continue;
    }

    if (currentHeadingId) bodyLines.push(line);
  }
  flush();

  const hasBody =
    (Array.isArray(item.learning_objectives) && item.learning_objectives.length) ||
    (Array.isArray(item.materials_required) && item.materials_required.length) ||
    (Array.isArray(item.step_by_step_procedure) && item.step_by_step_procedure.length) ||
    str(item.subtopic_link_prior_knowledge);

  return hasBody || title.length >= 4 ? item : null;
}

/**
 * @param {string} text
 * @param {string} toolSlug
 * @param {number} [limit=100]
 */
export function extractActivityItemsByCanonicalHeadings(text, toolSlug = 'project-idea-lab', limit = 100) {
  const raw = str(text);
  if (!raw) return [];

  let blocks = splitActivityBlocksByTitleSection(raw);
  if (!blocks.length) {
    if (/Learning Objectives/i.test(raw) || /Materials Required/i.test(raw)) blocks = [raw];
    else return [];
  }

  const out = [];
  for (const block of blocks) {
    if (out.length >= limit) break;
    const numMatch = block.match(/\bActivity\s+(\d+)\b/i);
    const parsed = parseActivityBlockByCanonicalHeadings(block, toolSlug);
    if (!parsed) continue;
    if (numMatch) {
      parsed.sl_no = Number.parseInt(numMatch[1], 10);
      parsed.question_number = parsed.sl_no;
    }
    out.push(parsed);
  }
  return out;
}
