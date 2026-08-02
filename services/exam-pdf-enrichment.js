/**
 * Enrich Gemini PDF question extraction:
 * - Detect shared case/passage blocks and attach to child questions
 * - Detect Assertion–Reason shared option sets
 * - Extract/attach PDF figures as questionImage files
 * - Flag rows that still look unsolvable without passage/figure
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS_UPLOAD_DIR = path.resolve(__dirname, '../uploads/questions');

const DEFAULT_AR_OPTIONS = [
  'Both A and R are true, and R is the correct explanation of A.',
  'Both A and R are true, but R is not the correct explanation of A.',
  'A is true, but R is false.',
  'A is false, but R is true.',
];

const FIGURE_HINT_RE =
  /\b(screw\s*gauge|vernier|calliper|caliper|diagram|figure|shown\s+in\s+the\s+(?:figure|diagram)|least\s*count|circular\s*scale|main\s*scale|as\s+shown)\b/i;

function normalizeSpaces(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuestionNumbersNear(text, fromIdx, toIdx) {
  const slice = String(text || '').slice(fromIdx, toIdx);
  const nums = new Set();
  const re = /(?:^|\n)\s*(\d{1,3})\.\s+\S/g;
  let m;
  while ((m = re.exec(slice))) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 200) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

/**
 * Detect Case I / Case II / passage blocks and the question numbers that follow.
 */
export function detectPassagesFromPdfText(fullText) {
  const text = String(fullText || '');
  if (!text.trim()) return [];

  const markers = [];
  const markerRe =
    /(?:^|\n)\s*((?:Case\s*[-–:]?\s*(?:Based(?:\s+Type)?(?:\s+Questions)?)?|Case\s*(?:I{1,3}|IV|\d+|Study)|Directions\s*:\s*Read\s+the\s+following\s+passage)[^\n]*)/gi;
  let m;
  while ((m = markerRe.exec(text))) {
    markers.push({ index: m.index + (m[0].startsWith('\n') ? 1 : 0), title: normalizeSpaces(m[1]) });
  }
  if (markers.length === 0) return [];

  const passages = [];
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index : Math.min(text.length, start + 3500);
    const block = text.slice(start, end);
    // Passage body: until first numbered question in this block
    const firstQ = block.search(/(?:^|\n)\s*\d{1,3}\.\s+\S/);
    const passageBody =
      firstQ > 0
        ? normalizeSpaces(block.slice(0, firstQ))
        : normalizeSpaces(block.slice(0, Math.min(block.length, 1200)));
    if (passageBody.length < 40) continue;

    const qEnd =
      i + 1 < markers.length
        ? markers[i + 1].index
        : Math.min(text.length, start + block.length + 2500);
    const questionRange = extractQuestionNumbersNear(text, start, qEnd);
    if (questionRange.length === 0) continue;

    passages.push({
      passageId: `P${passages.length + 1}`,
      title: markers[i].title,
      passageText: passageBody,
      questionRange,
    });
  }
  return passages;
}

/**
 * Find Assertion–Reason Directions blocks and question ranges that use shared options.
 */
export function detectAssertionReasonBlocks(fullText) {
  const text = String(fullText || '');
  const blocks = [];
  const re =
    /(?:^|\n)\s*(Assertion\s*[-–]?\s*Reason[^\n]*|Directions\s*:\s*Each\s+question\s+is\s+followed\s+by\s+four\s+options[^\n]*Assertion[^\n]*)/gi;
  const markers = [];
  let m;
  while ((m = re.exec(text))) {
    markers.push(m.index);
  }
  if (markers.length === 0 && /Both\s+A\s+and\s+R\s+are\s+true/i.test(text)) {
    // Single shared AR option set somewhere in paper
    const qRange = [];
    const qRe = /(?:^|\n)\s*(\d{1,3})\.\s*A\s*:\s*/gi;
    let qm;
    while ((qm = qRe.exec(text))) {
      const n = parseInt(qm[1], 10);
      if (n >= 1 && n <= 200) qRange.push(n);
    }
    if (qRange.length) {
      blocks.push({
        sharedOptionsId: 'AR1',
        sharedOptions: [...DEFAULT_AR_OPTIONS],
        questionRange: qRange,
      });
    }
    return blocks;
  }

  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1] : Math.min(text.length, start + 4000);
    const slice = text.slice(start, end);
    const qRange = [];
    const qRe = /(?:^|\n)\s*(\d{1,3})\.\s*A\s*:\s*/gi;
    let qm;
    while ((qm = qRe.exec(slice))) {
      const n = parseInt(qm[1], 10);
      if (n >= 1 && n <= 200) qRange.push(n);
    }
    // Also catch "13. A:" style after directions without A: on same scan of following section
    if (qRange.length === 0) {
      const nums = extractQuestionNumbersNear(text, start, end);
      // Heuristic: AR sections usually 3–4 questions
      qRange.push(...nums.slice(0, 8));
    }
    if (!qRange.length) continue;
    blocks.push({
      sharedOptionsId: `AR${blocks.length + 1}`,
      sharedOptions: [...DEFAULT_AR_OPTIONS],
      questionRange: [...new Set(qRange)].sort((a, b) => a - b),
    });
  }
  return blocks;
}

