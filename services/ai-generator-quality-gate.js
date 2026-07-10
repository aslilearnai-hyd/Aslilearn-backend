import {
  validateAllCanonicalToolFields,
  hasFieldContent,
} from '../utils/ai-generator-section-pad.js';
import { isAiGeneratorSectionPadEnabled } from '../utils/ai-generator-batch-config.js';
import { extractContentUnits } from './ai-generator-content-extractor.js';
import { isStoryPassagePlaceholderText, validateStoryPassageLanguageCompliance, mustEnforceStoryPassageLanguageCompliance } from '../utils/story-passage-subject.js';
import { runPromptEngineQualityCheck } from '../prompts/quality-content-check.js';
import { isPromptEngineEnabled } from '../prompts/registry.js';
import { detectBannedPhrase } from '../prompts/shared/banned-phrases.js';

function flashcardBatchLooksSaveable(data, slug) {
  const minCards = slug === 'my-study-decks' ? 10 : 5;
  const title = String(data.flashcard_deck_title || data.deck_title || data.title || '').trim();
  const cards = Array.isArray(data.cards) ? data.cards : [];
  const valid = cards.filter((c) => {
    const front = String(c?.front || c?.task || c?.question || c?.term || '').trim();
    const back = String(c?.back || c?.solution || c?.answer || c?.definition || '').trim();
    if (front.length < 4 || back.length < 4) return false;
    if (/^What are the key ideas about .+\?$/i.test(front)) return false;
    if (/^Students should define the concept/i.test(back)) return false;
    if (/— key idea \d+$/i.test(front)) return false;
    return true;
  });
  return title.length >= 4 && valid.length >= minCards;
}

/** Patterns that indicate scaffold/placeholder content — must never be saved. */
const PLACEHOLDER_PATTERNS = [
  /\bfor\s+this\s+subtopic\b/i,
  /\bin\s+your\s+notebook\b/i,
  /\bsee\s+class\s+notes\b/i,
  /\bnot\s+included\s+in\s+this\s+generation\b/i,
  /\bplaceholder\b/i,
  /\bscaffold\b/i,
  /\btemplate\s+text\b/i,
  /\bstudents\s+explain\s+key\s+ideas\s+about\b/i,
  /\bstudents\s+recall\s+key\s+facts\s+about\b/i,
  /\ba\s+core\s+concept\s+from\b/i,
  /\bgeneric\s+scaffold\b/i,
  /\breview\s+class\s+notes\s+on\b/i,
  /\banswer\s+all\s+questions\s+on\b/i,
  /\bwhiteboard,\s*chart\s+paper,\s*subject\s+textbook\b/i,
  /\binteractive\s+teaching\s+using\s+discussion,\s+demonstration\b/i,
  /\bwhich\s+statement\s+about\b.*\bis\s+most\s+accurate\?\s*$/i,
  /\bcomplete:\s*a\s+key\s+idea\s+in\b.*is\s+_____/i,
  /\bdefine\s+one\s+important\s+term\s+related\s+to\b/i,
  /\bexplain\s+how\b.*\bapplies\s+in\s+daily\s+life\b/i,
  /\bhow\s+would\s+you\s+use\s+ideas\s+from\b.*\bto\s+solve\s+a\s+problem\b/i,
  /\bsection\s+[a-e]\s+for\b.*\(\s*subject\s*\)/i,
  /\blabel\s+for\b.*\bin\s+subject\b/i,
  /build questions directly from these passages/i,
  /it matches the textbook explanation/i,
  /book:\s*.+subject:\s*.+class:/i,
  /according to the chapter on .+, which choice reflects/i,
];

const MIN_SECTION_TEXT_LEN = 12;
const MIN_QUESTION_LEN = 10;

