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

/** Worksheet & MCQ 10-section template: PDF "Section 4" = Section A, etc. */
export const WORKSHEET_TEMPLATE_SECTION_NUM_TO_CANONICAL = {
  4: WORKSHEET_CANONICAL_SECTIONS[0],
  5: WORKSHEET_CANONICAL_SECTIONS[1],
  6: WORKSHEET_CANONICAL_SECTIONS[2],
  7: WORKSHEET_CANONICAL_SECTIONS[3],
  8: WORKSHEET_CANONICAL_SECTIONS[4],
};

const SECTION_HEADER_DETECTORS = [
  { label: WORKSHEET_CANONICAL_SECTIONS[0], re: /^section\s*a\b|^a[\).:\s-]+.*(mcq|multiple\s*choice|objective)/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[0], re: /^multiple\s*choice\s*questions?/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[0], re: /^objective\s*type\s*questions?/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[0], re: /^part\s*[-\s]*a\b.*(mcq|choice|objective)/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[1], re: /^section\s*b\b|^b[\).:\s-]+.*(fill|blank|fib)/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[1], re: /^fill\s*in\s*the\s*blanks?/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[1], re: /^part\s*[-\s]*b\b.*(fill|blank)/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[2], re: /^section\s*c\b|^c[\).:\s-]+.*(very\s*short|vsa)/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[2], re: /^very\s*short\s*answer/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[2], re: /^part\s*[-\s]*c\b.*(very\s*short|vsa)/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[3], re: /^section\s*d\b|^d[\).:\s-]+.*short\s*answer/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[3], re: /^short\s*answer\s*questions?/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[3], re: /^part\s*[-\s]*d\b.*short\s*answer/i },
  {
    label: WORKSHEET_CANONICAL_SECTIONS[4],
    re: /^section\s*[ef]\b|^[ef][\).:\s-]+.*(competency|application|real)/i,
  },
  { label: WORKSHEET_CANONICAL_SECTIONS[4], re: /competency|real[\s-]*life\s*application/i },
  { label: WORKSHEET_CANONICAL_SECTIONS[4], re: /^part\s*[-\s]*[ef]\b.*(competency|application|real)/i },
];

/** Strip markdown/numbering prefixes so "4. Section A: MCQs" matches section detectors. */
function stripWorksheetLineDecorations(line) {
  let t = String(line || '').trim();
  if (!t) return '';
  t = t.replace(/^#{1,4}\s+/, '');
  t = t.replace(/^\*\*(.+)\*\*$/, '$1').trim();
  t = t.replace(/^\.\s+/, '');
  t = t.replace(/^\d{1,2}[\.\):\-]\s+/, '');
  return t.trim();
}

const QUESTION_START_RE =
  /^(?:q(?:uestion)?\.?\s*)?(\d{1,3})[\).:\-]\s+|^\((\d{1,3})\)\s+|^\d{1,3}[\).:\-]\s+|^\d{1,3}\s+(?=[A-Za-z"(])/i;

const OPTION_LINE_RE = /^(?:\([a-d]\)|[a-d][\).])\s+/i;

const INLINE_OPTION_RE = /\([a-d]\)\s*[^()]+/gi;

const PROMPT_START_RE =
  /^(?:q(?:uestion)?\.?\s*)?\d{1,3}[\).:\-]\s+|(?:what|which|why|how|is|are|was|were|name|write|explain|define|list|give|find|calculate|solve|describe|state|complete|fill|identify|choose|select|draw|design|create|prepare|compare|arrange|convert|express|show|represent|read|tick|circle|match)\b/i;

/** Unnumbered question line (common in Section 4–8 of numbered worksheet PDFs). */
function looksLikeStandalonePromptLine(line) {
  const t = String(line || '').trim();
  if (!t || t.length < 6) return false;
  if (OPTION_LINE_RE.test(t)) return false;
  if (isNumberedTemplateSectionLine(t)) return false;
  if (detectSectionHeaderLine(stripWorksheetLineDecorations(t))) return false;
  if (/^answer\s*key\b/i.test(t) || /^bloom/i.test(t)) return false;
  if (/^generation\s+\d+/i.test(t)) return false;
  if (/^worksheet\s*&\s*mcq/i.test(t)) return false;
  if (QUESTION_START_RE.test(t)) return true;
  if (/\?/.test(t)) return true;
  if (/_{2,}/.test(t)) return true;
  if (PROMPT_START_RE.test(t)) return true;
  if (/^(?:give|identify|name|list|state|define|explain|write|describe)\b.+\.\s*$/i.test(t)) return true;
  if (/^(?:identify|name|give)\b.+:\s*.+\.\s*$/i.test(t)) return true;
  return false;
}

function isNumberedTemplateSectionLine(line) {
  const t = stripWorksheetLineDecorations(line);
  return /^section\s+\d{1,2}\b/i.test(t) || /^\d{1,2}[\.\):\-]\s+section\s+\d{1,2}\b/i.test(t);
}

