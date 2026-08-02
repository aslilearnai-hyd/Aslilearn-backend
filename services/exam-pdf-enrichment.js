/**
 * Enrich Gemini PDF question extraction:
 * - Detect shared case/passage blocks and attach to child questions (tight ranges only)
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
  /\b(screw\s*gauge|vernier|calliper|caliper|diagram|figure|shown\s+in\s+the\s+(?:figure|diagram)|least\s*count|circular\s*scale|main\s*scale|as\s+shown|refer\s+to\s+(?:the\s+)?(?:figure|diagram)|given\s+figure|marked\s+point|shown\s+below)\b/i;

/** Stops a case block from swallowing the rest of the paper */
const SECTION_STOP_RE =
  /(?:^|\n)\s*(?:Mathematics|Maths|Physics|Chemistry|Biology|Science|English|Hindi|Social\s*Science|Assertion\s*[-–]?\s*Reason|Match\s+the\s+Following|SECTION\s*[A-D]|Single\s+Correct|Multi\s+Correct|Integer\s+Type)\b/i;

const MAX_QUESTIONS_PER_PASSAGE = 5;

function normalizeSpaces(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuestionNumbersNear(text, fromIdx, toIdx, minNumber = 0) {
  const slice = String(text || '').slice(fromIdx, toIdx);
  const nums = new Set();
  const re = /(?:^|\n)\s*(\d{1,3})\.\s+\S/g;
  let m;
  while ((m = re.exec(slice))) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 200 && n > minNumber) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

/**
 * Highest question number printed before `idx`. A passage's questions must come
 * after it — without this floor, "Column II" lists inside a Match-the-Following
 * ("1. …", "2. …") are read as question numbers 1-4 and the passage gets
 * attached to Q1-Q4 instead of the questions that actually follow it.
 */
function highestQuestionNumberBefore(text, idx) {
  const head = String(text || '').slice(0, idx);
  const re = /(?:^|\n)\s*(\d{1,3})\.\s+\S/g;
  let max = 0;
  let m;
  while ((m = re.exec(head))) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 200 && n > max) max = n;
  }
  return max;
}

/** Keep only the first consecutive run (e.g. 9,10,11) capped in length. */
function consecutiveQuestionRun(nums, maxLen = MAX_QUESTIONS_PER_PASSAGE) {
  if (!Array.isArray(nums) || nums.length === 0) return [];
  const sorted = [...new Set(nums.map(Number).filter((n) => Number.isFinite(n)))].sort(
    (a, b) => a - b,
  );
  const run = [sorted[0]];
  for (let i = 1; i < sorted.length && run.length < maxLen; i += 1) {
    if (sorted[i] === run[run.length - 1] + 1) run.push(sorted[i]);
    else break;
  }
  return run;
}

function findSectionStopAfter(text, fromIdx) {
  const slice = String(text || '').slice(fromIdx);
  const m = slice.match(SECTION_STOP_RE);
  if (!m || m.index == null) return -1;
  // Ignore a stop that is at the very start of the slice (same heading)
  if (m.index < 8) {
    const again = slice.slice(m.index + m[0].length).match(SECTION_STOP_RE);
    if (!again || again.index == null) return -1;
    return fromIdx + m.index + m[0].length + again.index;
  }
  return fromIdx + m.index;
}

/**
 * Detect Case I / Case II / Case Study / Paragraph / passage blocks.
 * Intentionally does NOT match bare "Case Based Type Questions" section titles —
 * those were attaching one chemistry case onto dozens of unrelated later questions.
 */
