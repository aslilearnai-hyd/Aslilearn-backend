/**
 * Shared pedagogy blocks referenced by per-tool prompt packs.
 * @module prompts/shared/pedagogy-depth
 */

export const PEDAGOGY_CHECKLIST = Object.freeze([
  'Learning Outcome (measurable, starts with action verb)',
  'Success Criteria (what "got it" looks like in student work)',
  'Prior Knowledge (what students already know from earlier classes/chapters)',
  'Common Misconceptions (2–3) + teacher correction strategy',
  'Hook / Opening (one direct question or fact about the subtopic — not a fictional scenario)',
  'Teacher Script (actual dialogue with expected student answers)',
  'Student Activity (step-by-step with timing)',
  'Group Activity (roles, materials, deliverable)',
  'Hands-on / Experiential Learning',
  'Questioning Strategy (funnel: open → guided → probing)',
  'Real-life Connection (Indian context)',
  'Cross-curricular Link (where natural)',
  'Formative Assessment (exit ticket / quick check)',
  'Reflection prompt for students',
  'Extension for early finishers',
  'Differentiation: Below / On / Above grade + SEN + ELL + Gifted',
  'Homework tiers: Basic / Standard / Challenge (+ family activity where apt)',
  'Visual Learning suggestions (diagram, flowchart, mind map, table)',
]);

export function buildPedagogyDepthBlock() {
  return [
    'PEDAGOGICAL DEPTH — include every item that fits this tool\'s schema:',
    ...PEDAGOGY_CHECKLIST.map((item, i) => `${i + 1}. ${item}`),
  ].join('\n');
}

export function buildDifferentiationBlock() {
  return [
    'DIFFERENTIATION (mandatory — separate labelled subsections):',
    'Below Grade Level: simplified task, sentence frames, visual supports, reduced reading load.',
    'On Grade Level: core task as designed for the class.',
    'Advanced Learners: extension question, research angle, cross-topic connection.',
    'Special Needs (SEN): concrete modifications — seating, timing, alternative response mode.',
    'English Language Learners (ELL): key vocabulary with L1 bridge if Hindi/Telugu class; sentence starters.',
    'Gifted Learners: open-ended design challenge or peer-teaching role.',
  ].join('\n');
}

export function buildTeacherScriptBlock() {
  return [
    'TEACHER SCRIPT FORMAT (use in introduction/warmup and key teaching moments):',
    'Teacher: "[exact words to say — conversational, Indian classroom tone]"',
    'Expected Student Answers: [list 3–5 realistic answers students might give]',
    'Teacher Response: "[how to build on answers and bridge to the concept]"',
    'Repeat this pattern at least twice per lesson-type output.',
    'BAD: "Explain photosynthesis to students."',
    'GOOD: Teacher: "Hold up this potted plant. Why do you think the leaves are green and not red?" Expected: chlorophyll, sunlight, paint, etc. Teacher: "Three of you said sunlight — today we test whether light changes leaf colour."',
  ].join('\n');
}

export function buildBloomQuestionBlock() {
  return [
    "BLOOM'S TAXONOMY — question design:",
    'Remember: recall fact/term from THIS subtopic.',
    'Understand: explain in own words, classify, compare.',
    'Apply: solve a numerical or explain using the subtopic formula/principle.',
    'Analyse: break down, find cause-effect, interpret data/diagram.',
    'Evaluate: justify a choice, critique a statement.',
    'Create: design, propose, compose, invent within the subtopic.',
    'Each assessment section must progress upward — never all Remember level.',
  ].join('\n');
}

export function buildMisconceptionBlock() {
  return [
    'COMMON MISCONCEPTIONS (mandatory for lesson/activity/concept tools):',
    'For THIS subtopic, list:',
    '1. Misconception — what students wrongly believe',
    '2. Why they think it — cognitive or prior experience reason',
    '3. Correction strategy — exact teacher move (demo, counter-example, analogy)',
    'Never write "students may have misconceptions" without naming them.',
  ].join('\n');
}

export function buildVisualLearningBlock() {
  return [
    'VISUAL LEARNING SUGGESTIONS (name the type and what to draw):',
    'Flowchart / Mind map / Timeline / Comparison table / Labelled diagram / Concept map / Infographic outline.',
    'Specify what each node/box contains for THIS subtopic — not "draw a diagram".',
  ].join('\n');
}

export function buildClassroomEngagementBlock() {
  return [
    'CLASSROOM ENGAGEMENT — weave in where schema allows:',
    'Icebreaker (2 min), Poll/show of hands, Think-Pair-Share (prompt + share format),',
    'Quick quiz (3 items), Peer discussion (roles), Reflection (1 min), Exit ticket (one question).',
  ].join('\n');
}