function isWorksheetBreakLine(line) {
  const t = String(line || '').trim();
  if (!t) return true;
  if (/^answer\s*key\b/i.test(t) || /^bloom/i.test(t)) return true;
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(t)) return true;
  if (/^\d{1,2}[\.\):\-]\s+section\s+[a-f]\s*:/i.test(t)) return true;
  if (/^\d{1,2}[\.\):\-]\s+section\s+\d{1,2}\b/i.test(t)) return true;
  if (isNumberedTemplateSectionLine(t)) return true;
  if (detectSectionHeaderLine(stripWorksheetLineDecorations(t))) return true;
  if (/\bsection\s+[a-f]\s*:/i.test(t) && !/\?/.test(t) && !/_{2,}/.test(t)) return true;
  if (/\bsection\s+\d{1,2}\b/i.test(t) && !/\?/.test(t) && !/_{2,}/.test(t)) return true;
  return false;
}

function collectQuestionChunk(lines, startIdx) {
  let chunk = String(lines[startIdx] || '').trim();
  let i = startIdx + 1;
  while (i < lines.length) {
    const next = String(lines[i] || '').trim();
    if (!next) {
      i += 1;
      continue;
    }
    if (isWorksheetBreakLine(next)) break;
    if (looksLikeStandalonePromptLine(next) && chunk.trim().length >= 8) break;
    if (QUESTION_START_RE.test(next) && !OPTION_LINE_RE.test(next) && chunk.includes('?')) break;
    if (QUESTION_START_RE.test(next) && !OPTION_LINE_RE.test(next) && /_{2,}/.test(chunk)) break;
    if (QUESTION_START_RE.test(next) && !OPTION_LINE_RE.test(next) && (chunk.match(INLINE_OPTION_RE) || []).length >= 2) {
      break;
    }
    chunk += `\n${next}`;
    i += 1;
    if (/^(?:answer|correct\s*answer)\s*[:\-]/i.test(next)) break;
  }
  return { chunk, nextIndex: i };
}

/** Line scan: numbered and unnumbered ? / blank prompts with optional MCQ options. */
export function extractQuestionsByLineScan(pdfText) {
  const lines = String(pdfText || '').split(/\r?\n/).map((l) => String(l || '').trim());
  const out = [];
  let currentSection = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i += 1;
      continue;
    }
    if (/^answer\s*key\b/i.test(line) || /^bloom/i.test(line)) break;

    const header = detectSectionHeaderLine(stripWorksheetLineDecorations(line));
    if (header) {
      currentSection = header;
      i += 1;
      continue;
    }
    if (/^\d{1,2}[\.\):\-]\s+section\s+[a-f]\s*:/i.test(line) || /^\d{1,2}[\.\):\-]\s+section\s+\d{1,2}\b/i.test(line)) {
      const forced = detectSectionHeaderLine(stripWorksheetLineDecorations(line));
      if (forced) {
        currentSection = forced;
        i += 1;
        continue;
      }
    }
    if (isNumberedTemplateSectionLine(line)) {
      const forced = detectSectionHeaderLine(stripWorksheetLineDecorations(line));
      if (forced) {
        currentSection = forced;
        i += 1;
        continue;
      }
    }

    const numbered = QUESTION_START_RE.test(line);
    const promptLike = /\?/.test(line) || /_{2,}/.test(line);
    const optionLine = OPTION_LINE_RE.test(line);

    if (numbered || (promptLike && !optionLine && line.length >= 8)) {
      const { chunk, nextIndex } = collectQuestionChunk(lines, i);
      const parsed = parseQuestionBlock(chunk, currentSection);
      if (parsed) out.push(parsed);
      i = Math.max(nextIndex, i + 1);
      continue;
    }

    i += 1;
  }
  return out;
}

export const isHeadingLikeLine = (text) => {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/\b(chapter|topic|lesson|unit|syllabus|subtopic|worksheet\s*title)\b/i.test(t) && !/[?]/.test(t) && !/_{2,}/.test(t)) {
    return true;
  }
  if (/^section\s+[a-e]\s*:/i.test(t)) return true;
  if (/^(?:learning\s+objectives|instructions|answer\s*key|bloom)/i.test(t)) return true;
  return false;
};

/** PDF layout chrome — titles, page footers, generator watermarks — not real questions. */
export function isWorksheetPdfChrome(text) {
  const q = String(text || '').replace(/\s+/g, ' ').trim();
  if (!q) return true;
  if (isAnswerKeyLikeQuestion(q)) return true;
  if (/^---\s*pdf\s+answer\s+key\s*---$/i.test(q)) return true;
  if (/worksheet\s*&\s*mcq/i.test(q)) return true;
  if (/nep[\s-]*ncf/i.test(q)) return true;
  if (/\bpage\s*\d+\b/i.test(q) && !/\?/.test(q) && !/_{2,}/.test(q)) return true;
  if ((q.match(/\|/g) || []).length >= 2) return true;
  if (/mathematics\s*-\s*chapter/i.test(q) && !/\?/.test(q)) return true;
  if (/chapter\s*\d+\s*:/i.test(q) && !/\?/.test(q) && !/_{2,}/.test(q)) return true;
  if (/\bsubtopic\s*$/i.test(q)) return true;
  if (/varieties!\s*(worksheet|\|)/i.test(q)) return true;
  if (/^[\d.]+\s+[A-Z][^.?!]{0,80}!\s*(?:\||worksheet)/i.test(q)) return true;
  if (
    /!/.test(q) &&
    !/\?/.test(q) &&
    !/_{2,}/.test(q) &&
    !/^\s*(write|find|calculate|how|what|which|arrange|compare|solve|express|convert)\b/i.test(q) &&
    q.length < 120 &&
    !/\d{2,}/.test(q)
  ) {
    return true;
  }
  return false;
}