export function detectPassagesFromPdfText(fullText) {
  const text = String(fullText || '');
  if (!text.trim()) return [];

  const markers = [];
  const markerRe =
    /(?:^|\n)\s*((?:Case\s*(?:I{1,3}|IV|\d+)\b[^\n]{0,120}|Case\s*Study\s*[:.\-][^\n]{0,160}|Paragraph\s*:\s*[^\n]{0,200}|Directions\s*:\s*Read\s+the\s+following\s+passage[^\n]{0,120}))/gi;
  let m;
  while ((m = markerRe.exec(text))) {
    const title = normalizeSpaces(m[1]);
    // Skip section banners without a real case body
    if (/^case\s*based(\s+type)?(\s+questions)?$/i.test(title)) continue;
    markers.push({
      index: m.index + (m[0].startsWith('\n') ? 1 : 0),
      title,
    });
  }
  if (markers.length === 0) return [];

  const passages = [];
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i].index;
    const nextMarker = i + 1 < markers.length ? markers[i + 1].index : text.length;
    const sectionStop = findSectionStopAfter(text, start + Math.min(80, markers[i].title.length + 5));
    const hardEnd = Math.min(
      nextMarker,
      sectionStop > start ? sectionStop : text.length,
      start + 4500,
    );

    const block = text.slice(start, hardEnd);
    const firstQ = block.search(/(?:^|\n)\s*\d{1,3}\.\s+\S/);
    const passageBody =
      firstQ > 0
        ? normalizeSpaces(block.slice(0, firstQ))
        : normalizeSpaces(block.slice(0, Math.min(block.length, 900)));
    if (passageBody.length < 50) continue;

    // Questions that belong to this case: only those printed after the passage body
    const qStart = start + (firstQ > 0 ? firstQ : 0);
    const rawRange = extractQuestionNumbersNear(
      text,
      qStart,
      hardEnd,
      highestQuestionNumberBefore(text, start),
    );
    const questionRange = consecutiveQuestionRun(rawRange, MAX_QUESTIONS_PER_PASSAGE);
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
        questionRange: consecutiveQuestionRun(qRange, 8),
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
    if (qRange.length === 0) {
      const nums = extractQuestionNumbersNear(
        text,
        start,
        end,
        highestQuestionNumberBefore(text, start),
      );
      qRange.push(...nums.slice(0, 8));
    }
    if (!qRange.length) continue;
    blocks.push({
      sharedOptionsId: `AR${blocks.length + 1}`,
      sharedOptions: [...DEFAULT_AR_OPTIONS],
      questionRange: consecutiveQuestionRun([...new Set(qRange)], 8),
    });
  }
  return blocks;
}

