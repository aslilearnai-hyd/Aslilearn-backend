/**
 * PDF extraction validation, cleaning, chunking, and retry helpers.
 * Used by gemini-service.js after Gemini returns structured JSON arrays.
 *
 * @module services/pdf-extract-validation
 */

import Joi from 'joi';
import {
  getAiToolTemplate,
  AI_TOOL_ORDERED_SLUGS,
} from '../config/aiToolTemplates.js';
import {
  extractWorksheetItemsFromPdfText,
  splitPdfTextByWorksheetSections,
} from './pdf-worksheet-extract.js';

/** Tools that must return multiple top-level array items when PDF has multiple markers. */
export const MULTI_ITEM_PDF_TOOLS = new Set([
  'my-study-decks',
  'flashcard-generator',
  'short-notes-summaries-maker',
  'reading-practice-room',
  'story-passage-creator',
  'concept-mastery-helper',
  'worksheet-mcq-generator',
  'mock-test-builder',
  'exam-question-paper-generator',
  'concept-breakdown-explainer',
  'smart-qa-practice-generator',
  'quick-assignment-builder',
  'smart-study-guide-generator',
  'chapter-summary-creator',
  'key-points-formula-extractor',
]);

/** Tools that may legitimately return a single consolidated object. */
export const SINGLE_OBJECT_PDF_TOOLS = new Set([
  'daily-class-plan-maker',
  'rubrics-evaluation-generator',
  'homework-creator',
  'lesson-planner',
  'study-schedule-maker',
  'activity-project-generator',
  'project-idea-lab',
]);

export const PDF_EXTRACT_MAX_RETRIES = Math.max(
  1,
  Math.min(5, Number(process.env.PDF_EXTRACT_MAX_RETRIES) || 3),
);

const str = (v) => (v == null ? '' : String(v).trim());
const strArr = (v) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

/** Normalize PDF text before LLM extraction. */
export function cleanPdfTextForExtraction(rawText) {
  let text = String(rawText || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  const lines = text.split('\n').map((line) => {
    let l = line.replace(/[ \t]{2,}/g, ' ').trim();
    l = l.replace(/^(\d+)[.)]\s*/, (m, n) => `${n}. `);
    l = l.replace(/^([A-D])[.)]\s*/i, (_, letter) => `${letter.toUpperCase()}) `);
    return l;
  });

  return lines.filter(Boolean).join('\n').trim();
}

/** Count distinct multi-item markers in PDF text (heuristic). */
export function countExpectedPdfItems(toolType, pdfText) {
  const text = String(pdfText || '');
  const tool = String(toolType || '').trim();

  if (tool === 'flashcard-generator') {
    const cardMarkers = text.match(/(?:^|\n)\s*(?:Card|Flashcard|Flash\s*Card)\s+\d+\b/gim) || [];
    const itemMarkers = text.match(/(?:^|\n)\s*Item\s+\d+\b/gim) || [];
    const frontBackPairs = text.match(/(?:^|\n)\s*Front\s*[:\-]/gim) || [];
    return Math.max(cardMarkers.length, itemMarkers.length, frontBackPairs.length, 0);
  }

  if (tool === 'short-notes-summaries-maker' || tool === 'reading-practice-room' || tool === 'story-passage-creator') {
    const items = text.match(/(?:^|\n)\s*Item\s+\d+\b/gim) || [];
    const stories = text.match(/(?:^|\n)\s*(?:Story|Passage)\s+\d+\b/gim) || [];
    return Math.max(items.length, stories.length, 0);
  }

  if (tool === 'smart-study-guide-generator') {
    const guides =
      text.match(/(?:^|\n)\s*(?:Item|Study\s*Guide|Guide)\s+\d+\b/gim) || [];
    return guides.length;
  }

  if (tool === 'chapter-summary-creator') {
    const chapters =
      text.match(/(?:^|\n)\s*(?:Item|Chapter|Topic)\s+\d+\b/gim) || [];
    return chapters.length;
  }

  if (tool === 'key-points-formula-extractor') {
    const topics =
      text.match(/(?:^|\n)\s*(?:Item|Topic|Key\s*Points)\s+\d+\b/gim) || [];
    return topics.length;
  }

  if (tool === 'quick-assignment-builder') {
    const assignments =
      text.match(/(?:^|\n)\s*(?:Item|Assignment)\s+\d+\b/gim) || [];
    return assignments.length;
  }

  if (tool === 'concept-breakdown-explainer' || tool === 'concept-mastery-helper') {
    const concepts =
      text.match(/(?:^|\n)\s*(?:Item|Concept|Topic)\s+\d+\b/gim) || [];
    return concepts.length;
  }

  if (
    tool === 'worksheet-mcq-generator' ||
    tool === 'smart-qa-practice-generator' ||
    tool === 'mock-test-builder' ||
    tool === 'exam-question-paper-generator'
  ) {
    return extractWorksheetItemsFromPdfText(text, 500).length;
  }

  if (tool === 'daily-class-plan-maker') {
    const slots = text.match(/(?:^|\n)\s*(?:\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}|Period\s+\d+)/gim) || [];
    return slots.length;
  }

  return 0;
}

