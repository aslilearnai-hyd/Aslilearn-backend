/**
 * Regex-based Concept Mastery extraction from PDF text (no LLM / extract-only).
 * Handles Tool PDFs that use Item N / Concept N blocks with numbered sections 1–12.
 */

import { matchCanonicalHeadingLine } from '../config/aiToolTemplates.js';

const ITEM_MARKER_LINE = /^(?:Item|Concept|Topic)\s+\d+\b/i;

function str(v) {
  return v == null ? '' : String(v).trim();
}

/** Split PDF into concept item blocks at Item N / Concept N / Topic N markers. */
export function splitPdfTextByConceptItems(text) {
  const raw = str(text);
  if (!raw) return [];

  const lines = raw.replace(/\r/g, '\n').split('\n');
  const chunks = [];
  let current = [];

  for (const line of lines) {
    if (ITEM_MARKER_LINE.test(line.trim())) {
      if (current.length) {
        const chunk = current.join('\n').trim();
        if (chunk.length > 60) chunks.push(chunk);
      }
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length) {
    const chunk = current.join('\n').trim();
    if (chunk.length > 60) chunks.push(chunk);
  }

  return chunks.length ? chunks : raw.trim().length > 60 ? [raw.trim()] : [];
}

const SECTION_FIELD_MAP = {
  simple_definition: 'simple_definition',
  importance: 'why_important',
  prior_knowledge: 'prior_knowledge_needed',
  explanation: 'lesson',
  visual: 'diagram_suggestion',
  examples: 'real_example',
  misconceptions: 'common_mistakes',
  concept_check: 'concept_check_questions',
  key_points: 'key_points',
  exam_tips: 'exam_tips',
  hots: 'hots_question',
  reflection: 'self_reflection_prompt',
};

const ARRAY_FIELDS = new Set(['common_mistakes', 'concept_check_questions', 'key_points']);

function strArr(v) {
  return Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];
}

function splitLines(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim());
}

function parseItemNumber(block) {
  const m = String(block || '').match(/^(?:Item|Concept|Topic)\s+(\d+)\b/i);
  return m ? Number.parseInt(m[1], 10) : 0;
}

function parseConceptName(lines, itemNumber) {
  for (const line of lines.slice(0, 8)) {
    if (!line) continue;
    if (/^(?:Item|Concept|Topic)\s+\d+\b/i.test(line)) continue;
    const named = line.match(/^(?:Concept\s*Name|Title)\s*[:\-—]\s*(.+)$/i);
    if (named?.[1]) return str(named[1]);
    if (/^\d+[\.)]\s/.test(line)) break;
    if (line.length >= 4 && line.length <= 160 && !/^class\b|^subject\b|^topic\b/i.test(line)) {
      return line;
    }
  }
  return itemNumber ? `Concept ${itemNumber}` : 'Concept';
}

function bulletsFromBody(bodyLines) {
  const out = [];
  for (const line of bodyLines) {
    if (!line) continue;
    const bullet = line.replace(/^[-•*]\s*/, '').replace(/^\d+[\.)]\s*/, '').trim();
    if (bullet) out.push(bullet);
  }
  return out;
}