export function attachPassagesToRows(rows, passages) {
  if (!Array.isArray(rows) || !passages?.length) return rows;
  return rows.map((row) => {
    const qn = Number(row?.questionNumber);
    if (!Number.isFinite(qn)) return row;
    const hit = passages.find((p) => p.questionRange.includes(qn));
    if (!hit) return row;
    const stem = String(row.questionText || '').trim();
    const passage = String(hit.passageText || '').trim();
    const alreadyHas =
      passage.length > 40 &&
      stem.toLowerCase().includes(passage.slice(0, 60).toLowerCase());
    const questionText = alreadyHas
      ? stem
      : `${passage}\n\n${stem}`.trim();
    return {
      ...row,
      passageId: hit.passageId,
      passageText: passage,
      questionText,
    };
  });
}

export function attachAssertionReasonOptions(rows, arBlocks) {
  if (!Array.isArray(rows) || !arBlocks?.length) return rows;
  return rows.map((row) => {
    const qn = Number(row?.questionNumber);
    if (!Number.isFinite(qn)) return row;
    const hit = arBlocks.find((b) => b.questionRange.includes(qn));
    if (!hit) return row;
    const opts = hit.sharedOptions || DEFAULT_AR_OPTIONS;
    const hasOwnOptions = [row.option1, row.option2, row.option3, row.option4].filter((o) =>
      String(o || '').trim(),
    ).length >= 2;
    // Replace thin/missing options with shared AR set
    const looksLikeAR =
      /\bA\s*[:：]/i.test(String(row.questionText || '')) ||
      /\bR\s*[:：]/i.test(String(row.questionText || '')) ||
      /assertion/i.test(String(row.questionText || ''));
    if (!looksLikeAR && hasOwnOptions) return row;
    return {
      ...row,
      questionType: row.questionType === 'multiple' ? 'multiple' : 'mcq',
      option1: opts[0] || row.option1,
      option2: opts[1] || row.option2,
      option3: opts[2] || row.option3,
      option4: opts[3] || row.option4,
      sharedOptionsId: hit.sharedOptionsId,
      needsPassage: false,
    };
  });
}

/**
 * Heuristic validation: can this stem stand alone?
 */
export function validateExtractedQuestionRow(row) {
  const flags = [];
  const text = String(row?.questionText || '');
  const passage = String(row?.passageText || '');
  const combined = `${passage}\n${text}`;
  const hasImage = Boolean(String(row?.questionImage || '').trim());

  if (FIGURE_HINT_RE.test(text) && !hasImage) {
    flags.push('needs_figure');
  }

  // Short stem without numbers, but answer key exists → likely missing case numbers
  const numbersInStem = combined.match(/\d/g) || [];
  if (
    text.length < 90 &&
    numbersInStem.length < 2 &&
    !hasImage &&
    !passage &&
    /\b(what|how|find|side|length|volume|number)\b/i.test(text)
  ) {
    flags.push('needs_passage');
  }

  // Passage was expected (passageId) but not present in text
  if (row?.passageId && !passage && numbersInStem.length < 2) {
    flags.push('needs_passage');
  }

  const solvable = flags.length === 0;
  return {
    solvable,
    validationFlags: flags,
    validationNote: solvable
      ? ''
      : flags.includes('needs_figure')
        ? 'Needs diagram/figure from the paper'
        : 'Needs case/passage context',
  };
}

async function ensureQuestionsUploadDir() {
  await fs.mkdir(QUESTIONS_UPLOAD_DIR, { recursive: true });
}

function isLikelyLogoOrTiny(img) {
  const w = Number(img?.width) || 0;
  const h = Number(img?.height) || 0;
  if (w < 120 || h < 80) return true;
  if (w * h < 20000) return true;
  return false;
}

function bufferFromImageData(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer);
  return null;
}

/**
 * Map printed question numbers → page numbers using per-page text.
 */
