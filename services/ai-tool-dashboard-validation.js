/**
 * Strict content gate for Student / Teacher dashboards.
 * Stored AI Tool Data is shown only when every canonical section is filled
 * and content matches the selected tool format.
 */
import {
  getAiToolTemplate,
  getStorageKeysForHeading,
  matchCanonicalHeadingLine,
  getContentTypeDefault,
  getToolDisplayTitle,
  isValidAiToolSlug,
  getSectionFallbackRules,
} from '../config/aiToolTemplates.js';
import { toolSlugMatches } from './ai-tool-rotation-service.js';
import {
  validateToolSpecificStructuredContent,
  practiceQaHasAllRequiredSections,
  practiceQaValidationMessage,
  getPracticeQaMissingSections,
  normalizeStudyGuideStructuredContent,
  normalizeConceptBreakdownStructuredContent,
  normalizeChapterSummaryStructuredContent,
  normalizeKeyPointsStructuredContent,
  normalizeMyStudyDecksStructuredContent,
  normalizeFlashcardDeckStructuredContent,
  normalizePracticeQaStructuredContent,
  finalizeChapterSummaryStructuredContent,
  normalizeWorksheetStructuredContent,
  normalizeActivityStructuredContent,
  normalizeLessonPlannerStructuredContent,
  finalizeActivityStructuredContent,
  PRACTICE_QA_SECTION_LABELS,
  WORKSHEET_SECTION_LABELS,
} from './ai-content-engine-service.js';

const WORKSHEET_HEADING_SECTION = {
  section_a: WORKSHEET_SECTION_LABELS.A,
  section_b: WORKSHEET_SECTION_LABELS.B,
  section_c: WORKSHEET_SECTION_LABELS.C,
  section_d: WORKSHEET_SECTION_LABELS.D,
  section_e: WORKSHEET_SECTION_LABELS.E,
};

function rawWorksheetSectionHasQuestions(sections, label) {
  return rawPracticeQaSectionHasQuestions(sections, label);
}

function worksheetHeadingFilledInStructured(data, heading, markdown = '') {
  const src = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const normalized = normalizeWorksheetStructuredContent(src, markdown);
  const id = heading.id;

  if (id === 'worksheet_title') {
    return isMeaningfulScalar(normalized.title || normalized.worksheet_title);
  }
  if (id === 'learning_objectives') {
    return isMeaningfulArray(normalized.learning_objectives || src.learning_objectives);
  }
  if (id === 'instructions') {
    return isMeaningfulScalar(normalized.instructions || src.instructions);
  }
  if (id === 'answer_key') {
    return (
      isMeaningfulScalar(normalized.answer_key) ||
      (Array.isArray(normalized.questions) &&
        normalized.questions.some((q) => isMeaningfulScalar(q?.answer)))
    );
  }
  if (id === 'bloom_tag') {
    if (isMeaningfulScalar(normalized.bloom_level || normalized.difficulty_tag)) return true;
    const qs = Array.isArray(normalized.questions) ? normalized.questions : [];
    return qs.some(
      (q) => isMeaningfulScalar(q?.bloom_level) || isMeaningfulScalar(q?.difficulty_tag || q?.difficulty),
    );
  }

  const label = WORKSHEET_HEADING_SECTION[id];
  if (label) {
    if (rawWorksheetSectionHasQuestions(normalized.sections, label)) return true;
    if (rawWorksheetSectionHasQuestions(src.sections, label)) return true;
    if (id === 'section_a' && isMeaningfulArray(src.questions)) {
      return (Array.isArray(src.questions) ? src.questions : []).some((q) =>
        practiceQaRowHasQuestion(q),
      );
    }
    for (const key of heading.storageKeys || []) {
      if (isMeaningfulContent(src[key])) return true;
    }
    return false;
  }
  return false;
}

function worksheetHeadingFilledInMarkdown(markdown, heading) {
  const body = String(markdown || '');
  if (!body.trim()) return false;
  const id = heading.id;

  if (id === 'worksheet_title') {
    return /worksheet\s*title|^#\s+/i.test(body);
  }
  if (id === 'learning_objectives') return /learning\s+objectives/i.test(body);
  if (id === 'instructions') return /instructions\s+to\s+students/i.test(body);
  if (id === 'answer_key') return /answer\s+key/i.test(body);
  if (id === 'bloom_tag') {
    return /bloom|difficulty\s+tag/i.test(body);
  }

  const label = WORKSHEET_HEADING_SECTION[id];
  if (!label) return false;
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(esc, 'i').test(body)) return false;
  return /\*\*Q\d|^\d+\.\s+\S|\*\*Answer:/im.test(body);
}

/** Same rules as getMissingCanonicalSections (structured + markdown). */
function worksheetDashboardComplete(data, markdown = '') {
  return getMissingCanonicalSections('worksheet-mcq-generator', data, markdown).complete;
}

function chapterSummaryConnectionsFilled(s) {
  const c = s?.concept_connections;
  if (Array.isArray(c)) return isMeaningfulArray(c);
  return isMeaningfulScalar(c);
}

function chapterSummaryImportantConceptsFilled(s) {
  const concepts = Array.isArray(s?.important_concepts) ? s.important_concepts : [];
  return concepts.some((c) => {
    if (c && typeof c === 'object') {
      return isMeaningfulScalar(c.name) || isMeaningfulScalar(c.explanation);
    }
    return isMeaningfulScalar(c);
  });
}

function chapterSummaryHeadingFilledInStructured(data, heading) {
  const s = finalizeChapterSummaryStructuredContent(
    data && typeof data === 'object' && !Array.isArray(data) ? data : {},
    {},
  );
  const id = heading.id;
  if (id === 'chapter_summary_title') {
    return isMeaningfulScalar(s.chapter_summary_title || s.title);
  }
  if (id === 'chapter_overview') return isMeaningfulScalar(s.chapter_overview);
  if (id === 'learning_objectives') return isMeaningfulArray(s.learning_objectives);
  if (id === 'important_concepts') return chapterSummaryImportantConceptsFilled(s);
  if (id === 'definitions') return isMeaningfulArray(s.definitions);
  if (id === 'formulae') return Array.isArray(s.formulae) && s.formulae.length >= 3;
  if (id === 'concept_connections') return chapterSummaryConnectionsFilled(s);
  if (id === 'real_life') return isMeaningfulArray(s.real_life_applications);
  if (id === 'quick_revision') return isMeaningfulArray(s.quick_revision_notes);
  if (id === 'recall_questions') return isMeaningfulArray(s.practice_recall_questions);
  return false;
}

