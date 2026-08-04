/**
 * Enrich Gemini PDF question extraction:
 * - Detect shared case/passage blocks and attach to child questions (tight ranges only)
 * - Detect Assertionâ€“Reason shared option sets
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
  /\b(screw\s*gauge|vernier|calliper|caliper|diagram|figure|graph|shown\s+in\s+the\s+(?:figure|diagram|graph)|least\s*count|circular\s*scale|main\s*scale|as\s+shown|refer\s+to\s+(?:the\s+)?(?:figure|diagram)|given\s+figure|marked\s+point|shown\s+below|velocity[- ]time|distance[- ]time)\b/i;

/** Match-the-Following tables are usually vector text in PDFs â€” detect so we can screenshot the page. */
const MATCH_TABLE_HINT_RE =
  /Column\s*I\b|Column\s*II\b|List\s*-?\s*I\b|List\s*-?\s*II\b|match\s+(?:the\s+)?(?:following|each|column)/i;

/** Stops a case block from swallowing the rest of the paper */
const SECTION_STOP_RE =
  /(?:^|\n)\s*(?:Mathematics|Maths|Physics|Chemistry|Biology|Science|English|Hindi|Social\s*Science|Assertion\s*[-â€“]?\s*Reason|Match\s+the\s+Following|SECTION\s*[A-D]|Single\s+Correct|Multi\s+Correct|Integer\s+Type)\b/i;

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
 * after it â€” without this floor, "Column II" lists inside a Match-the-Following
 * ("1. â€¦", "2. â€¦") are read as question numbers 1-4 and the passage gets
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
 * Intentionally does NOT match bare "Case Based Type Questions" section titles â€”
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
 * Find Assertionâ€“Reason Directions blocks and question ranges that use shared options.
 */
