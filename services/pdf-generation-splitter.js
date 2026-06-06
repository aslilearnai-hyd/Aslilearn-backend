/**
 * Detect and split PDF text into separate generations (Generation 1, Lesson Planner 2, etc.).
 * Uses GLOBAL line scan + heading-based split — never page count.
 * @module services/pdf-generation-splitter
 */

import { str } from './pdf-extract-utils.js';
import { cleanPdfEducationalContent, stripDocumentTrailer } from './pdf-content-cleaner.js';

/** @typedef {{ type: string, label: string, re: RegExp }} GenerationMarkerPattern */

export const GENERATION_MARKER_PATTERNS = [
  { type: 'generation', label: 'Generation', re: /^generation\s+(\d{1,3})\s*[:\-—]?\s*(.*)$/i },
  { type: 'lesson_planner', label: 'Lesson Planner', re: /^lesson\s+planner\s+(\d{1,3})\s*[:\-—]?\s*(.*)$/i },
  { type: 'worksheet', label: 'Worksheet', re: /^worksheet\s+(\d{1,3})\s*[:\-—]?\s*(.*)$/i },
  { type: 'activity', label: 'Activity', re: /^activity\s+(\d{1,3})\s*[:\-—]?\s*(.*)$/i },
  { type: 'assignment', label: 'Assignment', re: /^assignment\s+(\d{1,3})\s*[:\-—]?\s*(.*)$/i },
];

/** Global regex for debug counting (not used for single match). */
export const GENERATION_GLOBAL_RE = /generation\s+(\d{1,3})\b/gi;

const BANK_HEADER_TYPES = new Set(['generation', 'lesson_planner', 'worksheet']);

const COMBINED_BOUNDARY_RE = new RegExp(
  GENERATION_MARKER_PATTERNS.map((p) => p.re.source).join('|'),
  'i',
);

/**
 * @param {string} line
 * @returns {{ type: string, label: string, generationNumber: number, title: string } | null}
 */
export function parseGenerationBoundaryLine(line) {
  const t = str(line);
  if (!t) return null;
  for (const pattern of GENERATION_MARKER_PATTERNS) {
    const m = t.match(pattern.re);
    if (m) {
      return {
        type: pattern.type,
        label: pattern.label,
        generationNumber: Number(m[1]),
        title: str(m[2]),
      };
    }
  }
  return null;
}

/**
 * @param {string} line
 */
export function isGenerationBoundaryLine(line) {
  return COMBINED_BOUNDARY_RE.test(str(line));
}

/**
 * Scan EVERY line for generation-style headings (full document).
 * @param {string} text
 * @param {string} [markerType='generation']
 */
export function findAllGenerationHeadings(text, markerType = 'generation') {
  const lines = String(text || '').split('\n');
  const pattern = GENERATION_MARKER_PATTERNS.find((p) => p.type === markerType) || GENERATION_MARKER_PATTERNS[0];
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseGenerationBoundaryLine(lines[i]);
    if (!parsed || parsed.type !== pattern.type) continue;
    const label = `${parsed.label} ${parsed.generationNumber}${parsed.title ? `: ${parsed.title}` : ''}`;
    out.push({
      lineIndex: i,
      generationNumber: parsed.generationNumber,
      generationTitle: parsed.title || `${parsed.label} ${parsed.generationNumber}`,
      markerType: parsed.type,
      markerLabel: parsed.label,
      label,
    });
  }
  return out;
}

/**
 * @param {Array<{ label: string }>} headings
 */
export function logDetectedGenerationHeadings(headings) {
  const deduped = dedupeHeadingsFirstOccurrence(headings);
  console.log(`Detected Generations: ${deduped.length}`);
  if (!deduped.length) {
    console.log('  (none)');
    return;
  }
  const maxLog = 80;
  for (let i = 0; i < Math.min(deduped.length, maxLog); i += 1) {
    console.log(`  ${deduped[i].label}`);
  }
  if (deduped.length > maxLog) {
    console.log(`  ... and ${deduped.length - maxLog} more`);
  }
}

/**
 * Debug each generation chunk — content must differ between generations.
 * @param {Array<{ generationNumber: number, text: string }>} generations
 */
export function logGenerationChunkDebug(generations) {
  console.log(`Detected Generations: ${generations.length}`);
  for (const gen of generations) {
    const content = String(gen.text || gen.content || '');
    console.log(gen.generationNumber, content.substring(0, 200));
    console.log(`Generation ${gen.generationNumber} chunk length: ${content.length}`);
  }
}

