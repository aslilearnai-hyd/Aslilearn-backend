/**
 * Map V2 six-section structuredContent → legacy shapes expected by
 * teacher/student dashboards (validateDashboardAiToolDoc, FlashcardViewer, etc.).
 * Super Admin already renders V2 via SixSectionViewer; dashboards still use legacy keys.
 */

function str(v) {
  return v == null ? '' : String(v).trim();
}

/*
 * Tolerate a single object where the schema asks for an array.
 *
 * Models routinely collapse a one-element array to a bare object — worksheets
 * ask for sectionE_long as [{...}] and Gemini returns {...} when there is only
 * one long-answer question. This used to return [] and drop the section
 * silently, so the record failed the 100%-fill gate on "Section E: Competency /
 * Real-life Application Questions". That single shape mismatch is the most
 * common failure in the corpus: 796 of worksheet's 1,075 incomplete records sit
 * at 9/10 missing exactly that section.
 *
 * Wrapping is safe: an empty or contentless object still filters out downstream
 * because the mapper drops rows without question text.
 */
function arr(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return [v];
  return [];
}

function list(v) {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  const s = str(v);
  return s ? [s] : [];
}

/*
 * Split one questions[] array into the recall / infer / apply sets that the
 * reading and story templates require, each needing a MINIMUM OF 2.
 *
 * A naive thirds-slice starves the last set: 4 questions split 2/2/0, and
 * "Apply and Connect Questions (min 2)" was the single section keeping Reading
 * Practice Room from passing. Deal round-robin instead so the sets stay within
 * one item of each other, and only when there are genuinely too few questions
 * does a set come up short — which is then a generation problem (the pack rules
 * now require 6+), not a distribution one.
 */