function countQuestionsInWorksheetItem(item) {
  if (!item || typeof item !== 'object') return 0;
  if (Array.isArray(item.sections)) {
    return item.sections.reduce(
      (n, sec) => n + (Array.isArray(sec?.questions) ? sec.questions.length : 0),
      0,
    );
  }
  if (String(item.question || '').trim()) return 1;
  if (Array.isArray(item.questions)) return item.questions.length;
  return 0;
}

function countQuestionsInExamItem(item) {
  return countQuestionsInWorksheetItem(item);
}

function validateFlashcardItem(item, index) {
  const errors = [];
  const front = str(item?.front);
  const back = str(item?.back);
  if (!front) errors.push(`Item ${index + 1}: missing front`);
  if (!back) errors.push(`Item ${index + 1}: missing back`);
  return errors;
}

function validateStoryItem(item, index) {
  const errors = [];
  const passage = str(item?.passage || item?.content || item?.story_text);
  if (!passage || passage.length < 40) {
    errors.push(`Item ${index + 1}: passage too short or missing`);
  }
  return errors;
}

function validateShortNotesItem(item, index) {
  const errors = [];
  const summary = str(item?.short_note_summary || item?.summary || item?.exam_summary);
  if (!summary || summary.length < 20) {
    errors.push(`Item ${index + 1}: short_note_summary too short or missing`);
  }
  return errors;
}

function validateChapterSummaryItem(item, index) {
  const errors = [];
  const title = str(item?.chapter_summary_title || item?.chapter_title || item?.title);
  const hasBody =
    str(item?.chapter_overview || item?.summary || item?.chapter_summary).length > 15 ||
    (Array.isArray(item?.important_concepts) && item.important_concepts.length > 0) ||
    (Array.isArray(item?.quick_revision_notes) && item.quick_revision_notes.length > 0);
  if (!title && !hasBody) {
    errors.push(`Item ${index + 1}: chapter summary missing title and body sections`);
  }
  return errors;
}

function validateKeyPointsItem(item, index) {
  const errors = [];
  const title = str(item?.topic_title || item?.title);
  const hasBody =
    (Array.isArray(item?.important_concepts) && item.important_concepts.length > 0) ||
    (Array.isArray(item?.must_remember_facts) && item.must_remember_facts.length > 0) ||
    (Array.isArray(item?.key_points) && item.key_points.length > 0) ||
    (Array.isArray(item?.formulae) && item.formulae.length > 0) ||
    (Array.isArray(item?.formulas) && item.formulas.length > 0) ||
    str(item?.one_minute_revision_summary || item?.summary).length > 8;
  if (!title && !hasBody) {
    errors.push(`Item ${index + 1}: key points missing title and body sections`);
  }
  return errors;
}

