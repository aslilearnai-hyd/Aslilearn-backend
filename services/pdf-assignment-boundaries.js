/**
 * Assignment bank boundary detection — isolate one Generation / assignment from bulk PDFs.
 * @module services/pdf-assignment-boundaries
 */

import { splitPdfTextByMarkerLines, str } from './pdf-extract-utils.js';
import { cleanPdfEducationalContent } from './pdf-content-cleaner.js';
import { detectAssignmentSectionNum } from './pdf-assignment-section-parser.js';

export const GENERATION_START_RE = /^generation\s+(\d{1,3})\s*[:\-—]?\s*(.*)$/i;

/**
 * @param {string} line
 * @returns {{ generation: number, title: string } | null}
 */
export function parseGenerationHeader(line) {
  const m = str(line).match(GENERATION_START_RE);
  if (!m) return null;
  return { generation: Number(m[1]), title: str(m[2]) };
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isGenerationBoundaryLine(line) {
  return GENERATION_START_RE.test(str(line));
}

/**
 * Lines that must never appear inside a section body.
 * @param {string} line
 */
export function isAssignmentBankNoiseLine(line) {
  const t = str(line);
  if (!t) return true;
  if (isGenerationBoundaryLine(t)) return true;
  if (/^generation\s+\d+/i.test(t)) return true;
  return false;
}

/**
 * Split bulk assignment bank PDF into one block per Generation N.
 * @param {string} text
 * @returns {{ generation: number, title: string, text: string }[]}
 */
export function splitByGenerationMarkers(text) {
  const cleaned = cleanPdfEducationalContent(text);
  const chunks = splitPdfTextByMarkerLines(cleaned, GENERATION_START_RE, 60);
  if (chunks.length <= 1) {
    const single = isolateGenerationBlock(cleaned, 1);
    if (!single) return [];
    return [{ generation: 1, title: '', text: single }];
  }

  const out = [];
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const headerLine = lines.find((l) => isGenerationBoundaryLine(l));
    const parsed = headerLine ? parseGenerationHeader(headerLine) : null;
    const gen = parsed?.generation ?? out.length + 1;
    const title = parsed?.title || '';
    const body = isolateGenerationBlock(chunk, gen);
    if (body && body.length >= 60) {
      out.push({ generation: gen, title, text: body });
    }
  }
  return out;
}

/**
 * Keep only one generation's content; stop before the next Generation header.
 * @param {string} block
 * @param {number} [keepGeneration=1]
 */
export function isolateGenerationBlock(block, keepGeneration = 1) {
  const lines = String(block || '').split('\n');
  const out = [];
  let started = keepGeneration === 1;
  let seenTargetHeader = keepGeneration === 1;

  for (const raw of lines) {
    const line = str(raw);
    const gen = parseGenerationHeader(line);
    if (gen) {
      if (gen.generation > keepGeneration) break;
      if (gen.generation === keepGeneration) {
        started = true;
        seenTargetHeader = true;
        if (gen.title) out.push(gen.title);
        continue;
      }
      if (gen.generation < keepGeneration) continue;
    }
    if (!started && keepGeneration === 1) {
      started = true;
    }
    if (started) out.push(raw);
  }

  if (!out.length && !seenTargetHeader && keepGeneration === 1) {
    return truncateBeforeGeneration(lines, 2).join('\n').trim();
  }
  return out.join('\n').trim();
}

/**
 * @param {string[]} lines
 * @param {number} stopAtGeneration
 */
function truncateBeforeGeneration(lines, stopAtGeneration) {
  const out = [];
  for (const raw of lines) {
    const gen = parseGenerationHeader(str(raw));
    if (gen && gen.generation >= stopAtGeneration) break;
    out.push(raw);
  }
  return out;
}

/**
 * Split when Section 1 / Assignment Title repeats (fallback when no Generation headers).
 * @param {string} text
 */
export function splitByRepeatedSectionOne(text) {
  const cleaned = cleanPdfEducationalContent(text);
  const lines = cleaned.split('\n');
  const blocks = [];
  let current = [];
  let section1Hits = 0;

  const flush = () => {
    const chunk = current.join('\n').trim();
    if (chunk.length >= 80) blocks.push(chunk);
    current = [];
  };

  for (const raw of lines) {
    const line = str(raw);
    const isSection1 =
      /^section\s+1\s*:?\s*$/i.test(line) ||
      (/^assignment\s*title\s*$/i.test(line) && detectAssignmentSectionNum(line) === 1);

    if (isSection1) {
      section1Hits += 1;
      if (section1Hits > 1 && current.length > 20) flush();
    }

    if (isGenerationBoundaryLine(line) && current.length > 20) {
      flush();
      section1Hits = 0;
    }

    current.push(raw);
  }
  flush();
  return blocks.length ? blocks : cleaned.length >= 80 ? [cleaned] : [];
}

/**
 * @param {{ generation: number, title: string, text: string }[]} generations
 * @param {Record<string, unknown>} [params]
 */
export function selectGenerationBlock(generations, params = {}) {
  if (!generations.length) return '';
  if (generations.length === 1) return generations[0].text;

  const topic = str(params.subtopic || params.topic || '').toLowerCase();
  const chapter = str(params.topic || '').toLowerCase();
  const titleNeedle = str(params.assignmentTitle || '').toLowerCase();
  const needles = [titleNeedle, topic, chapter].filter((n) => n.length >= 3);

  if (needles.length) {
    const scored = generations.map((g) => {
      const head = `${g.title}\n${g.text.slice(0, 2000)}`.toLowerCase();
      const score = needles.reduce((n, needle) => n + (head.includes(needle) ? 15 : 0), 0);
      return { ...g, score };
    });
    scored.sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) return scored[0].text;
  }

  const wantedGen = Number(params.generation || params.generationNumber || 1);
  const byNum = generations.find((g) => g.generation === wantedGen);
  return byNum?.text || generations[0].text;
}
