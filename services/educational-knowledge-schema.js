/**
 * Universal educational knowledge base JSON schema (one per PDF).
 * @module services/educational-knowledge-schema
 */

export const KNOWLEDGE_BASE_VERSION = 1;

const str = (v) => (v == null ? '' : String(v).trim());

/**
 * @param {unknown} raw
 * @param {Record<string, unknown>} [params]
 */
export function normalizeEducationalKnowledgeBase(raw, params = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const strList = (v) => {
    if (!Array.isArray(v)) return str(v) ? [str(v)] : [];
    return v.map((x) => str(x)).filter(Boolean);
  };

  const mapConcepts = (list) =>
    (Array.isArray(list) ? list : []).map((c, i) => {
      const row = c && typeof c === 'object' ? c : { name: c };
      return {
        name: str(row.name || row.concept || row.title) || `Concept ${i + 1}`,
        description: str(row.description || row.summary || row.explanation),
        importance: str(row.importance || row.significance),
        examples: strList(row.examples),
      };
    }).filter((c) => c.name || c.description);

  const mapDefinitions = (list) =>
    (Array.isArray(list) ? list : []).map((d, i) => {
      const row = d && typeof d === 'object' ? d : { term: d };
      return {
        term: str(row.term || row.name || row.title) || `Term ${i + 1}`,
        definition: str(row.definition || row.meaning || row.description),
      };
    }).filter((d) => d.term || d.definition);

  const mapFormulas = (list) =>
    (Array.isArray(list) ? list : []).map((f, i) => {
      const row = f && typeof f === 'object' ? f : { expression: f };
      return {
        name: str(row.name || row.title) || `Formula ${i + 1}`,
        expression: str(row.expression || row.formula || row.equation),
        explanation: str(row.explanation || row.description),
      };
    }).filter((f) => f.expression || f.name);

  const mapExamples = (list) =>
    (Array.isArray(list) ? list : []).map((e, i) => {
      const row = e && typeof e === 'object' ? e : { problem: e };
      return {
        title: str(row.title || row.name) || `Example ${i + 1}`,
        problem: str(row.problem || row.question || row.prompt),
        solution: str(row.solution || row.answer),
        steps: strList(row.steps),
      };
    }).filter((e) => e.problem || e.solution || e.title);

  const mapActivities = (list) =>
    (Array.isArray(list) ? list : []).map((a, i) => {
      const row = a && typeof a === 'object' ? a : { title: a };
      return {
        title: str(row.title || row.name) || `Activity ${i + 1}`,
        description: str(row.description || row.summary),
        steps: strList(row.steps || row.procedure),
        materials: strList(row.materials || row.materials_required),
        learning_outcomes: strList(row.learning_outcomes || row.outcomes),
      };
    }).filter((a) => a.title || a.description);

  const mapApplications = (list) =>
    (Array.isArray(list) ? list : []).map((a, i) => {
      const row = a && typeof a === 'object' ? a : { scenario: a };
      return {
        title: str(row.title || row.name) || `Application ${i + 1}`,
        scenario: str(row.scenario || row.context || row.description),
        explanation: str(row.explanation || row.solution),
      };
    }).filter((a) => a.scenario || a.title);

  const mapMisconceptions = (list) =>
    (Array.isArray(list) ? list : []).map((m) => {
      const row = m && typeof m === 'object' ? m : { misconception: m };
      return {
        misconception: str(row.misconception || row.myth || row.wrong_belief),
        correction: str(row.correction || row.clarification || row.fact),
      };
    }).filter((m) => m.misconception || m.correction);

  const mapQuestions = (list) =>
    (Array.isArray(list) ? list : []).map((q, i) => {
      const row = q && typeof q === 'object' ? q : { question: q };
      const options = Array.isArray(row.options) ? row.options.map((o) => str(o)).filter(Boolean) : [];
      return {
        question_number: row.question_number ?? row.number ?? i + 1,
        question: str(row.question || row.text || row.prompt),
        type: str(row.type || (options.length >= 2 ? 'mcq' : 'short')),
        options,
        answer: str(row.answer || row.correct_answer),
        section: str(row.section || row.section_name),
        marks: row.marks != null ? Number(row.marks) : undefined,
        explanation: str(row.explanation),
      };
    }).filter((q) => q.question);

  const chapter = str(src.chapter || params.topic || params.chapter);
  const title = str(src.title || chapter || params.subtopic || 'Chapter');

  return {
    version: KNOWLEDGE_BASE_VERSION,
    extractionEngine: 'knowledge-base-v1',
    chapter,
    title,
    concepts: mapConcepts(src.concepts),
    definitions: mapDefinitions(src.definitions),
    formulas: mapFormulas(src.formulas),
    examples: mapExamples(src.examples),
    activities: mapActivities(src.activities),
    applications: mapApplications(src.applications),
    misconceptions: mapMisconceptions(src.misconceptions),
    learningObjectives: strList(src.learningObjectives || src.learning_objectives || src.objectives),
    questions: mapQuestions(src.questions),
    instructions: str(src.instructions),
    summary: str(src.summary || src.chapter_summary),
    metadata: {
      extractedAt: new Date().toISOString(),
      textLength: Number(src.metadata?.textLength || params.textLength || 0),
      subject: str(params.subject || src.metadata?.subject),
      classLabel: str(params.classLabel || src.metadata?.classLabel),
      topic: str(params.topic || src.metadata?.topic),
      subtopic: str(params.subtopic || src.metadata?.subtopic),
      geminiCallCount: 1,
    },
  };
}

export function knowledgeBaseHasContent(kb) {
  if (!kb || typeof kb !== 'object') return false;
  return (
    (kb.concepts?.length || 0) > 0 ||
    (kb.definitions?.length || 0) > 0 ||
    (kb.questions?.length || 0) > 0 ||
    (kb.activities?.length || 0) > 0 ||
    (kb.learningObjectives?.length || 0) > 0 ||
    str(kb.summary).length > 40
  );
}