function validateQuickAssignmentItem(item, index) {
  const errors = [];
  const title = str(item?.assignment_title || item?.title);
  const conceptQs = Array.isArray(item?.concept_based_questions)
    ? item.concept_based_questions
    : Array.isArray(item?.questions)
      ? item.questions
      : [];
  const hasBody =
    conceptQs.length > 0 ||
    (Array.isArray(item?.learning_objectives) && item.learning_objectives.length > 0) ||
    (Array.isArray(item?.application_oriented_tasks) && item.application_oriented_tasks.length > 0) ||
    (Array.isArray(item?.application_tasks) && item.application_tasks.length > 0) ||
    str(item?.instructions).length > 8 ||
    str(item?.assessment_criteria_rubric || item?.marking_criteria).length > 8 ||
    (Array.isArray(item?.expected_learning_outcomes) && item.expected_learning_outcomes.length > 0);
  if (!title && !hasBody) {
    errors.push(`Item ${index + 1}: quick assignment missing title and body sections`);
  }
  return errors;
}

function validateStudyGuideItem(item, index) {
  const errors = [];
  const title = str(item?.title);
  const hasBody =
    (Array.isArray(item?.key_concepts) && item.key_concepts.length > 0) ||
    (Array.isArray(item?.quick_revision_notes) && item.quick_revision_notes.length > 0) ||
    (Array.isArray(item?.revision_checklist) && item.revision_checklist.length > 0) ||
    str(item?.chapter_subtopic_overview || item?.chapter_overview).length > 15 ||
    (Array.isArray(item?.learning_objectives) && item.learning_objectives.length > 0);
  if (!title && !hasBody) {
    errors.push(`Item ${index + 1}: study guide missing title and body sections`);
  }
  return errors;
}

function validateConceptItem(item, index) {
  const errors = [];
  const name = str(item?.concept_name || item?.title || item?.name);
  const lesson = str(item?.lesson || item?.explanation || item?.simple_definition);
  if (!name) errors.push(`Item ${index + 1}: missing concept_name`);
  if (!lesson || lesson.length < 15) errors.push(`Item ${index + 1}: missing lesson/explanation body`);
  return errors;
}

function validateConceptBreakdownItem(item, index) {
  const errors = [];
  const title = str(item?.concept_title || item?.concept_name || item?.title);
  const hasBody =
    str(item?.simple_definition || item?.simple_explanation || item?.explanation).length > 8 ||
    (Array.isArray(item?.breakdown_steps) && item.breakdown_steps.length > 0) ||
    str(item?.quick_revision_summary || item?.summary).length > 8;
  if (!title && !hasBody) {
    errors.push(`Item ${index + 1}: concept breakdown missing title and body sections`);
  }
  return errors;
}

function validateDailyPlanItem(item) {
  const errors = [];
  const hasBody = Boolean(
    (Array.isArray(item?.time_slots) && item.time_slots.length) ||
      (Array.isArray(item?.timeline) && item.timeline.length) ||
      (Array.isArray(item?.objectives) && item.objectives.length) ||
      str(item?.exit_ticket) ||
      str(item?.day_period_topic_breakup) ||
      str(item?.title),
  );
  if (!hasBody) errors.push('Daily plan missing time_slots/timeline/objectives');
  return errors;
}

function validateRubricItem(item) {
  const errors = [];
  const criteria = Array.isArray(item?.criteria) ? item.criteria : [];
  const hasTitle = str(item?.title);
  const hasCriteriaRows =
    criteria.length > 0 ||
    str(item?.name || item?.criterion) ||
    str(item?.excellent);
  if (!hasTitle && !hasCriteriaRows) errors.push('Rubric missing title and criteria');
  return errors;
}

function validateWorksheetItem(item, expectedQuestionCount = 0, isPartialPass = false) {
  const errors = [];
  const qCount = countQuestionsInWorksheetItem(item);
  if (qCount === 0 && !isPartialPass) {
    errors.push('Worksheet has no questions in sections[] or flat rows');
  }
  if (
    !isPartialPass &&
    expectedQuestionCount > 2 &&
    qCount < Math.ceil(expectedQuestionCount * 0.5)
  ) {
    errors.push(
      `Worksheet question count (${qCount}) is far below PDF pattern count (~${expectedQuestionCount})`,
    );
  }
  if (Array.isArray(item?.sections)) {
    for (const sec of item.sections) {
      for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
        const opts = Array.isArray(q?.options) ? q.options : [];
        const isMcq =
          String(q?.type || '').toUpperCase() === 'MCQ' ||
          /section\s*a|mcq/i.test(String(sec?.sectionName || ''));
        if (isMcq && opts.length > 0 && opts.length < 2) {
          errors.push(`MCQ missing options: "${str(q?.question).slice(0, 60)}..."`);
        }
      }
    }
  }
  return errors;
}

