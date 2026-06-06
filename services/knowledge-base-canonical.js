/**
 * Convert educational knowledge base → canonical v2 shape for legacy mappers.
 * @module services/knowledge-base-canonical
 */

import { str } from './pdf-extract-utils.js';

/**
 * @param {Record<string, unknown>} kb
 */
export function knowledgeBaseToCanonical(kb) {
  if (!kb || typeof kb !== 'object') return { version: 2, extractionEngine: 'knowledge-base' };

  const questions = (Array.isArray(kb.questions) ? kb.questions : []).map((q, i) => ({
    question_number: q.question_number ?? i + 1,
    question: str(q.question),
    options: Array.isArray(q.options) ? q.options.map((o) => str(o)) : [],
    answer: str(q.answer),
    section: str(q.section) || 'Questions',
    type: str(q.type),
    marks: q.marks,
    explanation: str(q.explanation),
  }));

  const sectionMap = new Map();
  for (const q of questions) {
    const name = q.section || 'Questions';
    if (!sectionMap.has(name)) sectionMap.set(name, []);
    sectionMap.get(name).push(q);
  }

  const sections = Array.from(sectionMap.entries()).map(([sectionName, qs]) => ({
    sectionName,
    questions: qs,
    count: qs.length,
  }));

  const concepts = (Array.isArray(kb.concepts) ? kb.concepts : []).map((c) => ({
    title: str(c.name),
    concept_name: str(c.name),
    description: str(c.description),
    importance: str(c.importance),
    examples: c.examples || [],
  }));

  const activities = (Array.isArray(kb.activities) ? kb.activities : []).map((a) => ({
    title: str(a.title),
    description: str(a.description),
    step_by_step_procedure: a.steps || [],
    materials_required: a.materials || [],
    expected_learning_outcomes: a.learning_outcomes || [],
  }));

  const flashcards = [
    ...(Array.isArray(kb.definitions) ? kb.definitions : []).map((d) => ({
      front: str(d.term),
      back: str(d.definition),
    })),
    ...concepts.slice(0, 30).map((c) => ({
      front: str(c.title),
      back: str(c.description),
    })),
  ].filter((c) => c.front && c.back);

  const contentBlocks = [];
  if (str(kb.summary)) {
    contentBlocks.push({ kind: 'summary', heading: 'Summary', text: str(kb.summary), lines: [str(kb.summary)] });
  }
  for (const f of Array.isArray(kb.formulas) ? kb.formulas : []) {
    const line = `${str(f.name)}: ${str(f.expression)} — ${str(f.explanation)}`.trim();
    if (line.length > 4) contentBlocks.push({ kind: 'formula', heading: str(f.name), text: line, lines: [line] });
  }

  return {
    version: 2,
    extractionEngine: 'knowledge-base',
    title: str(kb.title || kb.chapter),
    chapter: str(kb.chapter),
    headings: [{ level: 1, text: str(kb.title || kb.chapter) }],
    sections,
    paragraphs: str(kb.summary) ? [{ text: str(kb.summary) }] : [],
    questions,
    answers: questions.filter((q) => q.answer).map((q) => ({
      question_number: q.question_number,
      section: q.section,
      answer: q.answer,
    })),
    objectives: Array.isArray(kb.learningObjectives) ? kb.learningObjectives : [],
    learningObjectives: Array.isArray(kb.learningObjectives) ? kb.learningObjectives : [],
    instructions: str(kb.instructions),
    activities,
    concepts,
    flashcards,
    stories: [],
    contentBlocks,
    applications: kb.applications || [],
    examples: kb.examples || [],
    misconceptions: kb.misconceptions || [],
    formulas: kb.formulas || [],
    definitions: kb.definitions || [],
    metadata: {
      knowledgeBaseVersion: kb.version,
      source: 'educational-knowledge-base',
      ...(kb.metadata || {}),
    },
    stats: {
      questionCount: questions.length,
      sectionCount: sections.length,
      conceptCount: concepts.length,
      activityCount: activities.length,
      flashcardCount: flashcards.length,
    },
  };
}
