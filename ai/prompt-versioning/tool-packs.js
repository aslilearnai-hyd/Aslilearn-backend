/**
 * Per-tool packs for the V2 6-section engine — all 21 tools.
 * Each tool customizes Section 1 (core) via a short rules string and belongs to a
 * content FAMILY that defines the JSON shape of `core`. Sections 2-6 share one schema.
 */

/** Shared shape for the five non-core sections. */
const SHARED_SECTION_SCHEMA = `"objectives": { "items": ["3-5 measurable objectives"], "alignment": "NCERT/SCERT chapter + outcomes", "bloom": ["Remember: …", "Understand: …", "Apply: …", "Analyze: …"] },
"differentiation": { "support": "for struggling / first-gen learners", "core": "for the average learner", "stretch": "for advanced / IIT-level" },
"assessment": { "answerKey": [{ "q": "one object per question across ALL sections A-E in order, not only the MCQ", "answer": "complete model answer for THIS question", "working": "worked solution; for 2+ mark questions give point-wise marking with marks per point; for MCQ state why the other options are wrong" }], "rubric": "short marking guidance", "commonErrors": ["typical Indian student mistake", "…"] },
"teacher": { "timing": "how it fits a 35-45 min period", "tlm": ["low-cost Indian teaching aids"], "tips": ["classroom management / blackboard tip"] },
"reallife": { "connection": "authentic Indian real-life example", "family": "parent/community link", "reflection": "one short student reflection prompt" }`;

/** Core JSON shape per content family. */
const FAMILY_CORE = {
  questions: `"core": { "title": "specific title naming the subtopic", "instructions": "student instructions + total marks + time", "sectionA_mcq": [{ "question": "…", "options": ["A) …","B) …","C) …","D) …"], "answer": "B) …", "marks": 1 }], "sectionB_fib": [{ "question": "sentence with a single ___ blank", "answer": "exact missing term", "marks": 1 }], "sectionC_short": [{ "question": "…", "answer": "model answer", "marks": 2 }], "sectionD_application": [{ "question": "real-life / numerical / case-based", "answer": "worked answer", "marks": 3 }], "sectionE_long": [{ "question": "long-answer (only if the tool needs it)", "answer": "model answer", "marks": 5 }] }`,
  explain: `"core": { "title": "…", "definition": "one clear, simple definition", "explanation": ["step or short paragraph 1", "step 2", "step 3"], "keyPoints": ["must-remember point", "…"], "examples": ["real Indian-context example", "…"], "formulae": ["formula or rule (only if relevant)"] }`,
  // Minimums are stated inline because validators enforce them as hard gates
  // (e.g. steps>=3 && materials>=2 at ai-content-engine-service.js:4465). Without
  // them the model is free to emit one step or one material and the record fails
  // to save — the schema, not the prompt, is where the contract has to live.
  plan: `"core": { "title": "…", "overview": "1-2 line overview", "materials": ["low-cost / zero-cost Indian item", "second item — MINIMUM 2 required"], "steps": ["step 1", "step 2", "step 3 — MINIMUM 3 required"], "roles": { "teacher": "what the teacher does", "student": "what the student does" } }`,
  reading: `"core": { "title": "…", "passage": "the full, complete passage or story text (real, age-appropriate, Indian context)", "vocabulary": ["word — simple meaning"], "questions": [{ "question": "recall / inference / apply question", "answer": "suggested answer" }] }`,
  // Flashcard save gates require 5 valid cards (10 for my-study-decks), each with
  // a non-empty front AND back — see flashcardBatchLooksSaveable.
  cards: `"core": { "title": "…", "cards": [{ "front": "question / term / prompt", "back": "complete answer / definition" }] }  // MINIMUM 5 cards (10 for study decks); every card needs BOTH front and back`,
};