/** Strip merged section headers / PDF footer tails from a question string. */
export function cleanWorksheetQuestionText(text) {
  let q = String(text || '').replace(/\s+/g, ' ').trim();
  if (!q) return '';
  q = q.replace(/\s*--\s*\d+\s+of\s+\d+\s*--/gi, ' ').trim();
  q = q.replace(/^(?:q(?:uestion)?\.?\s*)?\d{1,3}[\).:\-]\s+/i, '').trim();
  q = q.replace(/\s+section\s+[a-f]\s*:\s*.+$/i, '').trim();
  q = q.replace(/\s+\d{1,2}[\.\):\-]\s+section\s+[a-f]\s*:\s*.+$/i, '').trim();
  q = q.replace(/(?:\s+\*{0,2}Section\s+\d{1,2}\*{0,2})+.*$/i, '').trim();
  q = q.replace(/(?:\s+Section\s+\d{1,2}\b)+.*$/i, '').trim();
  if (/\.\s+\d{1,2}[\.\):\-]\s+/i.test(q)) {
    q = q.replace(/\.\s+\d{1,2}[\.\):\-]\s+.+$/i, '.').trim();
  }
  q = q.replace(/\s*\|\s*worksheet\s*&\s*mcq[^|?]*/gi, '').trim();
  q = q.replace(/\s*\|\s*nep[\s-]*ncf[^|?]*/gi, '').trim();
  q = q.replace(/\s*\|\s*page\s*\d+\s*$/i, '').trim();
  q = q.replace(/\s*\|\s*[^|?]+$/i, '').trim();
  return q;
};

export const looksLikeQuestionPrompt = (text) => {
  const t = cleanWorksheetQuestionText(text);
  if (!t || isHeadingLikeLine(t) || isWorksheetPdfChrome(t)) return false;
  if (
    /(?:explained in class|core concept from|evidence about|using evidence about|a brief definition using)\b/i.test(
      t,
    ) &&
    !/[?]/.test(t) &&
    !/_{2,}/.test(t)
  ) {
    return false;
  }
  if (/[?]|_{2,}/.test(t)) return true;
  if (
    /^\s*(what|which|why|how|define|choose|fill|select|state|identify|explain|describe|list|write|convert|find|calculate|solve|express|match|arrange|compare|name|complete|circle|tick|read|show|represent|form|make|give|add|subtract|multiply|divide|place|round|estimate|expand|simplify|design|create|prepare|draw|construct)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\d[\d,]*/.test(t) && /\b(how many|how much|total|voted|registered|photos|masks|numerals|ascending|descending|greater|less|difference|sum|product)\b/i.test(t)) {
    return true;
  }
  const words = t.split(/\s+/).filter(Boolean).length;
  return (
    words >= 6 &&
    words <= 120 &&
    /\d/.test(t) &&
    !/^(section|answer\s*key|bloom|instructions|learning\s+objectives)\b/i.test(t)
  );
};

function detectNumberedTemplateSectionLine(line) {
  const t = stripWorksheetLineDecorations(line);
  if (!t) return '';
  const m =
    t.match(/^section\s+(\d{1,2})\s*(?:[:\-—]\s*(.*))?$/i) ||
    t.match(/^\d{1,2}[\.\):\-]\s+section\s+(\d{1,2})\s*(?:[:\-—]\s*(.*))?$/i);
  if (!m) return '';
  const num = Number(m[1]);
  const rest = String(m[2] || '').toLowerCase();
  if (WORKSHEET_TEMPLATE_SECTION_NUM_TO_CANONICAL[num]) {
    return WORKSHEET_TEMPLATE_SECTION_NUM_TO_CANONICAL[num];
  }
  if (num === 4 || /mcq|multiple\s*choice|objective/i.test(rest)) return WORKSHEET_CANONICAL_SECTIONS[0];
  if (num === 5 || /fill|blank|fib/i.test(rest)) return WORKSHEET_CANONICAL_SECTIONS[1];
  if (num === 6 || /very\s*short|vsa/i.test(rest)) return WORKSHEET_CANONICAL_SECTIONS[2];
  if (num === 7 || (/short\s*answer/i.test(rest) && !/very/i.test(rest))) return WORKSHEET_CANONICAL_SECTIONS[3];
  if (num === 8 || /competency|real[\s-]*life|application/i.test(rest)) return WORKSHEET_CANONICAL_SECTIONS[4];
  return '';
}

/**
 * Parse worksheet shell fields from numbered template sections 1–3.
 * @param {string} pdfText
 */