function validateExamItem(item, expectedQuestionCount = 0, isPartialPass = false) {
  const errors = validateWorksheetItem(item, expectedQuestionCount, isPartialPass);
  const qCount = countQuestionsInExamItem(item);
  if (qCount === 0 && !str(item?.paper_title || item?.title)) {
    errors.push('Exam paper missing sections/questions and title');
  }
  return errors;
}

/**
 * Validate extracted items for a tool.
 * @param {string} toolType
 * @param {unknown[]} items
 * @param {{ pdfText?: string; expectedItemCount?: number; chunkIndex?: number; chunkTotal?: number }} context
 */
export function validatePdfExtractItems(toolType, items, context = {}) {
  const tool = String(toolType || '').trim();
  const list = Array.isArray(items) ? items.filter((x) => x && typeof x === 'object') : [];
  const errors = [];
  const warnings = [];
  const pdfText = String(context.pdfText || '');
  const expectedFromPdf = Number(context.expectedItemCount) || countExpectedPdfItems(tool, pdfText);
  const isPartialPass = Boolean(context.isPartialPass);
  const template = getAiToolTemplate(tool);
  const requiredFields = template?.requiredFieldsForPdfExtract || [];

  if (!list.length) {
    errors.push('Extract returned zero items');
    return {
      valid: false,
      errors,
      warnings,
      stats: { itemCount: 0, expectedItemCount: expectedFromPdf },
    };
  }

  if (
    MULTI_ITEM_PDF_TOOLS.has(tool) &&
    expectedFromPdf >= 2 &&
    list.length < expectedFromPdf &&
    !context.isPartialPass
  ) {
    errors.push(
      `Expected ~${expectedFromPdf} items from PDF markers but extracted ${list.length}`,
    );
  }

  if (tool === 'flashcard-generator') {
    list.forEach((item, i) => {
      const nested = Array.isArray(item?.cards) ? item.cards : [];
      if (nested.length) {
        nested.forEach((c, j) => errors.push(...validateFlashcardItem(c, j)));
      } else {
        errors.push(...validateFlashcardItem(item, i));
      }
    });
    if (!isPartialPass && expectedFromPdf >= 2 && list.length === 1) {
      const only = list[0];
      const cardCount = Array.isArray(only?.cards) ? only.cards.length : 0;
      if (cardCount < 2) {
        errors.push('Only 1 flashcard extracted; PDF appears to contain multiple cards');
      }
    }
  } else if (tool === 'reading-practice-room' || tool === 'story-passage-creator') {
    list.forEach((item, i) => errors.push(...validateStoryItem(item, i)));
  } else if (tool === 'short-notes-summaries-maker') {
    list.forEach((item, i) => errors.push(...validateShortNotesItem(item, i)));
  } else if (tool === 'chapter-summary-creator') {
    list.forEach((item, i) => errors.push(...validateChapterSummaryItem(item, i)));
  } else if (tool === 'key-points-formula-extractor') {
    list.forEach((item, i) => errors.push(...validateKeyPointsItem(item, i)));
  } else if (tool === 'quick-assignment-builder') {
    list.forEach((item, i) => errors.push(...validateQuickAssignmentItem(item, i)));
  } else if (tool === 'smart-study-guide-generator') {
    list.forEach((item, i) => errors.push(...validateStudyGuideItem(item, i)));
  } else if (tool === 'concept-mastery-helper') {
    list.forEach((item, i) => errors.push(...validateConceptItem(item, i)));
  } else if (tool === 'concept-breakdown-explainer') {
    list.forEach((item, i) => errors.push(...validateConceptBreakdownItem(item, i)));
  } else if (tool === 'daily-class-plan-maker') {
    list.forEach((item) => errors.push(...validateDailyPlanItem(item)));
  } else if (tool === 'rubrics-evaluation-generator') {
    list.forEach((item) => errors.push(...validateRubricItem(item)));
  } else if (tool === 'worksheet-mcq-generator' || tool === 'smart-qa-practice-generator') {
    const expectedQ = expectedFromPdf || countExpectedPdfItems(tool, pdfText);
    if (list.length === 1) {
      errors.push(...validateWorksheetItem(list[0], expectedQ, isPartialPass));
    } else if (!isPartialPass) {
      const flatQs = list.filter((x) => str(x?.question)).length;
      if (expectedQ >= 3 && flatQs < Math.ceil(expectedQ * 0.5)) {
        errors.push(`Extracted ${flatQs} flat questions; PDF pattern found ~${expectedQ}`);
      }
    }
  } else if (tool === 'mock-test-builder' || tool === 'exam-question-paper-generator') {
    const expectedQ = expectedFromPdf || countExpectedPdfItems(tool, pdfText);
    if (list.length === 1) {
      errors.push(...validateExamItem(list[0], expectedQ, isPartialPass));
    } else if (!isPartialPass) {
      const flatQs = list.filter((x) => str(x?.question)).length;
      if (expectedQ >= 3 && flatQs < Math.ceil(expectedQ * 0.5)) {
        errors.push(`Extracted ${flatQs} exam questions; PDF pattern found ~${expectedQ}`);
      }
    }
  }

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    for (const field of requiredFields) {
      const val = item[field];
      const empty =
        val == null ||
        val === '' ||
        (Array.isArray(val) && val.length === 0);
      if (empty && !str(item?.title || item?.name || item?.front || item?.lesson_name)) {
        warnings.push(`Item ${i + 1}: recommended field "${field}" is empty`);
      }
    }
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    warnings,
    stats: {
      itemCount: list.length,
      expectedItemCount: expectedFromPdf,
      questionCount: list.reduce(
        (n, it) => n + countQuestionsInWorksheetItem(it) + (str(it?.question) ? 1 : 0),
        0,
      ),
    },
  };
}

