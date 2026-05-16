/**
 * Regex-based worksheet question extraction from PDF text (no LLM / no invented content).
 * Assigns Section A–E from PDF headings and question shape (MCQ, FIB, VSA, SA, competency).
 */

export const WORKSHEET_CANONICAL_SECTIONS = [
  'Section A: MCQs',
  'Section B: Fill in the Blanks',
  'Section C: Very Short Answer Questions',
  'Section D: Short Answer Questions',
  'Section E: Competency / Real-life Application Questions',
];

const SECTION_HEADER_DETECTORS = [
  { label: WORKSHEET_CANONICAL_SECTIONS[0], re: /^section\s*a\b|^a[\).:\s-]+.*(mcq|multiple\s*choice)/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[0], re: /^multiple\s*choice\s*questions?/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[1], re: /^section\s*b\b|^b[\).:\s-]+.*(fill|blank|fib)/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[1], re: /^fill\s*in\s*the\s*blanks?/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[2], re: /^section\s*c\b|^c[\).:\s-]+.*(very\s*short|vsa)/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[2], re: /^very\s*short\s*answer/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[3], re: /^section\s*d\b|^d[\).:\s-]+.*short\s*answer/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[3], re: /^short\s*answer\s*questions?/i },
  {
    label: WORKSHEET_CANONICAL_SECTIONS[4],
    re: /^section\s*[ef]\b|^[ef][\).:\s-]+.*(competency|application|real)/i,
  },
  { label: WORKSHEET_CANONICAL_SECTIONS[4], re: /competency|real[\s-]*life\s*application/i },
];

const isHeadingLikeLine = (text) =>
  /\b(chapter|topic|lesson|unit|syllabus)\b/i.test(text) &&
  !/[?]/.test(text) &&
  !/_{2,}/.test(text);

const looksLikeQuestionPrompt = (text) =>
  /[?]|_{3,}|^\s*(what|which|why|how|define|choose|fill|select|state|identify|explain|describe|list)\b/i.test(
    text,
  );

function detectSectionHeaderLine(line) {
  const t = String(line || '').trim();
  if (!t || t.length > 120) return '';
  for (const { label, re } of SECTION_HEADER_DETECTORS) {
    if (re.test(t)) return label;
  }
  if (/^section\s*([a-f])\b[:\s-]*(.*)$/i.test(t)) {
    const m = t.match(/^section\s*([a-f])\b[:\s-]*(.*)$/i);
    const letter = String(m[1] || '').toUpperCase();
    const rest = String(m[2] || '').toLowerCase();
    if (letter === 'A' || /mcq|choice/.test(rest)) return WORKSHEET_CANONICAL_SECTIONS[0];
    if (letter === 'B' || /fill|blank/.test(rest)) return WORKSHEET_CANONICAL_SECTIONS[1];
    if (letter === 'C' || /very|vsa/.test(rest)) return WORKSHEET_CANONICAL_SECTIONS[2];
    if (letter === 'D' || /short/.test(rest)) return WORKSHEET_CANONICAL_SECTIONS[3];
    if (letter === 'E' || letter === 'F' || /competency|application|real/.test(rest)) {
      return WORKSHEET_CANONICAL_SECTIONS[4];
    }
  }
  return '';
}

function inferTypeAndSection(question, options = []) {
  const q = String(question || '').trim();
  const opts = Array.isArray(options) ? options : [];
  if (opts.length >= 2) return { type: 'MCQ', section: WORKSHEET_CANONICAL_SECTIONS[0] };
  if (/_{2,}/.test(q)) return { type: 'FIB', section: WORKSHEET_CANONICAL_SECTIONS[1] };
  if (/competency|real[\s-]*life|application|observe|surroundings|daily\s*life/i.test(q)) {
    return { type: 'COMPETENCY', section: WORKSHEET_CANONICAL_SECTIONS[4] };
  }
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  if (/\?/.test(q) && wordCount <= 22) return { type: 'VSA', section: WORKSHEET_CANONICAL_SECTIONS[2] };
  if (/\?/.test(q)) return { type: 'SA', section: WORKSHEET_CANONICAL_SECTIONS[3] };
  if (/_{2,}/.test(q)) return { type: 'FIB', section: WORKSHEET_CANONICAL_SECTIONS[1] };
  return { type: 'VSA', section: WORKSHEET_CANONICAL_SECTIONS[2] };
}