async function mapQuestionNumbersToPages(parser) {
  const parsed = await parser.getText();
  const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];
  const map = new Map(); // qn -> pageNumber (1-based)
  pages.forEach((p, idx) => {
    const pageNumber = Number(p?.pageNumber) || idx + 1;
    const t = String(p?.text || '');
    const re = /(?:^|\n)\s*(\d{1,3})\.\s+\S/g;
    let m;
    while ((m = re.exec(t))) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 200 && !map.has(n)) map.set(n, pageNumber);
    }
  });
  return { map, pageCount: pages.length, pageTexts: pages.map((p) => String(p?.text || '')) };
}

/**
 * Save largest suitable image(s) from pages and attach to figure/case questions on those pages.
 */
export async function attachPdfFiguresToRows(pdfBuffer, rows, { examId } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  let parser;
  try {
    await ensureQuestionsUploadDir();
    parser = new PDFParse({ data: pdfBuffer });
    const { map: qToPage } = await mapQuestionNumbersToPages(parser);
    const imageResult = await parser.getImage();
    const pages = Array.isArray(imageResult?.pages) ? imageResult.pages : [];

    /** pageNumber -> saved relative url of best figure */
    const pageFigureUrl = new Map();

    for (const page of pages) {
      const pageNumber = Number(page?.pageNumber) || 0;
      const images = Array.isArray(page?.images) ? page.images : [];
      const candidates = images
        .filter((img) => !isLikelyLogoOrTiny(img))
        .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
      if (!candidates.length) continue;
      const best = candidates[0];
      const buf = bufferFromImageData(best.data);
      if (!buf || buf.length < 500) continue;
      const ext = buf[0] === 0x89 ? 'png' : buf[0] === 0xff ? 'jpg' : 'png';
      const filename = `exam-${String(examId || 'pdf').slice(-8)}-p${pageNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const full = path.join(QUESTIONS_UPLOAD_DIR, filename);
      await fs.writeFile(full, buf);
      pageFigureUrl.set(pageNumber, `/uploads/questions/${filename}`);
    }

    return rows.map((row) => {
      const qn = Number(row?.questionNumber);
      const pageNumber = Number.isFinite(qn) ? qToPage.get(qn) : null;
      const figureUrl = pageNumber ? pageFigureUrl.get(pageNumber) : null;
      if (!figureUrl) return row;
      if (String(row.questionImage || '').trim()) return row;

      const text = `${String(row?.passageText || '')}\n${String(row?.questionText || '')}`;
      const wantsFigure =
        FIGURE_HINT_RE.test(text) ||
        Boolean(row?.passageId) ||
        /case\s*(?:i{1,3}|\d+|study|based)/i.test(text);
      if (!wantsFigure) return row;

      return {
        ...row,
        questionImage: figureUrl,
        hasFigure: true,
      };
    });
  } catch (e) {
    console.warn('[PDF_ENRICH] attachPdfFiguresToRows failed:', e?.message || e);
    return rows;
  } finally {
    if (parser) await parser.destroy().catch(() => {});
  }
}

/**
 * Full enrichment after Gemini extraction.
 */
export async function enrichExtractedExamQuestions({
  pdfBuffer,
  rows,
  examId,
  fullText,
}) {
  let text = String(fullText || '');
  if (!text && pdfBuffer) {
    try {
      const parser = new PDFParse({ data: pdfBuffer });
      const parsed = await parser.getText();
      text = String(parsed?.text || '');
      await parser.destroy().catch(() => {});
    } catch (e) {
      console.warn('[PDF_ENRICH] text extract failed:', e?.message || e);
    }
  }

  const passages = detectPassagesFromPdfText(text);
  const arBlocks = detectAssertionReasonBlocks(text);

  let next = attachPassagesToRows(rows, passages);
  next = attachAssertionReasonOptions(next, arBlocks);
  next = await attachPdfFiguresToRows(pdfBuffer, next, { examId });

  next = next.map((row, idx) => {
    const v = validateExtractedQuestionRow(row);
    return {
      ...row,
      row: row.row || idx + 1,
      solvable: v.solvable,
      validationFlags: v.validationFlags,
      validationNote: v.validationNote,
    };
  });

  console.log('[PDF_ENRICH] done', {
    rows: next.length,
    passages: passages.length,
    arBlocks: arBlocks.length,
    withImages: next.filter((r) => r.questionImage).length,
    flagged: next.filter((r) => !r.solvable).length,
  });

  return {
    rows: next,
    meta: {
      passages,
      arBlocks,
      flaggedCount: next.filter((r) => !r.solvable).length,
      withImages: next.filter((r) => r.questionImage).length,
    },
  };
}
