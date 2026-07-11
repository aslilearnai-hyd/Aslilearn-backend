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
  plan: `"core": { "title": "…", "overview": "1-2 line overview", "materials": ["low-cost / zero-cost Indian item"], "steps": ["step 1", "step 2", "step 3"], "roles": { "teacher": "what the teacher does", "student": "what the student does" } }`,
  reading: `"core": { "title": "…", "passage": "the full, complete passage or story text (real, age-appropriate, Indian context)", "vocabulary": ["word — simple meaning"], "questions": [{ "question": "recall / inference / apply question", "answer": "suggested answer" }] }`,
  cards: `"core": { "title": "…", "cards": [{ "front": "question / term / prompt", "back": "complete answer / definition" }] }`,
};

/** slug -> { title, family, coreRules } */
const PACKS = {
  // --- Family: questions ---
  'worksheet-mcq-generator': { title: 'Worksheet & MCQ Generator', family: 'questions', coreRules: 'A complete printable worksheet with EXACTLY 5 questions in EACH section — Section A: 5 MCQs (4 options, one correct); Section B: 5 Fill-in-the-Blanks; Section C: 5 Very Short/Short Answer; Section D: 5 Application/case-based; Section E: 5 higher-order/long-answer. That is 25 questions total. Do not return fewer than 5 per section. Every question must be real, chapter-specific, and distinct (no repeats or trivial rewordings). Add internal choice where the board allows.' },
  'homework-creator': { title: 'Homework Creator', family: 'questions', coreRules: 'A balanced, reasonable homework set (20-40 min total): practice questions (textbook-mapped), an application task, one creative/observation task, and a challenge question with hints. Respect family time; prefer home/kitchen/local resources.' },
  'mock-test-builder': { title: 'Mock Test Builder', family: 'questions', coreRules: 'A complete mock test to the board blueprint (CBSE competency distribution / State pattern / JEE Main): instructions, questions across all types, and balanced difficulty. Map chapters/exercises covered.' },
  'exam-question-paper-generator': { title: 'Exam Question Paper Generator', family: 'questions', coreRules: 'A full question paper strictly to the official blueprint: section-wise distribution, internal choice, all question types (MCQ, VSA, SA, LA, case/assertion-reason, numericals as applicable). Include long answers in sectionE_long.' },
  'smart-qa-practice-generator': { title: 'Smart Q&A Practice', family: 'questions', coreRules: 'A mixed, balanced practice set (MCQ, Fill-ups, VSA, SA, case-study, HOTS) of varying difficulty that mirrors real board/competitive style. Put HOTS/analytical items in sectionE_long.' },
  'quick-assignment-builder': { title: 'Quick Assignment Builder', family: 'questions', coreRules: 'A short assignment: concept-based questions, an application-oriented task, a real-life/competency activity, one creative question, and a challenge for advanced learners.' },
  // --- Family: explain ---
  'concept-mastery-helper': { title: 'Concept Mastery Helper', family: 'explain', coreRules: 'Definition, why it matters, a step-by-step breakdown with Indian examples/analogies, common misconceptions, and practice. Keep it age-appropriate and board-mapped.' },
  'concept-breakdown-explainer': { title: 'Concept Breakdown Explainer', family: 'explain', coreRules: 'Break a difficult concept into simple steps with keywords, Indian real-life examples, and a short summary. Make the complex feel achievable.' },
  'smart-study-guide-generator': { title: 'Smart Study Guide', family: 'explain', coreRules: 'A comprehensive yet concise chapter study guide: overview, key concepts, definitions and formulae, worked examples, and quick revision notes. Highlight high-weightage areas.' },
  'chapter-summary-creator': { title: 'Chapter Summary Creator', family: 'explain', coreRules: 'A chapter summary: overview, important concepts and explanations, key definitions, formulae/rules/facts, and concept connections.' },
  'key-points-formula-extractor': { title: 'Key Points & Formula Extractor', family: 'explain', coreRules: 'The most important concepts, essential definitions, key formulae/rules, keywords, must-remember facts, and mnemonics. Put formulae/rules in the formulae array.' },
  'short-notes-summaries-maker': { title: 'Short Notes & Summaries', family: 'explain', coreRules: 'Concise, memorable, exam-focused short notes: overview, key points (use bullets/mnemonics), definitions, and an example. For board years include high-weightage topics.' },
  // --- Family: plan ---
  'activity-project-generator': { title: 'Activity & Project Generator', family: 'plan', coreRules: 'A complete, ready-to-conduct activity: overview, low-cost/zero-cost Indian materials, step-by-step procedure with 35-45 min timing, and clear teacher vs student roles. Add safety and a group strategy for 40-60 students in the steps.' },
  'project-idea-lab': { title: 'Project Idea Lab', family: 'plan', coreRules: 'An innovation project brief: overview, low-cost materials, a step-by-step prototype/build process, and teacher/student roles. Align with Atal Tinkering Lab / science-fair spirit and a local Indian problem.' },
  'lesson-planner': { title: 'Lesson Planner', family: 'plan', coreRules: 'A complete lesson plan: overview, teaching aids in materials, a phased lesson flow with realistic 35-45 min timings in steps (hook → teach → practice → close), and teacher/student roles with expected responses.' },
  'daily-class-plan-maker': { title: 'Daily Class Plan', family: 'plan', coreRules: 'A practical period plan: overview, aids, a period-wise flow of activities in steps that fits a 35-45 min Indian period, and teacher/student roles.' },
  'study-schedule-maker': { title: 'Study Schedule Maker', family: 'plan', coreRules: 'A realistic personalized study schedule: overview of the week, needed resources, and a day/slot-wise plan in steps (concept slots, practice, revision, breaks) that respects the school timetable, sleep, and family/festival time.' },
  // --- Family: reading ---
  'reading-practice-room': { title: 'Reading Practice Room', family: 'reading', coreRules: 'An age-appropriate, culturally rooted passage with vocabulary support and recall/inference/application questions. Match the board comprehension pattern.' },
  'story-passage-creator': { title: 'Story & Passage Creator', family: 'reading', coreRules: 'A complete, engaging story/passage in an Indian context with a positive value, at the right reading level, followed by recall/inference/apply questions.' },
  // --- Family: cards ---
  'flashcard-generator': { title: 'Flash Card Generator', family: 'cards', coreRules: 'A complete flashcard set (front/back), scannable and exam-oriented. Textbook + board mapped; for competitive exams include high-frequency/tricky concepts.' },
  'my-study-decks': { title: 'My Study Decks', family: 'cards', coreRules: 'A ready-to-use flashcard deck (front/back) with definitions/facts per NCERT + board expectations. For JEE add conceptual + numerical trigger cards.' },
};

export const TOOL_PACKS = PACKS;

/** Build the tool-specific instruction block + response schema. */
export function buildToolPack(toolSlug) {
  const pack = PACKS[String(toolSlug || '').trim()];
  if (!pack) return null;
  const coreSchema = FAMILY_CORE[pack.family];
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