function sanitizeWorksheetQuestions(questions = []) {
  return questions
    .map((row) => {
      const inferred = inferTypeAndSection(row?.question, row?.options);
      return {
        question: String(row?.question || '').replace(/\s+/g, ' ').trim(),
        options: (Array.isArray(row?.options) ? row.options : [])
          .map((opt) => String(opt || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean),
        answer: String(row?.answer || '').replace(/\s+/g, ' ').trim(),
        section: String(row?.section || inferred.section || '').trim(),
        type: String(row?.type || inferred.type || '').trim(),
        question_number: row?.question_number ?? row?.sl_no,
      };
    })
    .filter((row) => row.question)
    .filter((row) => !isHeadingLikeLine(row.question))
    .filter((row) => looksLikeQuestionPrompt(row.question) || row.options.length >= 2 || /_{2,}/.test(row.question));
}

function parseQuestionBlock(chunk, currentSection) {
  const normalized = String(chunk || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const body = normalized.replace(/^(?:q(?:uestion)?\s*)?\d+[\).:-]\s*/i, '').trim();
  const optionMatches = Array.from(
    body.matchAll(/([A-D])\)\s*([^]+?)(?=(?:\s+[A-D]\)\s*)|(?:\s+(?:answer|correct\s*answer)\s*[:\-])|$)/gi),
  );
  const answerMatch = body.match(/(?:answer|correct\s*answer)\s*[:\-]\s*([^]+)$/i);
  const questionText = optionMatches.length > 0 ? body.slice(0, optionMatches[0].index).trim() : body;
  const options = optionMatches.map((m) => `${m[1].toUpperCase()}) ${String(m[2] || '').trim()}`).filter(Boolean);
  const answer = answerMatch ? String(answerMatch[1] || '').trim() : '';
  const question = questionText.replace(/\s*(?:answer|correct\s*answer)\s*[:\-]\s*[^]+$/i, '').trim();
  if (!question || isHeadingLikeLine(question)) return null;
  if (!looksLikeQuestionPrompt(question) && options.length < 2 && !/_{2,}/.test(question)) return null;
  const inferred = inferTypeAndSection(question, options);
  return {
    question,
    options,
    answer,
    section: currentSection || inferred.section,
    type: inferred.type,
  };
}

function extractQuestionsFromText(value, defaultSection = '') {
  const text = String(value || '').trim();
  if (!text) return [];

  const blocks = text
    .split(/(?=(?:^|\n|\s)(?:q(?:uestion)?\s*)?\d+[\).:-]\s*)/gi)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => /^(?:q(?:uestion)?\s*)?\d+[\).:-]\s*/i.test(chunk));

  return blocks
    .map((chunk) => parseQuestionBlock(chunk, defaultSection))
    .filter(Boolean);
}

/** Walk PDF lines; switch section on headings; parse numbered questions per block. */
function extractQuestionsBySectionHeaders(pdfText) {
  const lines = String(pdfText || '').split(/\r?\n/);
  let currentSection = '';
  let chunk = '';
  const out = [];

  const flush = () => {
    if (!chunk.trim()) return;
    const parsed = parseQuestionBlock(chunk, currentSection);
    if (parsed) out.push(parsed);
    chunk = '';
  };

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;
    if (/^answer\s*key\b/i.test(line) || /^bloom/i.test(line)) {
      flush();
      break;
    }
    const header = detectSectionHeaderLine(line);
    if (header) {
      flush();
      currentSection = header;
      continue;
    }
    if (/^(?:q(?:uestion)?\s*)?\d+[\).:-]\s*/i.test(line)) {
      flush();
      chunk = line;
      continue;
    }
    if (/^[A-D]\)\s+/i.test(line) && chunk) {
      chunk += ` ${line}`;
      continue;
    }
    if (chunk) chunk += ` ${line}`;
  }
  flush();
  return out;
}