/**
 * Split on raw text (heading line indices match), then clean each chunk in isolation.
 * @param {string} rawText
 * @param {Array<{ lineIndex: number, generationNumber: number, generationTitle?: string, markerType?: string, markerLabel?: string }>} headings
 * @param {number} minChunkLen
 */
export function splitRawTextCleanPerChunk(rawText, headings, minChunkLen = 40) {
  const rawChunks = splitByGenerationHeadings(rawText, headings, { minChunkLen: 1 });
  return rawChunks
    .map((gen) => {
      const cleaned = cleanPdfEducationalContent(gen.text, {
        stripTrailer: false,
        dedupeParagraphs: false,
      }).trim();
      return { ...gen, text: cleaned, content: cleaned };
    })
    .filter((gen) => gen.text.length >= minChunkLen);
}

/**
 * @param {string} text
 */
export function countGlobalGenerationMatches(text) {
  return [...String(text || '').matchAll(GENERATION_GLOBAL_RE)].length;
}

/**
 * @param {string} text
 * @param {GenerationMarkerPattern} pattern
 */
export function scanGenerationBoundaries(text, pattern) {
  return findAllGenerationHeadings(text, pattern.type).map((h) => ({
    lineIndex: h.lineIndex,
    generationNumber: h.generationNumber,
    generationTitle: h.generationTitle,
    markerType: h.markerType,
    markerLabel: h.markerLabel,
  }));
}

/**
 * @param {Array<{ lineIndex: number, generationNumber: number }>} boundaries
 */
export function filterMonotonicGenerationBoundaries(boundaries) {
  const sorted = [...boundaries].sort((a, b) => a.lineIndex - b.lineIndex);
  const out = [];
  let lastNum = 0;
  for (const b of sorted) {
    const num = Number(b.generationNumber);
    if (!Number.isFinite(num) || num < 1) continue;
    if (num > lastNum) {
      out.push(b);
      lastNum = num;
    }
  }
  return out;
}

/**
 * First occurrence of each generation number in document order.
 * @param {Array<{ lineIndex: number, generationNumber: number, generationTitle?: string, markerType?: string, markerLabel?: string }>} headings
 */
export function dedupeHeadingsFirstOccurrence(headings) {
  const sorted = [...headings].sort((a, b) => a.lineIndex - b.lineIndex);
  const seen = new Set();
  const out = [];
  for (const h of sorted) {
    const num = Number(h.generationNumber);
    if (seen.has(num)) continue;
    seen.add(num);
    out.push(h);
  }
  return out.sort((a, b) => a.lineIndex - b.lineIndex);
}

/**
 * Split text between heading lines — content from heading N until heading N+1.
 * @param {string} text
 * @param {Array<{ lineIndex: number, generationNumber: number, generationTitle?: string, markerType?: string, markerLabel?: string }>} headings
 * @param {{ minChunkLen?: number }} [options]
 */
export function splitByGenerationHeadings(text, headings, options = {}) {
  const minChunkLen = options.minChunkLen ?? 40;
  const lines = String(text || '').split('\n');
  const boundaries = dedupeHeadingsFirstOccurrence(headings);
  const generations = [];

  for (let i = 0; i < boundaries.length; i += 1) {
    const b = boundaries[i];
    const start = b.lineIndex;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].lineIndex : lines.length;
    const chunk = lines.slice(start, end).join('\n').trim();
    if (chunk.length < minChunkLen) continue;

    generations.push({
      generationNumber: b.generationNumber,
      generationTitle: str(b.generationTitle) || `${b.markerLabel || 'Generation'} ${b.generationNumber}`,
      markerType: b.markerType || 'generation',
      markerLabel: b.markerLabel || 'Generation',
      text: chunk,
      content: chunk,
    });
  }

  return generations;
}

/**
 * @param {string} text
 * @param {string} markerType
 */
export function splitByMarkerTypeHeadings(text, markerType) {
  const headings = findAllGenerationHeadings(text, markerType);
  if (headings.length < 2) return [];
  return splitByGenerationHeadings(text, headings);
}

/**
 * @param {string} text
 */
export function contentFingerprint(text) {
  return str(text)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .replace(/\bpage\s+\d+\b/gi, '')
    .slice(0, 2500);
}

/**
 * Warn when two consecutive generation chunks have identical content (split failure signal).
 * @param {Array<{ generationNumber: number, text: string }>} generations
 */
