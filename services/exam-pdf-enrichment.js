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

const DEFAULT_AR_DIRECTIONS =
  'Directions: Each question below consists of an Assertion (A) and a Reason (R). Choose the correct option:\n' +
  '(a) Both A and R are true, and R is the correct explanation of A.\n' +
  '(b) Both A and R are true, but R is not the correct explanation of A.\n' +
  '(c) A is true, but R is false.\n' +
  '(d) A is false, but R is true.';

const DEFAULT_MATCH_DIRECTIONS =
  'Directions: Following questions have statements in Column I and Column II. Match Column I with Column II and choose the correct matching from the options.';

const FIGURE_HINT_RE =
  /\b(screw\s*gauge|vernier|calliper|caliper|diagram|figure|shown\s+in\s+the\s+(?:figure|diagram)|least\s*count|circular\s*scale|main\s*scale|as\s+shown|refer\s+to\s+(?:the\s+)?(?:figure|diagram)|given\s+figure|marked\s+point|shown\s+below)\b/i;

/** Match-the-Following tables are usually vector text in PDFs — detect so we can screenshot the page. */
const MATCH_TABLE_HINT_RE =
  /Column\s*I\b|Column\s*II\b|List\s*-?\s*I\b|List\s*-?\s*II\b|match\s+(?:the\s+)?(?:following|each|column)/i;

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
        sharedMatterText: DEFAULT_AR_DIRECTIONS,
        questionRange: consecutiveQuestionRun(qRange, 8),
      });
    }
    return blocks;
  }

  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1] : Math.min(text.length, start + 4000);
    const slice = text.slice(start, end);
    const firstQ = slice.search(/(?:^|\n)\s*\d{1,3}\.\s*A\s*:\s*/i);
    const directionsBody =
      firstQ > 20
        ? normalizeSpaces(slice.slice(0, firstQ))
        : normalizeSpaces(slice.slice(0, Math.min(slice.length, 700)));
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
      sharedMatterText:
        directionsBody.length >= 40 ? directionsBody : DEFAULT_AR_DIRECTIONS,
      questionRange: consecutiveQuestionRun([...new Set(qRange)], 8),
    });
  }
  return blocks;
}

/**
 * Split an Assertion–Reason stem into A / R fields.
 */
export function parseAssertionReasonFromStem(stem) {
  const text = String(stem || '').trim();
  if (!text) return { assertionText: '', reasonText: '', cleanedStem: '' };

  const arMatch = text.match(
    /(?:^|\n)\s*A\s*[:：]\s*([\s\S]*?)(?:\n|\s+)R\s*[:：]\s*([\s\S]*?)$/i,
  );
  if (arMatch) {
    return {
      assertionText: normalizeSpaces(arMatch[1]),
      reasonText: normalizeSpaces(arMatch[2]),
      cleanedStem: `A: ${normalizeSpaces(arMatch[1])}\nR: ${normalizeSpaces(arMatch[2])}`.trim(),
    };
  }

  const inline = text.match(
    /\bA\s*[:：]\s*(.+?)\s+R\s*[:：]\s*(.+)$/i,
  );
  if (inline) {
    return {
      assertionText: normalizeSpaces(inline[1]),
      reasonText: normalizeSpaces(inline[2]),
      cleanedStem: `A: ${normalizeSpaces(inline[1])}\nR: ${normalizeSpaces(inline[2])}`.trim(),
    };
  }

  return { assertionText: '', reasonText: '', cleanedStem: text };
}

/**
 * Parse Column I / Column II lists from a match-the-following stem.
 */