/**
 * Body text under numbered template sections 5–8 (shown when no question prompts exist).
 * @param {string} pdfText
 */
export function extractNumberedTemplateSectionBodies(pdfText) {
  const lines = String(pdfText || '').split(/\r?\n/);
  const out = new Map();
  let sectionNum = 0;
  let buffer = [];

  const flush = () => {
    const text = buffer
      .map((l) => String(l || '').trim())
      .filter(Boolean)
      .join('\n')
      .trim();
    buffer = [];
    if (!text || sectionNum < 5 || sectionNum > 8) return;
    const canonical = WORKSHEET_TEMPLATE_SECTION_NUM_TO_CANONICAL[sectionNum];
    if (canonical) out.set(canonical, text);
  };

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;
    const m = stripWorksheetLineDecorations(line).match(/^section\s+(\d{1,2})\b/i);
    if (m) {
      flush();
      sectionNum = Number(m[1]);
      continue;
    }
    if (sectionNum >= 5 && sectionNum <= 8) buffer.push(line);
  }
  flush();
  return out;
}

/**
 * Answer lines from numbered template Section 9.
 * @param {string} pdfText
 */
export function extractNumberedSection9Answers(pdfText) {
  const lines = String(pdfText || '').split(/\r?\n/);
  const answers = [];
  let inSection9 = false;

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;
    const m = stripWorksheetLineDecorations(line).match(/^section\s+(\d{1,2})\b/i);
    if (m) {
      const num = Number(m[1]);
      if (num === 9) {
        inSection9 = true;
        continue;
      }
      if (inSection9) break;
      inSection9 = false;
      continue;
    }
    if (inSection9 && !/^answer\s*key\b/i.test(line)) {
      answers.push(line.replace(/^[-•*]\s*/, '').trim());
    }
  }
  return answers.filter(Boolean);
}

function attachNumberedSection9Answers(questions, pdfText) {
  const answers = extractNumberedSection9Answers(pdfText);
  if (!answers.length) return questions;
  const questionSections = new Set([
    WORKSHEET_CANONICAL_SECTIONS[0],
    WORKSHEET_CANONICAL_SECTIONS[1],
    WORKSHEET_CANONICAL_SECTIONS[2],
    WORKSHEET_CANONICAL_SECTIONS[3],
    WORKSHEET_CANONICAL_SECTIONS[4],
  ]);
  const rows = questions.map((q) => ({ ...q }));
  const targets = rows.filter((q) => questionSections.has(q.section) && !q._sectionBody);
  for (let i = 0; i < Math.min(answers.length, targets.length); i += 1) {
    const idx = rows.indexOf(targets[i]);
    if (idx >= 0 && !String(rows[idx].answer || '').trim()) {
      rows[idx].answer = answers[i];
    }
  }
  return rows;
}

function sectionBodyToQuestionRow(sectionName, body) {
  const text = String(body || '').trim();
  if (!text || text.length < 8) return null;
  return {
    question: text,
    options: [],
    answer: '',
    section: sectionName,
    type: 'SECTION_CONTENT',
    _sectionBody: true,
    _fromPdf: true,
  };
}

export function extractWorksheetShellFromNumberedPdfText(pdfText) {
  const lines = String(pdfText || '')
    .split(/\r?\n/)
    .map((l) => String(l || '').trim())
    .filter(Boolean);
  const out = { title: '', learning_objectives: [], instructions: '' };
  let metaSection = 0;
  let buffer = [];

  const flushMeta = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (!text || metaSection < 1 || metaSection > 3) return;
    if (metaSection === 1) {
      const first = text.split('\n').map((l) => l.trim()).filter(Boolean)[0] || text;
      out.title = first.replace(/^worksheet\s*(?:title)?\s*[:\-—]?\s*/i, '').trim() || first;
    } else if (metaSection === 2) {
      out.learning_objectives = text
        .split(/\n|(?<=[.!?])\s+/)
        .map((l) => l.replace(/^[-•*]\s*/, '').trim())
        .filter((l) => l.length >= 4 && !/^learning\s+objectives?/i.test(l));
    } else if (metaSection === 3) {
      out.instructions = text.replace(/^instructions?\s*(?:to\s+students?)?\s*[:\-—]?\s*/i, '').trim();
    }
  };

  for (const line of lines) {
    if (/^generation\s+\d+/i.test(line)) {
      flushMeta();
      metaSection = 0;
      const genTitle = line.replace(/^generation\s+\d+\s*[-–:]\s*/i, '').trim();
      if (genTitle && !out.title) out.title = genTitle;
      continue;
    }
    const numbered = stripWorksheetLineDecorations(line).match(/^section\s+(\d{1,2})\b/i);
    if (numbered) {
      const num = Number(numbered[1]);
      if (num >= 1 && num <= 3) {
        flushMeta();
        metaSection = num;
        continue;
      }
      flushMeta();
      metaSection = 0;
      if (num >= 4) break;
      continue;
    }
    if (metaSection >= 1 && metaSection <= 3) buffer.push(line);
  }
  flushMeta();
  return out;
}