/** slug -> { title, family, coreRules } */
const PACKS = {
  // --- Family: questions ---
  'worksheet-mcq-generator': { title: 'Worksheet & MCQ Generator', family: 'questions', coreRules: 'A complete printable worksheet. DEFAULT (only when the user did NOT set a question count): Section A: 5 MCQs (1 mark); Section B: 5 Fill-in-the-Blanks (1 mark); Section C: 3 Short Answer (2 marks); Section D: 2 Application/case-based (3 marks); Section E: 1 long-answer (5 marks) — 16 questions total. WHEN USER PARAMETERS specify a question count / composition, those counts OVERRIDE this default — generate EXACTLY that many questions (may be more or fewer than 16). Every question must be real, chapter-specific, and distinct (no repeats or trivial rewordings). Add internal choice where the board allows.' },
  'homework-creator': { title: 'Homework Creator', family: 'questions', coreRules: 'A balanced, reasonable homework set (20-40 min total): practice questions (textbook-mapped), an application task, one creative/observation task, and a challenge question with hints. Respect family time; prefer home/kitchen/local resources. The creativeTask field is REQUIRED and must be a genuine open-ended thinking prompt — not a reworded practice question.', coreExtra: '"creativeTask": "one open-ended creative/thinking question inviting the student to imagine, design, or justify — distinct from the graded questions above"' },
  'mock-test-builder': { title: 'Mock Test Builder', family: 'questions', coreExtra: '"testPurpose": "why this test matters for this subtopic and board prep", "remedialSuggestions": "per weak section, the concept to re-study and one practice action"', coreRules: 'A complete mock test to the board blueprint (CBSE competency distribution / State pattern / JEE Main): instructions, questions across all types, and balanced difficulty. Map chapters/exercises covered.' },
  'exam-question-paper-generator': { title: 'Exam Question Paper Generator', family: 'questions', coreRules: 'A full question paper strictly to the official blueprint: section-wise distribution, internal choice, all question types (MCQ, VSA, SA, LA, case/assertion-reason, numericals as applicable). Include long answers in sectionE_long. sectionD_application and sectionE_long must contain DIFFERENT questions — never the same stem in both; sectionD_application is the case/application item and sectionE_long is the extended long-answer item, and they print as two separate sections of the paper.' },
  'smart-qa-practice-generator': { title: 'Smart Q&A Practice', family: 'questions', coreExtra: '"sectionF_case": [{ "question": "application / case-based question", "answer": "model answer", "marks": 3 }], "sectionG_hots": [{ "question": "HOTS / analytical question", "answer": "model answer", "marks": 4 }]', coreRules: 'A mixed, balanced practice set (MCQ, Fill-ups, VSA, SA, case-study, HOTS) of varying difficulty that mirrors real board/competitive style. Put HOTS/analytical items in sectionE_long.' },
  'quick-assignment-builder': { title: 'Quick Assignment Builder', family: 'questions', coreRules: 'A short assignment: concept-based questions, an application-oriented task, a real-life/competency activity, one creative question, and a challenge for advanced learners.' },
  // --- Family: explain ---
  'concept-mastery-helper': { title: 'Concept Mastery Helper', family: 'explain', coreRules: 'Definition, why it matters, a step-by-step breakdown with Indian examples/analogies, common misconceptions, and practice. Keep it age-appropriate and board-mapped. priorKnowledge, diagram and hotsQuestion are REQUIRED — the explain-family core does not otherwise carry them and the tool cannot be delivered without them.', coreExtra: '"priorKnowledge": "what the student must already know before this concept", "diagram": "what to draw on the board to visualise this concept, with the labels to mark", "hotsQuestion": "one higher-order (analyse/evaluate/design) question on this concept, with its expected answer"' },
  'concept-breakdown-explainer': { title: 'Concept Breakdown Explainer', family: 'explain', coreExtra: '"applicationQuestion": "one application-based thinking question with its answer", "hotsPrompt": "one higher-order thinking prompt (analyse/evaluate/design)", "revisionSummary": "a dense 4-6 line recap for last-minute revision"', coreRules: 'Break a difficult concept into simple steps with keywords, Indian real-life examples, and a short summary. Make the complex feel achievable.' },
  'smart-study-guide-generator': { title: 'Smart Study Guide', family: 'explain', coreExtra: '"priorKnowledge": "what the student must already know before this guide", "conceptFlow": "a concept flow / mind-map outline showing how the ideas connect"', coreRules: 'A comprehensive yet concise chapter study guide: overview, key concepts, definitions and formulae, worked examples, and quick revision notes. Highlight high-weightage areas.' },
  'chapter-summary-creator': { title: 'Chapter Summary Creator', family: 'explain', coreExtra: '"conceptConnections": "how this chapter connects to earlier and later chapters"', coreRules: 'A chapter summary: overview, important concepts and explanations, key definitions, formulae/rules/facts, and concept connections. formulae[] MUST contain AT LEAST 3 entries — the section is "Formulae / Rules / Important Facts", so a must-know rule or exam-critical fact counts as an entry when the chapter has few equations. Fewer than 3 fails validation and the record cannot be delivered.' },
  'key-points-formula-extractor': { title: 'Key Points & Formula Extractor', family: 'explain', coreRules: 'The most important concepts, essential definitions, key formulae/rules, keywords, must-remember facts, and mnemonics. Put formulae/rules in the formulae array.' },
  'short-notes-summaries-maker': { title: 'Short Notes & Summaries', family: 'explain', coreRules: 'Concise, memorable, exam-focused short notes: overview, key points (use bullets/mnemonics), definitions, and an example. For board years include high-weightage topics.' },
  // --- Family: plan ---
  'activity-project-generator': { title: 'Activity & Project Generator', family: 'plan', coreRules: 'A complete, ready-to-conduct activity: overview, low-cost/zero-cost Indian materials, step-by-step procedure with 35-45 min timing, and clear teacher vs student roles. Add safety and a group strategy for 40-60 students in the steps.' },
  'project-idea-lab': { title: 'Project Idea Lab', family: 'plan', coreRules: 'An innovation project brief: overview, low-cost materials, a step-by-step prototype/build process, and teacher/student roles. Align with Atal Tinkering Lab / science-fair spirit and a local Indian problem.' },
  'lesson-planner': { title: 'Lesson Planner', family: 'plan', coreRules: 'A complete lesson plan: overview, teaching aids in materials, a phased lesson flow with realistic 35-45 min timings in steps (hook → teach → practice → close), and teacher/student roles with expected responses. The homework field is REQUIRED and must be work the student does AFTER the lesson — never a restatement of a classroom step.', coreExtra: '"homework": "the practice/homework set after this lesson — specific questions or a task with what to submit"' },
  'daily-class-plan-maker': { title: 'Daily Class Plan', family: 'plan', coreExtra: '"exitTicket": "the quick assessment / exit ticket for the period", "homeworkFollowup": "the follow-up task set after this period"', coreRules: 'A practical period plan: overview, aids, a period-wise flow of activities in steps that fits a 35-45 min Indian period, and teacher/student roles.' },
  'study-schedule-maker': { title: 'Study Schedule Maker', family: 'plan', coreExtra: '"priorKnowledge": "readiness check before starting the schedule", "practiceSlot": "the practice/revision slot with what to solve", "breaksFocusTips": "specific break activities and focus techniques"', coreRules: 'A realistic personalized study schedule: overview of the week, needed resources, and a day/slot-wise plan in steps (concept slots, practice, revision, breaks) that respects the school timetable, sleep, and family/festival time.' },
  // --- Family: reading ---
  'reading-practice-room': { title: 'Reading Practice Room', family: 'reading', coreExtra: '"priorKnowledge": "subtopic link and what the reader should already know", "vocabularyWarmup": "pre-reading vocabulary warm-up activity", "vocabularyPractice": "a vocabulary practice exercise using the passage words"', coreRules: 'An age-appropriate, culturally rooted passage with vocabulary support and recall/inference/application questions. Match the board comprehension pattern. questions[] MUST contain at least 6 items — they are split into recall / infer / apply sets that each require a minimum of 2.' },
  'story-passage-creator': { title: 'Story & Passage Creator', family: 'reading', coreExtra: '"subtopicConnection": "how this story connects to the topic and subtopic", "priorKnowledge": "what the reader should already know", "preReadingPrompt": "a thinking prompt to pose BEFORE reading", "vocabGrammarPractice": "a vocabulary and grammar practice exercise built from the passage", "creativeResponse": "a creative response activity after reading"', coreRules: 'A complete, engaging story/passage in an Indian context with a positive value, at the right reading level, followed by recall/inference/apply questions. questions[] MUST contain at least 6 items so the recall / infer / apply sets get 2 each.' },
  // --- Family: cards ---
  'flashcard-generator': { title: 'Flash Card Generator', family: 'cards', coreRules: 'A complete flashcard set (front/back), scannable and exam-oriented. Textbook + board mapped; for competitive exams include high-frequency/tricky concepts.' },
  'my-study-decks': { title: 'My Study Decks', family: 'cards', coreRules: 'A ready-to-use flashcard deck (front/back) with definitions/facts per NCERT + board expectations. For JEE add conceptual + numerical trigger cards.' },
};