function chapterSummaryHeadingFilledInMarkdown(markdown, heading) {
  const body = String(markdown || '');
  if (!body.trim()) return false;
  const patterns = {
    chapter_summary_title: /chapter\s*summary\s*title|^#\s+/i,
    chapter_overview: /overview of the chapter|chapter\s*overview/i,
    learning_objectives: /learning\s+objectives/i,
    important_concepts: /important\s+concepts/i,
    definitions: /key\s+definitions|definitions\s+and\s+terms/i,
    formulae: /formulae|formulas|rules|important\s+facts/i,
    concept_connections: /concept\s+connections/i,
    real_life: /real[\s-]*life\s+applications/i,
    quick_revision: /quick\s+revision/i,
    recall_questions: /practice\s+recall|recall\s+questions/i,
  };
  const pattern = patterns[heading.id];
  if (!pattern) return false;
  if (!pattern.test(body)) return false;
  if (heading.id === 'formulae') {
    const hits = (body.match(/^\s*\d+\.\s+/gm) || []).length;
    return hits >= 3 || /\*\*.+\*\*/.test(body);
  }
  return /.{8,}/.test(body);
}

const PRACTICE_QA_HEADING_SECTION = {
  section_a: PRACTICE_QA_SECTION_LABELS.A,
  section_b: PRACTICE_QA_SECTION_LABELS.B,
  section_c: PRACTICE_QA_SECTION_LABELS.C,
  section_d: PRACTICE_QA_SECTION_LABELS.D,
  section_e: PRACTICE_QA_SECTION_LABELS.E,
  section_f: PRACTICE_QA_SECTION_LABELS.F,
  section_g: PRACTICE_QA_SECTION_LABELS.G,
};

function practiceQaRowHasQuestion(q) {
  if (q == null) return false;
  if (typeof q === 'string') return isMeaningfulScalar(q);
  const text = String(
    q.question || q.prompt || q.question_text || q.questionText || q.text || '',
  ).trim();
  return Boolean(text) && !isPlaceholderText(text);
}

function rawPracticeQaSectionHasQuestions(sections, label) {
  const target = String(label || '').toLowerCase();
  const letter = target.match(/section\s+([a-g])\b/i)?.[1];
  for (const sec of Array.isArray(sections) ? sections : []) {
    const name = String(sec?.sectionName || sec?.name || sec?.section || '').toLowerCase();
    const nameMatch =
      name === target ||
      (letter && new RegExp(`section\\s+${letter}\\b`, 'i').test(name)) ||
      target.includes(name) ||
      name.includes(target.slice(0, 20));
    if (!nameMatch) continue;
    const qs = Array.isArray(sec?.questions)
      ? sec.questions
      : Array.isArray(sec?.items)
        ? sec.items
        : [];
    if (qs.some((q) => practiceQaRowHasQuestion(q))) return true;
  }
  return false;
}

function practiceQaHeadingFilledInStructured(data, heading, markdown = '') {
  const src = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const normalized = normalizePracticeQaStructuredContent(src, markdown);
  const id = heading.id;

  if (id === 'title') {
    return isMeaningfulScalar(normalized.title || src.title || src.practice_set_title);
  }
  if (id === 'learning_objectives') {
    return isMeaningfulArray(normalized.learning_objectives || src.learning_objectives);
  }
  if (id === 'instructions') {
    return isMeaningfulScalar(normalized.instructions || src.instructions);
  }
  if (id === 'answer_key') {
    return (
      isMeaningfulScalar(normalized.answer_key_with_explanations || normalized.answer_key) ||
      (Array.isArray(normalized.questions) &&
        normalized.questions.some((q) => isMeaningfulScalar(q?.answer)))
    );
  }

  const label = PRACTICE_QA_HEADING_SECTION[id];
  if (label) {
    if (rawPracticeQaSectionHasQuestions(normalized.sections, label)) return true;
    if (rawPracticeQaSectionHasQuestions(src.sections, label)) return true;
    for (const key of heading.storageKeys || []) {
      if (isMeaningfulContent(src[key])) return true;
    }
    return false;
  }
  return false;
}

function practiceQaHeadingFilledInMarkdown(markdown, heading) {
  const body = String(markdown || '');
  if (!body.trim()) return false;
  const id = heading.id;

  if (id === 'title') {
    return /practice\s*set\s*title|^#\s+/im.test(body) && /.{4,}/.test(body);
  }
  if (id === 'learning_objectives') {
    return /learning\s+objectives/i.test(body) && /^\s*[-*\d]/m.test(body);
  }
  if (id === 'instructions') {
    return /instructions\s+to\s+students/i.test(body);
  }
  if (id === 'answer_key') {
    return /answer\s+key/i.test(body);
  }

  const label = PRACTICE_QA_HEADING_SECTION[id];
  if (!label) return false;
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(esc, 'i').test(body)) return false;
  return /\*\*Q\d|^\d+\.\s+\S|\*\*Answer:/im.test(body);
}

function practiceQaDashboardComplete(data, markdown = '') {
  if (practiceQaHasAllRequiredSections(data)) return true;
  const src = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const sections = Array.isArray(src.sections) ? src.sections : [];
  if (!sections.length) return false;
  for (const label of Object.values(PRACTICE_QA_SECTION_LABELS)) {
    if (!rawPracticeQaSectionHasQuestions(sections, label)) return false;
  }
  return (
    isMeaningfulScalar(src.title || src.practice_set_title) &&
    (isMeaningfulArray(src.learning_objectives) || isMeaningfulScalar(src.instructions))
  );
}

export const DASHBOARD_INCOMPLETE_CODE = 'AI_TOOL_CONTENT_INCOMPLETE';
export const DASHBOARD_WRONG_TOOL_CODE = 'AI_TOOL_WRONG_TYPE';

export const DASHBOARD_INCOMPLETE_USER_MESSAGE =
  'Saved content for this class, subject, topic, and sub-topic is incomplete or not in the correct tool format. Please ask your Super Admin to complete all sections and regenerate.';

export const DASHBOARD_WRONG_TOOL_USER_MESSAGE =
  'Saved content belongs to a different AI tool. Super Admin must generate content using this tool name only (same class, subject, topic, and sub-topic).';