/**
 * @param {string} pdfText
 * @param {number} [maxQuestions]
 * @returns {Array<Record<string, unknown>>}
 */
export function extractWorksheetItemsFromPdfText(pdfText, maxQuestions = 80) {
  const bySection = extractQuestionsBySectionHeaders(pdfText);
  const flat = extractQuestionsFromText(pdfText);
  const merged = [...bySection];
  const seen = new Set(merged.map((q) => String(q.question || '').toLowerCase()));
  for (const q of flat) {
    const key = String(q.question || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(q);
  }
  return sanitizeWorksheetQuestions(merged)
    .slice(0, maxQuestions)
    .map((q, i) => ({
      ...q,
      question_number: q.question_number ?? i + 1,
      _fromPdf: true,
    }));
}

export function buildDeterministicQuestionSetFromText(pdfText, maxQuestions = 15) {
  const questions = sanitizeWorksheetQuestions(extractWorksheetItemsFromPdfText(pdfText, maxQuestions));
  return {
    type: 'Worksheet',
    questions,
  };
}

export function normalizeWorksheetQuestionKey(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function toQuestionRows(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (typeof entry === 'string') return { question: entry.trim() };
      if (entry && typeof entry === 'object') return { ...entry };
      return null;
    })
    .filter(Boolean);
}

function groupQuestionsIntoSections(questions = []) {
  const cleaned = sanitizeWorksheetQuestions(questions);
  const map = new Map();
  for (const q of cleaned) {
    const sectionName =
      String(q.section || '').trim() ||
      inferTypeAndSection(q.question, q.options).section ||
      WORKSHEET_CANONICAL_SECTIONS[2];
    if (!map.has(sectionName)) map.set(sectionName, []);
    map.get(sectionName).push({
      ...q,
      question_number: q.question_number ?? q.sl_no,
    });
  }
  const sections = [];
  for (const label of WORKSHEET_CANONICAL_SECTIONS) {
    if (!map.has(label)) continue;
    const qs = map.get(label);
    qs.sort((a, b) => Number(a.question_number || 0) - Number(b.question_number || 0));
    sections.push({ sectionName: label, questions: qs, count: qs.length });
    map.delete(label);
  }
  for (const [sectionName, qs] of map.entries()) {
    qs.sort((a, b) => Number(a.question_number || 0) - Number(b.question_number || 0));
    sections.push({ sectionName, questions: qs, count: qs.length });
  }
  return sections;
}

function mergeWorksheetSectionLists(base = [], extra = []) {
  const loose = [];
  for (const sec of [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])]) {
    const name = String(sec?.sectionName || sec?.name || '').trim();
    for (const q of toQuestionRows(sec?.questions || [])) {
      loose.push({ ...q, section: q.section || name });
    }
  }
  return groupQuestionsIntoSections(loose);
}

function normalizeWorksheetGroupKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function isGenericWorksheetGroupKey(key) {
  const k = String(key || '').trim();
  if (!k) return true;
  return /^(worksheet|mcqs?|question\s*bank|practice\s*(?:sheet|paper)?|untitled|general\s*topic?)(\s*\d*)?$/i.test(k);
}

function isFullWorksheetExtractItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (Array.isArray(item.sections) && item.sections.length > 0) return true;
  const hasQuestion = String(item.question || '').trim();
  const hasBody = Boolean(
    String(item.instructions || '').trim() ||
      (Array.isArray(item.learning_objectives) && item.learning_objectives.length) ||
      String(item.answer_key || item.answerKey || '').trim() ||
      String(item.bloom_level || '').trim(),
  );
  return hasBody && !hasQuestion;
}