export function detectAssertionReasonBlocks(fullText) {
  const text = String(fullText || '');
  const blocks = [];
  const re =
    /(?:^|\n)\s*(Assertion\s*[-â€“]?\s*Reason[^\n]*|Directions\s*:\s*Each\s+question\s+is\s+followed\s+by\s+four\s+options[^\n]*Assertion[^\n]*)/gi;
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
 * Split an Assertionâ€“Reason stem into A / R fields.
 */
export function parseAssertionReasonFromStem(stem) {
  const text = String(stem || '').trim();
  if (!text) return { assertionText: '', reasonText: '', cleanedStem: '' };

  const arMatch = text.match(
    /(?:^|\n)\s*A\s*[:ï¼š]\s*([\s\S]*?)(?:\n|\s+)R\s*[:ï¼š]\s*([\s\S]*?)$/i,
  );
  if (arMatch) {
    return {
      assertionText: normalizeSpaces(arMatch[1]),
      reasonText: normalizeSpaces(arMatch[2]),
      cleanedStem: `A: ${normalizeSpaces(arMatch[1])}\nR: ${normalizeSpaces(arMatch[2])}`.trim(),
    };
  }

  const inline = text.match(
    /\bA\s*[:ï¼š]\s*(.+?)\s+R\s*[:ï¼š]\s*(.+)$/i,
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

  // Fallback: "A. â€¦ B. â€¦" without Column headers
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
  // Long stem from Gemini that already inlined case facts â€” do not double-prepend
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

    // Long unrelated stem that wrongly matched a wide range â€” keep stem, skip passage
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
      /\bA\s*[:：]/.test(String(row.questionText || '')) ||
      /\bR\s*[:：]/.test(String(row.questionText || '')) ||
      /assertion/i.test(String(row.questionText || ''));
    if (!looksLikeAR && hasOwnOptions) {
      // In AR range but stem doesn't look like A/R â€” still attach shared directions
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
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    const qn = Number(row?.questionNumber);
    if (!Number.isFinite(qn)) return row;
    const hit = Array.isArray(matchBlocks)
      ? matchBlocks.find((b) => b.questionRange.includes(qn))
      : null;
    const stem = String(row.questionText || '');
    const looksLikeMatch =
      (/Column\s*I\b/i.test(stem) && /Column\s*II\b/i.test(stem)) ||
      /match\s+the\s+following/i.test(stem) ||
      (/Column\s*I\b/i.test(stem) && /A-\s*\d/.test(String(row.option1 || '')));

    // Require the stem itself to look like Match. Section ranges alone were
    // stamping Match directions onto unrelated MCQs (false "need photo" flags).
    if (!looksLikeMatch) return row;

    const columns = parseMatchColumnsFromStem(stem);
    const matter =
      String(hit?.sharedMatterText || '').trim() || DEFAULT_MATCH_DIRECTIONS;
    const matterId = hit?.sharedMatterId || `MF_Q${qn}`;

    return {
      ...row,
      questionType: 'match_following',
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
      const cleaned = stripLeadingCaseFromArStem(stem);
      const parsed = parseAssertionReasonFromStem(cleaned);
      return {
        ...row,
        questionType: 'assertion_reason',
        assertionText: row.assertionText || parsed.assertionText,
        reasonText: row.reasonText || parsed.reasonText,
        questionText: parsed.cleanedStem || cleaned,
        sharedMatterId: row.sharedMatterId || 'AR1',
        sharedMatterText: looksLikeArDirections(row.sharedMatterText)
          ? row.sharedMatterText
          : DEFAULT_AR_DIRECTIONS,
        sharedMatterKind: 'assertion_reason',
        passageText: '',
        passageId: '',
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
      stemLooksLikeAssertionReason(stem) || optionsLookLikeAssertionReason(row);
    // Promote even if wrongly tagged as case — Case matter on an A/R stem is a bug
    if (looksLikeAR) {
      const cleaned = stripLeadingCaseFromArStem(stem);
      const parsed = parseAssertionReasonFromStem(cleaned);
      const opts = [row.option1, row.option2, row.option3, row.option4].map((o) =>
        String(o || '').trim(),
      );
      const needDefaults = opts.filter(Boolean).length < 2;
      return {
        ...row,
        questionType: 'assertion_reason',
        assertionText: row.assertionText || parsed.assertionText,
        reasonText: row.reasonText || parsed.reasonText,
        questionText: parsed.cleanedStem || cleaned,
        option1: needDefaults ? DEFAULT_AR_OPTIONS[0] : row.option1,
        option2: needDefaults ? DEFAULT_AR_OPTIONS[1] : row.option2,
        option3: needDefaults ? DEFAULT_AR_OPTIONS[2] : row.option3,
        option4: needDefaults ? DEFAULT_AR_OPTIONS[3] : row.option4,
        sharedMatterId: 'AR1',
        sharedMatterText: looksLikeArDirections(row.sharedMatterText)
          ? row.sharedMatterText
          : DEFAULT_AR_DIRECTIONS,
        sharedMatterKind: 'assertion_reason',
        passageText: '',
        passageId: '',
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
 * Lightweight shared-matter attach (no figure extraction) â€” safe for fast mode.
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

  let   next = attachPassagesToRows(rows, passages);
  next = attachAssertionReasonOptions(next, arBlocks);
  next = attachMatchFollowingMatter(next, matchBlocks);
  next = promoteStructuredTypesFromStem(next);

  return {
    rows: applyExtractionValidation(ensureAssertionReasonDirections(next)),
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
  // Prefer explicit type. Do NOT trust sharedMatterKind alone — match-section
  // ranges were attaching Match directions onto unrelated MCQs (false flags).
  if (row?.questionType === 'match_following') return true;
  const stem = String(row?.questionText || '');
  const opt1 = String(row?.option1 || '');
  if (/match\s+the\s+following/i.test(stem)) return true;
  if (/Column\s*I\b/i.test(stem) && /Column\s*II\b/i.test(stem)) return true;
  if (/Column\s*I\b/i.test(stem) && /A-\s*\d/.test(opt1)) return true;
  return false;
}

function rowIsAssertionReason(row) {
  if (
    row?.questionType === 'assertion_reason' ||
    row?.sharedMatterKind === 'assertion_reason' ||
    String(row?.questionType || '').toUpperCase() === 'ASSERTION_REASON'
  ) {
    return true;
  }
  return optionsLookLikeAssertionReason(row);
}

/** Standard A/R choice lines (even when Gemini typed the Q as MCQ). */
function optionsLookLikeAssertionReason(row) {
  const blob = [row?.option1, row?.option2, row?.option3, row?.option4]
    .map((o) => String(o || ''))
    .join('\n');
  if (/Both A and R are true/i.test(blob) && /correct explanation of A/i.test(blob)) return true;
  const opts = Array.isArray(row?.options)
    ? row.options.map((o) => (typeof o === 'string' ? o : o?.text || '')).join('\n')
    : '';
  return /Both A and R are true/i.test(opts) && /correct explanation of A/i.test(opts);
}

function stemLooksLikeAssertionReason(stem) {
  const s = String(stem || '');
  return /\bA\s*[:：]/.test(s) && /\bR\s*[:：]/.test(s);
}

/** Drop a wrongly prepended Case/passage block sitting above A:/R:. */
function stripLeadingCaseFromArStem(stem) {
  const s = String(stem || '').trim();
  if (!stemLooksLikeAssertionReason(s)) return s;
  const cut = s.search(/\bA\s*[:：]/);
  if (cut > 0 && /^Case\b/i.test(s)) return s.slice(cut).trim();
  return s;
}

/** True when shared matter already looks like standard A/R directions (not a case passage). */
function looksLikeArDirections(text) {
  const t = String(text || '');
  return (
    /correct explanation of A/i.test(t) ||
    (/Both A and R are true/i.test(t) && /A is false,\s*but R is true/i.test(t))
  );
}

/**
 * Every Assertion–Reason question gets the standard directions block at the top.
 * Converts MCQ-looking rows with A/R options, and clears wrongly attached case matter.
 */
export function ensureAssertionReasonDirections(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    const stem = String(row?.questionText || '');
    const isAr =
      rowIsAssertionReason(row) ||
      stemLooksLikeAssertionReason(stem) ||
      optionsLookLikeAssertionReason(row);
    if (!isAr) return row;

    const cleanedStem = stripLeadingCaseFromArStem(stem);
    const parsed = parseAssertionReasonFromStem(cleanedStem);
    const matter = String(row.sharedMatterText || '').trim();
    const nextMatter = looksLikeArDirections(matter) ? matter : DEFAULT_AR_DIRECTIONS;
    const opts = [row.option1, row.option2, row.option3, row.option4].map((o) =>
      String(o || '').trim(),
    );
    const needDefaults = opts.filter(Boolean).length < 2;

    return {
      ...row,
      questionType: 'assertion_reason',
      sharedMatterKind: 'assertion_reason',
      sharedMatterId: row.sharedMatterId && row.sharedMatterKind === 'assertion_reason'
        ? row.sharedMatterId
        : 'AR1',
      sharedMatterText: nextMatter,
      passageText: '',
      passageId: '',
      questionText: parsed.cleanedStem || cleanedStem,
      assertionText: row.assertionText || parsed.assertionText,
      reasonText: row.reasonText || parsed.reasonText,
      option1: needDefaults ? DEFAULT_AR_OPTIONS[0] : row.option1,
      option2: needDefaults ? DEFAULT_AR_OPTIONS[1] : row.option2,
      option3: needDefaults ? DEFAULT_AR_OPTIONS[2] : row.option3,
      option4: needDefaults ? DEFAULT_AR_OPTIONS[3] : row.option4,
      questionImage: '',
      hasFigure: false,
    };
  });
}

function rowWantsFigure(row) {
  if (String(row?.questionImage || '').trim()) return false;
  // Assertion–Reason / Match: text only — never auto photos
  if (rowIsAssertionReason(row)) return false;
  if (rowLooksLikeMatchTable(row)) return false;
  if (row?.hasFigure === true) return true;
  // Scan stem + case passage (skip AR-directions matter — it is not a figure hint)
  const matter = String(row?.sharedMatterText || '');
  const matterForHint = looksLikeArDirections(matter) ? '' : matter;
  const text = `${String(row?.passageText || '')}\n${matterForHint}\n${String(row?.questionText || '')}`;
  if (FIGURE_HINT_RE.test(text)) return true;
  // Case/passage questions often depend on a printed diagram even without the word "figure"
  if (
    (row?.sharedMatterKind === 'case' || row?.passageId) &&
    /\b(diagram|figure|shown|graph|rod|scale|vernier|calliper|caliper|vector|force)\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

export function validateExtractedQuestionRow(row) {
  const flags = [];
  const text = String(row?.questionText || '');
  const passage = String(row?.passageText || row?.sharedMatterText || '');
  const hasImage = Boolean(String(row?.questionImage || '').trim());
  const type = String(row?.questionType || 'mcq').toLowerCase();
  const isAr = rowIsAssertionReason(row);
  const isMatch = rowLooksLikeMatchTable(row);
  const hasMatchCols =
    (Array.isArray(row?.matchColumnI) && row.matchColumnI.length > 0) ||
    (Array.isArray(row?.matchColumnII) && row.matchColumnII.length > 0);

  // Strong diagram signals only (avoid flagging every "shown" / chemistry MCQ)
  const strongFigure =
    row?.hasFigure === true ||
    /\b(diagram|figure|vernier|calliper|caliper|screw\s*gauge|graph|shown\s+below|as\s+shown|velocity[- ]time|distance[- ]time)\b/i.test(
      text,
    );

  if (strongFigure && !hasImage && !isAr && !isMatch) {
    flags.push('needs_figure');
  }

  if (isMatch && !hasMatchCols && !hasImage) {
    flags.push('needs_figure');
  }

  if ((type === 'mcq' || type === 'assertion_reason' || type === 'match_following' || isAr) && !isMatch) {
    const opts = [row?.option1, row?.option2, row?.option3, row?.option4]
      .map((o) => String(o || '').trim())
      .filter(Boolean);
    if (opts.length < 2) flags.push('incomplete_options');
    if (!String(row?.correctAnswer || '').trim()) flags.push('missing_answer');
  }
  if (type === 'integer' && !String(row?.correctAnswer || '').trim()) {
    flags.push('missing_answer');
  }

  const combined = `${passage}\n${text}`;
  const numbersInStem = combined.match(/\d/g) || [];
  if (
    text.length < 90 &&
    numbersInStem.length < 2 &&
    !hasImage &&
    !passage &&
    !isMatch &&
    !isAr &&
    /\b(what|how|find|side|length|volume|number)\b/i.test(text)
  ) {
    flags.push('needs_passage');
  }

  if (row?.passageId && !passage && numbersInStem.length < 2 && !isAr) {
    flags.push('needs_passage');
  }

  if (row?.answerConflict === true) {
    flags.push('answer_conflict');
  }

  const unique = [...new Set(flags)];
  const solvable = unique.length === 0;
  return {
    solvable,
    validationFlags: unique,
    validationNote: solvable
      ? ''
      : unique.includes('answer_conflict')
        ? 'Answer needs checking'
        : unique.includes('needs_figure')
          ? isMatch
            ? 'Match table columns missing — fill Column I/II or upload a cropped table photo'
            : 'Needs diagram/figure from the paper'
          : unique.includes('incomplete_options')
            ? 'Options incomplete'
            : unique.includes('missing_answer')
              ? 'Correct answer missing'
              : 'Needs case/passage context',
  };
}

/** Run validation + strip bad auto-images (AR / false Match). */
export function applyExtractionValidation(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row, idx) => {
    let next = { ...row };

    // Clear Match matter wrongly stamped onto non-match MCQs
    if (
      next.sharedMatterKind === 'match_following' &&
      next.questionType !== 'match_following' &&
      !rowLooksLikeMatchTable(next)
    ) {
      next = {
        ...next,
        sharedMatterKind: '',
        sharedMatterId: '',
        sharedMatterText: '',
        matchColumnI: [],
        matchColumnII: [],
      };
    }

    if (rowIsAssertionReason(next)) {
      next.questionImage = '';
      next.hasFigure = false;
    }
    if (rowLooksLikeMatchTable(next) && next.questionType === 'match_following') {
      // Keep text columns; drop accidental full-page shots
      next.questionImage = '';
      next.hasFigure = false;
    }
    const v = validateExtractedQuestionRow(next);
    return {
      ...next,
      row: next.row || idx + 1,
      solvable: v.solvable,
      validationFlags: v.validationFlags,
      validationNote: v.validationNote,
    };
  });
}

async function ensureQuestionsUploadDir() {
  await fs.mkdir(QUESTIONS_UPLOAD_DIR, { recursive: true });
}

function isLikelyLogoOrTiny(img) {
  const w = Number(img?.width) || 0;
  const h = Number(img?.height) || 0;
  // Keep small-but-real diagrams; only drop tiny icons / tracking pixels
  if (w < 60 || h < 50) return true;
  if (w * h < 8000) return true;
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
  const pageTexts = [];
  pages.forEach((p, idx) => {
    const pageNumber = Number(p?.pageNumber) || idx + 1;
    const t = String(p?.text || '');
    pageTexts.push({ pageNumber, text: t });
    // Common paper layouts: "25. The …", "25) …", "Q.25 …", "Q25."
    const patterns = [
      /(?:^|\n)\s*(\d{1,3})\.\s+\S/g,
      /(?:^|\n)\s*(\d{1,3})\)\s+\S/g,
      /(?:^|\n)\s*Q\.?\s*(\d{1,3})[.)]\s*\S/gi,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(t))) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 200 && !map.has(n)) map.set(n, pageNumber);
      }
    }
  });
  return { map, pageCount: pages.length, pageTexts };
}

