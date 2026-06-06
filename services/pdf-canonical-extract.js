/**
 * Universal PDF → canonical JSON v2 (all content types, one parse).
 * Tool formatters consume this via tool-formatters/ or pdf-canonical-mapper.js.
 * @module services/pdf-canonical-extract
 */

import { bulletsFromLines, splitLines, str } from './pdf-extract-utils.js';
import { splitNormalizedPdfLines } from './pdf-canonical-normalize.js';
import {
  extractWorksheetItemsFromPdfText,
  isWorksheetPdfChrome,
  worksheetTextForPatternExtract,
} from './pdf-worksheet-extract.js';
import { extractToolItemsFromPdfText } from './pdf-tool-extract.js';
import { AI_TOOL_ORDERED_SLUGS } from '../config/aiToolTemplates.js';

function groupQuestionsIntoCanonicalSections(questions = []) {
  const map = new Map();
  for (const q of questions) {
    const name = str(q.section) || 'Questions';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push({
      question_number: q.question_number ?? q.sl_no,
      question: str(q.question),
      options: Array.isArray(q.options) ? q.options.map((o) => str(o)).filter(Boolean) : [],
      answer: str(q.answer),
      section: name,
      type: str(q.type),
      marks: q.marks,
      explanation: str(q.explanation),
      bloom_level: str(q.bloom_level),
    });
  }
  return Array.from(map.entries()).map(([sectionName, qs]) => ({
    sectionName,
    questions: qs,
    count: qs.length,
  }));
}