function detectSectionHeaderLine(line) {
  const t = stripWorksheetLineDecorations(line);
  if (!t || t.length > 140) return '';
  const numbered = detectNumberedTemplateSectionLine(t);
  if (numbered) return numbered;
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

/** Answer-key blobs and multi-answer lines must not become worksheet questions. */
export function isAnswerKeyLikeQuestion(text) {
  const q = String(text || '').replace(/\s+/g, ' ').trim();
  if (!q) return true;
  if (/^answer\s*key\b/i.test(q)) return true;
  if (/^(?:answer|correct\s*answer)\s*[:\-]/i.test(q)) return true;
  if (/^q\d+[\).:\-]\s*[A-Da-d][);.]?\s*(?:;\s*\d+[\).:\-]\s*[A-Da-d])/i.test(q)) return true;
  const numberedShort = (q.match(/\d+[\).:\-]\s*[A-Da-d][);.]?/g) || []).length;
  if (numberedShort >= 3 && !/\?/.test(q) && !/_{2,}/.test(q) && q.length < 500) return true;
  if (/^(?:\d+[\).:\-]\s*[A-Za-z0-9][^?]{0,40}\s*;?\s*){3,}/.test(q) && !/\?/.test(q)) return true;
  return false;
}

function sanitizeWorksheetQuestionOptions(options = []) {
  return (Array.isArray(options) ? options : [])
    .map((opt) =>
      String(opt || '')
        .replace(/\s+section\s+[a-f]\s*:.+$/i, '')
        .replace(/\s+\d{1,2}[\.\):\-]\s+section\s+[a-f]\s*:.+$/i, '')
        .replace(/(?:\s+Section\s+\d{1,2}\b)+.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .filter((opt) => opt.length <= 220)
    .filter((opt) => !isAnswerKeyLikeQuestion(opt))
    .filter((opt) => !/^(?:answer|correct\s*answer)\s*[:\-]/i.test(opt))
    .filter((opt) => !/\bsection\s+[a-f]\s*:/i.test(opt))
    .slice(0, 6);
}

function sanitizeWorksheetQuestions(questions = []) {
  const seenFull = new Set();
  return questions
    .map((row) => {
      const question = cleanWorksheetQuestionText(row?.question);
      const inferred = inferTypeAndSection(question, row?.options);
      const options = sanitizeWorksheetQuestionOptions(row?.options);
      return {
        question,
        options,
        answer: String(row?.answer || '').replace(/\s+/g, ' ').trim(),
        section: String(row?.section || inferred.section || '').trim(),
        type: String(row?.type || inferred.type || '').trim(),
        question_number: row?.question_number ?? row?.sl_no,
        marks: row?.marks,
        explanation: row?.explanation,
        bloom_level: row?.bloom_level,
      };
    })
    .filter((row) => row.question)
    .filter((row) => !isHeadingLikeLine(row.question))
    .filter((row) => !isWorksheetPdfChrome(row.question))
    .filter((row) => !isAnswerKeyLikeQuestion(row.question))
    .filter(
      (row) =>
        row._sectionBody ||
        looksLikeQuestionPrompt(row.question) ||
        row.options.length >= 2 ||
        /_{2,}/.test(row.question),
    )
    .filter((row) => {
      const fullKey = worksheetQuestionDedupeKey(row);
      if (!fullKey) return false;
      if (seenFull.has(fullKey)) return false;
      seenFull.add(fullKey);
      return true;
    });
}

function parseQuestionBlock(chunk, currentSection) {
  const normalized = String(chunk || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const body = normalized
    .replace(/^(?:q(?:uestion)?\.?\s*)?\d+[\).:\-]\s*/i, '')
    .replace(/^\(\d{1,3}\)\s+/, '')
    .trim();
  const optionMatches = Array.from(
    body.matchAll(
      /(?:\(([a-d])\)|(?:^|\s)([A-D])\))\s*([^]+?)(?=(?:\s*\([a-d]\)\s*)|(?:\s+[A-D]\)\s*)|(?:\s+(?:answer|correct\s*answer)\s*[:\-])|$)/gi,
    ),
  );
  if (/^answer\s*key\b/i.test(body)) return null;
  const answerMatch = body.match(/(?:answer|correct\s*answer)\s*[:\-]\s*([^]+)$/i);
  const questionText = optionMatches.length > 0 ? body.slice(0, optionMatches[0].index).trim() : body;
  if (isAnswerKeyLikeQuestion(questionText)) return null;
  const options = optionMatches
    .map((m) => {
      const letter = String(m[1] || m[2] || 'A').toUpperCase();
      return `${letter}) ${String(m[3] || '').trim()}`;
    })
    .filter(Boolean);
  const answer = answerMatch ? String(answerMatch[1] || '').trim() : '';
  const question = cleanWorksheetQuestionText(
    questionText.replace(/\s*(?:answer|correct\s*answer)\s*[:\-]\s*[^]+$/i, '').trim(),
  );
  if (!question || isHeadingLikeLine(question) || isWorksheetPdfChrome(question)) return null;
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