const PLACEHOLDER_RE =
  /^(n\/?a|tbd|todo|pending|none|null|undefined|—+|\.\.\.|to be (added|completed|filled)|not available|not included|placeholder|coming soon|lorem ipsum)$/i;

const PLACEHOLDER_CONTAINS_RE =
  /not included in this|not included for this|regenerate to add|no items in this section/i;

function isPlaceholderText(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (t.length <= 2) return true;
  if (PLACEHOLDER_RE.test(t)) return true;
  return PLACEHOLDER_CONTAINS_RE.test(t);
}

function isMeaningfulScalar(value) {
  const t = String(value ?? '').trim();
  return t.length > 2 && !isPlaceholderText(t);
}

function isMeaningfulArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  return arr.some((item) => {
    if (item == null) return false;
    if (typeof item === 'string') return isMeaningfulScalar(item);
    if (typeof item === 'object') {
      const parts = Object.values(item)
        .map((v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : String(v ?? '')))
        .join(' ')
        .trim();
      return isMeaningfulScalar(parts);
    }
    return isMeaningfulScalar(String(item));
  });
}

/** @param {unknown} value */
export function isMeaningfulContent(value) {
  if (value == null) return false;
  if (typeof value === 'string') return isMeaningfulScalar(value);
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return isMeaningfulArray(value);
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return false;
    return keys.some((k) => isMeaningfulContent(value[k]));
  }
  return false;
}

function tryParseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {string} content @param {Record<string, unknown>} [metadata] */
export function extractStructuredFromStoredContent(content, metadata = {}) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  if (meta.structuredContent && typeof meta.structuredContent === 'object' && !Array.isArray(meta.structuredContent)) {
    return meta.structuredContent;
  }
  const parsed = tryParseJson(content);
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed)) return { items: parsed };
  if (parsed.structuredContent && typeof parsed.structuredContent === 'object') {
    return parsed.structuredContent;
  }
  if (parsed.rawData && typeof parsed.rawData === 'object' && !Array.isArray(parsed.rawData)) {
    return parsed.rawData;
  }
  return parsed;
}

/** Merge concept deck / nested rows for field lookup. */
function dataContextForHeading(toolSlug, data, heading) {
  const base = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  if (toolSlug === 'concept-mastery-helper') {
    const row = Array.isArray(base.concepts) && base.concepts[0] ? base.concepts[0] : null;
    if (row && typeof row === 'object') return { ...base, ...row };
  }
  if (toolSlug === 'concept-breakdown-explainer') {
    const row = Array.isArray(base.concepts) && base.concepts[0] ? base.concepts[0] : base;
    if (row && typeof row === 'object') return { ...base, ...row };
  }
  return base;
}

/** Dashboard gate: primary storage keys only (no cross-section fallbacks). */
function keysForHeading(toolSlug, heading) {
  const fromTemplate = getStorageKeysForHeading(toolSlug, heading.id);
  return [...new Set(fromTemplate.length ? fromTemplate : heading.storageKeys || [])];
}

function studyDeckCards(data) {
  const ctx = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  if (Array.isArray(ctx.cards)) return ctx.cards;
  if (Array.isArray(ctx.flashcard_set)) return ctx.flashcard_set;
  if (Array.isArray(ctx.flashcards)) return ctx.flashcards;
  return [];
}

function studyDeckCardHasAnyField(card, keys) {
  if (!card || typeof card !== 'object') return false;
  for (const key of keys) {
    if (isMeaningfulContent(card[key])) return true;
  }
  return false;
}

/** Sections 6–8 are stored on each card, not only at deck root. */
function studyDeckPerCardHeadingFilled(data, heading) {
  const cards = studyDeckCards(data);
  if (!cards.length) return false;

  const byHeadingId = {
    difficulty_tag_for_each_card: [
      'difficulty_tag_for_each_card',
      'difficulty_tag',
      'difficulty_level',
      'skill_focus',
      'bloom_level',
    ],
    memory_hook_quick_tip: ['memory_hook_quick_tip', 'memory_cue', 'hint', 'memory_hook'],
    self_check_round: ['self_check_round', 'peer_prompt', 'self_check'],
    self_check_rapid_recall_round: [
      'self_check_rapid_recall_round',
      'self_check_round',
      'peer_prompt',
      'self_check',
    ],
  };

  const keys = byHeadingId[heading.id];
  if (!keys) return false;
  return cards.every((card) => studyDeckCardHasAnyField(card, keys));
}

function studyDeckHeadingFilledInMarkdown(markdown, heading) {
  const body = String(markdown || '');
  if (!body.trim()) return false;

  const patternsById = {
    difficulty_tag_for_each_card: /difficulty\s+tag\s+for\s+each\s+card|difficulty\s+tag/i,
    memory_hook_quick_tip: /memory\s+hook|quick\s+tip|memory\s+cue/i,
    self_check_round: /self[-\s]?check\s+round|self[-\s]?check\s+rapid/i,
    self_check_rapid_recall_round: /self[-\s]?check\s+rapid|self[-\s]?check\s+round/i,
  };
  const pattern = patternsById[heading.id];
  if (!pattern) return false;
  return pattern.test(body) && /card\s+1\b/i.test(body);
}

function studyGuideHeadingFilledInStructured(data, heading) {
  const s = normalizeStudyGuideStructuredContent(
    data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  );
  const id = heading.id;
  if (id === 'definitions_formulae') {
    const definitions = Array.isArray(s.definitions) ? s.definitions : [];
    const formulae = Array.isArray(s.formulae) ? s.formulae : [];
    const hasDefs = definitions.some(
      (d) => isMeaningfulScalar(d?.term) && isMeaningfulScalar(d?.definition),
    );
    const hasFm = formulae.some(
      (f) => isMeaningfulScalar(f?.formula) || isMeaningfulScalar(f?.name),
    );
    return hasDefs || hasFm;
  }
  if (id === 'key_concepts') {
    const concepts = Array.isArray(s.key_concepts) ? s.key_concepts : [];
    return concepts.some(
      (c) => isMeaningfulScalar(c?.name) && isMeaningfulScalar(c?.explanation),
    );
  }
  if (id === 'practice_questions') {
    const pq = Array.isArray(s.practice_questions) ? s.practice_questions : [];
    return pq.some((q) => isMeaningfulScalar(q?.question));
  }
  return false;
}