export const TOOL_PACKS = PACKS;

/** Build the tool-specific instruction block + response schema. */
export function buildToolPack(toolSlug) {
  const pack = PACKS[String(toolSlug || '').trim()];
  if (!pack) return null;
  /*
   * A tool may append its own fields to the family core schema via `coreExtra`.
   *
   * Some canonical template sections have no home in the shared family shape —
   * a lesson plan's "Homework / Practice" is not a teaching step, and homework's
   * "Creative / Thinking Question" is not one of sectionA-E. Without a slot the
   * model cannot emit them, so those sections were unfillable and the record
   * failed the 100%-fill gate no matter how many times it was retried.
   *
   * coreExtra is per-tool so adding a field for one tool does not change the
   * shape for every other member of its family.
   */
  let coreSchema = FAMILY_CORE[pack.family];
  if (pack.coreExtra) {
    const close = coreSchema.lastIndexOf('}');
    if (close > -1) {
      coreSchema = `${coreSchema.slice(0, close).trimEnd()}, ${pack.coreExtra} ${coreSchema.slice(close)}`;
    }
  }
  const instructions = `TOOL: ${pack.title}\nSECTION 1 (core) RULES:\n${pack.coreRules}`;
  const responseSchema = `{
  ${coreSchema},
  ${SHARED_SECTION_SCHEMA}
}`;
  return { title: pack.title, family: pack.family, instructions, responseSchema };
}

export function isV2SupportedTool(toolSlug) {
  return Boolean(PACKS[String(toolSlug || '').trim()]);
}

/** slug -> content family (used by the frontend core-block mapper). */
export function v2ToolFamily(toolSlug) {
  return PACKS[String(toolSlug || '').trim()]?.family || null;
}