/** Build corrective retry suffix for incomplete Gemini responses. */
export function buildPdfExtractRetryPrompt(basePrompt, validationResult, attempt) {
  const errors = validationResult?.errors || [];
  const stats = validationResult?.stats || {};
  const errBlock = errors.length
    ? errors.map((e) => `- ${e}`).join('\n')
    : '- Response was incomplete or malformed';

  return `${basePrompt}

CRITICAL RETRY (attempt ${attempt}):
The previous response was incomplete or invalid.
Validation errors:
${errBlock}

Expected approximately ${stats.expectedItemCount || 'all'} items from the PDF; you returned ${stats.itemCount || 0}.

You MUST:
1. Return ONLY valid JSON — a JSON ARRAY [ {...}, {...} ] with NO markdown, NO code fences, NO explanation text
2. Extract ALL items from the PDF — do NOT return only the first item
3. Do NOT omit schema fields — use "" or [] for missing optional fields
4. Do NOT shorten arrays — include EVERY question, option, flashcard, note block, and section
5. Preserve exact wording from the PDF — extract-only, no generation
6. For worksheets/exams: include ALL sections (A–E), ALL options (A) B) C) D)), answers, and answer keys
7. For flashcards: one object per card with front AND back
8. For stories/notes: one object per Item N with full passage/summary text`;
}

/** Strict JSON rules appended to every PDF extract prompt. */
export const PDF_STRICT_JSON_RULES = `
STRICT JSON OUTPUT (mandatory):
- Return ONLY a valid JSON array [ ... ] — no markdown, no code fences, no prose before or after
- Do not omit fields from the schema — use "" or [] when a field is absent in the PDF
- Do not shorten arrays — include EVERY question, card, note item, section, and option
- Extract ALL items from the PDF — if multiple worksheets/cards/stories/notes exist, return ALL as separate array elements
- Never return a single object when the PDF contains multiple items — always use a JSON array
- Escape quotes inside strings; do not truncate strings mid-word
- Add "_fromPdf": true on every object
`.trim();