/** Find a page for a question when the primary number→page map missed it. */
function resolvePageForRow(row, qToPage, pageTexts) {
  const qn = Number(row?.questionNumber);
  if (Number.isFinite(qn) && qToPage.has(qn)) return qToPage.get(qn);

  const stem = String(row?.questionText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  if (stem.length >= 18) {
    const needle = stem.toLowerCase();
    for (const p of pageTexts) {
      if (String(p.text || '').toLowerCase().includes(needle)) return p.pageNumber;
    }
  }

  if (Number.isFinite(qn)) {
    // Nearby printed numbers often share a page (e.g. 24 mapped, 25 missed)
    for (const delta of [-1, 1, -2, 2]) {
      const near = qToPage.get(qn + delta);
      if (near) return near;
    }
  }
  return null;
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
 * Attach PDF figures to questions.
 *
 * fast=true (default extract path): SKIP getImage() — it can hang 10–15+ min on
 * ASLI papers. Take top-crop page screenshots for diagram questions only.
 *
 * fast=false: try embedded images first, then top-crop fallback.
 * Match / Assertion–Reason: no auto photo.
 */
export async function attachPdfFiguresToRows(pdfBuffer, rows, { examId, fast = true } = {}) {
  if (!Array.isArray(rows) || rows.length === 0 || !pdfBuffer) return rows;
  const startedAt = Date.now();
  let parser;
  try {
    parser = new PDFParse({ data: pdfBuffer });
    const { map: qToPage, pageTexts } = await mapQuestionNumbersToPages(parser);

    const rowsByPage = new Map();
    let unmappedWanting = 0;
    rows.forEach((row, idx) => {
      if (!rowWantsFigure(row)) return;
      const pageNumber = resolvePageForRow(row, qToPage, pageTexts);
      if (!pageNumber) {
        unmappedWanting += 1;
        return;
      }
      if (!rowsByPage.has(pageNumber)) rowsByPage.set(pageNumber, []);
      rowsByPage.get(pageNumber).push({ row, idx, qn: Number(row?.questionNumber) || 0 });
    });

    const imageKey = (img) => {
      const buf = bufferFromImageData(img?.data);
      if (!buf || buf.length < 500) return null;
      return `${buf.length}:${buf.subarray(0, 32).toString('hex')}`;
    };

    const diagramPages = new Set(rowsByPage.keys());

    console.log('[PDF_ENRICH] figure pages', {
      count: diagramPages.size,
      pages: [...diagramPages].sort((a, b) => a - b),
      wanting: rows.filter((r) => rowWantsFigure(r)).map((r) => r.questionNumber),
      unmappedWanting,
      fast,
    });

    const candidatesByPage = new Map();
    const pagesForImages = [...diagramPages].sort((a, b) => a - b).slice(0, fast ? 12 : 24);

    // getImage is only for quality mode — it hangs for minutes on many ASLI PDFs.
    if (!fast && pagesForImages.length > 0) {
      console.log('[PDF_ENRICH] getImage start', {
        pages: pagesForImages,
        elapsedMs: Date.now() - startedAt,
      });
      try {
        const imageResult = await parser.getImage({
          partial: pagesForImages,
          imageBuffer: true,
          imageDataUrl: false,
          imageThreshold: 50,
        });
        const pages = Array.isArray(imageResult?.pages) ? imageResult.pages : [];
        const pagesSeenByImage = new Map();
        for (const page of pages) {
          const uniqueKeys = new Set(
            (Array.isArray(page?.images) ? page.images : []).map(imageKey).filter(Boolean),
          );
          for (const k of uniqueKeys) {
            pagesSeenByImage.set(k, (pagesSeenByImage.get(k) || 0) + 1);
          }
        }
        for (const page of pages) {
          const pageNumber = Number(page?.pageNumber) || 0;
          const list = [];
          for (const img of Array.isArray(page?.images) ? page.images : []) {
            if (isLikelyLogoOrTiny(img)) continue;
            const key = imageKey(img);
            if (!key || (pagesSeenByImage.get(key) || 0) >= 3) continue;
            const buf = bufferFromImageData(img.data);
            if (!buf) continue;
            const area = (Number(img.width) || 0) * (Number(img.height) || 0);
            list.push({
              buf,
              key,
              kind: 'embed',
              area,
              w: Number(img.width) || 0,
              h: Number(img.height) || 0,
            });
          }
          list.sort((a, b) => b.area - a.area);
          if (list.length) candidatesByPage.set(pageNumber, list);
        }
      } catch (imgErr) {
        console.warn('[PDF_ENRICH] getImage failed:', imgErr?.message || imgErr);
      }
      console.log('[PDF_ENRICH] getImage done', {
        pagesWithEmbeds: candidatesByPage.size,
        elapsedMs: Date.now() - startedAt,
      });
    }

    // Vector-diagram / fast path: top-crop of page (not full page dump)
    const cropByPage = new Map();
    const needCropPages = pagesForImages.filter((p) => {
      const embeds = candidatesByPage.get(p) || [];
      return embeds.length === 0;
    });
    if (needCropPages.length > 0) {
      try {
        const cropLimit = fast ? 10 : 14;
        console.log('[PDF_ENRICH] diagram top-crop screenshot start', {
          pages: needCropPages.slice(0, cropLimit),
          elapsedMs: Date.now() - startedAt,
        });
        const shotResult = await parser.getScreenshot({
          partial: needCropPages.slice(0, cropLimit),
          scale: 1.25,
          imageBuffer: true,
          imageDataUrl: false,
        });
        let canvasApi = null;
        try {
          canvasApi = await import('@napi-rs/canvas');
        } catch (canvasErr) {
          console.warn(
            '[PDF_ENRICH] @napi-rs/canvas unavailable, using full screenshot buffers:',
            canvasErr?.message || canvasErr,
          );
        }
        for (const page of Array.isArray(shotResult?.pages) ? shotResult.pages : []) {
          const pageNumber = Number(page?.pageNumber) || 0;
          const full = bufferFromImageData(page?.data);
          if (!full || !pageNumber) continue;
          if (!canvasApi) {
            cropByPage.set(pageNumber, {
              buf: full,
              key: `shot:${pageNumber}:${full.length}`,
              kind: 'shot',
            });
            continue;
          }
          try {
            const img = await canvasApi.loadImage(full);
            // Keep upper ~55% — graphs often sit mid-upper; options below
            const cropH = Math.max(140, Math.floor(img.height * 0.55));
            const canvas = canvasApi.createCanvas(img.width, cropH);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, img.width, cropH);
            ctx.drawImage(img, 0, 0, img.width, cropH, 0, 0, img.width, cropH);
            const buf = canvas.toBuffer('image/png');
            cropByPage.set(pageNumber, {
              buf,
              key: `crop:${pageNumber}:${buf.length}`,
              kind: 'crop',
            });
          } catch (cropErr) {
            console.warn(
              '[PDF_ENRICH] crop failed page',
              pageNumber,
              cropErr?.message || cropErr,
              '— using full screenshot',
            );
            cropByPage.set(pageNumber, {
              buf: full,
              key: `shot:${pageNumber}:${full.length}`,
              kind: 'shot',
            });
          }
        }
        console.log('[PDF_ENRICH] diagram top-crop done', {
          got: cropByPage.size,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (shotErr) {
        console.warn('[PDF_ENRICH] diagram screenshot failed:', shotErr?.message || shotErr);
      }
    }

    const stitchEmbeds = async (embeds) => {
      if (!Array.isArray(embeds) || embeds.length === 0) return null;
      if (embeds.length === 1) return embeds[0];
      try {
        const { createCanvas, loadImage } = await import('@napi-rs/canvas');
        const images = [];
        for (const e of embeds.slice(0, 4)) {
          images.push(await loadImage(e.buf));
        }
        const gap = 10;
        const width = Math.max(...images.map((i) => i.width));
        const height = images.reduce((s, i) => s + i.height, 0) + gap * (images.length - 1);
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        let y = 0;
        for (const img of images) {
          ctx.drawImage(img, 0, y);
          y += img.height + gap;
        }
        const buf = canvas.toBuffer('image/png');
        const key = `stitch:${embeds.map((e) => e.key).join('+')}`;
        return { buf, key, kind: 'stitch' };
      } catch (stitchErr) {
        console.warn('[PDF_ENRICH] stitch failed, using largest embed:', stitchErr?.message || stitchErr);
        return embeds[0];
      }
    };

    const savedUrlByImageKey = new Map();
    const urlByRowIdx = new Map();

    for (const [pageNumber, pageRowsRaw] of rowsByPage) {
      const pageRows = [...pageRowsRaw].sort((a, b) => a.qn - b.qn);
      const embeds = candidatesByPage.get(pageNumber) || [];
      const crop = cropByPage.get(pageNumber);
      const diagramWanting = pageRows.filter(({ row }) => rowWantsFigure(row));
      if (!diagramWanting.length) continue;

      const groups = groupWantingRows(diagramWanting);
      if (embeds.length) {
        if (groups.length === 1) {
          const combined = await stitchEmbeds(embeds);
          if (combined) {
            for (const entry of groups[0]) urlByRowIdx.set(entry.idx, combined);
          }
        } else {
          const n = Math.min(groups.length, embeds.length);
          for (let i = 0; i < n; i += 1) {
            for (const entry of groups[i]) urlByRowIdx.set(entry.idx, embeds[i]);
          }
          if (embeds[0]) {
            for (let i = n; i < groups.length; i += 1) {
              for (const entry of groups[i]) {
                if (!urlByRowIdx.has(entry.idx)) urlByRowIdx.set(entry.idx, embeds[0]);
              }
            }
          }
        }
      } else if (crop) {
        for (const group of groups) {
          for (const entry of group) urlByRowIdx.set(entry.idx, crop);
        }
      }
    }

    if (urlByRowIdx.size === 0) {
      console.log('[PDF_ENRICH] attachPdfFiguresToRows: no images attached', {
        fast,
        diagramPages: diagramPages.size,
        unmappedWanting,
        elapsedMs: Date.now() - startedAt,
      });
      return rows;
    }
    await ensureQuestionsUploadDir();

    for (const candidate of new Set(urlByRowIdx.values())) {
      await saveQuestionImageBuffer(candidate.buf, examId, savedUrlByImageKey, candidate.key);
    }

    console.log('[PDF_ENRICH] attachPdfFiguresToRows done', {
      fast,
      attached: urlByRowIdx.size,
      elapsedMs: Date.now() - startedAt,
    });

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
  next = await attachPdfFiguresToRows(pdfBuffer, next, { examId, fast: false });
  next = applyExtractionValidation(ensureAssertionReasonDirections(next));

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
