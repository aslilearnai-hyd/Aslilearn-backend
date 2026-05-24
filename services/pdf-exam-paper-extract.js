/**
 * Regex-based exam paper extraction from PDF text.
 * @module services/pdf-exam-paper-extract
 */

import { extractWorksheetItemsFromPdfText } from './pdf-worksheet-extract.js';
import { splitPdfTextByMarkerLines, str } from './pdf-extract-utils.js';

const PAPER_MARKER = /^(?:Paper|Exam(?:ination)?)\s*(?:\d+)?\b/i;

function groupQuestionsIntoSections(questions) {
  const sectionMap = new Map();
  for (const q of questions) {
    const name = str(q.section) || 'Questions';
    if (!sectionMap.has(name)) sectionMap.set(name, []);
    sectionMap.get(name).push(q);
  }
  return Array.from(sectionMap.entries()).map(([sectionName, qs]) => ({
    sectionName,
    questions: qs,
  }));
}

function parsePaperBlock(block, index) {
  const questions = extractWorksheetItemsFromPdfText(block, 120);
  if (!questions.length) return null;

  const titleLine = block
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^(?:Paper|Exam)\s*(?:Title)?[:\s]/i.test(l) || /^Section\s+[A-F]\b/i.test(l) === false && l.length > 3 && l.length < 120);
  const titleMatch = block.match(/(?:Paper|Exam)\s*(?:Title)?\s*[:\-—]\s*(.+)/i);

  return {
    sl_no: index + 1,
    paper_title: str(titleMatch?.[1]) || str(titleLine) || `Exam Paper ${index + 1}`,
    title: str(titleMatch?.[1]) || str(titleLine) || `Exam Paper ${index + 1}`,
    sections: groupQuestionsIntoSections(questions),
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=50]
 */
export function extractExamPaperItemsFromPdfText(text, limit = 50) {
  const raw = str(text);
  if (!raw) return [];

  const blocks = splitPdfTextByMarkerLines(raw, PAPER_MARKER, 80);
  const papers = [];

  for (const block of blocks) {
    if (papers.length >= limit) break;
    const paper = parsePaperBlock(block, papers.length);
    if (paper) papers.push(paper);
  }

  if (!papers.length) {
    const single = parsePaperBlock(raw, 0);
    if (single) papers.push(single);
  }

  return papers.slice(0, limit);
}