export function detectConsecutiveDuplicateGenerationContent(generations) {
  const warnings = [];
  for (let i = 1; i < generations.length; i += 1) {
    const prev = generations[i - 1];
    const curr = generations[i];
    const fpPrev = contentFingerprint(prev.text || prev.content);
    const fpCurr = contentFingerprint(curr.text || curr.content);
    if (fpPrev && fpPrev.length >= 80 && fpPrev === fpCurr) {
      warnings.push(
        `Generation ${curr.generationNumber} has identical content to Generation ${prev.generationNumber}`,
      );
    }
  }
  return warnings;
}

/**
 * @param {Array<{ generationNumber: number, text: string }>} generations
 */
export function detectDuplicateGenerationContent(generations) {
  const warnings = [];
  const seen = new Map();
  for (const gen of generations) {
    const fp = contentFingerprint(gen.text);
    if (!fp || fp.length < 80) continue;
    const prev = seen.get(fp);
    if (prev != null) {
      warnings.push(`Generation ${gen.generationNumber} identical to Generation ${prev}`);
    } else {
      seen.set(fp, gen.generationNumber);
    }
  }
  return warnings;
}

/**
 * @param {Array<{ generationNumber: number, text: string }>} generations
 */
export function filterDuplicateContentGenerations(generations) {
  const seen = new Set();
  const out = [];
  for (const gen of generations) {
    const fp = contentFingerprint(gen.text);
    if (fp.length >= 80 && seen.has(fp)) continue;
    seen.add(fp);
    out.push(gen);
  }
  return out;
}

/**
 * Pick best non-generation marker type when no Generation N bank exists.
 * @param {string} text
 * @param {number} [pageCount]
 */
function pickAlternateMarkerType(text, pageCount = 0) {
  let best = { type: '', label: '', headings: [], score: -Infinity };
  for (const pattern of GENERATION_MARKER_PATTERNS) {
    if (pattern.type === 'generation') continue;
    const headings = findAllGenerationHeadings(text, pattern.type);
    const deduped = dedupeHeadingsFirstOccurrence(headings);
    const uniqueCount = deduped.length;
    let score = uniqueCount * 100;
    if (BANK_HEADER_TYPES.has(pattern.type)) score += 200;
    if (pageCount > 10 && uniqueCount >= Math.floor(pageCount * 0.55)) score -= 5000;
    if (score > best.score) {
      best = { type: pattern.type, label: pattern.label, headings: deduped, score };
    }
  }
  return best;
}

/**
 * @deprecated No-op — do not renumber false splits.
 */
export function ensureUniqueGenerationNumbers(generations) {
  return generations;
}

/**
 * @param {string} rawText
 * @param {{ minChunkLen?: number, pageCount?: number }} [options]
 */
