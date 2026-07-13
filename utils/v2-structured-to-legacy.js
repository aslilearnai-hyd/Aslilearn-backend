/**
 * Map V2 six-section structuredContent → legacy shapes expected by
 * teacher/student dashboards (validateDashboardAiToolDoc, FlashcardViewer, etc.).
 * Super Admin already renders V2 via SixSectionViewer; dashboards still use legacy keys.
 */

function str(v) {
  return v == null ? '' : String(v).trim();
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function list(v) {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  const s = str(v);
  return s ? [s] : [];
}

function mapCards(core = {}) {
  return arr(core.cards)
    .map((c) => ({
      front: str(c?.front || c?.task || c?.term || c?.question),
      back: str(c?.back || c?.solution || c?.definition || c?.answer),
    }))
    .filter((c) => c.front && c.back);
}

function mapQuestionSections(core = {}) {
  const sections = [];
  const push = (sectionName, type, rows) => {
    const questions = arr(rows)
      .map((q, i) => ({
        question_number: i + 1,
        type,
        section: sectionName,
        question: str(q?.question || q?.prompt || q?.text),
        options: Array.isArray(q?.options) ? q.options.map(str) : [],
        answer: str(q?.answer),
        marks: q?.marks,
      }))
      .filter((q) => q.question);
    if (questions.length) sections.push({ sectionName, questions, count: questions.length });
  };
  push('Section A: MCQs', 'MCQ', core.sectionA_mcq);
  push('Section B: Fill in the Blanks', 'FIB', core.sectionB_fib);
  push('Section C: Very Short Answer Questions', 'VSA', core.sectionC_short);
  push('Section D: Short Answer Questions', 'SA', core.sectionD_application);
  push('Section E: Competency / Real-life Application Questions', 'COMPETENCY', core.sectionE_long);
  return sections;
}

function mapAnswerKey(assessment = {}) {
  const rows = arr(assessment.answerKey);
  if (!rows.length) return str(assessment.rubric);
  return rows
    .map((a) => {
      const n = str(a?.q || a?.n || a?.question_number);
      const ans = str(a?.answer);
      const work = str(a?.working || a?.work);
      if (!ans) return '';
      return `${n ? `Q${n}. ` : ''}${ans}${work ? ` (${work})` : ''}`;
    })
    .filter(Boolean)
    .join('\n');
}

function sharedPedagogy(v2 = {}) {
  const objectives = v2.objectives && typeof v2.objectives === 'object' ? v2.objectives : {};
  const differentiation =
    v2.differentiation && typeof v2.differentiation === 'object' ? v2.differentiation : {};
  const assessment = v2.assessment && typeof v2.assessment === 'object' ? v2.assessment : {};
  const teacher = v2.teacher && typeof v2.teacher === 'object' ? v2.teacher : {};
  const reallife = v2.reallife && typeof v2.reallife === 'object' ? v2.reallife : {};
  return {
    learning_objectives: list(objectives.items),
    ncf_competency_alignment: str(objectives.alignment),
    bloom_level: list(objectives.bloom).join(' | '),
    differentiation: [str(differentiation.support), str(differentiation.core), str(differentiation.stretch)]
      .filter(Boolean)
      .join(' | '),
    differentiation_support: str(differentiation.support),
    common_mistakes_to_avoid: list(assessment.commonErrors),
    teacher_instructions: [str(teacher.timing), ...list(teacher.tlm), ...list(teacher.tips)].filter(Boolean),
    real_life_application: str(reallife.connection),
    real_life_connection: str(reallife.connection),
    reflection_exit_ticket: str(reallife.reflection),
  };
}

/**
 * @param {string} toolSlug
 * @param {Record<string, unknown>} v2
 * @returns {Record<string, unknown>|null}
 */
export function mapV2StructuredToLegacy(toolSlug, v2) {
  if (!v2 || typeof v2 !== 'object' || v2.schema !== 'asli-v2-six-section') return null;
  const slug = String(toolSlug || v2.tool || '').trim();
  const core = v2.core && typeof v2.core === 'object' ? v2.core : {};
  const objectives = v2.objectives && typeof v2.objectives === 'object' ? v2.objectives : {};
  const differentiation =
    v2.differentiation && typeof v2.differentiation === 'object' ? v2.differentiation : {};
  const assessment = v2.assessment && typeof v2.assessment === 'object' ? v2.assessment : {};
  const teacher = v2.teacher && typeof v2.teacher === 'object' ? v2.teacher : {};
  const reallife = v2.reallife && typeof v2.reallife === 'object' ? v2.reallife : {};
  const pedagogy = sharedPedagogy(v2);
  const title = str(core.title || core.worksheetTitle || 'Generated content');

  if (slug === 'flashcard-generator' || slug === 'my-study-decks') {
    const cards = mapCards(core);
    if (!cards.length) return null;
    const learningObjectives = list(objectives.items);
    while (learningObjectives.length < 2) {
      learningObjectives.push(
        learningObjectives.length === 0
          ? `Apply key ideas from ${title}`
          : `Check understanding of ${title}`,
      );
    }
    const mistakes = list(assessment.commonErrors);
    if (!mistakes.length) mistakes.push(`Mixing up related terms in ${title}`);
    return {
      ...pedagogy,
      title,
      deck_title: title,
      flashcard_deck_title: title,
      cards,
      flashcard_set: cards,
      application_hots_cards: cards,
      learning_objectives: learningObjectives,
      expected_learning_outcomes: learningObjectives,
      prior_knowledge_required:
        str(core.overview) || pedagogy.ncf_competency_alignment || `Basic ideas related to ${title}`,
      ncf_competency_alignment:
        pedagogy.ncf_competency_alignment || `Apply and reason with concepts from ${title}`,
      deck_memory_hook: list(teacher.tips)[0] || `Link each card back to ${title}`,
      common_mistakes_to_avoid: mistakes,
      self_check_rapid_recall_round:
        str(assessment.rubric) || `Cover the back and recall each card for ${title}`,
      real_life_connection:
        pedagogy.real_life_connection || `Connect ${title} to a familiar everyday situation`,
      real_life_application: pedagogy.real_life_application || pedagogy.real_life_connection,
      differentiation_support:
        str(differentiation.support) ||
        pedagogy.differentiation_support ||
        `Support learners with guided examples from ${title}`,
      reflection_exit_ticket:
        str(reallife.reflection) ||
        pedagogy.reflection_exit_ticket ||
        `Name one idea from ${title} you can explain`,
    };
  }

  if (
    [
      'worksheet-mcq-generator',
      'homework-creator',
      'mock-test-builder',
      'exam-question-paper-generator',
      'smart-qa-practice-generator',
      'quick-assignment-builder',
    ].includes(slug)
  ) {
    const sections = mapQuestionSections(core);
    if (!sections.length) return null;
    return {
      ...pedagogy,
      title,
      worksheet_title: title,
      paper_title: title,
      mock_test_title: title,
      practice_set_title: title,
      instructions: str(core.instructions),
      sections,
      questions: sections.flatMap((s) => s.questions),
      answer_key: mapAnswerKey(v2.assessment),
      difficulty_tag: 'Medium',
    };
  }

  // Explain / plan / reading families — surface core fields teachers expect.
  return {
    ...pedagogy,
    title,
    simple_definition: str(core.definition || core.overview || core.passage),
    step_by_step_explanation: list(core.explanation || core.steps),
    key_points: list(core.keyPoints),
    key_points_to_remember: list(core.keyPoints),
    examples: list(core.examples),
    formulae: list(core.formulae),
    materials_required: list(core.materials),
    step_by_step_procedure: list(core.steps),
    passage: str(core.passage),
    vocabulary: list(core.vocabulary),
    cards: mapCards(core),
  };
}

/** True when structured content is V2 six-section. */
export function isV2SixSectionStructured(structured) {
  return Boolean(
    structured &&
      typeof structured === 'object' &&
      !Array.isArray(structured) &&
      structured.schema === 'asli-v2-six-section',
  );
}