export function parseMatchColumnsFromStem(stem) {
  const text = String(stem || '');
  const colI = [];
  const colII = [];

  const iBlock = text.match(
    /Column\s*I\s*[:.]?\s*([\s\S]*?)(?=Column\s*II|$)/i,
  );
  const iiBlock = text.match(/Column\s*II\s*[:.]?\s*([\s\S]*?)$/i);

  const parseList = (block, letterKeys) => {
    const out = [];
    if (!block) return out;
    const re = letterKeys
      ? /(?:^|\n|\s)([A-D])\s*[.):\-]\s*([^\n]+)/gi
      : /(?:^|\n|\s)(\d{1,2})\s*[.):\-]\s*([^\n]+)/gi;
    let m;
    while ((m = re.exec(block))) {
      out.push({ key: String(m[1]).trim(), text: normalizeSpaces(m[2]) });
    }
    return out;
  };

  if (iBlock) colI.push(...parseList(iBlock[1], true));
  if (iiBlock) colII.push(...parseList(iiBlock[1], false));

  // Fallback: "A. … B. …" without Column headers
  if (colI.length === 0) {
    const loose = parseList(text, true);
    if (loose.length >= 2) colI.push(...loose.slice(0, 4));
  }

  return { matchColumnI: colI, matchColumnII: colII };
}

/**
 * Detect Match-the-Following section directions + question ranges.
 */