export function extractQuestionsFromText(value, defaultSection = '') {
  const text = String(value || '').trim();
  if (!text) return [];

  const blocks = text
    .split(
      /(?=(?:^|\n)(?:(?:q(?:uestion)?\.?\s*)?\d{1,3}[\).:\-]\s+|\(\d{1,3}\)\s+|\d{1,3}\s+(?=[A-Za-z"(])))/gi,
    )
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => QUESTION_START_RE.test(chunk));

  return blocks
    .map((chunk) => parseQuestionBlock(chunk, defaultSection))
    .filter(Boolean);
}

/** Walk PDF lines; switch section on headings; parse numbered questions per block. */
export function extractQuestionsBySectionHeaders(pdfText) {
  const lines = String(pdfText || '').split(/\r?\n/);
  let currentSection = '';
  let metaSectionNum = 0;
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
    const stripped = stripWorksheetLineDecorations(line);
    const numberedMeta = stripped.match(/^section\s+(\d{1,2})\b/i);
    if (numberedMeta) {
      const num = Number(numberedMeta[1]);
      if (num >= 1 && num <= 3) {
        flush();
        metaSectionNum = num;
        currentSection = '';
        continue;
      }
      metaSectionNum = 0;
    }
    const header = detectSectionHeaderLine(stripped);
    if (header) {
      flush();
      currentSection = header;
      metaSectionNum = 0;
      continue;
    }
    if (/^\d{1,2}[\.\):\-]\s+section\s+[a-f]\s*:/i.test(line) || /^\d{1,2}[\.\):\-]\s+section\s+\d{1,2}\b/i.test(line)) {
      const forced = detectSectionHeaderLine(stripped);
      if (forced) {
        flush();
        currentSection = forced;
        metaSectionNum = 0;
        continue;
      }
    }
    if (isNumberedTemplateSectionLine(line)) {
      const forced = detectSectionHeaderLine(stripped);
      if (forced) {
        flush();
        currentSection = forced;
        metaSectionNum = 0;
        continue;
      }
      if (numberedMeta && Number(numberedMeta[1]) <= 3) {
        flush();
        metaSectionNum = Number(numberedMeta[1]);
        currentSection = '';
        continue;
      }
    }
    if (metaSectionNum >= 1 && metaSectionNum <= 3) continue;
    if (
      (QUESTION_START_RE.test(line) || looksLikeStandalonePromptLine(line)) &&
      !detectSectionHeaderLine(stripWorksheetLineDecorations(line))
    ) {
      flush();
      chunk = line;
      continue;
    }
    if (OPTION_LINE_RE.test(line) && chunk) {
      chunk += ` ${line}`;
      continue;
    }
    if (chunk) {
      if (looksLikeStandalonePromptLine(line)) {
        flush();
        chunk = line;
      } else {
        chunk += ` ${line}`;
      }
      continue;
    }
  }
  flush();
  return out;
}

/**
 * @param {string} pdfText
 * @param {number} [maxQuestions]
 * @returns {Array<Record<string, unknown>>}
 */
