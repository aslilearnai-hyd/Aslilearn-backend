/**
 * Project stored educational knowledge base → any AI tool format (zero LLM).
 * @module services/knowledge-projector
 */

import { str } from './pdf-extract-utils.js';
import { knowledgeBaseToCanonical } from './knowledge-base-canonical.js';
import { mapCanonicalPdfToToolBulkItems, postProcessCanonicalBulkItems } from './pdf-canonical-mapper.js';
import { canonicalizeBulkItems, buildToolRenderContent } from './tool-formatters/index.js';

const strList = (v) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

function titleFromKb(kb, params = {}) {
  return str(kb.title || kb.chapter || params.subtopic || params.topic || 'Content');
}

function groupQuestionsBySection(questions = []) {
  const map = new Map();
  for (const q of questions) {
    const sec = str(q.section) || 'Questions';
    if (!map.has(sec)) map.set(sec, []);
    map.get(sec).push(q);
  }
  return Array.from(map.entries()).map(([sectionName, qs]) => ({
    sectionName,
    questions: qs.map((q) => ({
      question: str(q.question),
      options: q.options || [],
      answer: str(q.answer),
      marks: q.marks,
      question_number: q.question_number,
    })),
  }));
}

/** Tool-specific projection from knowledge base (no PDF regex). */
function projectToolFromKnowledgeBase(toolSlug, kb, params = {}) {
  const slug = str(toolSlug);
  const t = titleFromKb(kb, params);
  const objectives = strList(kb.learningObjectives);
  const questions = Array.isArray(kb.questions) ? kb.questions : [];

  switch (slug) {
    case 'quick-assignment-builder':
      return [
        {
          assignment_title: t,
          title: t,
          learning_objectives: objectives,
          instructions: str(kb.instructions) || 'Complete all sections using the concepts from this chapter.',
          concept_based_questions: questions.slice(0, 12).map((q) => ({
            question: str(q.question),
            options: q.options || [],
            answer: str(q.answer),
            marks: q.marks,
            question_number: q.question_number,
          })),
          application_oriented_tasks: (kb.applications || []).map(
            (a) => `${str(a.title)}: ${str(a.scenario)}`.trim(),
          ),
          real_life_competency_activity: (kb.applications || [])
            .slice(0, 3)
            .map((a) => `${str(a.title)} — ${str(a.explanation || a.scenario)}`)
            .join('\n'),
          creative_thinking_question: (kb.examples || [])
            .slice(0, 2)
            .map((e) => `Create a new problem similar to: ${str(e.problem || e.title)}`)
            .join('\n'),
          collaborative_discussion_task: (kb.misconceptions || [])
            .slice(0, 2)
            .map((m) => `Discuss: ${str(m.misconception)} → ${str(m.correction)}`)
            .join('\n'),
          challenge_question_advanced: questions
            .filter((q) => /challenge|advanced|prove|explain/i.test(str(q.question)))
            .slice(0, 5)
            .map((q) => str(q.question))
            .join('\n'),
          assessment_criteria_rubric: 'Concept accuracy, reasoning, application, presentation — 4 marks each.',
          expected_learning_outcomes: objectives,
        },
      ];

    case 'worksheet-mcq-generator':
      return [
        {
          title: t,
          worksheet_title: t,
          instructions: str(kb.instructions),
          learning_objectives: objectives,
          sections: groupQuestionsBySection(questions),
          questions: questions.map((q) => ({ ...q, _fromKnowledgeBase: true })),
        },
      ];

    case 'flashcard-generator':
    case 'my-study-decks':
      return (kb.definitions || [])
        .concat(
          (kb.concepts || []).map((c) => ({
            term: str(c.name),
            definition: str(c.description),
          })),
        )
        .filter((c) => str(c.term || c.name) && str(c.definition))
        .slice(0, 80)
        .map((c, i) => ({
          sl_no: i + 1,
          front: str(c.term || c.name),
          back: str(c.definition),
          deck_title: t,
        }));

    case 'concept-mastery-helper':
      return (kb.concepts || []).slice(0, 30).map((c, i) => ({
        sl_no: i + 1,
        concept_name: str(c.name),
        title: str(c.name),
        concept_explanation: str(c.description),
        importance: str(c.importance),
        examples: strList(c.examples),
        learning_objectives: objectives,
      }));

    case 'concept-breakdown-explainer':
      return (kb.concepts || []).slice(0, 20).map((c, i) => ({
        sl_no: i + 1,
        concept_title: str(c.name),
        title: str(c.name),
        simple_explanation: str(c.description),
        key_points: strList(c.examples),
        common_misconceptions: (kb.misconceptions || [])
          .slice(0, 2)
          .map((m) => str(m.misconception)),
        real_life_applications: (kb.applications || [])
          .slice(0, 2)
          .map((a) => str(a.scenario)),
      }));

    case 'activity-project-generator':
    case 'project-idea-lab':
      return (kb.activities || []).slice(0, 20).map((a, i) => ({
        sl_no: i + 1,
        title: str(a.title),
        learning_objectives: objectives,
        step_by_step_procedure: strList(a.steps),
        materials_required: strList(a.materials),
        expected_learning_outcomes: strList(a.learning_outcomes),
        description: str(a.description),
      }));

    case 'short-notes-summaries-maker':
      return [
        {
          title: t,
          concept_name: t,
          short_note_summary: str(kb.summary) || objectives.join(' '),
          key_points_to_remember: [
            ...objectives,
            ...(kb.definitions || []).map((d) => `${str(d.term)}: ${str(d.definition)}`),
          ].slice(0, 20),
          formulas: (kb.formulas || []).map((f) => `${str(f.name)} = ${str(f.expression)}`),
        },
      ];

    case 'chapter-summary-creator':
      return [
        {
          title: t,
          chapter_title: str(kb.chapter || t),
          chapter_summary: str(kb.summary),
          key_concepts: (kb.concepts || []).map((c) => str(c.name)).filter(Boolean),
          learning_objectives: objectives,
          important_definitions: (kb.definitions || []).map((d) => ({
            term: str(d.term),
            definition: str(d.definition),
          })),
        },
      ];

    case 'key-points-formula-extractor':
      return [
        {
          title: t,
          concept_name: t,
          key_points_to_remember: [
            ...objectives,
            ...(kb.concepts || []).map((c) => str(c.name)),
          ],
          important_formulas: (kb.formulas || []).map((f) => ({
            name: str(f.name),
            formula: str(f.expression),
            explanation: str(f.explanation),
          })),
          definitions: kb.definitions || [],
        },
      ];

    case 'smart-study-guide-generator':
      return [
        {
          title: t,
          study_guide_title: t,
          chapter_overview: str(kb.summary),
          learning_objectives: objectives,
          core_concepts: kb.concepts || [],
          key_formulas: kb.formulas || [],
          practice_questions: questions.slice(0, 15),
          common_mistakes: (kb.misconceptions || []).map((m) => str(m.misconception)),
        },
      ];

    case 'homework-creator':
    case 'mock-test-builder':
    case 'exam-question-paper-generator':
    case 'smart-qa-practice-generator': {
      const canonical = knowledgeBaseToCanonical(kb);
      const mapped = mapCanonicalPdfToToolBulkItems(slug, canonical, '', { ...params, skipToolRegex: true });
      if (mapped.items?.length) return mapped.items;
      break;
    }

    default:
      break;
  }

  const canonical = knowledgeBaseToCanonical(kb);
  const mapped = mapCanonicalPdfToToolBulkItems(slug, canonical, '', { ...params, skipToolRegex: true });
  if (mapped.items?.length) return mapped.items;
  return [
    {
      title: t,
      learning_objectives: objectives,
      questions: questions.slice(0, 20),
      summary: str(kb.summary),
    },
  ];
}

/**
 * @param {Record<string, unknown>} kb
 * @param {string} toolSlug
 * @param {Record<string, unknown>} [params]
 */
export function projectKnowledgeBaseForTool(kb, toolSlug, params = {}) {
  const slug = str(toolSlug);
  let items = projectToolFromKnowledgeBase(slug, kb, params);
  items = postProcessCanonicalBulkItems(slug, items, '', params);
  items = canonicalizeBulkItems(slug, items, '');
  return items;
}

/**
 * Build render + structured pair for API (zero LLM).
 * @param {Record<string, unknown>} kb
 * @param {string} toolSlug
 * @param {string} [contentType]
 * @param {Record<string, unknown>} [params]
 */
export function projectKnowledgeBaseForApi(kb, toolSlug, contentType = 'Generated Content', params = {}) {
  const items = projectKnowledgeBaseForTool(kb, toolSlug, params);
  const primary = items[0] || {};
  return {
    bulkItems: items,
    structuredContent: primary,
    renderContent: buildToolRenderContent(toolSlug, primary, ''),
    contentType,
  };
}