function isPlaceholderText(text) {
  const t = String(text || '').trim();
  if (!t || t.length < MIN_SECTION_TEXT_LEN) return true;
  if (isStoryPassagePlaceholderText(t)) return true;
  if (isPromptEngineEnabled() && detectBannedPhrase(t).banned) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

/**
 * Phrases that only ever appear in programmatic scaffold/filler questions or
 * answers — never in real, chapter-specific Gemini output. Matched against the
 * combined question + options + answer text of each row, so they stay reliable
 * even after display sanitization strips "Set N:" / "(variant N)" prefixes.
 */
const SCAFFOLD_QUESTION_PATTERNS = [
  // Worksheet generic MCQ options (buildTopicGroundedWorksheetQuestion)
  /a claim supported by evidence from the lesson/i,
  /a guess without checking/i,
  /an opinion with no example/i,
  /observation and reasoning support the claim/i,
  /the idea matches textbook\/class explanation/i,
  /data or examples back the statement/i,
  /unrelated everyday hearsay/i,
  /a reversed cause-effect claim/i,
  /ignores the lesson concept/i,
  /contradicts class notes/i,
  // Worksheet generic stems / answers
  /which choice about .+ fits a lesson focused on/i,
  /which .+ idea about .+ is best supported/i,
  /one measurable feature of .+ is _{2,}/i,
  /expected term or phrase about/i,
  /short accurate point about .+\(set \d+\)/i,
  /clear explanation linking .+\(variant \d+\)/i,
  /structured response with steps, evidence, and conclusion/i,
  // Practice Q&A generic (isGenericPracticeQaScaffoldQuestion)
  /claim without evidence/i,
  /personal opinion only/i,
  /statement supported by observation/i,
  /precise term or process from/i,
  /students cite a brief evidence-based observation/i,
  /pick the claim that fits/i,
  /students justify their choice using concepts/i,
  /students compare reasoning and evidence/i,
  /during .+, one key term students must recall/i,
  // Flashcard scaffold pairs
  /students should define the concept, give one example/i,
  /^what are the key ideas about .+\?$/i,
  /— key idea \d+$/i,
  // Exam / Mock-test scaffold (buildScaffoldExamQuestions) — the _scaffold flag is
  // dropped when buckets become the final `sections` shape, so match the text too.
  /systematic observation and evidence/i,
  /belief without evidence/i,
  /unquestioned tradition/i,
  /superstition only/i,
  /a concise definition using evidence about/i,
  /(?:students give|give) a reasoned example connected to/i,
  /a step-by-step explanation with observation, hypothesis, and evidence/i,
  /answers use evidence from the scenario and concepts from/i,
  /identify the correct idea related to/i,
  /choose the best description of/i,
  /which option correctly applies/i,
  /name and define a core concept in/i,
  /state one essential fact about/i,
  /define a key term linked to/i,
  /give a reasoned example using/i,
  /describe a real-world use of/i,
  /describe the process of scientific inquiry for/i,
  /analyse the main principles of .+ with steps/i,
  /discuss evidence-based reasoning for/i,
  /explain how .+ applies in daily life/i,
  /^case study on .+: read the scenario/i,
  /^applied problem on .+ with data/i,
  /^competency task on .+: interpret/i,
  // Secondary worksheet filler builder
  /a claim supported by observation and reasoning/i,
  /a tradition that cannot be tested/i,
  /an opinion with no examples?/i,
  /a core concept from .+ explained in class/i,
  /^complete: a key idea in .+ is _{2,}/i,
  // Practice Q&A last-resort fallback builder (buildPracticeQaFallbackQuestion)
  /a definition or fact taught in the/i,
  /a guess without textbook support/i,
  /correct ncert term for/i,
  /accurate one-line definition from the/i,
  /concept from .+ applied to the situation with reasoning/i,
  /evaluates both statements using evidence from/i,
  // Scenario-framing wrappers (precision mode)
  /\b(?:imagine|during a|set the scene|role-play|in pairs, discuss|in your community)\b/i,
  /\b(?:design a poster|school (?:science )?fair|market visit|festival preparation)\b/i,
  /\b(?:speaking situation|observe a real conversation)\b/i,
  /\bsummarise the main message\b/i,
  /follow textbook terminology, definitions, examples, formulae/i,
  /pick the best option linking "follow textbook/i,
];

/** Above this fraction of scaffold questions, a batch must not be saved. */
const SCAFFOLD_SAVE_CEILING = (() => {
  const raw = Number(process.env.AI_GENERATOR_SCAFFOLD_CEILING);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.4;
})();

function rowScaffoldText(row) {
  if (typeof row === 'string') return row;
  if (!row || typeof row !== 'object') return '';
  return [
    row.question,
    row.prompt,
    row.text,
    row.front,
    row.back,
    row.answer,
    row.definition,
    row.explanation,
    ...(Array.isArray(row.options) ? row.options : []),
  ]
    .filter(Boolean)
    .join(' \n ');
}

function collectScaffoldRows(data) {
  const rows = [];
  const pushPool = (pool) => {
    if (Array.isArray(pool)) for (const r of pool) rows.push(r);
  };
  pushPool(data.questions);
  pushPool(data.practice_questions);
  pushPool(data.concept_based_questions);
  pushPool(data.formative_assessment_questions);
  pushPool(data.cards);
  pushPool(data.application_hots_cards);
  for (const k of [
    'section_a',
    'section_a_mcqs',
    'section_b',
    'section_b_fib',
    'section_c',
    'section_c_vsa',
    'section_d',
    'section_d_sa',
    'section_e',
    'section_e_competency',
  ]) {
    pushPool(data[k]);
  }
  for (const sec of Array.isArray(data.sections) ? data.sections : []) {
    pushPool(sec?.questions);
  }
  return rows;
}

/** True when a question/card row is programmatic scaffold rather than real content. */
function isScaffoldRow(row) {
  if (row && typeof row === 'object' && row._scaffold === true) return true;
  const text = rowScaffoldText(row).trim();
  if (!text) return true;
  return SCAFFOLD_QUESTION_PATTERNS.some((re) => re.test(text));
}

/**
 * Fraction of question/flashcard rows that are programmatic scaffold/filler.
 * Tool-agnostic — returns all-zero for tools that carry no question pools.
 * @returns {{ total: number, scaffold: number, density: number }}
 */
export function computeScaffoldDensity(toolSlug, structured) {
  const data =
    structured && typeof structured === 'object' && !Array.isArray(structured) ? structured : {};
  const rows = collectScaffoldRows(data);
  if (!rows.length) return { total: 0, scaffold: 0, density: 0 };
  let scaffold = 0;
  for (const row of rows) if (isScaffoldRow(row)) scaffold += 1;
  return { total: rows.length, scaffold, density: scaffold / rows.length };
}

export const SCAFFOLD_DENSITY_CEILING = SCAFFOLD_SAVE_CEILING;

function walkValues(obj, out = [], parentKey = '') {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    out.push({ key: parentKey, text: obj });
    return out;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) walkValues(x, out, parentKey);
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) walkValues(v, out, k);
  }
  return out;
}