export function detectMatchFollowingBlocks(fullText) {
  const text = String(fullText || '');
  const blocks = [];
  const re =
    /(?:^|\n)\s*((?:Match\s+the\s+Following[^\n]{0,120}|Directions\s*:\s*Following\s+questions\s+have\s+four\s+statements[^\n]{0,200}))/gi;
  const markers = [];
  let m;
  while ((m = re.exec(text))) {
    markers.push({
      index: m.index + (m[0].startsWith('\n') ? 1 : 0),
      title: normalizeSpaces(m[1]),
    });
  }

  if (markers.length === 0 && /Column\s*I/i.test(text) && /Column\s*II/i.test(text)) {
    const qRange = [];
    const qRe = /(?:^|\n)\s*(\d{1,3})\.\s+(?:Match|Column)/gi;
    let qm;
    while ((qm = qRe.exec(text))) {
      const n = parseInt(qm[1], 10);
      if (n >= 1 && n <= 200) qRange.push(n);
    }
    if (qRange.length) {
      blocks.push({
        sharedMatterId: 'MF1',
        sharedMatterText: DEFAULT_MATCH_DIRECTIONS,
        questionRange: consecutiveQuestionRun(qRange, 8),
      });
    }
    return blocks;
  }

  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index : Math.min(text.length, start + 5000);
    const slice = text.slice(start, end);
    const firstQ = slice.search(/(?:^|\n)\s*\d{1,3}\.\s+\S/);
    const directionsBody =
      firstQ > 20
        ? normalizeSpaces(slice.slice(0, firstQ))
        : normalizeSpaces(markers[i].title);
    const qRange = extractQuestionNumbersNear(
      text,
      start + (firstQ > 0 ? firstQ : 0),
      end,
      highestQuestionNumberBefore(text, start),
    );
    const run = consecutiveQuestionRun(qRange, 8);
    if (!run.length) continue;
    blocks.push({
      sharedMatterId: `MF${blocks.length + 1}`,
      sharedMatterText:
        directionsBody.length >= 30 ? directionsBody : DEFAULT_MATCH_DIRECTIONS,
      questionRange: run,
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

    const withMatter = {
      ...row,
      passageId: hit.passageId,
      passageText: passage,
      sharedMatterId: hit.passageId,
      sharedMatterText: passage,
      sharedMatterKind: 'case',
    };

    // Always store metadata; only prepend when the stem is a short orphan
    if (stemAlreadyHasPassageContext(stem, passage)) {
      return { ...withMatter, questionText: stem };
    }

    if (stem.length < 120) {
      return {
        ...withMatter,
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
    if (!looksLikeAR && hasOwnOptions) {
      // In AR range but stem doesn't look like A/R — still attach shared directions
      return {
        ...row,
        sharedOptionsId: hit.sharedOptionsId,
        sharedMatterId: hit.sharedOptionsId,
        sharedMatterText: String(hit.sharedMatterText || '').trim() || DEFAULT_AR_DIRECTIONS,
        sharedMatterKind: 'assertion_reason',
        questionType: 'assertion_reason',
      };
    }

    const parsed = parseAssertionReasonFromStem(row.questionText);
    const matter =
      String(hit.sharedMatterText || '').trim() || DEFAULT_AR_DIRECTIONS;

    return {
      ...row,
      questionType: 'assertion_reason',
      questionText: parsed.cleanedStem || String(row.questionText || '').trim(),
      assertionText: parsed.assertionText || String(row.assertionText || '').trim(),
      reasonText: parsed.reasonText || String(row.reasonText || '').trim(),
      option1: !hasOwnOptions ? opts[0] || row.option1 : row.option1 || opts[0],
      option2: !hasOwnOptions ? opts[1] || row.option2 : row.option2 || opts[1],
      option3: !hasOwnOptions ? opts[2] || row.option3 : row.option3 || opts[2],
      option4: !hasOwnOptions ? opts[3] || row.option4 : row.option4 || opts[3],
      sharedOptionsId: hit.sharedOptionsId,
      sharedMatterId: hit.sharedOptionsId,
      sharedMatterText: matter,
      sharedMatterKind: 'assertion_reason',
      needsPassage: false,
    };
  });
}

export function attachMatchFollowingMatter(rows, matchBlocks) {
  if (!Array.isArray(rows) || !matchBlocks?.length) return rows;
  return rows.map((row) => {
    const qn = Number(row?.questionNumber);
    if (!Number.isFinite(qn)) return row;
    const hit = matchBlocks.find((b) => b.questionRange.includes(qn));
    const stem = String(row.questionText || '');
    const looksLikeMatch =
      /Column\s*I/i.test(stem) ||
      /match\s+(each|the|column)/i.test(stem) ||
      /A-\d/i.test(String(row.option1 || ''));

    if (!hit && !looksLikeMatch) return row;

    const columns = parseMatchColumnsFromStem(stem);
    const matter =
      String(hit?.sharedMatterText || '').trim() || DEFAULT_MATCH_DIRECTIONS;
    const matterId = hit?.sharedMatterId || `MF_Q${qn}`;

    return {
      ...row,
      questionType:
        row.questionType === 'multiple' || row.questionType === 'integer'
          ? row.questionType
          : 'match_following',
      sharedMatterId: matterId,
      sharedMatterText: matter,
      sharedMatterKind: 'match_following',
      matchColumnI:
        Array.isArray(row.matchColumnI) && row.matchColumnI.length
          ? row.matchColumnI
          : columns.matchColumnI,
      matchColumnII:
        Array.isArray(row.matchColumnII) && row.matchColumnII.length
          ? row.matchColumnII
          : columns.matchColumnII,
    };
  });
}

/**
 * Heuristic: promote lone AR / Match stems even without a detected section block.
 */
export function promoteStructuredTypesFromStem(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    const stem = String(row.questionText || '');
    if (row.sharedMatterKind === 'assertion_reason' || row.questionType === 'assertion_reason') {
      const parsed = parseAssertionReasonFromStem(stem);
      return {
        ...row,
        questionType: 'assertion_reason',
        assertionText: row.assertionText || parsed.assertionText,
        reasonText: row.reasonText || parsed.reasonText,
        questionText: parsed.cleanedStem || stem,
        sharedMatterId: row.sharedMatterId || 'AR1',
        sharedMatterText: row.sharedMatterText || DEFAULT_AR_DIRECTIONS,
        sharedMatterKind: 'assertion_reason',
      };
    }
    if (row.sharedMatterKind === 'match_following' || row.questionType === 'match_following') {
      const columns = parseMatchColumnsFromStem(stem);
      return {
        ...row,
        questionType: 'match_following',
        matchColumnI: row.matchColumnI?.length ? row.matchColumnI : columns.matchColumnI,
        matchColumnII: row.matchColumnII?.length ? row.matchColumnII : columns.matchColumnII,
        sharedMatterId: row.sharedMatterId || 'MF1',
        sharedMatterText: row.sharedMatterText || DEFAULT_MATCH_DIRECTIONS,
        sharedMatterKind: 'match_following',
      };
    }

    const looksLikeAR =
      /\bA\s*[:：]/.test(stem) && /\bR\s*[:：]/.test(stem);
    if (looksLikeAR && row.sharedMatterKind !== 'case') {
      const parsed = parseAssertionReasonFromStem(stem);
      const opts = [row.option1, row.option2, row.option3, row.option4].map((o) =>
        String(o || '').trim(),
      );
      const needDefaults = opts.filter(Boolean).length < 2;
      return {
        ...row,
        questionType: 'assertion_reason',
        assertionText: parsed.assertionText,
        reasonText: parsed.reasonText,
        questionText: parsed.cleanedStem || stem,
        option1: needDefaults ? DEFAULT_AR_OPTIONS[0] : row.option1,
        option2: needDefaults ? DEFAULT_AR_OPTIONS[1] : row.option2,
        option3: needDefaults ? DEFAULT_AR_OPTIONS[2] : row.option3,
        option4: needDefaults ? DEFAULT_AR_OPTIONS[3] : row.option4,
        sharedMatterId: row.sharedMatterId || 'AR1',
        sharedMatterText: row.sharedMatterText || DEFAULT_AR_DIRECTIONS,
        sharedMatterKind: 'assertion_reason',
      };
    }

    const looksLikeMatch =
      /Column\s*I/i.test(stem) && (/Column\s*II/i.test(stem) || /A-\d/.test(String(row.option1 || '')));
    if (looksLikeMatch && row.sharedMatterKind !== 'case') {
      const columns = parseMatchColumnsFromStem(stem);
      return {
        ...row,
        questionType: 'match_following',
        matchColumnI: columns.matchColumnI,
        matchColumnII: columns.matchColumnII,
        sharedMatterId: row.sharedMatterId || 'MF1',
        sharedMatterText: row.sharedMatterText || DEFAULT_MATCH_DIRECTIONS,
        sharedMatterKind: 'match_following',
      };
    }

    // Map legacy passage fields onto shared matter when present
    if (row.passageText && !row.sharedMatterText) {
      return {
        ...row,
        sharedMatterId: row.passageId || row.sharedMatterId || '',
        sharedMatterText: row.passageText,
        sharedMatterKind: row.sharedMatterKind || 'case',
      };
    }
    return row;
  });
}