/** PDF.js often emits one long line — insert breaks before sections and numbered questions. */
function insertWorksheetLineBreaks(text) {
  let t = String(text || '');
  if (!t.trim()) return t;
  const sectionTokens = new Map();
  let tokenIdx = 0;
  t = t.replace(/\bSection\s+\d{1,2}\b/gi, (match) => {
    const key = `__WSSEC${tokenIdx++}__`;
    sectionTokens.set(key, match);
    return key;
  });
  t = t.replace(/\s+(Section\s+[A-F]\s*:)/gi, '\n$1');
  t = t.replace(/\s+(Section\s+\d{1,2}\b)/gi, '\n$1');
  t = t.replace(/\s+(Part\s*[-\s]*[A-F]\b[^.?!]{0,40})/gi, '\n$1');
  t = t.replace(/\s+(Multiple\s*Choice\s*Questions?|Fill\s*in\s*the\s*Blanks?|Very\s*Short\s*Answer)/gi, '\n$1');
  t = t.replace(
    /(\?\s*)(?=(?:Is|Are|Was|Were|What|Which|Why|How|Write|Explain|Name|Give|Define|List|Find|Calculate|Describe|State|Complete|Fill|Identify|Choose|Select)\b)/gi,
    '$1\n',
  );
  t = t.replace(
    /(\.\s+)(?=(?:Is|Are|Was|Were|What|Which|Why|How|Write|Explain|Name|Give|Define|List|Find|Calculate|Describe|State|Complete|Fill|Identify|Choose|Select)\b)/gi,
    '$1\n',
  );
  t = t.replace(/(\?\s*)(?=\d{1,3}[\).:\-]\s+[A-Za-z"(])/g, '$1\n');
  t = t.replace(/(Answer:\s*\([a-d]\)[);.]?\s*)(?=\d{1,3}[\).:\-]\s+)/gi, '$1\n');
  t = t.replace(/(_{2,}\s*)(?=\d{1,3}[\).:\-]\s+[A-Za-z"(])/g, '$1\n');
  const promptWord =
    '(?:Which|What|How|Fill|The|Name|Write|Find|Choose|Select|State|Define|Explain|List|Complete|Identify|Who|Where|When|Why|Tick|Circle|Match|Arrange|Compare|Calculate|Solve|Convert|Express|Read|Show|Represent|Form|Make|Give|Add|Subtract)';
  t = t.replace(
    new RegExp(`(\\s)(?=(?:Q\\.?\\s*)?\\d{1,3}[\\).:\\-]\\s+${promptWord}\\b)`, 'gi'),
    '\n',
  );
  t = t.replace(
    new RegExp(`(?<!Section)(\\s)(?=\\d{1,3}\\s+${promptWord}\\b)`, 'gi'),
    '\n',
  );
  for (const [key, val] of sectionTokens) {
    t = t.split(key).join(val);
  }
  return t;
}

function pdfTextLooksDense(t) {
  const text = String(t || '');
  if (text.length < 2500) return false;
  const lines = text.split(/\r?\n/).filter((l) => String(l || '').trim());
  if (lines.length >= Math.max(40, Math.floor(text.length / 120))) return false;
  const avgLen = text.length / Math.max(lines.length, 1);
  return avgLen > 180;
}

/** Split inline section headers / Q-lines that PDF or markdown glue onto one line. */
function splitInlineWorksheetMarkers(text) {
  let t = String(text || '');
  t = t.replace(/([.?!]|_{2,})\s+(\d{1,2}[\.\):\-]\s+Section\s+[A-F]\s*:)/gi, '$1\n$2');
  t = t.replace(/([.?!]|_{2,})\s+(Section\s+[A-F]\s*:)/gi, '$1\n$2');
  t = t.replace(/([.?!]|_{2,})\s+(Section\s+\d{1,2}\b)/gi, '$1\n$2');
  t = t.replace(/([.?!]|_{2,})\s+(\d{1,2}[\.\):\-]\s+Section\s+\d{1,2}\b)/gi, '$1\n$2');
  t = t.replace(/([A-D]\)\s*[^\n(]{0,120}?)\s+(Section\s+[A-F]\s*:)/gi, '$1\n$2');
  t = t.replace(/([A-D]\)\s*[^\n(]{0,120}?)\s+(Section\s+\d{1,2}\b)/gi, '$1\n$2');
  t = t.replace(/([A-D]\)\s*[^\n(]{0,120}?)\s+(\d{1,2}[\.\):\-]\s+Section\s+[A-F]\s*:)/gi, '$1\n$2');
  t = t.replace(/([A-D]\)\s*[^\n(]{0,120}?)\s+(\d{1,2}[\.\):\-]\s+Section\s+\d{1,2}\b)/gi, '$1\n$2');
  t = t.replace(/(Section\s+[A-F]\s*:[^\n]{0,80})\s+(Q\d+\.)/gi, '$1\n$2');
  t = t.replace(/(Section\s+\d{1,2}\b[^\n]{0,80})\s+(Q\d+\.)/gi, '$1\n$2');
  t = t.replace(/(Section\s+[A-F]\s*:[^\n]{0,80})\s+(\d{1,3}[\.\):\-]\s+)/gi, '$1\n$2');
  t = t.replace(/(Section\s+\d{1,2}\b[^\n]{0,80})\s+(\d{1,3}[\.\):\-]\s+)/gi, '$1\n$2');
  t = t.replace(/^\s*\.\s+(Section\s+[A-F]\s*:)/gim, '\n$1');
  t = t.replace(/^\s*\.\s+(Section\s+\d{1,2}\b)/gim, '\n$1');
  return t;
}

/** Flatten stored markdown (### sections, **Q1.**) into plain text for regex extractors. */
export function worksheetTextForPatternExtract(sourceText) {
  let t = String(sourceText || '');
  if (!t.trim()) return '';
  t = t.replace(/\r\n/g, '\n');
  t = t.replace(/^\s*#{1,4}\s+/gm, '');
  t = t.replace(/^\s*\d{1,2}\.\s+(Section\s+[A-F][^\n]*)/gim, '\n$1\n');
  t = t.replace(/^\s*\d{1,2}\.\s+(Section\s+\d{1,2}[^\n]*)/gim, '\n$1\n');
  t = t.replace(/\*\*Q(\d+)\.\*\*/gi, '\n$1. ');
  t = t.replace(/(?:^|\n)\s*Q(\d+)\.\s*/gi, '\n$1. ');
  t = t.replace(/\*\*Answer:\*\*/gi, '\nAnswer: ');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  t = t.replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gim, '\n');
  t = splitInlineWorksheetMarkers(t);
  if (pdfTextLooksDense(t) || (/\bsection\s+\d{1,2}\b/i.test(t) && t.length >= 120)) {
    t = insertWorksheetLineBreaks(t);
  }
  return t;
}