export function splitAllPdfGenerations(rawText, options = {}) {
  const minChunkLen = options.minChunkLen ?? 40;
  const pageCount = Number(options.pageCount || 0);
  const rawLen = String(rawText || '').length;

  console.log('PDF Text Length (raw):', rawLen);

  const rawGlobalCount = countGlobalGenerationMatches(rawText);
  console.log('[PDF Gen] Global /Generation\\s+\\d+/gi matches:', rawGlobalCount);

  const rawGenHeadings = findAllGenerationHeadings(rawText, 'generation');
  logDetectedGenerationHeadings(rawGenHeadings);

  const cleanedNoTrailer = cleanPdfEducationalContent(rawText, { stripTrailer: false });
  console.log('PDF Text Length (cleaned):', cleanedNoTrailer.length);

  const cleanedGenHeadings = findAllGenerationHeadings(cleanedNoTrailer, 'generation');
  const rawGenHeadingsDeduped = dedupeHeadingsFirstOccurrence(rawGenHeadings);
  const cleanedGenHeadingsDeduped = dedupeHeadingsFirstOccurrence(cleanedGenHeadings);

  if (pageCount > 0) {
    console.log('PDF Pages:', pageCount);
  }

  let generations = [];
  let selectedMarkerType = 'generation';
  let selectedMarkerLabel = 'Generation';

  // Split on the SAME text the headings were scanned from — never mix raw line indices with cleaned text.
  if (rawGenHeadingsDeduped.length >= 2) {
    generations = splitRawTextCleanPerChunk(rawText, rawGenHeadings, minChunkLen);
    console.log('[PDF Gen] Split by Generation headings (raw text, per-chunk clean):', generations.length);
  } else if (cleanedGenHeadingsDeduped.length >= 2) {
    generations = splitByGenerationHeadings(cleanedNoTrailer, cleanedGenHeadings, { minChunkLen });
    console.log('[PDF Gen] Split by Generation headings (cleaned text):', generations.length);
  } else {
    const alt = pickAlternateMarkerType(cleanedNoTrailer, pageCount);
    if (alt.headings.length >= 2) {
      selectedMarkerType = alt.type;
      selectedMarkerLabel = alt.label;
      generations = splitByGenerationHeadings(cleanedNoTrailer, alt.headings, { minChunkLen });
      logDetectedGenerationHeadings(alt.headings);
      console.log(`[PDF Gen] Split by ${alt.label} headings:`, generations.length);
    }
  }

  if (!generations.length) {
    const textWithTrailer = stripDocumentTrailer(cleanedNoTrailer);
    const trailerHeadings = findAllGenerationHeadings(textWithTrailer, 'generation');
    if (trailerHeadings.length >= 2) {
      generations = splitByGenerationHeadings(textWithTrailer, trailerHeadings, { minChunkLen });
      console.log('[PDF Gen] Split after trailer strip:', generations.length);
    } else {
      const lines = textWithTrailer.split('\n');
      const header = lines.find((l) => parseGenerationBoundaryLine(l));
      const parsed = header ? parseGenerationBoundaryLine(header) : null;
      const title =
        parsed?.title ||
        lines.find((l) => l.length >= 8 && l.length <= 200 && !isGenerationBoundaryLine(l)) ||
        'Generation 1';
      generations = [
        {
          generationNumber: parsed?.generationNumber || 1,
          generationTitle: str(title) || 'Generation 1',
          markerType: parsed?.type || 'generation',
          markerLabel: parsed?.label || 'Generation',
          text: textWithTrailer.trim(),
        },
      ];
      console.log('[PDF Gen] Single-document fallback (no multi headings found)');
    }
  }

  const headingCount = Math.max(rawGenHeadingsDeduped.length, cleanedGenHeadingsDeduped.length);
  if (headingCount > 1 && generations.length === 1) {
    console.warn(
      `[PDF Gen] WARNING: ${headingCount} Generation headings found but only 1 block built — retrying raw split`,
    );
    const retry = splitRawTextCleanPerChunk(rawText, rawGenHeadings, 20);
    if (retry.length > generations.length) {
      generations = retry;
      console.log('[PDF Gen] Retry split produced:', generations.length);
    }
  }

  const beforeDedupe = generations.length;
  generations = filterDuplicateContentGenerations(generations);
  if (generations.length < beforeDedupe) {
    console.warn(`[PDF Gen] Removed ${beforeDedupe - generations.length} duplicate-content block(s)`);
  }

  const duplicateWarnings = detectDuplicateGenerationContent(generations);
  const consecutiveDuplicateWarnings = detectConsecutiveDuplicateGenerationContent(generations);
  if (duplicateWarnings.length) {
    console.warn('[PDF Gen] Duplicate content warnings:', duplicateWarnings.slice(0, 5).join(' | '));
  }
  if (consecutiveDuplicateWarnings.length) {
    console.warn(
      '[PDF Gen] Consecutive identical chunk warnings:',
      consecutiveDuplicateWarnings.slice(0, 5).join(' | '),
    );
  }

  logGenerationChunkDebug(generations);

  if (
    pageCount > 5 &&
    generations.length >= Math.floor(pageCount * 0.75) &&
    headingCount < generations.length
  ) {
    console.warn(
      `[PDF Gen] Page-like false split (${generations.length} blocks vs ${pageCount} pages) — collapsing`,
    );
    generations = generations.slice(0, 1);
  }

  const globalHeadingCount = headingCount;

  return {
    markerType: generations[0]?.markerType || selectedMarkerType,
    markerLabel: generations[0]?.markerLabel || selectedMarkerLabel,
    totalGenerations: generations.length,
    generations,
    extractionStats: {
      totalPages: pageCount,
      pdfTextLengthRaw: rawLen,
      pdfTextLengthCleaned: cleanedNoTrailer.length,
      globalGenerationRegexMatches: rawGlobalCount,
      globalHeadingCount,
      detectedGenerations: generations.length,
      recordsCreated: generations.length,
      selectedMarkerType,
      duplicateContentWarnings: duplicateWarnings,
      consecutiveDuplicateContentWarnings: consecutiveDuplicateWarnings,
      removedDuplicateBlocks: Math.max(0, beforeDedupe - generations.length),
      headingMismatch: globalHeadingCount > 1 && generations.length === 1,
    },
  };
}

/**
 * @returns {string}
 */
export function generatePdfCode() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PDF_${ymd}_${rand}`;
}