/** Split large PDFs at item/section boundaries for multi-pass extraction. */
export function buildPdfExtractionPasses(toolType, rawText) {
  const text = cleanPdfTextForExtraction(rawText);
  const CHUNK_SIZE = Number(process.env.PDF_EXTRACT_CHUNK_SIZE) || 36_000;
  const OVERLAP = 2_500;
  const tool = String(toolType || '').trim();
  const passes = [];

  if (tool === 'worksheet-mcq-generator' || tool === 'mock-test-builder' || tool === 'exam-question-paper-generator') {
    const sectionChunks = splitPdfTextByWorksheetSections(text);
    if (sectionChunks.length > 1) {
      for (const chunk of sectionChunks) {
        if (str(chunk.text).length > 200) {
          passes.push({
            text: chunk.text,
            label: chunk.sectionName || 'section',
            strategy: 'section',
          });
        }
      }
    }
  }

  const itemChunks = splitPdfByItemMarkers(tool, text);
  if (itemChunks.length > 1 && itemChunks.every((c) => c.length < CHUNK_SIZE)) {
    for (const chunk of itemChunks) {
      passes.push({ text: chunk, label: 'item-marker', strategy: 'item' });
    }
  }

  if (passes.length) return passes;

  if (text.length <= CHUNK_SIZE) {
    return [{ text, label: 'full', strategy: 'full' }];
  }

  for (let i = 0; i < text.length; i += CHUNK_SIZE - OVERLAP) {
    const slice = text.slice(i, i + CHUNK_SIZE).trim();
    if (slice.length > 500) {
      passes.push({
        text: slice,
        label: `chunk-${passes.length + 1}`,
        strategy: 'size',
        offset: i,
      });
    }
  }
  return passes.length ? passes : [{ text, label: 'full', strategy: 'full' }];
}

/** Split PDF at Item N / Card N markers for multi-item tools. */
export function splitPdfByItemMarkers(toolType, text) {
  const tool = String(toolType || '').trim();
  const markerLinePatterns = {
    'my-study-decks': /^(?:Card|Flashcard|Flash\s*Card|Item)\s+\d+\b/i,
    'flashcard-generator': /^(?:Card|Flashcard|Flash\s*Card|Item)\s+\d+\b/i,
    'short-notes-summaries-maker': /^Item\s+\d+\b/i,
    'reading-practice-room': /^(?:Item|Story|Passage|Reading\s*Practice)\s+\d+\b/i,
    'story-passage-creator': /^(?:Item|Story|Passage)\s+\d+\b/i,
    'concept-mastery-helper': /^(?:Item|Concept|Topic)\s+\d+\b/i,
  };
  const lineRe = markerLinePatterns[tool];
  if (!lineRe) return [];

  const lines = String(text || '').replace(/\r/g, '\n').split('\n');
  const chunks = [];
  let current = [];

  for (const line of lines) {
    if (lineRe.test(line.trim())) {
      if (current.length) {
        const chunk = current.join('\n').trim();
        if (chunk.length > 80) chunks.push(chunk);
      }
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length) {
    const chunk = current.join('\n').trim();
    if (chunk.length > 80) chunks.push(chunk);
  }

  return chunks.length > 1 ? chunks : [];
}

/** Normalize a single extracted item (options, numbering, whitespace). */
export function normalizeExtractedItem(toolType, item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };

  if (Array.isArray(out.options)) {
    out.options = out.options
      .map((opt) => {
        let s = str(opt);
        if (/^[A-Da-d][.)]\s*/.test(s)) {
          s = s.replace(/^([A-Da-d])[.)]\s*/, (_, l) => `${l.toUpperCase()}) `);
        }
        return s;
      })
      .filter(Boolean);
  }

  if (Array.isArray(out.sections)) {
    out.sections = out.sections.map((sec) => ({
      ...sec,
      sectionName: str(sec?.sectionName || sec?.name),
      questions: (Array.isArray(sec?.questions) ? sec.questions : []).map((q, i) => ({
        ...q,
        question: str(q?.question).replace(/\s+/g, ' '),
        question_number: q?.question_number ?? q?.sl_no ?? i + 1,
        options: Array.isArray(q?.options)
          ? q.options.map((o) => str(o).replace(/\s+/g, ' ')).filter(Boolean)
          : [],
        answer: str(q?.answer),
      })),
    }));
  }

  if (toolType === 'my-study-decks' || toolType === 'flashcard-generator') {
    out.front = str(out.front);
    out.back = str(out.back);
  }

  if (toolType === 'reading-practice-room' || toolType === 'story-passage-creator') {
    out.passage = str(out.passage || out.content || out.story_text);
  }

  if (toolType === 'short-notes-summaries-maker') {
    out.short_note_summary = str(out.short_note_summary || out.summary || out.exam_summary);
  }

  return out;
}