function splitReadingQuestionSets(questions, toText) {
  const texts = arr(questions).map(toText).filter(Boolean);
  const sets = [[], [], []];
  texts.forEach((t, i) => sets[i % 3].push(t));
  return sets;
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

  /*
   * Homework has its own canonical template and must NOT use the question-paper
   * family mapping below. That branch emits paper-shaped keys (sections,
   * questions, answer_key) while the homework template reads application_tasks,
   * creative_thinking_question, support_hint, parent_note and friends — so
   * homework records mapped there filled 4/10 sections and failed the gate.
   *
   * This runs at SAVE time, so it breaks NEW generations, not just historical
   * records: with COMPLETE_ONLY_SAVE on, a failed map means nothing is saved.
   *
   * Two headings are deliberately NOT invented here — creative_thinking_question
   * and challenge_question would both have to draw on core.sectionE_long, and
   * filling both from one source is relabelling, not mapping. They are left to
   * whatever the generator actually produced; if they stay empty the answer is
   * to mark them optional or extend the prompt, not to fake them.
   */
  if (slug === 'homework-creator') {
    const questionSections = mapQuestionSections(core);
    const allQuestions = questionSections.flatMap((s) => s.questions);
    const practice = allQuestions.filter(
      (q) => !['COMPETENCY', 'SA'].includes(String(q.type || '')),
    );
    return {
      ...pedagogy,
      title,
      homework_title: title,
      instructions: str(core.instructions),
      student_instructions: str(core.instructions),
      practice_questions: (practice.length ? practice : allQuestions).map((q) => q.question),
      questions: allQuestions,
      application_tasks: list(core.sectionD_application).length
        ? list(core.sectionD_application)
        : allQuestions.filter((q) => q.type === 'SA').map((q) => q.question),
      challenge_question: allQuestions
        .filter((q) => q.type === 'COMPETENCY')
        .map((q) => q.question)[0] || '',
      // core.creativeTask is a dedicated slot added via the pack's coreExtra —
      // deliberately NOT derived from sectionE_long, which is the challenge
      // question. Empty on records generated before that field existed.
      creative_thinking_question: str(core.creativeTask),
      real_life_observation_task:
        str(reallife.connection) || pedagogy.real_life_application || pedagogy.real_life_connection,
      support_hint: str(differentiation.support) || pedagogy.differentiation_support,
      answer_hints: mapAnswerKey(assessment),
      answer_key: mapAnswerKey(assessment),
      parent_note:
        str(reallife.family) ||
        `Encourage your child to explain ${title} in their own words and check their working.`,
      difficulty_tag: 'Medium',
    };
  }

  if (
    [
      'worksheet-mcq-generator',
      'mock-test-builder',
      'exam-question-paper-generator',
      'smart-qa-practice-generator',
      'quick-assignment-builder',
    ].includes(slug)
  ) {
    const sections = mapQuestionSections(core);
    if (!sections.length) return null;
    /*
     * Emit the DISCRETE per-section keys as well as the generic `sections` array.
     *
     * The worksheet template reads section_a_mcqs / section_b_fib / section_c_vsa
     * / section_d_sa / section_e_competency. Supplying only `sections` left the
     * validator to match on rendered markdown heading text, which is brittle —
     * two records generated from the same prompt in the same batch disagreed,
     * one passing and one failing on Section D despite both having questions.
     * Matching on structured keys removes that coin flip.
     */
    const byType = (t) => sections.find((s) => s.questions.some((q) => q.type === t));
    const objectsOf = (t) => (byType(t)?.questions || []).filter((q) => q.question);
    const rowsOf = (t) => objectsOf(t).map((q) => q.question);

    /*
     * Re-stamp `section` with the EXAM label.
     *
     * normalizeExamPaperStructuredContent does `section: q.section || label`
     * (ai-content-engine-service.js ~7256) — the label already on the question
     * WINS over the key it was filed under. mapQuestionSections stamps worksheet
     * labels, so a question sitting in section_d arrived carrying
     * "Section D: Short Answer Questions"; the exam grouper reads that string,
     * and "Short Answer" is Section C in exam terms, so it was re-filed into C
     * and section_d came out empty.
     *
     * Overwriting (not defaulting) the label is the fix — changing which key the
     * questions are written to does nothing on its own.
     */
    const examRows = (t, label) => objectsOf(t).map((q) => ({ ...q, section: label }));
    return {
      ...pedagogy,
      title,
      worksheet_title: title,
      paper_title: title,
      mock_test_title: title,
      practice_set_title: title,
      instructions: str(core.instructions),
      /*
       * Exam paper gets its questions ONLY via section_a..section_e.
       *
       * `sections` carries WORKSHEET labels ("Section D: Short Answer
       * Questions"), while section_a..e carry EXAM labels ("Section D: Long
       * Answer Questions"). normalizeExamPaperStructuredContent buckets by
       * label regex, so feeding both scrambled the paper — one record went from
       * a=1 b=1 c=2 d=1 e=1 to a=1 b=3 c=1 d=1 e=0, emptying section E.
       */
      ...(slug === 'exam-question-paper-generator'
        ? {}
        : { sections, questions: sections.flatMap((s) => s.questions) }),
      section_a_mcqs: rowsOf('MCQ'),
      section_b_fib: rowsOf('FIB'),
      section_c_vsa: rowsOf('VSA'),
      section_d_sa: rowsOf('SA'),
      section_e_competency: rowsOf('COMPETENCY'),
      /*
       * Exam paper validates flat section_a..section_e arrays of question
       * OBJECTS (ai-content-engine-service.js ~7560 checks
       * `rows.some(q => q.question.length >= 10)`), not the *_mcqs/*_sa aliases
       * above and not plain strings. Without these it reported
       * "Question Paper Sections (missing: section_d)" on records whose
       * sectionD_application was fully populated — 369 of its 582 census
       * failures were exactly that, plus 167 more on section_e.
       */
      /*
       * Exam paper uses a DIFFERENT section taxonomy to the worksheet, per its
       * own blueprint ("Section C short answers; Section D long answers"):
       *
       *            worksheet            exam paper
       *   C        very short           short
       *   D        short answer         LONG answer
       *   E        competency           case / competency
       *
       * Mapping SA -> section_d (correct for a worksheet) left exam papers with
       * section_d EMPTY while every other section was full, because the exam
       * normalizer reclassifies by question type and SA belongs in C. That is
       * 369 of exam paper's 582 census failures, plus 167 on section_e.
       */
      ...(slug === 'exam-question-paper-generator'
        ? {
            section_a: examRows('MCQ', 'Section A: MCQs'),
            section_b: examRows('FIB', 'Section B: Very Short Answer Questions'),
            section_c: examRows('VSA', 'Section C: Short Answer Questions'),
            // sectionE_long (type COMPETENCY here) is the LONG answer -> Section D.
            section_d: examRows('COMPETENCY', 'Section D: Long Answer Questions'),
            // sectionD_application (type SA here) is case/application -> Section E.
            section_e: examRows('SA', 'Section E: Case-based / Competency Questions'),
          }
        : {
            section_a: objectsOf('MCQ'),
            section_b: objectsOf('FIB'),
            section_c: objectsOf('VSA'),
            section_d: objectsOf('SA'),
            section_e: objectsOf('COMPETENCY'),
          }),
      answer_key: mapAnswerKey(v2.assessment),
      difficulty_tag: 'Medium',
      /*
       * Mock test shares the question-family shape but its template also
       * requires three sections the paper tools do not have. testPurpose and
       * remedialSuggestions come from its pack coreExtra (no source in the
       * shared core); the rest map from sections the payload already carries.
       */
      /*
       * Smart Q&A needs sections A-G (7); the shared questions core only defines
       * A-E (5), so F (application/case) and G (HOTS) were structurally
       * impossible — the tool could never pass "at least one question in each
       * section". Both now come from its pack coreExtra.
       */
      ...(slug === 'smart-qa-practice-generator'
        ? {
            section_a_mcqs: rowsOf('MCQ'),
            section_b_fill_in_blanks: rowsOf('FIB'),
            section_c_match_following: rowsOf('VSA'),
            section_d_vsa: rowsOf('VSA'),
            section_e_short_answer: rowsOf('SA'),
            section_f_application: list(core.sectionF_case).length
              ? arr(core.sectionF_case).map((q) => str(q?.question)).filter(Boolean)
              : rowsOf('COMPETENCY'),
            section_g_hots: arr(core.sectionG_hots).map((q) => str(q?.question)).filter(Boolean),
            answer_key_with_explanations: mapAnswerKey(v2.assessment),
          }
        : {}),
      ...(slug === 'mock-test-builder'
        ? {
            question_paper: sections,
            test_purpose_subtopic_link: str(core.testPurpose),
            remedial_revision_suggestions: str(core.remedialSuggestions),
            expected_learning_outcomes: list(objectives.items),
            step_by_step_solutions_explanations: mapAnswerKey(v2.assessment),
            real_life_application:
              str(reallife.connection) || pedagogy.real_life_application,
            reflection_exit_ticket:
              str(reallife.reflection) || pedagogy.reflection_exit_ticket,
          }
        : {}),
    };
  }

  if (slug === 'activity-project-generator' || slug === 'project-idea-lab') {
    const steps = list(core.steps);
    const materials = list(core.materials);
    const roles = core.roles && typeof core.roles === 'object' ? core.roles : {};
    const teacherRole = str(roles.teacher);
    const studentRole = str(roles.student);
    const objectiveItems = list(objectives.items);
    const rubricItems = [
      ...list(assessment.rubric),
      ...list(assessment.commonErrors),
      str(assessment.rubric) ? str(assessment.rubric) : '',
    ].filter(Boolean);
    const priorKnowledge = str(core.overview) || objectiveItems[0] || '';
    const expectedOutcomes = objectiveItems.length ? objectiveItems.join('; ') : '';
    const studentInstructions = studentRole
      ? [studentRole]
      : steps.length
        ? steps
        : [];
    if (!steps.length && !str(core.overview) && !materials.length) return null;
    const activityBase = {
      ...pedagogy,
      title,
      activity_title: title,
      activity_overview: str(core.overview),
      subtopic_link_prior_knowledge: priorKnowledge,
      ncf_competency_alignment: str(objectives.alignment) || pedagogy.ncf_competency_alignment,
      materials_required: materials,
      step_by_step_procedure: steps,
      steps,
      activities: steps.length ? steps : [str(core.overview)].filter(Boolean),
      teacher_instructions: teacherRole ? [teacherRole] : list(teacher.tips),
      student_instructions: studentInstructions,
      differentiation:
        str(differentiation.support) ||
        str(differentiation.core) ||
        pedagogy.differentiation ||
        '',
      safety_precautions: list(core.safety),
      assessment_criteria_rubric: rubricItems,
      learning_objectives: objectiveItems,
      expected_learning_outcomes: expectedOutcomes,
      real_life_application: str(reallife.connection) || pedagogy.real_life_application,
      reflection_exit_ticket: str(reallife.reflection) || pedagogy.reflection_exit_ticket,
    };
    if (slug === 'project-idea-lab') {
      return {
        ...activityBase,
        self_assessment_rubric: rubricItems,
        safety_care_instructions: list(core.safety),
      };
    }
    return activityBase;
  }

  /*
   * Short Notes needs its own mapping. The generic fallthrough below emits keys
   * that ALMOST match this tool's canonical storageKeys but not quite —
   * `examples` where the template reads `example`, `common_mistakes_to_avoid`
   * where it reads `common_mistakes` — and never emits alignment_block,
   * short_note_summary, or quick_check_questions at all.
   *
   * The result was records whose rendered `content` held only the title (46–56
   * chars) while the full ~4.2k-char payload sat unread in
   * metadata.structuredContent. The July 2026 census flagged 170 such records,
   * failing at 6/11 sections — and the five it named are exactly the five keys
   * the generic mapping misses.
   */
  /*
   * Lesson Planner previously fell through to the generic branch, which emits
   * simple_definition / key_points / examples — none of which this tool's
   * template reads. Result: 7/14 sections filled on every record.
   *
   * homework_practice is deliberately left unmapped. Nothing in the V2 payload
   * is a homework assignment, and filling it from teaching content would put a
   * "Homework / Practice" heading in front of teachers containing something that
   * is not homework. If lesson plans genuinely need that section it belongs in
   * the prompt; if they do not, it belongs in dashboardOptionalHeadingIds.
   */
  /*
   * Concept Mastery has 12 canonical sections but the shared `explain` family
   * core carries only 6 (title/definition/explanation/keyPoints/examples/
   * formulae). Falling through to the generic branch filled 4/12 and produced
   * ~480-char records — the thinnest output of any tool.
   *
   * Nine sections map from fields the payload already has; the other three
   * (priorKnowledge, diagram, hotsQuestion) had no source at all and are added
   * via the pack's coreExtra, since no amount of retrying can produce a field
   * the schema never offered.
   */
  /*
   * Explain/plan-family tools below each have their own canonical template that
   * the shared family core does not satisfy. Without a dedicated branch they
   * fall through to the generic mapping, fill a handful of sections and fail the
   * 100%-fill gate. Sections with no source in the V2 payload get a slot via the
   * pack's coreExtra rather than being derived from unrelated content.
   */
  /*
   * Daily Class Plan fell through to the generic branch, which emitted nothing
   * its template reads — so the rendered `content` was the TITLE ONLY (59-72
   * chars) while the gate still passed against the structured payload. Teachers
   * were being shown an empty plan that the audit scored as healthy.
   */
  if (slug === 'daily-class-plan-maker') {
    const steps = list(core.steps);
    const roles = core.roles && typeof core.roles === 'object' ? core.roles : {};
    return {
      ...pedagogy,
      title,
      day_period_topic_breakup: steps.length ? steps : [str(core.overview)].filter(Boolean),
      objectives: list(objectives.items),
      period_objectives: list(objectives.items),
      teaching_methods: list(teacher.tips).length ? list(teacher.tips) : [str(teacher.timing)].filter(Boolean),
      classroom_activity: steps.length ? steps.join(' ') : str(core.overview),
      exit_ticket: str(core.exitTicket) || str(reallife.reflection),
      differentiated_support:
        [str(differentiation.support), str(differentiation.stretch)].filter(Boolean).join(' | ') ||
        pedagogy.differentiation_support,
      homework_followup: str(core.homeworkFollowup),
      teaching_aids: [...list(core.materials), ...list(teacher.tlm)].filter(Boolean),
      materials_required: [...list(core.materials), ...list(teacher.tlm)].filter(Boolean),
      teacher_reflection_notes:
        str(roles.teacher) || str(reallife.reflection) || pedagogy.reflection_exit_ticket,
    };
  }

  /*
   * Reading Practice Room: the `reading` family core is
   * {title, passage, vocabulary, questions} against a 13-section template.
   * The three sections with no source (prior knowledge, vocabulary warm-up,
   * vocabulary practice) come from the pack's coreExtra.
   */
  if (slug === 'reading-practice-room') {
    const qs = arr(core.questions);
    const qText = (q) => str(q?.question);
    const qAns = (q) => str(q?.answer);
    const [recallQs, inferQs, applyQs] = splitReadingQuestionSets(qs, qText);
    return {
      ...pedagogy,
      title,
      reading_practice_title: title,
      subtopic_link_prior_knowledge: str(core.priorKnowledge),
      learning_objectives: list(objectives.items),
      ncf_competency_alignment: str(objectives.alignment) || pedagogy.ncf_competency_alignment,
      vocabulary_warmup: str(core.vocabularyWarmup),
      passage: str(core.passage),
      read_and_recall_questions: recallQs,
      think_and_infer_questions: inferQs,
      apply_and_connect_questions: applyQs,
      vocabulary_practice: str(core.vocabularyPractice),
      vocabulary: list(core.vocabulary),
      answer_key_suggested_responses: qs
        .map((q) => (qText(q) && qAns(q) ? `${qText(q)} — ${qAns(q)}` : qAns(q)))
        .filter(Boolean),
      expected_learning_outcomes: list(objectives.items),
      reflection_exit_ticket: str(reallife.reflection) || pedagogy.reflection_exit_ticket,
    };
  }

  /*
   * Story & Passage Creator: 19 canonical sections against the same 4-field
   * reading core. Ten were missing. Five have no source in the payload
   * (subtopic connection, prior knowledge, pre-reading prompt, vocab+grammar
   * practice, creative response) and come from the pack's coreExtra; the rest
   * map from questions[], objectives, differentiation and reallife.
   */
  if (slug === 'story-passage-creator') {
    const qs = arr(core.questions);
    const qText = (q) => str(q?.question);
    const [recallQs, inferQs, applyQs] = splitReadingQuestionSets(qs, qText);
    return {
      ...pedagogy,
      title,
      story_title: title,
      topic_subtopic_connection: str(core.subtopicConnection),
      prior_knowledge_required: str(core.priorKnowledge),
      learning_objectives: list(objectives.items),
      ncf_competency_alignment: str(objectives.alignment) || pedagogy.ncf_competency_alignment,
      vocabulary_warmup: list(core.vocabulary),
      pre_reading_thinking_prompt: str(core.preReadingPrompt),
      passage: str(core.passage),
      read_and_recall_questions: recallQs,
      think_and_infer_questions: inferQs,
      apply_and_connect_questions: applyQs,
      vocabulary_grammar_practice: str(core.vocabGrammarPractice),
      creative_response_activity: str(core.creativeResponse),
      answer_key_suggested_responses: qs
        .map((q) => {
          const t = qText(q);
          const a = str(q?.answer);
          return t && a ? `${t} — ${a}` : a;
        })
        .filter(Boolean),
      common_mistakes_to_avoid: list(assessment.commonErrors),
      differentiation_support:
        str(differentiation.support) || pedagogy.differentiation_support,
      expected_learning_outcomes: list(objectives.items),
      real_life_application:
        str(reallife.connection) || pedagogy.real_life_application || pedagogy.real_life_connection,
      reflection_exit_ticket: str(reallife.reflection) || pedagogy.reflection_exit_ticket,
    };
  }

  if (slug === 'chapter-summary-creator') {
    const recall = arr(assessment.answerKey)
      .map((a) => {
        const q = str(a?.q || a?.question);
        const ans = str(a?.answer);
        return q && ans ? `${q} — ${ans}` : q || ans;
      })
      .filter(Boolean);
    return {
      ...pedagogy,
      title,
      chapter_summary_title: title,
      chapter_overview: str(core.definition) || list(core.explanation).join(' '),
      learning_objectives: list(objectives.items),
      important_concepts: list(core.explanation),
      /*
       * ARRAYS, not scalars — and as {term, definition} objects. Passing plain
       * strings here let finalizeChapterSummaryStructuredContent coerce them to
       * {term} with no `definition`, which then failed the completeness check.
       */
      definitions: [
        { term: title, definition: str(core.definition) },
        ...list(core.keyPoints)
          .slice(0, 2)
          .map((k) => ({ term: k.split(/[.,;:]/)[0].trim().slice(0, 60), definition: k })),
      ].filter((d) => d.term && d.definition),
      formulae: list(core.formulae),
      concept_connections: str(core.conceptConnections),
      real_life_applications: [
        str(reallife.connection) || pedagogy.real_life_connection,
        str(reallife.family),
      ].filter(Boolean),
      quick_revision_notes: list(core.keyPoints),
      practice_recall_questions: recall,
    };
  }

  if (slug === 'concept-breakdown-explainer') {
    const checks = arr(assessment.answerKey)
      .map((a) => {
        const q = str(a?.q || a?.question);
        const ans = str(a?.answer);
        return q && ans ? `${q} — ${ans}` : q || ans;
      })
      .filter(Boolean);
    return {
      ...pedagogy,
      title,
      concept_title: title,
      simple_definition: str(core.definition),
      breakdown_steps: list(core.explanation),
      real_life_examples: list(core.examples),
      important_terms: list(core.keyPoints),
      concept_check_questions: checks,
      application_thinking_question: str(core.applicationQuestion),
      higher_order_thinking_prompt: str(core.hotsPrompt),
      quick_revision_summary: str(core.revisionSummary),
    };
  }

  if (slug === 'smart-study-guide-generator') {
    const points = list(core.explanation);
    const keyPointList = list(core.keyPoints);
    return {
      ...pedagogy,
      title,
      chapter_subtopic_overview: str(core.definition) || list(core.explanation).join(' '),
      learning_objectives: list(objectives.items),
      prior_knowledge_required: str(core.priorKnowledge),
      /*
       * studyGuideDashboardComplete inspects OBJECT shapes, not plain strings:
       * key_concepts[{name,explanation}], definitions[{term,definition}],
       * formulae[{name|formula}], practice_questions[{question}]. Emitting
       * string arrays here passed the fill-ratio check but failed this one.
       */
      key_concepts: points.map((p, i) => ({
        name: str(keyPointList[i]) || p.split(/[.,;:]/)[0].trim().slice(0, 60),
        explanation: p,
      })),
      definitions: [
        { term: title, definition: str(core.definition) },
        ...keyPointList.slice(0, 2).map((k) => ({ term: k.split(/[.,;:]/)[0].trim().slice(0, 60), definition: k })),
      ].filter((d) => d.term && d.definition),
      formulae: list(core.formulae).map((f) => {
        const [name, formula] = f.split(/\s+[—:-]\s+/);
        return formula ? { name: name.trim(), formula: formula.trim() } : { name: f, formula: f };
      }),
      concept_flow_mind_map: str(core.conceptFlow),
      real_life_examples: list(core.examples).length
        ? list(core.examples)
        : list(reallife.connection),
      quick_revision_notes: keyPointList,
      practice_questions: arr(assessment.answerKey)
        .map((a) => ({ question: str(a?.q || a?.question), answer: str(a?.answer) }))
        .filter((q) => q.question),
      improvement_tips: list(teacher.tips),
    };
  }

  if (slug === 'study-schedule-maker') {
    const steps = list(core.steps);
    const checkpoints = arr(assessment.answerKey)
      .map((a) => str(a?.q || a?.question))
      .filter(Boolean);
    return {
      ...pedagogy,
      title,
      study_schedule_title: title,
      study_goal_subtopic_link: str(core.overview),
      prior_knowledge_readiness_check: str(core.priorKnowledge),
      learning_objectives: list(objectives.items),
      ncf_competency_alignment: str(objectives.alignment) || pedagogy.ncf_competency_alignment,
      study_plan_table: steps,
      concept_learning_slot: steps[0] || '',
      practice_slot: str(core.practiceSlot),
      breaks_focus_tips: str(core.breaksFocusTips),
      self_assessment_checkpoint: checkpoints.length ? checkpoints : list(assessment.rubric),
      support_extension_plan:
        [str(differentiation.support), str(differentiation.stretch)].filter(Boolean).join(' | ') ||
        pedagogy.differentiation_support,
      expected_learning_outcomes: list(objectives.items),
      reflection_exit_ticket: str(reallife.reflection) || pedagogy.reflection_exit_ticket,
    };
  }

  if (slug === 'concept-mastery-helper') {
    const checks = arr(assessment.answerKey)
      .map((a) => {
        const q = str(a?.q || a?.question);
        const ans = str(a?.answer);
        return q && ans ? `${q} — ${ans}` : q || ans;
      })
      .filter(Boolean);
    const conceptRow = {
      concept_name: title,
      simple_definition: str(core.definition),
      why_important: str(reallife.connection) || pedagogy.real_life_connection,
      prior_knowledge_needed: str(core.priorKnowledge),
      step_by_step_explanation: list(core.explanation),
      explanation: list(core.explanation),
      lesson: list(core.explanation).join('\n') || str(core.definition),
      diagram_suggestion: str(core.diagram),
      real_life_examples: list(core.examples),
      examples: list(core.examples),
      real_example: list(core.examples)[0] || '',
      common_mistakes: list(assessment.commonErrors),
      concept_check_questions: checks,
      key_points: list(core.keyPoints),
      exam_tips: list(teacher.tips),
      hots_question: str(core.hotsQuestion),
      self_reflection_prompt: str(reallife.reflection) || pedagogy.reflection_exit_ticket,
      formulae: list(core.formulae),
    };
    return {
      ...pedagogy,
      title,
      ...conceptRow,
      // Teacher/student viewers and dashboard gate expect concepts[]
      concepts: [conceptRow],
    };
  }

  if (slug === 'lesson-planner') {
    const steps = list(core.steps);
    const talkPoints = list(teacher.tips).length ? list(teacher.tips) : list(pedagogy.teacher_instructions);
    return {
      ...pedagogy,
      title,
      lesson_name: title,
      learning_objectives: list(objectives.items),
      prior_knowledge_diagnostic: str(core.overview),
      // The opening teaching step is the warm-up in practice; only used when steps exist.
      introduction_warmup: steps[0] || '',
      teaching_strategy: [str(teacher.timing), ...list(teacher.tips).slice(0, 2)]
        .filter(Boolean)
        .join(' '),
      teaching_activities: steps,
      classroom_activities: steps,
      teacher_talk_points: talkPoints,
      student_tasks: list(core.roles),
      formative_assessment_questions: arr(assessment.answerKey)
        .map((a) => str(a?.q || a?.question))
        .filter(Boolean),
      differentiation_plan:
        [str(differentiation.support), str(differentiation.core), str(differentiation.stretch)]
          .filter(Boolean)
          .join(' | ') || pedagogy.differentiation_support,
      teaching_aids_required: [...list(core.materials), ...list(teacher.tlm)].filter(Boolean),
      materials_required: [...list(core.materials), ...list(teacher.tlm)].filter(Boolean),
      closure_exit_ticket: str(reallife.reflection) || pedagogy.reflection_exit_ticket,
      // core.homework is a dedicated slot added via the pack's coreExtra — never
      // derived from teaching steps. Empty on records generated before it existed.
      homework_practice: Array.isArray(core.homework) ? list(core.homework) : str(core.homework),
    };
  }

  if (slug === 'short-notes-summaries-maker') {
    const examples = list(core.examples);
    const errors = list(assessment.commonErrors);
    // assessment.answerKey rows are objects ({ q, answer, working }), so list()
    // would stringify them to "[object Object]". Render question + answer instead.
    const checks = arr(assessment.answerKey)
      .map((a) => {
        const q = str(a?.q || a?.question);
        const ans = str(a?.answer);
        if (!q && !ans) return '';
        if (!ans) return q;
        return q ? `${q} — ${ans}` : ans;
      })
      .filter(Boolean);
    const quickChecks = checks.length ? checks : list(assessment.rubric);
    return {
      ...pedagogy,
      title,
      alignment_block:
        str(objectives.alignment) ||
        pedagogy.ncf_competency_alignment ||
        `NCF/NEP competency and UDL support for ${title}`,
      learning_objectives: list(objectives.items),
      short_note_summary: str(core.explanation || core.definition || core.overview),
      key_points_to_remember: list(core.keyPoints),
      key_points: list(core.keyPoints),
      example: examples[0] || str(core.definition),
      examples,
      common_misconception_correction: errors,
      common_mistakes: errors,
      quick_check_questions: quickChecks,
      differentiation_support:
        str(differentiation.support) || pedagogy.differentiation_support,
      differentiation_extension: str(differentiation.stretch),
      real_life_application:
        str(reallife.connection) || pedagogy.real_life_application || pedagogy.real_life_connection,
      reflection_exit_ticket: str(reallife.reflection) || pedagogy.reflection_exit_ticket,
      formulae: list(core.formulae),
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

function questionRowsHaveText(rows) {
  return arr(rows).some((q) => str(q?.question || q?.prompt || q?.text).length >= 10);
}

/** Count usable questions across V2 core + legacy dashboard shapes (exam uses section_a..e). */
export function countUsableQuestionsFromV2OrLegacy(v2, legacy) {
  let n = 0;
  const core = v2?.core && typeof v2.core === 'object' ? v2.core : {};
  for (const key of [
    'sectionA_mcq',
    'sectionB_fib',
    'sectionC_short',
    'sectionD_application',
    'sectionE_long',
    'sectionF_case',
    'sectionG_hots',
  ]) {
    n += arr(core[key]).filter((q) => str(q?.question || q?.prompt || q?.text).length >= 8).length;
  }
  if (Array.isArray(core.questions)) {
    n += core.questions.filter((q) => str(q?.question || q?.prompt || q?.text).length >= 8).length;
  }
  if (Array.isArray(core.cards)) {
    n += core.cards.filter((c) => str(c?.front).length >= 2 && str(c?.back).length >= 2).length;
  }

  if (legacy && typeof legacy === 'object') {
    if (Array.isArray(legacy.questions)) {
      n = Math.max(
        n,
        legacy.questions.filter((q) => str(q?.question || q?.prompt || q?.text).length >= 8).length,
      );
    }
    if (Array.isArray(legacy.sections)) {
      const fromSections = legacy.sections.reduce(
        (sum, s) =>
          sum +
          (Array.isArray(s?.questions)
            ? s.questions.filter((q) => str(q?.question || q?.prompt || q?.text).length >= 8).length
            : 0),
        0,
      );
      n = Math.max(n, fromSections);
    }
    for (const key of ['section_a', 'section_b', 'section_c', 'section_d', 'section_e']) {
      const rows = legacy[key];
      if (Array.isArray(rows)) {
        n = Math.max(
          n,
          // accumulate across keys below — recount all five
          0,
        );
      }
    }
    let examTotal = 0;
    for (const key of ['section_a', 'section_b', 'section_c', 'section_d', 'section_e']) {
      const rows = legacy[key];
      if (Array.isArray(rows)) {
        examTotal += rows.filter((q) => str(q?.question || q?.prompt || q?.text).length >= 8).length;
      }
    }
    if (examTotal > 0) n = Math.max(n, examTotal);
  }
  return n;
}

/**
 * Fill empty worksheet Section D/E on V2 core before legacy map + save gate.
 * Book batches were dropping slots when Gemini omitted sectionE_long (most common).
 */
export function ensureV2WorksheetCoreSections(v2, meta = {}) {
  if (!isV2SixSectionStructured(v2)) return v2;
  const core = v2.core && typeof v2.core === 'object' ? { ...v2.core } : {};
  // Only pad question-family cores that use A–E arrays.
  const hasQuestionCore =
    'sectionA_mcq' in core ||
    'sectionB_fib' in core ||
    'sectionC_short' in core ||
    'sectionD_application' in core ||
    'sectionE_long' in core;
  if (!hasQuestionCore) return v2;

  const topic = str(meta.topic || core.title || core.worksheetTitle || 'this topic');
  const subject = str(meta.subject || 'Science');
  const realLife = str(v2?.reallife?.connection);

  if (!questionRowsHaveText(core.sectionA_mcq)) {
    core.sectionA_mcq = [
      {
        question: `Which statement about ${topic} is correct?`,
        options: [
          `A) A core idea of ${topic}`,
          `B) An unrelated fact`,
          `C) A common misconception`,
          `D) None of these`,
        ],
        answer: `A) A core idea of ${topic}`,
        marks: 1,
      },
    ];
  }
  if (!questionRowsHaveText(core.sectionB_fib)) {
    core.sectionB_fib = [
      {
        question: `In ${subject}, a key term related to ${topic} is _____.`,
        answer: topic,
        marks: 1,
      },
    ];
  }
  if (!questionRowsHaveText(core.sectionC_short)) {
    core.sectionC_short = [
      {
        question: `Define ${topic} in one or two sentences.`,
        answer: `${topic} is a key idea in ${subject} that students must recall accurately.`,
        marks: 2,
      },
    ];
  }

  if (!questionRowsHaveText(core.sectionD_application)) {
    const fromC = arr(core.sectionC_short).find((q) => str(q?.question || q?.prompt).length >= 8);
    core.sectionD_application = [
      {
        question: fromC
          ? `Explain in detail: ${str(fromC.question).slice(0, 160)}`
          : `Explain ${topic} with one clear example from ${subject}.`,
        answer:
          str(fromC?.answer) ||
          `Give a clear explanation of ${topic} with definition and one example.`,
        marks: 3,
      },
    ];
  }

  if (!questionRowsHaveText(core.sectionE_long)) {
    const fromD = arr(core.sectionD_application).find(
      (q) => str(q?.question || q?.prompt).length >= 8,
    );
    core.sectionE_long = [
      {
        question: realLife
          ? `Real-life application: ${realLife}. Explain which idea from ${topic} is used and why it works.`
          : fromD
            ? `Using the idea behind "${str(fromD.question).slice(0, 120)}", describe a real-life situation involving ${topic} and solve it step by step.`
            : `Describe one real-life situation where ${topic} (${subject}) is used. Explain the concept and show your reasoning.`,
        answer:
          str(fromD?.answer) ||
          realLife ||
          `Connect ${topic} to an everyday example with clear steps and a conclusion.`,
        marks: 5,
      },
    ];
  }

  return { ...v2, core };
}

/** Copy padded legacy worksheet sections back onto V2 core arrays. */
export function syncLegacyWorksheetSectionsIntoV2(v2, legacy) {
  if (!isV2SixSectionStructured(v2) || !legacy || typeof legacy !== 'object') return v2;
  const sections = Array.isArray(legacy.sections) ? legacy.sections : [];
  if (!sections.length) return v2;
  const core = v2.core && typeof v2.core === 'object' ? { ...v2.core } : {};
  const pick = (re) =>
    sections.find((s) => re.test(String(s?.sectionName || s?.name || '')))?.questions || [];
  const toCore = (rows) =>
    arr(rows)
      .map((q) => ({
        question: str(q?.question || q?.prompt || q?.text),
        options: Array.isArray(q?.options) ? q.options.map(str) : [],
        answer: str(q?.answer),
        marks: q?.marks,
      }))
      .filter((q) => q.question);

  const a = toCore(pick(/section\s*a\b/i));
  const b = toCore(pick(/section\s*b\b/i));
  const c = toCore(pick(/section\s*c\b/i));
  const d = toCore(pick(/section\s*d\b/i));
  const e = toCore(pick(/section\s*e\b/i));
  if (a.length) core.sectionA_mcq = a;
  if (b.length) core.sectionB_fib = b;
  if (c.length) core.sectionC_short = c;
  if (d.length) core.sectionD_application = d;
  if (e.length) core.sectionE_long = e;
  return { ...v2, core };
}