function stemAlreadyHasPassageContext(stem, passage) {
  const s = String(stem || '').trim();
  const p = String(passage || '').trim();
  if (!s) return false;
  if (/^(case\s*(i{1,3}|iv|\d+|study)|paragraph\s*:|directions\s*:)/i.test(s)) return true;
  if (p.length > 40 && s.toLowerCase().includes(p.slice(0, 48).toLowerCase())) return true;
  // Long stem from Gemini that already inlined case facts — do not double-prepend
  if (s.length >= 140 && /case\s*(i{1,3}|iv|\d+|study)|paragraph\s*:/i.test(s)) return true;
  return false;
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

    // Always store metadata; only prepend when the stem is a short orphan
    if (stemAlreadyHasPassageContext(stem, passage)) {
      return {
        ...row,
        passageId: hit.passageId,
        passageText: passage,
        questionText: stem,
      };
    }

    if (stem.length < 120) {
      return {
        ...row,
        passageId: hit.passageId,
        passageText: passage,
        questionText: `${passage}\n\n${stem}`.trim(),
      };
    }

    // Long unrelated stem that wrongly matched a wide range — keep stem, skip passage
    return row;
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
  if (w < 100 || h < 70) return true;
  if (w * h < 14000) return true;
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
  const map = new Map();
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
 * Attach PDF figures to the questions that need them.
 *
 * How figures are matched (all heuristic, but grounded in two strong signals):
 * 1. Which questions NEED a figure: Gemini's per-question `hasFigure` flag
 *    (it reads the PDF visually), plus FIGURE_HINT_RE text hints as fallback.
 * 2. Which images are real figures: page images minus tiny/logo images minus
 *    "banners" — byte-identical images repeated on 3+ pages (page headers).
 * 3. Pairing: on each page, figure-needing questions are grouped (questions
 *    sharing a case/passage share one figure) in printed order, and page images
 *    are kept in content order (top→bottom), then zipped group-by-image.
 */
export async function attachPdfFiguresToRows(pdfBuffer, rows, { examId } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  let parser;
  try {
    parser = new PDFParse({ data: pdfBuffer });
    const { map: qToPage } = await mapQuestionNumbersToPages(parser);
    const imageResult = await parser.getImage();
    const pages = Array.isArray(imageResult?.pages) ? imageResult.pages : [];

    const imageKey = (img) => {
      const buf = bufferFromImageData(img?.data);
      if (!buf || buf.length < 500) return null;
      return `${buf.length}:${buf.subarray(0, 32).toString('hex')}`;
    };

    // Byte-identical images on 3+ pages are page furniture (header banner, watermark)
    const pagesSeenByImage = new Map();
    for (const page of pages) {
      const uniqueKeys = new Set(
        (Array.isArray(page?.images) ? page.images : []).map(imageKey).filter(Boolean),
      );
      for (const k of uniqueKeys) {
        pagesSeenByImage.set(k, (pagesSeenByImage.get(k) || 0) + 1);
      }
    }

    // Real figure candidates per page, in content order (top of page first)
    const candidatesByPage = new Map();
    for (const page of pages) {
      const pageNumber = Number(page?.pageNumber) || 0;
      const list = [];
      for (const img of Array.isArray(page?.images) ? page.images : []) {
        if (isLikelyLogoOrTiny(img)) continue;
        const key = imageKey(img);
        if (!key || (pagesSeenByImage.get(key) || 0) >= 3) continue;
        list.push({ buf: bufferFromImageData(img.data), key });
      }
      if (list.length) candidatesByPage.set(pageNumber, list);
    }

    // Index rows by page
    const rowsByPage = new Map();
    rows.forEach((row, idx) => {
      const qn = Number(row?.questionNumber);
      if (!Number.isFinite(qn)) return;
      const pageNumber = qToPage.get(qn);
      if (!pageNumber) return;
      if (!rowsByPage.has(pageNumber)) rowsByPage.set(pageNumber, []);
      rowsByPage.get(pageNumber).push({ row, idx, qn });
    });

    // Decide row → image assignments
    const savedUrlByImageKey = new Map();
    const urlByRowIdx = new Map();
    for (const [pageNumber, candidates] of candidatesByPage) {
      const pageRows = (rowsByPage.get(pageNumber) || []).sort((a, b) => a.qn - b.qn);
      if (!pageRows.length) continue;

      let wanting = pageRows.filter(({ row }) => {
        if (String(row.questionImage || '').trim()) return false;
        const text = `${String(row.passageText || '')}\n${String(row.questionText || '')}`;
        return row.hasFigure === true || FIGURE_HINT_RE.test(text);
      });
      // Single question alone on a page with an image → that image is its figure
      if (!wanting.length && pageRows.length === 1) wanting = pageRows;
      if (!wanting.length) continue;

      // Questions sharing a case/passage share one figure — group them
      const groups = [];
      const groupByKey = new Map();
      for (const entry of wanting) {
        const key = String(entry.row.passageId || '').trim() || `q${entry.qn}`;
        if (!groupByKey.has(key)) {
          const group = [];
          groupByKey.set(key, group);
          groups.push(group);
        }
        groupByKey.get(key).push(entry);
      }

      const n = Math.min(groups.length, candidates.length);
      for (let i = 0; i < n; i += 1) {
        for (const entry of groups[i]) {
          urlByRowIdx.set(entry.idx, candidates[i]);
        }
      }
    }

    if (urlByRowIdx.size === 0) return rows;
    await ensureQuestionsUploadDir();

    // Save each distinct assigned image once
    for (const candidate of new Set(urlByRowIdx.values())) {
      const { buf, key } = candidate;
      if (savedUrlByImageKey.has(key)) continue;
      const ext = buf[0] === 0x89 ? 'png' : buf[0] === 0xff ? 'jpg' : 'png';
      const filename = `exam-${String(examId || 'pdf').slice(-8)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      await fs.writeFile(path.join(QUESTIONS_UPLOAD_DIR, filename), buf);
      savedUrlByImageKey.set(key, `/uploads/questions/${filename}`);
    }

    return rows.map((row, idx) => {
      const candidate = urlByRowIdx.get(idx);
      if (!candidate) return row;
      const url = savedUrlByImageKey.get(candidate.key);
      if (!url) return row;
      return {
        ...row,
        questionImage: url,
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
    passageRanges: passages.map((p) => ({ id: p.passageId, q: p.questionRange })),
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
