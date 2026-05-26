/**
 * Regex-based Quick Assignment Builder extraction from PDF text (11-section template).
 * @module services/pdf-quick-assignment-extract
 */

import { bulletsFromLines, splitPdfTextByMarkerLines, str, strArr } from './pdf-extract-utils.js';

const ASSIGNMENT_MARKER = /^(?:Item|Assignment)\s+\d+\b/i;

const SECTION_PATTERNS = [
  { key: 'assignment_title', re: /^1\.?\s*Assignment\s*Title\s*[:\-—]?\s*$/i, type: 'text' },
  { key: 'learning_objectives', re: /^2\.?\s*Learning\s*Objectives\s*[:\-—]?\s*$/i, type: 'list' },
  {
    key: 'instructions',
    re: /^3\.?\s*Instructions\s*to\s*Students\s*[:\-—]?\s*$/i,
    type: 'text',
  },
  {
    key: 'concept_based_questions',
    re: /^4\.?\s*Concept[\s-]*based\s*Questions\s*[:\-—]?\s*$/i,
    type: 'questions',
  },
  {
    key: 'application_oriented_tasks',
    re: /^5\.?\s*Application[\s-]*oriented\s*Tasks\s*[:\-—]?\s*$/i,
    type: 'list',
  },
  {
    key: 'real_life_competency_activity',
    re: /^6\.?\s*Real[\s-]*life\s*(?:\/|\s*or\s*)\s*Competency[\s-]*based\s*Activity\s*[:\-—]?\s*$/i,
    type: 'text',
  },
  {
    key: 'creative_thinking_question',
    re: /^7\.?\s*Creative\s*Thinking\s*Question\s*[:\-—]?\s*$/i,
    type: 'text',
  },
  {
    key: 'collaborative_discussion_task',
    re: /^8\.?\s*Collaborative\s*(?:\/|\s*or\s*)\s*Discussion\s*Task\s*(?:\(if\s*suitable\))?\s*[:\-—]?\s*$/i,
    type: 'text',
  },
  {
    key: 'challenge_question_advanced',
    re: /^9\.?\s*Challenge\s*Question\s*for\s*Advanced\s*Learners\s*[:\-—]?\s*$/i,
    type: 'text',
  },
  {
    key: 'assessment_criteria_rubric',
    re: /^11\.?\s*Assessment\s*Criteria\s*(?:\/|\s*or\s*)\s*Rubric\s*[:\-—]?\s*$/i,
    type: 'text',
  },
  {
    key: 'expected_learning_outcomes',
    re: /^13\.?\s*Expected\s*Learning\s*Outcomes\s*[:\-—]?\s*$/i,
    type: 'list',
  },
];

function parseQuestionLines(lines) {
  const out = [];
  for (const line of lines) {
    const cleaned = line.replace(/^\s*[-*•]\s*/, '').trim();
    const numbered = cleaned.match(/^(?:\d+[\).]\s*)(.+)$/);
    const text = (numbered ? numbered[1] : cleaned).trim();
    if (text.length > 2) out.push({ question: text, options: [], answer: '' });
  }
  return out;
}

function parseAssignmentBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const row = {
    sl_no: index + 1,
    assignment_title: '',
    title: '',
    learning_objectives: [],
    instructions: '',
    concept_based_questions: [],
    application_oriented_tasks: [],
    real_life_competency_activity: '',
    creative_thinking_question: '',
    collaborative_discussion_task: '',
    challenge_question_advanced: '',
    assessment_criteria_rubric: '',
    expected_learning_outcomes: [],
    _fromPdf: true,
  };

  let currentKey = null;
  let currentType = 'text';
  const buffer = [];

  const flush = () => {
    if (!currentKey) return;
    const text = buffer.join('\n').trim();
    const bulletLines = bulletsFromLines(buffer.length ? buffer : text.split('\n'));

    switch (currentType) {
      case 'list':
        row[currentKey] = bulletLines.length ? bulletLines : strArr(text);
        break;
      case 'questions':
        row.concept_based_questions = parseQuestionLines(bulletLines.length ? bulletLines : [text]);
        break;
      default:
        if (currentKey === 'assignment_title') {
          row.assignment_title = text.split('\n')[0]?.trim() || text;
          row.title = row.assignment_title;
        } else {
          row[currentKey] = text;
        }
    }
    buffer.length = 0;
  };

  for (const line of lines) {
    if (ASSIGNMENT_MARKER.test(line)) continue;

    const section = SECTION_PATTERNS.find((s) => s.re.test(line));
    if (section) {
      flush();
      currentKey = section.key;
      currentType = section.type;
      const inline = line.replace(section.re, '').trim();
      if (inline) buffer.push(inline);
      continue;
    }

    if (!currentKey && !row.assignment_title && line.length >= 3 && line.length <= 200) {
      row.assignment_title = line;
      row.title = line;
      continue;
    }

    if (currentKey) buffer.push(line);
  }
  flush();

  if (!row.title) row.title = `Assignment ${index + 1}`;
  if (!row.assignment_title) row.assignment_title = row.title;

  const hasBody =
    row.learning_objectives.length > 0 ||
    str(row.instructions).length > 8 ||
    row.concept_based_questions.length > 0 ||
    row.application_oriented_tasks.length > 0 ||
    str(row.real_life_competency_activity).length > 8 ||
    str(row.creative_thinking_question).length > 8 ||
    str(row.assessment_criteria_rubric).length > 8 ||
    row.expected_learning_outcomes.length > 0;

  if (!hasBody) return null;
  return row;
}

/**
 * @param {string} text
 * @param {number} [limit=50]
 */
export function extractQuickAssignmentItemsFromPdfText(text, limit = 50) {
  const blocks = splitPdfTextByMarkerLines(str(text), ASSIGNMENT_MARKER, 40);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const parsed = parseAssignmentBlock(block, out.length);
    if (parsed) out.push(parsed);
  }

  if (!out.length) {
    const single = parseAssignmentBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.slice(0, limit);
}