/**
 * Lightweight shared-matter attach (no figure extraction) — safe for fast mode.
 */
export async function attachSharedMatterLightweight({ rows, fullText, pdfBuffer }) {
  let text = String(fullText || '');
  if (!text && pdfBuffer) {
    try {
      const parser = new PDFParse({ data: pdfBuffer });
      const parsed = await parser.getText();
      text = String(parsed?.text || '');
      await parser.destroy().catch(() => {});
    } catch (e) {
      console.warn('[PDF_ENRICH] lightweight text extract failed:', e?.message || e);
    }
  }

  const passages = detectPassagesFromPdfText(text);
  const arBlocks = detectAssertionReasonBlocks(text);
  const matchBlocks = detectMatchFollowingBlocks(text);

  let next = attachPassagesToRows(rows, passages);
  next = attachAssertionReasonOptions(next, arBlocks);
  next = attachMatchFollowingMatter(next, matchBlocks);
  next = promoteStructuredTypesFromStem(next);

  return {
    rows: next,
    meta: {
      passages,
      arBlocks,
      matchBlocks,
      lightweight: true,
    },
  };
}

/**
 * Heuristic validation: can this stem stand alone?
 */
function rowCombinedText(row) {
  return `${String(row?.passageText || '')}\n${String(row?.sharedMatterText || '')}\n${String(row?.questionText || '')}`;
}

function rowLooksLikeMatchTable(row) {
  if (row?.questionType === 'match_following' || row?.sharedMatterKind === 'match_following') return true;
  return MATCH_TABLE_HINT_RE.test(rowCombinedText(row));
}