function worksheetExtractGroupKey(item) {
  if (!item || typeof item !== 'object') return '';
  const title = String(item.title || item.worksheet_title || item.name || '').trim();
  const titleKey = normalizeWorksheetGroupKey(title);
  if (titleKey && !isGenericWorksheetGroupKey(titleKey)) return titleKey;
  const setNum = item.worksheet_number ?? item.set_number ?? item.paper_number;
  if (setNum != null && String(setNum).trim() !== '') return `set:${setNum}`;
  const sl = item.sl_no;
  if (sl != null && String(sl).trim() !== '' && !String(item.question || '').trim()) {
    return `sl:${sl}`;
  }
  return '';
}

function countWorksheetBoundariesInText(pdfText) {
  const lines = String(pdfText || '').split(/\r?\n/);
  const keys = new Set();
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const m = line.match(
      /^(?:worksheet|ws|practice\s*(?:sheet|paper)|question\s*paper|set|mcq\s*set)\s*[#.:)\-–]*\s*(\d+)\b/i,
    );
    if (m) keys.add(`ws:${m[1]}`);
  }
  return keys.size;
}

/** True when PDF is one structured worksheet (sections / instructions), not a 50-row question bank. */
function pdfLooksLikeSingleStructuredWorksheet(pdfText) {
  const text = String(pdfText || '');
  if (!text.trim()) return false;
  if (countWorksheetBoundariesInText(text) > 1) return false;
  const sectionHeaders = (text.match(/^section\s*[a-e]\b/gim) || []).length;
  if (sectionHeaders >= 2) return true;
  if (sectionHeaders >= 1 && /instructions?\s+to\s+students|learning\s*objectives/i.test(text)) return true;
  if (/^worksheet\s*title\b/im.test(text) && sectionHeaders >= 1) return true;
  return false;
}

/**
 * Question-bank PDFs: many standalone MCQ rows, no worksheet shell — keep one saved row per item.
 */
function looksLikeQuestionBankExtract(items, pdfText) {
  if (!Array.isArray(items) || items.length < 2) return false;
  if (items.some(isFullWorksheetExtractItem)) return false;

  const questionRows = items.filter((i) => String(i?.question || '').trim());
  if (questionRows.length < 2 || questionRows.length !== items.length) return false;

  const namedGroups = new Set(
    items.map((i) => worksheetExtractGroupKey(i)).filter((k) => k && !isGenericWorksheetGroupKey(k)),
  );
  if (namedGroups.size > 1) return false;

  if (pdfLooksLikeSingleStructuredWorksheet(pdfText)) return false;

  const withCanonicalSection = questionRows.filter((q) =>
    WORKSHEET_CANONICAL_SECTIONS.some((label) =>
      String(q.section || '')
        .toLowerCase()
        .includes(label.split(':')[0].toLowerCase()),
    ),
  ).length;
  if (withCanonicalSection >= Math.min(4, questionRows.length)) return false;

  return true;
}

function groupWorksheetExtractItems(items, pdfText = '') {
  if (!Array.isArray(items) || !items.length) return [[]];

  const byKey = new Map();
  const loose = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const key = worksheetExtractGroupKey(item);
    if (isFullWorksheetExtractItem(item) && key) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(item);
    } else {
      loose.push(item);
    }
  }

  if (byKey.size > 1) {
    const groups = [...byKey.values()];
    if (loose.length) groups.push(loose);
    return groups;
  }

  if (byKey.size === 1 && !loose.length) {
    return [[...byKey.values()].flat()];
  }

  const pool = loose.length ? loose : items;

  if (looksLikeQuestionBankExtract(pool, pdfText)) {
    return pool.map((item) => [item]);
  }

  const looseKeys = new Set(
    pool.map((i) => worksheetExtractGroupKey(i)).filter((k) => k && !isGenericWorksheetGroupKey(k)),
  );
  if (looseKeys.size > 1) {
    const groups = new Map();
    for (const item of pool) {
      const key = worksheetExtractGroupKey(item) || '__ungrouped__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return [...groups.values()];
  }

  return [pool];
}