/** Teacher boilerplate fields — not scanned for scaffold patterns on strict Premium. */
const BOILERPLATE_META_KEYS = new Set([
  'instructions',
  'blueprint',
  'internal_choices',
  'internal_choice',
  'marking_scheme',
  'open_ended_rubric',
  'general_instructions',
  'homework_instructions',
  'test_purpose',
  'answer_key',
]);

function hasScaffoldQuestionRows(data) {
  if (!data || typeof data !== 'object') return false;
  const pools = [
    data.questions,
    data.section_a,
    data.section_b,
    data.section_c,
    data.section_d,
    data.section_e,
  ];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const row of pool) {
      if (row && typeof row === 'object' && row._scaffold === true) return true;
    }
  }
  if (Array.isArray(data.sections)) {
    for (const sec of data.sections) {
      for (const row of Array.isArray(sec?.questions) ? sec.questions : []) {
        if (row && typeof row === 'object' && row._scaffold === true) return true;
      }
    }
  }
  return false;
}

function worksheetHasMinimumBookQuestions(data = {}) {
  let count = 0;
  for (const sec of Array.isArray(data.sections) ? data.sections : []) {
    count += Array.isArray(sec?.questions) ? sec.questions.length : 0;
  }
  if (Array.isArray(data.questions)) count = Math.max(count, data.questions.length);
  return count >= 3 || Boolean(data.bookGroundedFallback) || Boolean(data.topicGroundedFallback);
}

/**
 * Production quality gate — rejects incomplete, placeholder, or scaffold content.
 * @returns {{ valid: boolean, errors: string[], missingSections: string[] }}
 */
