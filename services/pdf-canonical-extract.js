/**
 * Universal PDF → canonical JSON (all questions, sections, metadata).
 * Tool-specific formatters consume this via pdf-canonical-mapper.js.
 * @module services/pdf-canonical-extract
 */

import { bulletsFromLines, splitLines, str } from './pdf-extract-utils.js';
import {
  extractWorksheetItemsFromPdfText,
  isWorksheetPdfChrome,
  worksheetTextForPatternExtract,
} from './pdf-worksheet-extract.js';
import { extractToolItemsFromPdfText } from './pdf-tool-extract.js';

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

/**
 * @param {string} pdfText
 * @param {{ toolSlug?: string }} [options]
 * @returns {Record<string, unknown>}
 */
export function extractCanonicalPdfDocument(pdfText, options = {}) {
  const text = String(pdfText || '').trim();
  const toolSlug = str(options.toolSlug);
  const questions = extractWorksheetItemsFromPdfText(text, 500);
  const sections = groupQuestionsIntoCanonicalSections(questions);
  const meta = extractPdfMetadata(splitLines(text));
  const contentBlocks = extractContentBlocks(text);

  const toolExtractPreview = toolSlug
    ? extractToolItemsFromPdfText(toolSlug, text, { limit: 200 })
    : [];

  return {
    version: 1,
    title: meta.title,
    instructions: meta.instructions,
    learningObjectives: meta.learningObjectives,
    answerKey: meta.answerKey,
    sections,
    questions,
    contentBlocks,
    stats: {
      questionCount: questions.length,
      sectionCount: sections.length,
      contentBlockCount: contentBlocks.length,
      textLength: text.length,
      toolExtractItemCount: Array.isArray(toolExtractPreview) ? toolExtractPreview.length : 0,
    },
  };
}

export function canonicalPdfHasExtractableContent(canonical) {
  if (!canonical || typeof canonical !== 'object') return false;
  const stats = canonical.stats || {};
  return (
    Number(stats.questionCount || 0) > 0 ||
    Number(stats.toolExtractItemCount || 0) > 0 ||
    Number(stats.contentBlockCount || 0) > 0
  );
}
