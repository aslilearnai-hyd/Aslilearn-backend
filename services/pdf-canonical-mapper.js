/**
 * Map canonical PDF JSON → AI tool bulk items (then canonicalize* in pdf-rag).
 * @module services/pdf-canonical-mapper
 */

import { extractToolItemsFromPdfText } from './pdf-tool-extract.js';
import {
  activityPatternExtractIsComplete,
  scoreActivityExtractRow,
} from './pdf-activity-extract.js';
import { consolidateWorksheetExtractItems } from './pdf-worksheet-extract.js';
import { str } from './pdf-extract-utils.js';

const ACTIVITY_TOOL_SLUGS = new Set(['activity-project-generator', 'project-idea-lab']);

function filterActivityToolItems(toolSlug, items = []) {
  if (!ACTIVITY_TOOL_SLUGS.has(toolSlug)) return items;
  const rows = Array.isArray(items) ? items : [];
  const rich = rows.filter((row) => scoreActivityExtractRow(row) >= 6);
  if (rich.length) return rich;
  return [];
}

function questionsFromCanonical(canonical) {
  return Array.isArray(canonical?.questions) ? canonical.questions : [];
}

function sectionsFromCanonical(canonical) {
  return Array.isArray(canonical?.sections) ? canonical.sections : [];
}

function mapQuestionsToHomework(canonical, params = {}) {
  const questions = questionsFromCanonical(canonical);
  if (!questions.length) return [];
  return [
    {
      title: str(canonical.title) || str(params.topic) || 'Homework',
      instructions: str(canonical.instructions),
      learning_objectives: canonical.learningObjectives || [],
      practice_questions: questions.map((q) => ({
        question: q.question,
        options: q.options || [],
        answer: q.answer || '',
      })),
      answer_hints: str(canonical.answerKey),
      _fromPdf: true,
    },
  ];
}

function mapQuestionsToWorksheet(canonical, params = {}) {
  const questions = questionsFromCanonical(canonical).map((q) => ({ ...q, _fromPdf: true }));
  if (!questions.length) return [];
  return [
    {
      title: str(canonical.title) || str(params.topic) || 'Worksheet',
      worksheet_title: str(canonical.title) || str(params.topic) || 'Worksheet',
      instructions: str(canonical.instructions),
      learning_objectives: canonical.learningObjectives || [],
      answer_key: str(canonical.answerKey),
      sections: sectionsFromCanonical(canonical),
      questions,
      _fromPdf: true,
    },
  ];
}

function mapQuestionsToExamPaper(canonical, params = {}, toolSlug = 'exam-question-paper-generator') {
  const sections = sectionsFromCanonical(canonical);
  if (!sections.length && !questionsFromCanonical(canonical).length) return [];
  const title = str(canonical.title) || str(params.topic) || 'Exam Paper';
  return [
    {
      paper_title: title,
      title,
      instructions: str(canonical.instructions),
      sections: sections.length
        ? sections
        : [{ sectionName: 'Questions', questions: questionsFromCanonical(canonical) }],
      answer_key: str(canonical.answerKey),
      _fromPdf: true,
      toolSlug,
    },
  ];
}

function mapQuestionsToPracticeQa(canonical, params = {}) {
  const sections = sectionsFromCanonical(canonical);
  const questions = questionsFromCanonical(canonical);
  if (!sections.length && !questions.length) return [];
  return [
    {
      title: str(canonical.title) || str(params.topic) || 'Practice Q&A',
      instructions: str(canonical.instructions),
      learning_objectives: canonical.learningObjectives || [],
      sections: sections.length ? sections : [{ sectionName: 'Practice Questions', questions }],
      questions,
      answer_key: str(canonical.answerKey),
      _fromPdf: true,
    },
  ];
}

function mapQuestionsToFlashcards(canonical) {
  const questions = questionsFromCanonical(canonical).filter(
    (q) => str(q.question) && (str(q.answer) || (q.options || []).length >= 2),
  );
  if (!questions.length) return [];
  return questions.map((q, i) => {
    const opts = q.options || [];
    const back =
      str(q.answer) ||
      (opts.length >= 2 ? opts.join(' | ') : '');
    return {
      sl_no: i + 1,
      front: q.question,
      back,
      deck_title: str(canonical.title) || 'Study Deck',
      _fromPdf: true,
    };
  });
}