function rowWantsFigure(row) {
  if (String(row?.questionImage || '').trim()) return false;
  const text = rowCombinedText(row);
  return (
    row?.hasFigure === true ||
    rowLooksLikeMatchTable(row) ||
    FIGURE_HINT_RE.test(text)
  );
}

export function validateExtractedQuestionRow(row) {
  const flags = [];
  const text = String(row?.questionText || '');
  const passage = String(row?.passageText || row?.sharedMatterText || '');
  const combined = `${passage}\n${text}`;
  const hasImage = Boolean(String(row?.questionImage || '').trim());

  if ((FIGURE_HINT_RE.test(text) || rowLooksLikeMatchTable(row)) && !hasImage) {
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

function groupWantingRows(wanting) {
  const groups = [];
  const groupByKey = new Map();
  for (const entry of wanting) {
    const key =
      String(entry.row.sharedMatterId || entry.row.passageId || '').trim() || `q${entry.qn}`;
    if (!groupByKey.has(key)) {
      const group = [];
      groupByKey.set(key, group);
      groups.push(group);
    }
    groupByKey.get(key).push(entry);
  }
  return groups;
}

async function saveQuestionImageBuffer(buf, examId, savedUrlByImageKey, key) {
  if (savedUrlByImageKey.has(key)) return savedUrlByImageKey.get(key);
  const ext = buf[0] === 0x89 ? 'png' : buf[0] === 0xff ? 'jpg' : 'png';
  const filename = `exam-${String(examId || 'pdf').slice(-8)}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)}.${ext}`;
  await fs.writeFile(path.join(QUESTIONS_UPLOAD_DIR, filename), buf);
  const url = `/uploads/questions/${filename}`;
  savedUrlByImageKey.set(key, url);
  return url;
}

/**
 * Attach PDF figures to the questions that need them.
 *
 * 1. Embedded images via getImage() (diagrams that are true image XObjects).
 * 2. Page screenshots via getScreenshot() for Match-the-Following tables and
 *    any figure-needing question that still has no image (ASLI papers often
 *    draw tables/figures as vectors, so getImage finds nothing).
 */
export async function attachPdfFiguresToRows(pdfBuffer, rows, { examId } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  let parser;
  try {
    parser = new PDFParse({ data: pdfBuffer });
    const { map: qToPage } = await mapQuestionNumbersToPages(parser);

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

    const pagesNeedingWork = new Set();
    for (const [pageNumber, pageRows] of rowsByPage) {
      if (pageRows.some(({ row }) => rowWantsFigure(row))) pagesNeedingWork.add(pageNumber);
      else if (pageRows.length === 1 && !String(pageRows[0].row.questionImage || '').trim()) {
        // May still pick up a lone embedded figure below
        pagesNeedingWork.add(pageNumber);
      }
    }

    const imageResult = await parser.getImage(
      pagesNeedingWork.size
        ? { partial: [...pagesNeedingWork], imageBuffer: true, imageDataUrl: false }
        : { imageBuffer: true, imageDataUrl: false },
    );
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

    const candidatesByPage = new Map();
    for (const page of pages) {
      const pageNumber = Number(page?.pageNumber) || 0;
      const list = [];
      for (const img of Array.isArray(page?.images) ? page.images : []) {
        if (isLikelyLogoOrTiny(img)) continue;
        const key = imageKey(img);
        if (!key || (pagesSeenByImage.get(key) || 0) >= 3) continue;
        const buf = bufferFromImageData(img.data);
        if (!buf) continue;
        list.push({ buf, key, kind: 'embed' });
      }
      if (list.length) candidatesByPage.set(pageNumber, list);
    }

    // Decide which pages need a full-page screenshot (match tables / missing embeds).
    // Cap count — rendering every page kills wall time on large papers.
    const matchShotPages = [];
    const otherShotPages = [];
    for (const [pageNumber, pageRows] of rowsByPage) {
      const wanting = pageRows.filter(({ row }) => rowWantsFigure(row));
      if (!wanting.length) continue;
      const prefersShot = wanting.some(({ row }) => rowLooksLikeMatchTable(row));
      const embeds = candidatesByPage.get(pageNumber) || [];
      if (prefersShot) matchShotPages.push(pageNumber);
      else if (embeds.length === 0) otherShotPages.push(pageNumber);
    }
    const screenshotPageList = [...matchShotPages, ...otherShotPages]
      .sort((a, b) => a - b)
      .filter((n, i, arr) => arr.indexOf(n) === i)
      .slice(0, 8);

    const screenshotByPage = new Map();
    if (screenshotPageList.length > 0) {
      try {
        const shotResult = await parser.getScreenshot({
          partial: screenshotPageList,
          scale: 1.2,
          imageBuffer: true,
          imageDataUrl: false,
        });
        for (const page of Array.isArray(shotResult?.pages) ? shotResult.pages : []) {
          const pageNumber = Number(page?.pageNumber) || 0;
          const buf = bufferFromImageData(page?.data);
          if (!buf || buf.length < 1000 || !pageNumber) continue;
          screenshotByPage.set(pageNumber, {
            buf,
            key: `shot:${pageNumber}:${buf.length}`,
            kind: 'screenshot',
          });
        }
      } catch (shotErr) {
        console.warn(
          '[PDF_ENRICH] getScreenshot failed (match/figure pages may lack photos):',
          shotErr?.message || shotErr,
        );
      }
    }

    const savedUrlByImageKey = new Map();
    const urlByRowIdx = new Map();

    for (const [pageNumber, pageRowsRaw] of rowsByPage) {
      const pageRows = [...pageRowsRaw].sort((a, b) => a.qn - b.qn);
      let wanting = pageRows.filter(({ row }) => rowWantsFigure(row));
      const embeds = candidatesByPage.get(pageNumber) || [];
      const shot = screenshotByPage.get(pageNumber);

      // Single question alone on a page with an image → that image is its figure
      if (!wanting.length && pageRows.length === 1 && embeds.length) {
        wanting = pageRows;
      }
      if (!wanting.length) continue;

      const groups = groupWantingRows(wanting);
      const useScreenshotFirst = wanting.some(({ row }) => rowLooksLikeMatchTable(row)) && shot;

      if (useScreenshotFirst) {
        for (const group of groups) {
          for (const entry of group) {
            urlByRowIdx.set(entry.idx, shot);
          }
        }
        continue;
      }

      // Zip shared-matter groups with embedded images in page order
      const n = Math.min(groups.length, embeds.length);
      for (let i = 0; i < n; i += 1) {
        for (const entry of groups[i]) {
          urlByRowIdx.set(entry.idx, embeds[i]);
        }
      }
      // Fallback: remaining figure-needing groups get the page screenshot
      if (shot) {
        for (let i = n; i < groups.length; i += 1) {
          for (const entry of groups[i]) {
            if (!urlByRowIdx.has(entry.idx)) urlByRowIdx.set(entry.idx, shot);
          }
        }
      }
    }

    if (urlByRowIdx.size === 0) return rows;
    await ensureQuestionsUploadDir();

    for (const candidate of new Set(urlByRowIdx.values())) {
      await saveQuestionImageBuffer(candidate.buf, examId, savedUrlByImageKey, candidate.key);
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
  const matchBlocks = detectMatchFollowingBlocks(text);

  let next = attachPassagesToRows(rows, passages);
  next = attachAssertionReasonOptions(next, arBlocks);
  next = attachMatchFollowingMatter(next, matchBlocks);
  next = promoteStructuredTypesFromStem(next);
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
    matchBlocks: matchBlocks.length,
    withImages: next.filter((r) => r.questionImage).length,
    flagged: next.filter((r) => !r.solvable).length,
  });

  return {
    rows: next,
    meta: {
      passages,
      arBlocks,
      matchBlocks,
      flaggedCount: next.filter((r) => !r.solvable).length,
      withImages: next.filter((r) => r.questionImage).length,
    },
  };
}