/** Parse one concept block into a Concept Mastery schema object. */
export function parseConceptMasteryBlock(block) {
  const lines = splitLines(block);
  const itemNumber = parseItemNumber(block);
  const concept = {
    sl_no: itemNumber || undefined,
    concept_name: parseConceptName(lines, itemNumber),
    simple_definition: '',
    why_important: '',
    prior_knowledge_needed: '',
    lesson: '',
    diagram_suggestion: '',
    real_example: '',
    common_mistakes: [],
    concept_check_questions: [],
    key_points: [],
    exam_tips: '',
    hots_question: '',
    self_reflection_prompt: '',
    _fromPdf: true,
  };

  let currentField = '';
  let bodyLines = [];

  const flush = () => {
    if (!currentField) return;
    const text = bodyLines.join('\n').trim();
    const bullets = bulletsFromBody(bodyLines);
    if (ARRAY_FIELDS.has(currentField)) {
      concept[currentField] = bullets.length ? bullets : text ? [text] : [];
    } else if (currentField === 'lesson' && !text && bullets.length) {
      concept.lesson = bullets.join('\n');
    } else {
      concept[currentField] = text;
    }
    bodyLines = [];
    currentField = '';
  };

  for (const line of lines) {
    if (!line) {
      if (currentField) bodyLines.push('');
      continue;
    }
    if (/^(?:Item|Concept|Topic)\s+\d+\b/i.test(line)) continue;

    const heading = matchCanonicalHeadingLine('concept-mastery-helper', line);
    if (heading.headingId && SECTION_FIELD_MAP[heading.headingId]) {
      flush();
      currentField = SECTION_FIELD_MAP[heading.headingId];
      const afterLabel = line
        .replace(/^\d+[\.)]\s*/, '')
        .replace(/^.*?(?:definition|important|knowledge|explanation|visual|examples|misconceptions|check questions|key points|exam tips|thinking question|reflection prompt)\s*[:\-—]?\s*/i, '')
        .trim();
      if (afterLabel && afterLabel.length > 3 && !/^simple\b|^why\b|^prior\b|^step/i.test(afterLabel)) {
        bodyLines.push(afterLabel);
      }
      continue;
    }

    if (/^\d+[\.)]\s+/.test(line)) {
      const num = Number.parseInt(line.match(/^(\d+)/)?.[1] || '0', 10);
      const fieldByNum = {
        1: 'simple_definition',
        2: 'why_important',
        3: 'prior_knowledge_needed',
        4: 'lesson',
        5: 'diagram_suggestion',
        6: 'real_example',
        7: 'common_mistakes',
        8: 'concept_check_questions',
        9: 'key_points',
        10: 'exam_tips',
        11: 'hots_question',
        12: 'self_reflection_prompt',
      }[num];
      if (fieldByNum) {
        flush();
        currentField = fieldByNum;
        const rest = line.replace(/^\d+[\.)]\s+/, '').replace(/^.*?(Simple Definition|Why|Prior|Step-by-step|Diagram|Real-life|Common|Concept Check|Key Points|Exam Tips|Higher-order|Self-reflection)[^:]*:\s*/i, '').trim();
        if (rest.length > 2) bodyLines.push(rest);
        continue;
      }
    }

    if (currentField) bodyLines.push(line);
  }
  flush();

  if (!concept.lesson && concept.simple_definition) {
    concept.lesson = concept.simple_definition;
  }

  const hasBody =
    str(concept.lesson).length >= 15 ||
    str(concept.simple_definition).length >= 15 ||
    concept.key_points.length > 0 ||
    concept.concept_check_questions.length > 0;

  if (!hasBody) return null;
  return concept;
}

/**
 * Extract concept mastery items from PDF plain text.
 * @param {string} text
 * @param {number} [limit=200]
 */
export function extractConceptMasteryItemsFromPdfText(text, limit = 200) {
  const blocks = splitPdfTextByConceptItems(text);
  const out = [];
  const cap = Math.max(1, Math.min(500, Number(limit) || 200));

  for (const block of blocks) {
    if (out.length >= cap) break;
    const parsed = parseConceptMasteryBlock(block);
    if (parsed) out.push(parsed);
  }

  if (!out.length) {
    const single = parseConceptMasteryBlock(text);
    if (single) out.push(single);
  }

  return out
    .map((row, i) => ({
      ...row,
      sl_no: row.sl_no ?? i + 1,
      concept_name: str(row.concept_name) || `Concept ${i + 1}`,
      common_mistakes: strArr(row.common_mistakes),
      concept_check_questions: strArr(row.concept_check_questions),
      key_points: strArr(row.key_points),
      _fromPdf: true,
    }))
    .filter((row) => str(row.concept_name) && (str(row.lesson).length >= 15 || str(row.simple_definition).length >= 15));
}
