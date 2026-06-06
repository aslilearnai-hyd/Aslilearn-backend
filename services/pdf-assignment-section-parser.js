/**
 * Parse Quick Assignment 11-section template from PDF text.
 * Mirrors client/src/lib/parse-quick-assignment.ts section detection.
 * @module services/pdf-assignment-section-parser
 */

import { str } from './pdf-extract-utils.js';
import { stripInlinePdfPollution, isPdfMetadataLine } from './pdf-content-cleaner.js';
import {
  isAssignmentBankNoiseLine,
  isGenerationBoundaryLine,
  parseGenerationHeader,
} from './pdf-assignment-boundaries.js';

/**
 * @param {string} title
 * @returns {number}
 */
export function detectAssignmentSectionNum(title) {
  const t = String(title || '').toLowerCase();
  if (/assignment\s*title|^title$/.test(t)) return 1;
  if (/learning\s*objectives?/.test(t)) return 2;
  if (/instructions/.test(t)) return 3;
  if (/concept[\s-]*based/.test(t)) return 4;
  if (/application/.test(t)) return 5;
  if (/real[\s-]*life|competency/.test(t)) return 6;
  if (/creative/.test(t)) return 7;
  if (/collaborative|discussion/.test(t)) return 8;
  if (/challenge|advanced/.test(t)) return 9;
  if (/assessment|rubric|marking/.test(t)) return 10;
  if (/expected\s*learning|learning\s*outcomes?/.test(t)) return 11;
  return 0;
}

/**
 * @param {string} block
 * @returns {Map<number, string>}
 */
export function parseAssignmentSections(block) {
  const lines = String(block || '').split('\n');
  const sections = new Map();
  let current = 0;
  let maxSectionSeen = 0;
  const buffers = new Map();

  const pushLine = (num, line) => {
    if (!num || num < 1 || num > 11) return;
    if (!buffers.has(num)) buffers.set(num, []);
    buffers.get(num).push(line);
  };

  const switchSection = (num) => {
    if (!num || num < 1 || num > 11) return false;
    if (maxSectionSeen >= 9 && num <= 3) return true;
    if (num < current && current >= 5 && num <= 4) return true;
    current = num;
    maxSectionSeen = Math.max(maxSectionSeen, num);
    return false;
  };

  for (const raw of lines) {
    let line = str(raw);
    if (!line || isPdfMetadataLine(line)) continue;
    if (isAssignmentBankNoiseLine(line)) break;

    const gen = parseGenerationHeader(line);
    if (gen && gen.generation >= 2) break;

    line = stripInlinePdfPollution(line);
    if (!line || isGenerationBoundaryLine(line)) break;

    const sectionOnly = line.match(/^section\s+(\d{1,2})\s*:?\s*$/i);
    if (sectionOnly) {
      if (switchSection(Number(sectionOnly[1]))) break;
      continue;
    }

    const sectionWithTitle = line.match(/^section\s+(\d{1,2})\s*[:\-—]\s*(.+)$/i);
    if (sectionWithTitle) {
      if (switchSection(Number(sectionWithTitle[1]))) break;
      const titleHint = detectAssignmentSectionNum(sectionWithTitle[2]);
      if (titleHint > 0) {
        if (switchSection(titleHint)) break;
      }
      continue;
    }

    const byBareTitle = detectAssignmentSectionNum(line);
    if (byBareTitle > 0 && line.length < 120 && !/^[-•*]/.test(line)) {
      if (switchSection(byBareTitle)) break;
      continue;
    }

    const numbered = line.match(/^(?:#{1,3}\s*)?(\d{1,2})\.\s*(.+)$/);
    if (numbered) {
      const byTitle = detectAssignmentSectionNum(numbered[2]);
      let num = byTitle > 0 ? byTitle : Number(numbered[1]);
      if (num === 11 && /assessment|rubric/i.test(numbered[2])) num = 10;
      if (num === 13) num = 11;
      if (switchSection(num)) break;
      const rest = str(numbered[2]);
      if (rest && !detectAssignmentSectionNum(rest)) pushLine(current, rest);
      continue;
    }

    pushLine(current, line);
  }

  for (const [num, bodyLines] of buffers.entries()) {
    const chunk = bodyLines.join('\n').trim();
    if (!chunk) continue;
    sections.set(num, chunk);
  }

  return sections;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function parseConceptQuestionBlock(text) {
  const out = [];
  let current = null;

  const flush = () => {
    if (current?.question) out.push(current);
    current = null;
  };

  for (const raw of String(text || '').split('\n')) {
    const line = str(raw);
    if (!line) continue;

    const qMatch = line.match(/^(?:Q|Question)?\s*(\d+)[\.\):]\s*(.+)$/i);
    if (qMatch) {
      flush();
      current = { question_number: Number(qMatch[1]), question: qMatch[2], options: [], answer: '' };
      continue;
    }

    const numMatch = line.match(/^(\d+)[\.\)]\s+(.+)$/);
    if (numMatch && !/^(\d+)[\.\)]\s*[A-Da-d][\.\)]/.test(line)) {
      flush();
      current = { question_number: Number(numMatch[1]), question: numMatch[2], options: [], answer: '' };
      continue;
    }

    const optMatch = line.match(/^[A-Da-d][\.\)]\s+(.+)$/);
    if (optMatch && current) {
      current.options.push(optMatch[1]);
      continue;
    }

    if (current) {
      current.question = `${current.question} ${line}`.trim();
    } else if (line.length > 4) {
      out.push({ question: line, options: [], answer: '' });
    }
  }
  flush();
  return out;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function parseBulletListBlock(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    let line = str(raw).replace(/^[-•*]\s+/, '');
    if (!line || isAssignmentBankNoiseLine(line)) break;
    if (/^task\s*\d+\s*[:\-—]/i.test(line)) {
      out.push(line);
      continue;
    }
    const num = line.match(/^(\d+)[\.\)]\s+(.+)$/);
    if (num) line = num[2];
    if (isAssignmentBankNoiseLine(line)) break;
    if (line.length > 1) out.push(line);
  }
  return out;
}