/** Merge one group of extract rows into a single worksheet object (sections A–E). */
function mergeWorksheetGroupToOne(group, params = {}) {
  const defaultTitle = String(params.topic || params.subtopic || 'Worksheet').trim() || 'Worksheet';
  const meta = { title: defaultTitle, worksheet_title: defaultTitle };
  const looseQuestions = [];
  let sectionBlocks = [];

  const applyMeta = (item) => {
    if (!item || typeof item !== 'object') return;
    const t = String(item.title || item.worksheet_title || item.name || '').trim();
    if (t) {
      if (meta.title === defaultTitle || !String(meta.title || '').trim()) {
        meta.title = t;
        meta.worksheet_title = t;
      }
    }
    for (const key of ['instructions', 'answer_key', 'bloom_level', 'difficulty_tag']) {
      const alt = key === 'answer_key' ? item.answerKey : undefined;
      const v = String(item[key] || alt || '').trim();
      if (v && !String(meta[key] || '').trim()) meta[key] = v;
    }
    const lo = []
      .concat(Array.isArray(item.learning_objectives) ? item.learning_objectives : [])
      .concat(Array.isArray(item.objectives) ? item.objectives : [])
      .concat(Array.isArray(item.learningObjectives) ? item.learningObjectives : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    if (lo.length) {
      const prev = Array.isArray(meta.learning_objectives) ? meta.learning_objectives : [];
      const seen = new Set(prev.map((x) => String(x).toLowerCase()));
      meta.learning_objectives = [
        ...prev,
        ...lo.filter((x) => {
          const k = x.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }),
      ];
    }
  };

  for (const item of group) {
    if (!item || typeof item !== 'object') continue;
    applyMeta(item);

    if (String(item.question || '').trim()) {
      looseQuestions.push({
        question: item.question,
        options: item.options,
        answer: item.answer,
        question_number: item.question_number ?? item.sl_no,
        section: item.section || item.sectionName,
        type: item.type,
        marks: item.marks,
        explanation: item.explanation,
        bloom_level: item.bloom_level,
      });
    }

    if (Array.isArray(item.sections) && item.sections.length) {
      sectionBlocks = mergeWorksheetSectionLists(sectionBlocks, item.sections);
    }

    for (const pool of [
      item.questions,
      item.mcqs,
      item.multipleChoiceQuestions,
      item.shortQuestions,
      item.longQuestions,
      item.fillInTheBlanks,
      item.exerciseQuestions,
      item.exercises,
      item.items,
    ]) {
      looseQuestions.push(...toQuestionRows(pool));
    }
  }

  if (looseQuestions.length) {
    sectionBlocks = mergeWorksheetSectionLists(sectionBlocks, groupQuestionsIntoSections(looseQuestions));
  }

  const out = {
    ...meta,
    sections: sectionBlocks,
    _fromPdf: true,
  };

  if (
    group.length === 1 &&
    String(group[0]?.question || '').trim() &&
    !String(out.instructions || '').trim() &&
    sectionBlocks.reduce((n, s) => n + (s.questions?.length || 0), 0) <= 1
  ) {
    const q = group[0];
    const num = q.question_number ?? q.sl_no;
    const shortQ = String(q.question || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 72);
    const label = String(q.title || q.worksheet_title || '').trim();
    if (label && !isGenericWorksheetGroupKey(normalizeWorksheetGroupKey(label))) {
      out.title = label;
      out.worksheet_title = label;
    } else {
      out.title = num != null ? `Question ${num}` : shortQ ? shortQ : out.title;
      out.worksheet_title = out.title;
    }
  }

  return out;
}

/**
 * Group PDF extract rows, then merge each group into one worksheet.
 * - One structured worksheet in the PDF → 1 saved record (all questions in sections A–E).
 * - Question bank (many standalone MCQs) → 1 saved record per question.
 * - Multiple worksheets (distinct titles / Worksheet 1, 2, …) → 1 record per worksheet.
 */
export function consolidateWorksheetExtractItems(items, params = {}) {
  if (!Array.isArray(items) || !items.length) return items;

  const pdfText = String(params.rawPdfText || params.pdfText || '').trim();
  const groups = groupWorksheetExtractItems(items, pdfText);

  return groups.map((group) => mergeWorksheetGroupToOne(group, params));
}