function headingFilledInStructured(toolSlug, data, heading, markdown = '') {
  if (toolSlug === 'smart-study-guide-generator') {
    if (studyGuideHeadingFilledInStructured(data, heading)) return true;
  }
  if (toolSlug === 'smart-qa-practice-generator') {
    if (practiceQaHeadingFilledInStructured(data, heading, markdown)) return true;
  }
  if (toolSlug === 'chapter-summary-creator') {
    if (chapterSummaryHeadingFilledInStructured(data, heading)) return true;
  }
  if (toolSlug === 'worksheet-mcq-generator') {
    if (worksheetHeadingFilledInStructured(data, heading, markdown)) return true;
  }
  if (toolSlug === 'activity-project-generator' || toolSlug === 'project-idea-lab') {
    if (activityHeadingFilledInStructured(toolSlug, data, heading, markdown)) return true;
  }
  if (toolSlug === 'lesson-planner' || toolSlug === 'study-schedule-maker') {
    if (lessonPlannerHeadingFilledInStructured(toolSlug, data, heading, markdown)) return true;
  }
  if (toolSlug === 'my-study-decks' || toolSlug === 'flashcard-generator') {
    if (studyDeckPerCardHeadingFilled(data, heading)) return true;
  }
  const ctx = dataContextForHeading(toolSlug, data, heading);
  const keys = keysForHeading(toolSlug, heading);
  for (const key of keys) {
    if (isMeaningfulContent(ctx[key])) return true;
  }
  return false;
}