export function extractWorksheetItemsFromPdfText(pdfText, maxQuestions = 500) {
  const plain = worksheetTextForPatternExtract(pdfText);
  const bySection = extractQuestionsBySectionHeaders(plain);
  const hasNumberedTemplate = /\bsection\s+[4-8]\b/i.test(plain);
  if (hasNumberedTemplate) {
    let rows = [...bySection];
    const bodies = extractNumberedTemplateSectionBodies(plain);
    for (const [sectionName, body] of bodies) {
      const hasQuestion = rows.some(
        (q) => q.section === sectionName && !q._sectionBody && String(q.question || '').trim(),
      );
      if (!hasQuestion) {
        const bodyRow = sectionBodyToQuestionRow(sectionName, body);
        if (bodyRow) rows.push(bodyRow);
      }
    }
    rows = attachNumberedSection9Answers(rows, plain);
    return sanitizeWorksheetQuestions(rows)
      .slice(0, maxQuestions)
      .map((q, i) => ({
        ...q,
        question_number: q.question_number ?? i + 1,
        _fromPdf: true,
      }));
  }
  const flat = extractQuestionsFromText(plain);
  const byLine = extractQuestionsByLineScan(plain);
  const merged = [...bySection];
  const seen = new Set(merged.map((q) => worksheetQuestionDedupeKey(q)).filter(Boolean));
  for (const q of [...flat, ...byLine]) {
    const key = worksheetQuestionDedupeKey(q);
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

/** Dedupe key: section + question stem (options/answer glitches must not block dedupe). */
export function worksheetQuestionDedupeKey(row) {
  const q = normalizeWorksheetQuestionKey(cleanWorksheetQuestionText(row?.question));
  if (!q) return '';
  const section = String(row?.section || '')
    .toLowerCase()
    .trim();
  return `${section}::${q}`;
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

function groupWorksheetExtractItems(items, pdfText = '', options = {}) {
  if (!Array.isArray(items) || !items.length) return [[]];

  if (options.forceSingleDocument) {
    return [items.filter((item) => item && typeof item === 'object')];
  }

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
  const pdfTextEarly = String(params.rawPdfText || params.pdfText || '').trim();
  const shell = pdfTextEarly ? extractWorksheetShellFromNumberedPdfText(pdfTextEarly) : {};
  const defaultTitle =
    String(params.generationTitle || shell.title || params.topic || params.subtopic || 'Worksheet').trim() ||
    'Worksheet';
  const meta = {
    title: defaultTitle,
    worksheet_title: defaultTitle,
    learning_objectives: shell.learning_objectives || [],
    instructions: shell.instructions || '',
  };
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

  const pdfText = String(params.rawPdfText || params.pdfText || '').trim();
  if (pdfText) {
    const maxQuestions = params.forceSingleDocument ? 500 : 120;
    const fromPdf = sanitizeWorksheetQuestions(extractWorksheetItemsFromPdfText(pdfText, maxQuestions));
    if (fromPdf.length) {
      out.sections = mergeWorksheetSectionLists(out.sections || [], groupQuestionsIntoSections(fromPdf));
      const flat = out.sections.flatMap((s) => s.questions || []);
      if (flat.length && !String(out.answer_key || '').trim()) {
        const letters = ['A', 'B', 'C', 'D', 'E'];
        const blocks = [];
        for (const [idx, sec] of (out.sections || []).entries()) {
          const qs = (sec.questions || []).filter((q) => String(q.answer || '').trim());
          if (!qs.length) continue;
          const name = String(sec.sectionName || '').trim();
          blocks.push(`${letters[idx] || '?'}. ${name}`);
          qs.forEach((q, qIdx) => {
            const num = q.question_number ?? q.sl_no ?? qIdx + 1;
            blocks.push(`  Q${num}. ${String(q.answer).trim()}`);
          });
          blocks.push('');
        }
        if (blocks.length) out.answer_key = blocks.join('\n').trim();
      }
    }
  }

  if (
    group.length === 1 &&
    String(group[0]?.question || '').trim() &&
    sectionBlocks.reduce((n, s) => n + (s.questions?.length || 0), 0) <= 1
  ) {
    const label = String(
      params.generationTitle || shell.title || group[0]?.title || group[0]?.worksheet_title || '',
    ).trim();
    if (label && !isGenericWorksheetGroupKey(normalizeWorksheetGroupKey(label))) {
      out.title = label;
      out.worksheet_title = label;
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
  const groups = groupWorksheetExtractItems(items, pdfText, {
    forceSingleDocument: Boolean(params.forceSingleDocument),
  });

  return groups.map((group) => mergeWorksheetGroupToOne(group, params));
}

/**
 * Split PDF text at worksheet/exam section headers for chunk-wise LLM extraction.
 * @param {string} pdfText
 * @returns {Array<{ sectionName: string; text: string }>}
 */
export function splitPdfTextByWorksheetSections(pdfText) {
  const text = String(pdfText || '').trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const chunks = [];
  let currentSection = 'Preamble';
  let buffer = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body.length > 120) {
      chunks.push({ sectionName: currentSection, text: body });
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) {
      if (buffer.length) buffer.push('');
      continue;
    }
    if (/^answer\s*key\b/i.test(line) || /^marking\s*scheme\b/i.test(line)) {
      buffer.push(line);
      flush();
      break;
    }
    const header = detectSectionHeaderLine(stripWorksheetLineDecorations(line));
    if (header) {
      flush();
      currentSection = header;
      buffer.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (chunks.length <= 1) {
    return [{ sectionName: 'Full document', text }];
  }
  return chunks;
}