function mapQuestionsToQuickAssignment(canonical, params = {}) {
  const questions = questionsFromCanonical(canonical);
  if (!questions.length) return [];
  return [
    {
      assignment_title: str(canonical.title) || str(params.topic) || 'Assignment',
      title: str(canonical.title) || str(params.topic) || 'Assignment',
      learning_objectives: canonical.learningObjectives || [],
      instructions: str(canonical.instructions),
      concept_based_questions: questions.map((q) => ({
        question: q.question,
        options: q.options || [],
        answer: q.answer || '',
      })),
      answer_key: str(canonical.answerKey),
      _fromPdf: true,
    },
  ];
}

function mapBlocksToShortNotes(canonical) {
  const blocks = Array.isArray(canonical?.contentBlocks) ? canonical.contentBlocks : [];
  if (!blocks.length) return [];
  return blocks.slice(0, 50).map((block, i) => ({
    sl_no: i + 1,
    title: str(block.heading) || str(canonical.title) || `Notes ${i + 1}`,
    concept_name: str(block.heading) || str(canonical.title) || `Notes ${i + 1}`,
    short_note_summary: str(block.text),
    key_points_to_remember: block.lines
      .filter((l) => /^[-•*]\s+/.test(l))
      .map((l) => l.replace(/^[-•*]\s+/, '')),
    _fromPdf: true,
  }));
}

function mapCanonicalQuestionsToTool(toolSlug, canonical, params = {}) {
  switch (toolSlug) {
    case 'worksheet-mcq-generator':
      return mapQuestionsToWorksheet(canonical, params);
    case 'homework-creator':
      return mapQuestionsToHomework(canonical, params);
    case 'mock-test-builder':
      return mapQuestionsToExamPaper(canonical, params, toolSlug);
    case 'exam-question-paper-generator':
      return mapQuestionsToExamPaper(canonical, params, toolSlug);
    case 'smart-qa-practice-generator':
      return mapQuestionsToPracticeQa(canonical, params);
    case 'my-study-decks':
    case 'flashcard-generator':
      return mapQuestionsToFlashcards(canonical);
    case 'quick-assignment-builder':
      return mapQuestionsToQuickAssignment(canonical, params);
    case 'short-notes-summaries-maker':
    case 'chapter-summary-creator':
    case 'key-points-formula-extractor':
      return mapBlocksToShortNotes(canonical);
    default:
      return [];
  }
}

/**
 * @param {string} toolSlug
 * @param {Record<string, unknown>} canonical
 * @param {string} sourceText
 * @param {Record<string, unknown>} [params]
 */
export function mapCanonicalPdfToToolBulkItems(toolSlug, canonical, sourceText, params = {}) {
  const slug = str(toolSlug);
  const text = String(sourceText || '').trim();

  if (!params.skipToolRegex) {
    const toolItems = extractToolItemsFromPdfText(slug, text, { limit: 200, ...params });
    const activityFiltered = filterActivityToolItems(slug, toolItems);
    const usableToolItems = ACTIVITY_TOOL_SLUGS.has(slug) ? activityFiltered : toolItems;
    if (Array.isArray(usableToolItems) && usableToolItems.length > 0) {
    if (
      ACTIVITY_TOOL_SLUGS.has(slug) &&
      !activityPatternExtractIsComplete(usableToolItems, usableToolItems.length)
    ) {
      return { items: [], parser: 'none', canonical };
    }
      return {
        items: usableToolItems.map((item) => ({ ...item, _fromPdf: true })),
        parser: 'tool-regex',
        canonical,
      };
    }
  }

  const fromQuestions = mapCanonicalQuestionsToTool(slug, canonical, params);
  if (fromQuestions.length > 0) {
    return { items: fromQuestions, parser: 'canonical-json', canonical };
  }

  const fromBlocks = mapBlocksToShortNotes(canonical);
  if (fromBlocks.length > 0 && /notes|summary|key-points|chapter-summary/i.test(slug)) {
    return { items: fromBlocks, parser: 'canonical-blocks', canonical };
  }

  return { items: [], parser: 'none', canonical };
}

/**
 * Worksheet → one consolidated row; other tools pass through.
 * @param {string} toolSlug
 * @param {unknown[]} items
 * @param {string} sourceText
 * @param {Record<string, unknown>} params
 */
export function postProcessCanonicalBulkItems(toolSlug, items, sourceText, params = {}) {
  const slug = str(toolSlug);
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return [];

  if (slug === 'worksheet-mcq-generator') {
    return consolidateWorksheetExtractItems(list, {
      ...params,
      rawPdfText: sourceText,
      forceSingleDocument: true,
    }).slice(0, 1);
  }

  if (
    slug === 'mock-test-builder' ||
    slug === 'exam-question-paper-generator' ||
    slug === 'smart-qa-practice-generator' ||
    slug === 'homework-creator' ||
    slug === 'quick-assignment-builder'
  ) {
    return list.slice(0, 1);
  }

  return list;
}