function splitMarkdownSections(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  /** @type {{ heading: string; body: string[] }[]} */
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[2].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

/** Hash, numbered (1. Title), and bold (**Section**) headings — PDF uploads often use numbers only. */
function collectMarkdownSections(markdown) {
  /** @type {{ heading: string; body: string }[]} */
  const out = [];
  const seen = new Set();

  const push = (heading, body) => {
    const h = String(heading || '').trim();
    if (!h) return;
    const key = `${h.toLowerCase()}::${String(body || '').slice(0, 40)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ heading: h, body: String(body || '').trim() });
  };

  for (const sec of splitMarkdownSections(markdown)) {
    push(sec.heading, sec.body.join('\n'));
  }

  const lines = String(markdown || '').split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const numMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
    const hashMatch = !numMatch && line.match(/^#{1,4}\s+(.+)$/);
    const boldMatch = !numMatch && !hashMatch && line.match(/^\s*\*\*(.+?)\*\*\s*$/);
    const headingText = numMatch ? numMatch[2].trim() : hashMatch ? hashMatch[1].trim() : boldMatch ? boldMatch[1].trim() : null;
    if (headingText) {
      if (current) push(current.heading, current.body);
      current = { heading: headingText, body: '' };
      continue;
    }
    if (current) {
      current.body += (current.body ? '\n' : '') + line;
    }
  }
  if (current) push(current.heading, current.body);

  return out;
}

function isCanonicalHeadingLine(toolSlug, line) {
  const raw = String(line || '').trim();
  if (!raw) return { headingId: null };
  const stripped = raw.replace(/^#{1,4}\s+/, '').replace(/^\s*\d+\.\s+/, '').trim();
  const match = matchCanonicalHeadingLine(toolSlug, raw);
  if (match.headingId) return match;
  if (stripped !== raw) return matchCanonicalHeadingLine(toolSlug, stripped);
  return match;
}

function markdownSectionBodyForHeading(toolSlug, markdown, heading) {
  const lines = String(markdown || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = isCanonicalHeadingLine(toolSlug, lines[i]);
    if (match.headingId !== heading.id) continue;
    const bodyLines = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = isCanonicalHeadingLine(toolSlug, lines[j]);
      if (next.headingId) break;
      bodyLines.push(lines[j]);
    }
    if (isMeaningfulContent(bodyLines.join('\n'))) return true;
  }
  return false;
}

function copyMeaningfulField(target, targetKey, source, sourceKeys) {
  if (isMeaningfulContent(target[targetKey])) return;
  for (const srcKey of sourceKeys) {
    const val = source[srcKey];
    if (!isMeaningfulContent(val)) continue;
    target[targetKey] = Array.isArray(val) ? [...val] : val;
    return;
  }
}

/** Apply template sectionFallbackRules (e.g. teacher_instructions ← differentiation). */
function applySectionFallbacks(toolSlug, data) {
  const rules = getSectionFallbackRules(toolSlug);
  const out = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  if (!rules.length) return out;

  const aliasTargets = {
    teacher_instructions: ['teacherInstructions'],
    student_instructions: ['studentInstructions'],
    step_by_step_procedure: ['steps', 'procedure'],
    assessment_criteria_rubric: ['assessmentRubric'],
    expected_learning_outcomes: ['expectedLearningOutcomes', 'learningOutcome'],
    learning_objectives: ['learningObjectives'],
  };

  for (const rule of rules) {
    const targets = Array.isArray(rule.ifEmpty) ? rule.ifEmpty : [];
    const sources = Array.isArray(rule.use) ? rule.use : [];
    for (const target of targets) {
      copyMeaningfulField(out, target, out, sources);
      for (const alias of aliasTargets[target] || []) {
        copyMeaningfulField(out, alias, out, [target, ...sources]);
      }
      if (rule.synthesize === 'split_into_bullets' && !isMeaningfulContent(out[target])) {
        const srcVal = sources.map((k) => out[k]).find((v) => isMeaningfulContent(v));
        if (typeof srcVal === 'string' && srcVal.trim()) {
          out[target] = srcVal
            .split(/[;\n•]+/)
            .map((s) => s.replace(/^[-*]\s*/, '').trim())
            .filter((s) => isMeaningfulScalar(s));
        }
      }
    }
  }
  return out;
}

function lessonActivityLines(data) {
  const ctx = data && typeof data === 'object' ? data : {};
  return [
    ...(Array.isArray(ctx.teaching_activities) ? ctx.teaching_activities : []),
    ...(Array.isArray(ctx.activities) ? ctx.activities : []),
    ...(Array.isArray(ctx.classroom_activities) ? ctx.classroom_activities : []),
    ...(Array.isArray(ctx.lesson_activities) ? ctx.lesson_activities : []),
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
}

function lessonPlannerHeadingFilledInStructured(toolSlug, data, heading, markdown = '') {
  const normalized = applySectionFallbacks(
    toolSlug,
    normalizeLessonPlannerStructuredContent(data && typeof data === 'object' ? data : {}, toolSlug),
  );
  const keys = keysForHeading(toolSlug, heading);
  for (const key of keys) {
    if (isMeaningfulContent(normalized[key])) return true;
  }
  if (heading.id === 'classroom_activities' && lessonActivityLines(normalized).length > 0) return true;
  if (
    (heading.id === 'introduction' || heading.id === 'teaching_strategy' || heading.id === 'teacher_talk') &&
    lessonActivityLines(normalized).length > 0
  ) {
    return true;
  }
  return markdownSectionBodyForHeading(toolSlug, markdown, heading);
}

function activityProcedureLines(data) {
  const ctx = data && typeof data === 'object' ? data : {};
  return [
    ...(Array.isArray(ctx.step_by_step_procedure) ? ctx.step_by_step_procedure : []),
    ...(Array.isArray(ctx.steps) ? ctx.steps : []),
    ...(Array.isArray(ctx.procedure) ? ctx.procedure : []),
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
}

function activityHeadingFilledInStructured(toolSlug, data, heading, markdown = '') {
  const normalized = applySectionFallbacks(
    toolSlug,
    normalizeActivityStructuredContent(
      data && typeof data === 'object' && !Array.isArray(data) ? data : {},
      toolSlug,
    ),
  );
  const id = heading.id;
  const keys = keysForHeading(toolSlug, heading);
  for (const key of keys) {
    if (isMeaningfulContent(normalized[key])) return true;
  }

  if (id === 'teacher_instructions') {
    if (activityProcedureLines(normalized).length >= 1) return true;
    const procText = activityProcedureLines(normalized).join('\n');
    if (/facilitat|teacher\s+note|for\s+the\s+teacher|teacher\s+role|whole[\s-]class/i.test(procText)) {
      return true;
    }
    return markdownSectionBodyForHeading(toolSlug, markdown, heading);
  }
  if (id === 'student_instructions') {
    if (activityProcedureLines(normalized).length > 0) return true;
    return markdownSectionBodyForHeading(toolSlug, markdown, heading);
  }

  return false;
}

function headingFilledInMarkdown(toolSlug, markdown, heading) {
  if (toolSlug === 'smart-qa-practice-generator') {
    if (practiceQaHeadingFilledInMarkdown(markdown, heading)) return true;
  }
  if (toolSlug === 'chapter-summary-creator') {
    if (chapterSummaryHeadingFilledInMarkdown(markdown, heading)) return true;
  }
  if (toolSlug === 'worksheet-mcq-generator') {
    if (worksheetHeadingFilledInMarkdown(markdown, heading)) return true;
  }
  if (toolSlug === 'activity-project-generator' || toolSlug === 'project-idea-lab') {
    if (markdownSectionBodyForHeading(toolSlug, markdown, heading)) return true;
  }
  const sections = collectMarkdownSections(markdown);
  for (const sec of sections) {
    const match = matchCanonicalHeadingLine(toolSlug, sec.heading);
    if (match.headingId === heading.id) {
      return isMeaningfulContent(sec.body);
    }
  }
  if (toolSlug === 'my-study-decks' || toolSlug === 'flashcard-generator') {
    return studyDeckHeadingFilledInMarkdown(markdown, heading);
  }
  return false;
}

function studyGuideDashboardComplete(data) {
  const s = normalizeStudyGuideStructuredContent(
    data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  );
  const concepts = Array.isArray(s.key_concepts) ? s.key_concepts : [];
  const hasConcepts = concepts.some(
    (c) => isMeaningfulScalar(c?.name) && isMeaningfulScalar(c?.explanation),
  );
  const definitions = Array.isArray(s.definitions) ? s.definitions : [];
  const hasDefinitions = definitions.some(
    (d) => isMeaningfulScalar(d?.term) && isMeaningfulScalar(d?.definition),
  );
  const formulae = Array.isArray(s.formulae) ? s.formulae : [];
  const hasFormulae = formulae.some(
    (f) => isMeaningfulScalar(f?.formula) || isMeaningfulScalar(f?.name),
  );
  const hasDefinitionsOrFormulae =
    definitions.some((d) => isMeaningfulScalar(d?.term) && isMeaningfulScalar(d?.definition)) ||
    hasFormulae;
  const practice = Array.isArray(s.practice_questions) ? s.practice_questions : [];
  const hasPractice = practice.some((q) => isMeaningfulScalar(q?.question));

  return (
    isMeaningfulScalar(s.title) &&
    isMeaningfulScalar(s.chapter_subtopic_overview) &&
    isMeaningfulArray(s.learning_objectives) &&
    isMeaningfulArray(s.prior_knowledge_required) &&
    hasConcepts &&
    hasDefinitionsOrFormulae &&
    isMeaningfulScalar(s.concept_flow_mind_map) &&
    isMeaningfulArray(s.real_life_examples) &&
    isMeaningfulArray(s.quick_revision_notes) &&
    hasPractice &&
    isMeaningfulArray(s.improvement_tips)
  );
}

function conceptBreakdownDashboardComplete(data) {
  const s = normalizeConceptBreakdownStructuredContent(
    data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  );
  return (
    isMeaningfulScalar(s.concept_title || s.concept_name || s.title) &&
    isMeaningfulScalar(s.simple_definition || s.simple_explanation || s.explanation) &&
    isMeaningfulArray(s.breakdown_steps || s.steps) &&
    isMeaningfulArray(s.real_life_examples || s.examples) &&
    isMeaningfulArray(s.important_terms || s.keywords) &&
    isMeaningfulArray(s.concept_check_questions) &&
    isMeaningfulScalar(s.application_thinking_question || s.application_question) &&
    isMeaningfulScalar(s.higher_order_thinking_prompt || s.hots_prompt || s.hots_question) &&
    isMeaningfulScalar(s.quick_revision_summary || s.summary)
  );
}

function chapterSummaryDashboardComplete(data) {
  const s = finalizeChapterSummaryStructuredContent(
    data && typeof data === 'object' && !Array.isArray(data) ? data : {},
    {},
  );
  const formulae = Array.isArray(s.formulae) ? s.formulae : [];
  return (
    isMeaningfulScalar(s.chapter_summary_title || s.title) &&
    isMeaningfulScalar(s.chapter_overview) &&
    isMeaningfulArray(s.learning_objectives) &&
    chapterSummaryImportantConceptsFilled(s) &&
    isMeaningfulArray(s.definitions) &&
    formulae.length >= 3 &&
    chapterSummaryConnectionsFilled(s) &&
    isMeaningfulArray(s.real_life_applications) &&
    isMeaningfulArray(s.quick_revision_notes) &&
    isMeaningfulArray(s.practice_recall_questions)
  );
}

function keyPointsDashboardComplete(data) {
  const s = normalizeKeyPointsStructuredContent(
    data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  );
  const formulae = Array.isArray(s.formulae) ? s.formulae : [];
  return (
    isMeaningfulScalar(s.topic_title || s.title) &&
    isMeaningfulArray(s.important_concepts) &&
    isMeaningfulArray(s.essential_definitions) &&
    formulae.length >= 3 &&
    isMeaningfulArray(s.keywords_terminologies) &&
    isMeaningfulArray(s.must_remember_facts) &&
    isMeaningfulArray(s.real_life_connections) &&
    isMeaningfulArray(s.frequently_asked_exam_points) &&
    isMeaningfulArray(s.mnemonics_memory_tricks) &&
    isMeaningfulScalar(s.one_minute_revision_summary)
  );
}

/** @returns {{ complete: boolean; missing: string[]; optionalMissing: string[] }} */
export function getMissingCanonicalSections(toolSlug, data, markdown = '') {
  const template = getAiToolTemplate(toolSlug);
  const headings = template?.canonicalHeadings || [];
  if (!headings.length) return { complete: true, missing: [], optionalMissing: [] };

  const optionalIds = new Set(
    Array.isArray(template.dashboardOptionalHeadingIds) ? template.dashboardOptionalHeadingIds : [],
  );
  const requiredIds = new Set(
    Array.isArray(template.dashboardRequiredHeadingIds) ? template.dashboardRequiredHeadingIds : [],
  );
  const missing = [];
  const optionalMissing = [];
  for (const heading of headings) {
    if (requiredIds.size > 0 && !requiredIds.has(heading.id)) continue;
    const structuredOk = headingFilledInStructured(toolSlug, data, heading, markdown);
    const markdownOk = !structuredOk && headingFilledInMarkdown(toolSlug, markdown, heading);
    if (!structuredOk && !markdownOk) {
      const label = heading.label || heading.id;
      if (optionalIds.has(heading.id)) optionalMissing.push(label);
      else missing.push(label);
    }
  }
  return { complete: missing.length === 0, missing, optionalMissing };
}

/**
 * Teacher/student Generate: deliver stored PDF rows when body text exists; only block wrong-tool mismatch.
 * @param {{ valid?: boolean; code?: string; missingSections?: string[] }} contentGate
 * @param {string} rawContent
 */
export function shouldDeliverStoredContentDespiteSectionGate(contentGate, rawContent) {
  if (contentGate?.valid) return true;
  if (contentGate?.code === DASHBOARD_WRONG_TOOL_CODE) return false;
  return String(rawContent || '').trim().length >= 60;
}

function hasStructuredKey(data, key) {
  return data && typeof data === 'object' && isMeaningfulContent(data[key]);
}

/** Worksheet A–E (5 sections) vs Smart Q&A A–G (7 sections). */
function looksLikeWorksheetPayload(structured, markdown) {
  const text = `${JSON.stringify(structured || {})}\n${markdown}`.slice(0, 24000);
  if (/section\s+e:\s*competency|competency\s*\/\s*real[\s-]*life\s+application/i.test(text)) {
    return true;
  }
  if (Array.isArray(structured?.sections)) {
    const names = structured.sections.map((s) => String(s?.sectionName || s?.name || '').toLowerCase());
    if (names.some((n) => /section\s+e:.*competency/i.test(n))) return true;
    if (names.filter((n) => /section\s+[a-e]:/i.test(n)).length >= 4 && !names.some((n) => /section\s+g:/i.test(n))) {
      return true;
    }
  }
  return false;
}

/** Smart Q&A and Quick Assignment both use "Instructions to Students" — detect practice set shape. */
function looksLikePracticeQaPayload(structured, markdown) {
  if (looksLikeWorksheetPayload(structured, markdown)) return false;
  const text = `${JSON.stringify(structured || {})}\n${markdown}`.slice(0, 24000);
  if (hasStructuredKey(structured, 'answer_key_with_explanations')) return true;
  if (/section\s+a:\s*mcqs|section\s+b:\s*fill|section\s+c:\s*match|section\s+g:\s*hots/i.test(text)) {
    return true;
  }
  if (/answer\s+key\s+with\s+explanations/i.test(text)) return true;
  if (Array.isArray(structured?.sections)) {
    return structured.sections.some((sec) => {
      const name = String(sec?.sectionName || sec?.name || '').toLowerCase();
      return /section\s+[a-g]:/.test(name);
    });
  }
  return false;
}

/** Score which tool the payload most likely belongs to (by JSON shape + headings). */
function detectDominantContentTool(structured, markdown) {
  const text = `${JSON.stringify(structured || {})}\n${markdown}`.slice(0, 24000);
  const scores = new Map();

  const bump = (slug, weight) => {
    scores.set(slug, (scores.get(slug) || 0) + weight);
  };

  if (looksLikeWorksheetPayload(structured, markdown)) {
    bump('worksheet-mcq-generator', 6);
  }
  if (looksLikePracticeQaPayload(structured, markdown)) {
    bump('smart-qa-practice-generator', 6);
  }

  if (hasStructuredKey(structured, 'chapter_subtopic_overview') || /chapter\s*and\s*subtopic/i.test(text)) {
    bump('smart-study-guide-generator', 4);
  }
  if (hasStructuredKey(structured, 'improvement_tips') || /tips for further improvement/i.test(text)) {
    bump('smart-study-guide-generator', 2);
  }
  if (hasStructuredKey(structured, 'chapter_summary_title') || /chapter\s*summary\s*title/i.test(text)) {
    bump('chapter-summary-creator', 5);
  }
  if (hasStructuredKey(structured, 'practice_recall_questions') || /practice recall questions/i.test(text)) {
    bump('chapter-summary-creator', 3);
  }
  if (hasStructuredKey(structured, 'topic_title') || /one-minute revision summary/i.test(text)) {
    bump('key-points-formula-extractor', 4);
  }
  if (hasStructuredKey(structured, 'keywords_terminologies') || /keywords and terminologies/i.test(text)) {
    bump('key-points-formula-extractor', 2);
  }
  if (!looksLikePracticeQaPayload(structured, markdown)) {
    if (hasStructuredKey(structured, 'assignment_title') || /instructions to students/i.test(text)) {
      bump('quick-assignment-builder', 4);
    }
    if (hasStructuredKey(structured, 'concept_based_questions')) {
      bump('quick-assignment-builder', 2);
    }
  }
  if (hasStructuredKey(structured, 'concept_title') && hasStructuredKey(structured, 'breakdown_steps')) {
    bump('concept-breakdown-explainer', 4);
  }
  if (
    !looksLikePracticeQaPayload(structured, markdown) &&
    Array.isArray(structured?.sections) &&
    structured.sections.length >= 5
  ) {
    bump('smart-qa-practice-generator', 3);
  }
  if (hasStructuredKey(structured, 'mock_test_title') || hasStructuredKey(structured, 'section_a')) {
    bump('mock-test-builder', 4);
  }
  if (Array.isArray(structured?.cards) && structured.cards.length > 0) {
    bump('my-study-decks', 3);
  }

  let bestSlug = '';
  let bestScore = 0;
  for (const [slug, score] of scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestSlug = slug;
    }
  }
  return bestScore >= 3 ? bestSlug : '';
}

function detectWrongToolFormat(toolSlug, data, markdown, options = {}) {
  const text = `${JSON.stringify(data || {})}\n${markdown}`.slice(0, 20000);
  if (!options.trustStoredTool) {
    const dominant = detectDominantContentTool(data, markdown);
    if (dominant && !toolSlugMatches(dominant, toolSlug)) {
      const expected = getToolDisplayTitle(toolSlug) || toolSlug;
      const found = getToolDisplayTitle(dominant) || dominant;
      return `Saved content matches "${found}", not "${expected}". Super Admin must generate content using the correct tool only.`;
    }
  }
  if (toolSlug === 'chapter-summary-creator') {
    const hasChapter =
      isMeaningfulContent(data?.chapter_overview) ||
      /overview of the chapter/i.test(markdown);
    const looksStudyGuide =
      /study\s*guide\s*title|chapter\s*and\s*subtopic\s*overview|prior knowledge required/i.test(text) &&
      !hasChapter;
    if (looksStudyGuide) {
      return 'Content is stored as a Smart Study Guide, not a Chapter Summary. Ask Super Admin to regenerate with Chapter Summary Creator.';
    }
  }
  if (toolSlug === 'smart-study-guide-generator') {
    const looksChapter =
      /chapter\s*summary\s*title|overview of the chapter/i.test(text) &&
      !/study\s*guide\s*title/i.test(text);
    if (looksChapter) {
      return 'Content is stored as a Chapter Summary, not a Smart Study Guide. Ask Super Admin to regenerate with Smart Study Guide Generator.';
    }
  }
  if (toolSlug === 'key-points-formula-extractor') {
    if (/study\s*guide\s*title|chapter\s*and\s*subtopic/i.test(text) && !/topic\s*title|most important concepts/i.test(text)) {
      return 'Content does not match Key Points Extractor format.';
    }
  }
  if (toolSlug === 'quick-assignment-builder') {
    if (/chapter\s*summary|study\s*guide\s*title|chapter_subtopic_overview/i.test(text) && !/assignment\s*title/i.test(text)) {
      return 'Content does not match Quick Assignment Builder format.';
    }
  }
  if (toolSlug === 'concept-breakdown-explainer') {
    if (/chapter\s*summary\s*title|assignment\s*title|study\s*guide\s*title/i.test(text) && !/concept\s*title|simple\s*definition/i.test(text)) {
      return 'Content does not match Concept Breakdown Explainer format.';
    }
  }
  return '';
}

/** @param {{ toolName?: string }} doc @param {string} requestedToolSlug */
export function validateStoredRecordToolName(doc, requestedToolSlug) {
  const stored = String(doc?.toolName || '').trim();
  if (!stored) {
    return { ok: true };
  }
  if (toolSlugMatches(stored, requestedToolSlug)) {
    return { ok: true };
  }
  const expected = getToolDisplayTitle(requestedToolSlug) || requestedToolSlug;
  const found = getToolDisplayTitle(stored) || stored;
  return {
    ok: false,
    message: `Saved data is for "${found}", not "${expected}". Content must be generated with the matching tool name only.`,
  };
}

function extraStrictChecks(toolSlug, data, markdown = '') {
  if (toolSlug === 'smart-study-guide-generator') {
    if (!studyGuideDashboardComplete(data)) {
      return {
        valid: false,
        message:
          'Smart Study Guide must include all 11 sections with real content (key concepts, definitions, formulae, practice questions, etc.).',
      };
    }
  }
  if (toolSlug === 'concept-breakdown-explainer') {
    if (!conceptBreakdownDashboardComplete(data)) {
      return {
        valid: false,
        message: 'Concept Breakdown must include all 9 sections with real content.',
      };
    }
  }
  if (toolSlug === 'chapter-summary-creator') {
    if (!chapterSummaryDashboardComplete(data)) {
      return {
        valid: false,
        message: 'Chapter Summary must include all 10 sections with real content (including at least 3 formulae/rules).',
      };
    }
  }
  if (toolSlug === 'key-points-formula-extractor') {
    if (!keyPointsDashboardComplete(data)) {
      return {
        valid: false,
        message: 'Key Points must include all 10 sections with real content (including at least 3 formulae/rules).',
      };
    }
  }
  if (toolSlug === 'smart-qa-practice-generator') {
    if (!practiceQaDashboardComplete(data, markdown)) {
      const missing = getPracticeQaMissingSections(data);
      const detail =
        practiceQaValidationMessage(data) ||
        (missing.length ? `Missing: ${missing.join('; ')}` : 'Practice Q&A sections A–G are incomplete.');
      return { valid: false, message: detail };
    }
  }
  if (toolSlug === 'my-study-decks' || toolSlug === 'flashcard-generator') {
    const cards = Array.isArray(data?.cards) ? data.cards : [];
    if (!cards.length || !cards.every((c) => isMeaningfulScalar(c?.front) && isMeaningfulScalar(c?.back))) {
      return { valid: false, message: 'Every flashcard must have a non-empty front and back.' };
    }
  }
  if (toolSlug === 'worksheet-mcq-generator') {
    if (!worksheetDashboardComplete(data, markdown)) {
      return {
        valid: false,
        message:
          'Worksheet must include all sections A–E with questions, plus title, objectives or instructions, and an answer key.',
      };
    }
  }
  if (toolSlug === 'concept-mastery-helper') {
    const concepts = Array.isArray(data?.concepts) ? data.concepts : [];
    if (!concepts.length) {
      return { valid: false, message: 'Concept Mastery must include at least one complete concept.' };
    }
  }
  return { valid: true, message: '' };
}

/**
 * @param {string} toolSlug
 * @param {string} rawContent
 * @param {{ metadata?: Record<string, unknown> }} [options]
 */
export function validateDashboardAiToolContent(toolSlug, rawContent, options = {}) {
  const slug = String(toolSlug || '').trim();
  const content = String(rawContent || '').trim();

  if (!slug) {
    return { valid: false, code: 'AI_TOOL_CONTENT_INCOMPLETE', message: 'Tool type is required.' };
  }
  if (!content) {
    return {
      valid: false,
      code: 'AI_TOOL_CONTENT_INCOMPLETE',
      message: 'No content is available for this selection.',
    };
  }

  const structured = extractStructuredFromStoredContent(content, options.metadata) || {};
  const contentType = getContentTypeDefault(slug);

  const formatError = detectWrongToolFormat(slug, structured, content, {
    trustStoredTool: Boolean(options.trustStoredTool),
  });
  if (formatError) {
    const wrongTool = /Saved content matches|belongs to a different|not ".*" tool/i.test(formatError);
    return {
      valid: false,
      code: wrongTool ? DASHBOARD_WRONG_TOOL_CODE : DASHBOARD_INCOMPLETE_CODE,
      message: formatError,
    };
  }

  if (isValidAiToolSlug(slug)) {
    const structural = validateToolSpecificStructuredContent(slug, structured, contentType, content);
    if (!structural.valid) {
      return {
        valid: false,
        code: 'AI_TOOL_CONTENT_INCOMPLETE',
        message: structural.message || 'Content does not meet the minimum structure for this tool.',
      };
    }
  }

  let normalized =
    validateToolSpecificStructuredContent(slug, structured, contentType, content)
      .normalizedStructuredContent || structured;
  if (slug === 'my-study-decks') {
    normalized = normalizeMyStudyDecksStructuredContent(normalized);
  }
  if (slug === 'flashcard-generator') {
    normalized = normalizeFlashcardDeckStructuredContent(normalized);
  }
  if (slug === 'concept-breakdown-explainer') {
    normalized = normalizeConceptBreakdownStructuredContent(normalized);
  }
  if (slug === 'smart-qa-practice-generator') {
    const merged =
      structured && typeof structured === 'object' && !Array.isArray(structured)
        ? { ...structured, ...normalized }
        : normalized;
    normalized = normalizePracticeQaStructuredContent(merged, content);
  }
  if (slug === 'chapter-summary-creator') {
    const merged =
      structured && typeof structured === 'object' && !Array.isArray(structured)
        ? { ...structured, ...normalized }
        : normalized;
    normalized = finalizeChapterSummaryStructuredContent(merged, options.meta || {});
  }
  if (slug === 'worksheet-mcq-generator') {
    const merged =
      structured && typeof structured === 'object' && !Array.isArray(structured)
        ? { ...structured, ...normalized }
        : normalized;
    normalized = normalizeWorksheetStructuredContent(merged, content);
  }
  if (slug === 'activity-project-generator' || slug === 'project-idea-lab') {
    const merged =
      structured && typeof structured === 'object' && !Array.isArray(structured)
        ? { ...structured, ...normalized }
        : normalized;
    const meta =
      options.metadata && typeof options.metadata === 'object'
        ? /** @type {Record<string, unknown>} */ (options.metadata)
        : {};
    normalized = finalizeActivityStructuredContent(
      applySectionFallbacks(slug, normalizeActivityStructuredContent(merged, slug)),
      meta,
      slug,
    );
  }
  if (slug === 'lesson-planner' || slug === 'study-schedule-maker') {
    const merged =
      structured && typeof structured === 'object' && !Array.isArray(structured)
        ? { ...structured, ...normalized }
        : normalized;
    normalized = applySectionFallbacks(slug, normalizeLessonPlannerStructuredContent(merged, slug));
  }

  /** Worksheet section regrouping may move rows between C/D — keep raw sections[] for heading checks. */
  const headingData =
    slug === 'worksheet-mcq-generator' &&
    structured &&
    typeof structured === 'object' &&
    Array.isArray(structured.sections) &&
    structured.sections.length
      ? { ...normalized, sections: structured.sections }
      : normalized;

  const { complete, missing, optionalMissing } = getMissingCanonicalSections(slug, headingData, content);
  if (!complete) {
    return {
      valid: false,
      code: 'AI_TOOL_CONTENT_INCOMPLETE',
      message: `Content is incomplete for ${getAiToolTemplate(slug)?.title || slug}. Missing sections: ${missing.join(', ')}.`,
      missingSections: missing,
      optionalMissingSections: optionalMissing,
    };
  }

  const extra = extraStrictChecks(slug, headingData, content);
  if (!extra.valid) {
    return { valid: false, code: 'AI_TOOL_CONTENT_INCOMPLETE', message: extra.message };
  }

  return {
    valid: true,
    normalizedStructuredContent: normalized,
    contentType,
    optionalMissingSections: optionalMissing,
  };
}

/** @param {string} toolSlug @param {{ generatedContent?: string; content?: string; metadata?: unknown; toolName?: string }} doc */
export function validateDashboardAiToolDoc(toolSlug, doc) {
  const toolCheck = validateStoredRecordToolName(doc, toolSlug);
  if (!toolCheck.ok) {
    return {
      valid: false,
      code: DASHBOARD_WRONG_TOOL_CODE,
      message: toolCheck.message || DASHBOARD_WRONG_TOOL_USER_MESSAGE,
    };
  }

  const content = String(doc?.generatedContent || doc?.content || '').trim();
  const metadata =
    doc?.metadata && typeof doc.metadata === 'object' ? /** @type {Record<string, unknown>} */ (doc.metadata) : {};
  return validateDashboardAiToolContent(toolSlug, content, {
    metadata,
    trustStoredTool: toolCheck.ok && Boolean(String(doc?.toolName || '').trim()),
  });
}