function extractHeadings(lines = []) {
  const headings = [];
  for (const line of lines) {
    const t = str(line);
    if (!t) continue;
    if (/^#{1,4}\s+/.test(t)) {
      headings.push({ level: (t.match(/^#+/) || ['#'])[0].length, text: t.replace(/^#+\s+/, '') });
      continue;
    }
    if (/^section\s+[a-g]\b/i.test(t) || /^[A-Z][A-Za-z\s/&-]{2,50}:$/.test(t)) {
      headings.push({ level: 2, text: t });
      continue;
    }
    if (/^(?:learning\s*objectives?|instructions?|answer\s*key|activity|project)\b/i.test(t) && t.length < 80) {
      headings.push({ level: 3, text: t });
    }
  }
  return headings;
}

function extractPdfMetadata(lines = []) {
  let title = '';
  let instructions = '';
  const learningObjectives = [];
  let answerKey = '';
  let inObjectives = false;
  let inInstructions = false;
  let inAnswerKey = false;

  for (const line of lines) {
    const t = str(line);
    if (!t) {
      inObjectives = false;
      inInstructions = false;
      continue;
    }
    if (/^answer\s*key\b/i.test(t)) {
      inAnswerKey = true;
      inObjectives = false;
      inInstructions = false;
      continue;
    }
    if (/^learning\s*objectives?\b/i.test(t)) {
      inObjectives = true;
      inInstructions = false;
      inAnswerKey = false;
      continue;
    }
    if (/^instructions?\s*(?:to\s*students)?\b/i.test(t)) {
      inInstructions = true;
      inObjectives = false;
      inAnswerKey = false;
      continue;
    }
    const titleMatch = t.match(/^(?:worksheet\s*title|title|topic)\s*[:\-—]\s*(.+)$/i);
    if (titleMatch) {
      title = str(titleMatch[1]);
      continue;
    }
    if (inAnswerKey) {
      answerKey += (answerKey ? '\n' : '') + t;
      continue;
    }
    if (inObjectives) {
      const bullet = t.replace(/^[-•*]\s*/, '').replace(/^\d+[\.)]\s*/, '');
      if (bullet) learningObjectives.push(bullet);
      continue;
    }
    if (inInstructions) {
      instructions += (instructions ? '\n' : '') + t;
      continue;
    }
    if (
      !title &&
      t.length >= 4 &&
      t.length <= 160 &&
      !/^\d+[\.)]/.test(t) &&
      !/^section\s+[a-e]\b/i.test(t) &&
      !isWorksheetPdfChrome(t)
    ) {
      title = t;
    }
  }

  return {
    title,
    instructions: str(instructions),
    learningObjectives,
    answerKey: str(answerKey),
  };
}

function extractContentBlocks(text) {
  const plain = worksheetTextForPatternExtract(text);
  const lines = splitLines(plain);
  const blocks = [];
  let current = null;

  const flush = () => {
    if (!current || !current.lines.length) return;
    blocks.push({
      kind: current.kind,
      heading: current.heading,
      lines: [...current.lines],
      text: current.lines.join('\n').trim(),
    });
    current = null;
  };

  for (const line of lines) {
    const t = str(line);
    if (!t) {
      flush();
      continue;
    }
    if (/^section\s+[a-f]\b/i.test(t) || /^#{1,4}\s+/.test(t) || (/^[A-Z][^.?!]{2,60}:$/.test(t) && t.length < 80)) {
      flush();
      current = { kind: 'section', heading: t.replace(/^#{1,4}\s+/, ''), lines: [] };
      continue;
    }
    if (/^\d+[\.)]\s+[A-Z]/.test(t) && !/\?/.test(t) && t.length < 100) {
      flush();
      current = { kind: 'numbered', heading: t, lines: [] };
      continue;
    }
    if (!current) current = { kind: 'paragraph', heading: '', lines: [] };
    current.lines.push(t);
  }
  flush();
  return blocks.filter((b) => b.text.length >= 20);
}

function extractParagraphs(lines = []) {
  return lines
    .filter((l) => {
      const t = str(l);
      return t.length >= 40 && !/^\d+[\.)]/.test(t) && !/^section\s+/i.test(t);
    })
    .map((text) => ({ text: str(text) }));
}

function extractAnswersFromQuestions(questions = []) {
  return questions
    .filter((q) => str(q.answer))
    .map((q) => ({
      question_number: q.question_number ?? q.sl_no,
      section: str(q.section),
      answer: str(q.answer),
    }));
}

function bucketToolExtract(toolSlug, items = []) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return {};

  switch (toolSlug) {
    case 'activity-project-generator':
    case 'project-idea-lab':
      return { activities: list };
    case 'my-study-decks':
    case 'flashcard-generator':
      return { flashcards: list };
    case 'reading-practice-room':
    case 'story-passage-creator':
      return { stories: list };
    case 'concept-mastery-helper':
    case 'concept-breakdown-explainer':
    case 'smart-study-guide-generator':
    case 'chapter-summary-creator':
    case 'key-points-formula-extractor':
      return { concepts: list };
    case 'lesson-planner':
    case 'study-schedule-maker':
    case 'daily-class-plan-maker':
      return { timelines: list };
    default:
      return {};
  }
}

function aggregateAllToolPreviews(text) {
  const previews = {};
  for (const slug of AI_TOOL_ORDERED_SLUGS) {
    const items = extractToolItemsFromPdfText(slug, text, { limit: 50 });
    if (items.length) previews[slug] = items.length;
  }
  return previews;
}

/** Run all 22 tool regex extractors once and merge into canonical buckets. */
function aggregateAllToolBuckets(text) {
  const merged = {
    activities: [],
    flashcards: [],
    stories: [],
    concepts: [],
    timelines: [],
  };
  for (const slug of AI_TOOL_ORDERED_SLUGS) {
    const items = extractToolItemsFromPdfText(slug, text, { limit: 50 });
    const buckets = bucketToolExtract(slug, items);
    for (const key of Object.keys(merged)) {
      if (Array.isArray(buckets[key]) && buckets[key].length) {
        merged[key].push(...buckets[key]);
      }
    }
  }
  return merged;
}

/**
 * @param {string} pdfText
 * @param {{ toolSlug?: string }} [options]
 * @returns {Record<string, unknown>}
 */
export function extractCanonicalPdfDocument(pdfText, options = {}) {
  const { lines, lineCount, charCount } = splitNormalizedPdfLines(pdfText);
  const text = lines.join('\n');
  const toolSlug = str(options.toolSlug);

  const questions = extractWorksheetItemsFromPdfText(text, 500);
  const sections = groupQuestionsIntoCanonicalSections(questions);
  const meta = extractPdfMetadata(lines);
  const contentBlocks = extractContentBlocks(text);
  const headings = extractHeadings(lines);
  const paragraphs = extractParagraphs(lines);
  const answers = extractAnswersFromQuestions(questions);

  const toolItems = toolSlug ? extractToolItemsFromPdfText(toolSlug, text, { limit: 200 }) : [];
  const toolBuckets = bucketToolExtract(toolSlug, toolItems);
  const allBuckets = aggregateAllToolBuckets(text);
  const toolPreviews = aggregateAllToolPreviews(text);

  const v2 = {
    version: 2,
    extractionEngine: 'canonical',
    title: meta.title,
    headings,
    sections,
    paragraphs,
    questions,
    answers,
    tables: [],
    objectives: meta.learningObjectives,
    instructions: meta.instructions,
    timelines: [...(toolBuckets.timelines || []), ...(allBuckets.timelines || [])],
    activities: [...(toolBuckets.activities || []), ...(allBuckets.activities || [])],
    concepts: [...(toolBuckets.concepts || []), ...(allBuckets.concepts || [])],
    flashcards: [...(toolBuckets.flashcards || []), ...(allBuckets.flashcards || [])],
    stories: [...(toolBuckets.stories || []), ...(allBuckets.stories || [])],
    contentBlocks,
    metadata: {
      textLength: charCount,
      lineCount,
      questionCount: questions.length,
      toolSlug: toolSlug || null,
      toolPreviews,
      normalizedAt: new Date().toISOString(),
    },
    stats: {
      questionCount: questions.length,
      sectionCount: sections.length,
      contentBlockCount: contentBlocks.length,
      textLength: charCount,
      toolExtractItemCount: toolItems.length,
      headingCount: headings.length,
      paragraphCount: paragraphs.length,
    },
    // v1 compatibility aliases
    learningObjectives: meta.learningObjectives,
    answerKey: meta.answerKey,
  };

  return v2;
}

export function canonicalPdfHasExtractableContent(canonical) {
  if (!canonical || typeof canonical !== 'object') return false;
  const stats = canonical.stats || {};
  const meta = canonical.metadata || {};
  return (
    Number(stats.questionCount || 0) > 0 ||
    Number(stats.toolExtractItemCount || 0) > 0 ||
    Number(stats.contentBlockCount || 0) > 0 ||
    (Array.isArray(canonical.activities) && canonical.activities.length > 0) ||
    (Array.isArray(canonical.flashcards) && canonical.flashcards.length > 0) ||
    (Array.isArray(canonical.stories) && canonical.stories.length > 0) ||
    (Array.isArray(canonical.concepts) && canonical.concepts.length > 0) ||
    Object.keys(meta.toolPreviews || {}).length > 0
  );
}
