import {
  validateAllCanonicalToolFields,
  hasFieldContent,
} from '../utils/ai-generator-section-pad.js';
import { isAiGeneratorSectionPadEnabled } from '../utils/ai-generator-batch-config.js';
import { extractContentUnits } from './ai-generator-content-extractor.js';
import { isStoryPassagePlaceholderText, validateStoryPassageLanguageCompliance } from '../utils/story-passage-subject.js';

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
];

const MIN_SECTION_TEXT_LEN = 12;
const MIN_QUESTION_LEN = 10;

function isPlaceholderText(text) {
  const t = String(text || '').trim();
  if (!t || t.length < MIN_SECTION_TEXT_LEN) return true;
  if (isStoryPassagePlaceholderText(t)) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

function walkValues(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    out.push(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) walkValues(x, out);
    return out;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) walkValues(v, out);
  }
  return out;
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

  const fieldCheck = validateAllCanonicalToolFields(slug, data);
  if (!fieldCheck.valid) {
    errors.push(`Missing sections: ${fieldCheck.missingSections.join('; ')}`);
  }

  for (const detail of fieldCheck.missingDetails || []) {
    if (detail.order === 999) errors.push(detail.label);
  }

  const sectionPadActive = isAiGeneratorSectionPadEnabled();

  const title = String(
    data.title ||
      data.worksheet_title ||
      data.lesson_name ||
      data.mock_test_title ||
      data.paper_title ||
      '',
  ).trim();
  if (!title || title.length < 4) errors.push('Title is missing or too short.');
  // Section-pad fills gaps with topic fallbacks; do not reject padded titles as placeholders.
  if (!sectionPadActive && isPlaceholderText(title)) {
    errors.push('Title appears to be placeholder/scaffold text.');
  }

  // Section-pad fills gaps with topic fallbacks; a full-text placeholder scan rejects that output.
  const skipPlaceholderWalk = sectionPadActive;
  if (!skipPlaceholderWalk) {
    for (const text of walkValues(data)) {
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
    questions.length < 3
  ) {
    errors.push(`Insufficient unique questions (${questions.length}, need at least 3).`);
  }

  for (const q of questions) {
    if (String(q.text || '').trim().length < MIN_QUESTION_LEN) {
      errors.push('Question text too short.');
      break;
    }
    if (!sectionPadActive && isPlaceholderText(q.text)) {
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
    if (!sectionPadActive && isPlaceholderText(o.text)) {
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

    const languageCheck = validateStoryPassageLanguageCompliance(meta.subject || data.subject, data);
    if (!languageCheck.valid) {
      errors.push(...languageCheck.errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingSections: fieldCheck.missingSections || [],
  };
}

export { isPlaceholderText, PLACEHOLDER_PATTERNS };