const PDF_EXTRACT_MAX_ITEMS = Math.max(
  50,
  Math.min(5000, Number(process.env.PDF_EXTRACT_MAX_ITEMS) || 500),
);

/** Safely append extract rows without spread-related RangeError on bad payloads. */
export function appendPdfExtractItems(target, batch, maxItems = PDF_EXTRACT_MAX_ITEMS) {
  if (!Array.isArray(target)) return target;
  if (!batch) return target;
  const list = Array.isArray(batch) ? batch : typeof batch === 'object' ? [batch] : [];
  for (let i = 0; i < list.length && target.length < maxItems; i += 1) {
    const row = list[i];
    if (row && typeof row === 'object') target.push(row);
  }
  return target;
}

function capExtractArray(arr) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= PDF_EXTRACT_MAX_ITEMS) return arr;
  console.warn(`[PDF] Truncating oversized extract array (${arr.length} → ${PDF_EXTRACT_MAX_ITEMS})`);
  return arr.slice(0, PDF_EXTRACT_MAX_ITEMS);
}

/** Parse Gemini PDF response — array, wrapped object, or single object. */
export function parsePdfExtractResponse(raw) {
  const cleaned = String(raw || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) return [];

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (firstErr) {
    if (String(firstErr?.message || '').includes('Invalid array length')) {
      throw new Error('Gemini JSON response too large to parse — split the PDF or reduce item count.');
    }
    const start = cleaned.indexOf('[');
    if (start === -1) throw firstErr;
    const body = cleaned.slice(start);
    const lastObjEnd = body.lastIndexOf('}');
    if (lastObjEnd > 10) {
      const repaired = `${body.slice(0, lastObjEnd + 1)}]`;
      try {
        parsed = JSON.parse(repaired);
        console.warn('[PDF] Repaired truncated JSON array from Gemini extract');
      } catch (repairErr) {
        if (String(repairErr?.message || '').includes('Invalid array length')) {
          throw new Error('Gemini JSON response too large to parse — split the PDF or reduce item count.');
        }
        const innerStart = body.indexOf('{');
        const innerEnd = body.lastIndexOf('}');
        if (innerStart !== -1 && innerEnd > innerStart) {
          try {
            parsed = [JSON.parse(body.slice(innerStart, innerEnd + 1))];
          } catch {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
    } else {
      throw firstErr;
    }
  }

  if (Array.isArray(parsed)) return capExtractArray(parsed);

  if (parsed && typeof parsed === 'object') {
    for (const key of [
      'items',
      'results',
      'data',
      'cards',
      'flashcards',
      'questions',
      'concepts',
      'notes',
      'stories',
      'passages',
    ]) {
      if (Array.isArray(parsed[key]) && parsed[key].length) {
        return capExtractArray(parsed[key]);
      }
    }
    if (
      parsed.sections ||
      parsed.cards ||
      parsed.front ||
      parsed.passage ||
      parsed.short_note_summary ||
      parsed.concept_name ||
      parsed.criteria
    ) {
      return [parsed];
    }
  }

  return [];
}

/** Joi schema for top-level PDF extract array wrapper (logging / optional strict check). */
export const pdfExtractArraySchema = Joi.array()
  .items(Joi.object().unknown(true))
  .min(1);

export function isSupportedPdfExtractTool(toolType) {
  return AI_TOOL_ORDERED_SLUGS.includes(String(toolType || '').trim());
}