export function runAiGeneratorQualityGate(toolSlug, structured, meta = {}) {
  const errors = [];
  const slug = String(toolSlug || '').trim();
  const data =
    structured && typeof structured === 'object' && !Array.isArray(structured) ? structured : {};

  const batchFlashcardRelaxed =
    Boolean(meta.batchOrchestrator) &&
    (slug === 'flashcard-generator' || slug === 'my-study-decks');
  const flashcardBatchSaveable =
    batchFlashcardRelaxed && flashcardBatchLooksSaveable(data, slug);
  const batchPracticeQaRelaxed =
    slug === 'smart-qa-practice-generator' &&
    Boolean(meta.bookGenerator || meta.batchOrchestrator);

  const fieldCheck = validateAllCanonicalToolFields(slug, data);
  if (!fieldCheck.valid && !flashcardBatchSaveable && !batchPracticeQaRelaxed) {
    errors.push(`Missing sections: ${fieldCheck.missingSections.join('; ')}`);
  }

  for (const detail of fieldCheck.missingDetails || []) {
    if (detail.order === 999 && !flashcardBatchSaveable && !batchPracticeQaRelaxed) errors.push(detail.label);
  }

  const sectionPadActive = isAiGeneratorSectionPadEnabled() && meta.strictValidation !== true;
  const batchWorksheetRelaxed =
    slug === 'worksheet-mcq-generator' &&
    Boolean(
      meta.bookGenerator ||
        meta.batchOrchestrator ||
        meta.bookGroundedFallback ||
        meta.topicGroundedFallback ||
        data.bookGroundedFallback ||
        data.topicGroundedFallback,
    );
  // Book RAG / batch tools: after programmatic repair, do not reject heading-echo scaffold checks.
  const bookBatchRelaxed =
    Boolean(meta.bookGenerator || data.bookGroundedFallback) &&
    (batchWorksheetRelaxed ||
      [
        'activity-project-generator',
        'project-idea-lab',
        'homework-creator',
        'lesson-planner',
        'daily-class-plan-maker',
        'concept-mastery-helper',
        'concept-breakdown-explainer',
        'chapter-summary-creator',
        'smart-study-guide-generator',
        'flashcard-generator',
        'my-study-decks',
        'quick-assignment-builder',
        'smart-qa-practice-generator',
        'story-passage-creator',
        'reading-practice-room',
        'key-points-formula-extractor',
        'short-notes-summaries-maker',
        'study-schedule-maker',
        'exam-question-paper-generator',
        'mock-test-builder',
      ].includes(slug));

  const title = String(
    data.title ||
      data.flashcard_deck_title ||
      data.deck_title ||
      data.worksheet_title ||
      data.lesson_name ||
      data.mock_test_title ||
      data.paper_title ||
      '',
  ).trim();
  if (!title || title.length < 4) errors.push('Title is missing or too short.');
  // Section-pad fills gaps with topic fallbacks; do not reject padded titles as placeholders.
  if (!sectionPadActive && !batchFlashcardRelaxed && !batchPracticeQaRelaxed && isPlaceholderText(title)) {
    errors.push('Title appears to be placeholder/scaffold text.');
  }

  // Section-pad / book-grounded fallbacks may use template phrasing — do not reject that output.
  const skipPlaceholderWalk =
    sectionPadActive || batchWorksheetRelaxed || batchPracticeQaRelaxed || bookBatchRelaxed || batchFlashcardRelaxed;
  if (!skipPlaceholderWalk) {
    for (const { key, text } of walkValues(data)) {
      if (BOILERPLATE_META_KEYS.has(key)) continue;
      if (typeof text !== 'string' || text.length < 20) continue;
      if (isPlaceholderText(text)) {
        errors.push(`Placeholder/scaffold detected: "${text.slice(0, 80)}..."`);
        break;
      }
    }
  }

  const units = extractContentUnits(slug, data);
  const questions = units.filter((u) => u.contentType === 'question' || u.contentType === 'flashcard');
  if (
    [
      'worksheet-mcq-generator',
      'homework-creator',
      'mock-test-builder',
      'exam-question-paper-generator',
      'smart-qa-practice-generator',
      'quick-assignment-builder',
    ].includes(slug) &&
    questions.length < 3 &&
    !batchPracticeQaRelaxed
  ) {
    errors.push(`Insufficient unique questions (${questions.length}, need at least 3).`);
  }

  for (const q of questions) {
    if (String(q.text || '').trim().length < MIN_QUESTION_LEN) {
      errors.push('Question text too short.');
      break;
    }
    if (
      !sectionPadActive &&
      !batchWorksheetRelaxed &&
      !batchPracticeQaRelaxed &&
      !batchFlashcardRelaxed &&
      isPlaceholderText(q.text)
    ) {
      errors.push(`Placeholder question: "${String(q.text).slice(0, 60)}..."`);
      break;
    }
  }

  if (slug === 'worksheet-mcq-generator' && !sectionPadActive) {
    const target = Number(meta.questionCount ?? meta.numberOfQuestions);
    const sectionRows = Array.isArray(data.sections) ? data.sections : [];
    const stems = new Set();
    let duplicateStems = 0;
    let actualCount = 0;
    for (const sec of sectionRows) {
      for (const row of Array.isArray(sec?.questions) ? sec.questions : []) {
        const stem = String(row?.question || row?.prompt || row?.text || '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim();
        if (!stem) continue;
        actualCount += 1;
        if (stems.has(stem)) duplicateStems += 1;
        else stems.add(stem);
      }
    }
    if (duplicateStems > 0) {
      errors.push(`Duplicate question stems in worksheet (${duplicateStems} duplicate(s)).`);
    }
  }

  const objectives = units.filter((u) => u.contentType === 'objective');
  if (objectives.length === 0 && hasFieldContent(data.learning_objectives || data.objectives) === false) {
    if (['lesson-planner', 'worksheet-mcq-generator', 'homework-creator'].includes(slug)) {
      errors.push('Learning objectives are missing.');
    }
  }

  for (const o of objectives) {
    if (!sectionPadActive && !batchWorksheetRelaxed && !bookBatchRelaxed && isPlaceholderText(o.text)) {
      errors.push(`Placeholder objective: "${String(o.text).slice(0, 60)}..."`);
      break;
    }
  }

  if (['reading-practice-room', 'story-passage-creator'].includes(slug)) {
    const passage = String(data.passage || data.content || data.story_passage_content || '').trim();
    if (passage.length < 80 || isStoryPassagePlaceholderText(passage)) {
      errors.push('Passage/story must be a full reading text (120+ words), not a section label.');
    }
    for (const key of [
      'read_and_recall_questions',
      'think_and_infer_questions',
      'apply_and_connect_questions',
    ]) {
      const rows = Array.isArray(data[key]) ? data[key] : [];
      const real = rows.filter((q) => {
        const text = typeof q === 'string' ? q : String(q?.question || q?.text || q?.prompt || '');
        return !isStoryPassagePlaceholderText(text) && text.trim().length >= MIN_QUESTION_LEN;
      });
      if (real.length < 2) {
        errors.push(`${key} need at least 2 real questions (not section labels).`);
        break;
      }
    }
  }

  if (mustEnforceStoryPassageLanguageCompliance(meta.subject || data.subject)) {
    const languageCheck = validateStoryPassageLanguageCompliance(meta.subject || data.subject, data, {
      requirePassage: ['reading-practice-room', 'story-passage-creator'].includes(slug),
      toolSlug: slug,
    });
    if (!languageCheck.valid) {
      errors.push(...languageCheck.errors);
    }
  }

  if (meta.strictValidation === true && hasScaffoldQuestionRows(data) && !meta.bookGenerator) {
    errors.push('Scaffold filler questions detected — Premium requires fully generated content.');
  }

  if (
    ['exam-question-paper-generator', 'mock-test-builder'].includes(slug) &&
    hasScaffoldQuestionRows(data)
  ) {
    errors.push(
      'Template/scaffold exam questions detected — regenerate with real chapter-specific content.',
    );
  }

  // Scaffold density: block single-record Premium saves; batch/book paths warn in orchestrator and still save.
  const scaffoldStats = computeScaffoldDensity(slug, data);
  const allowScaffoldBatchSave = Boolean(meta.bookGenerator || meta.batchOrchestrator);
  if (
    !allowScaffoldBatchSave &&
    scaffoldStats.total >= 3 &&
    scaffoldStats.density > SCAFFOLD_SAVE_CEILING
  ) {
    errors.push(
      `Scaffold-heavy content (${Math.round(scaffoldStats.density * 100)}% of ${scaffoldStats.total} questions are filler; ceiling ${Math.round(SCAFFOLD_SAVE_CEILING * 100)}%).`,
    );
  }

  if (isPromptEngineEnabled() && !bookBatchRelaxed && !batchWorksheetRelaxed && !flashcardBatchSaveable && meta.qualityTier !== 'fast' && meta.strictValidation === true) {
    const promptQuality = runPromptEngineQualityCheck(slug, data);
    if (!promptQuality.valid) {
      errors.push(...promptQuality.errors);
    }
  }

  if (
    batchFlashcardRelaxed &&
    flashcardBatchSaveable &&
    errors.length > 0
  ) {
    const blocking = errors.filter(
      (e) =>
        !/^Missing sections:/i.test(e) &&
        !/^Placeholder/i.test(e) &&
        !/^Title appears to be placeholder/i.test(e),
    );
    if (!blocking.length) {
      return {
        valid: true,
        errors: [],
        missingSections: fieldCheck.missingSections || [],
      };
    }
  }

  if (
    (meta.bookGenerator || meta.batchOrchestrator) &&
    slug === 'worksheet-mcq-generator' &&
    batchWorksheetRelaxed &&
    errors.length > 0 &&
    worksheetHasMinimumBookQuestions(data)
  ) {
    const blocking = errors.filter(
      (e) =>
        !/^Missing sections:/i.test(e) &&
        !/^Learning objectives are missing/i.test(e) &&
        !/^Placeholder/i.test(e) &&
        !/^Scaffold filler/i.test(e),
    );
    if (!blocking.length) {
      return {
        valid: true,
        errors: [],
        missingSections: fieldCheck.missingSections || [],
      };
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingSections: fieldCheck.missingSections || [],
  };
}

export { isPlaceholderText, PLACEHOLDER_PATTERNS };
