/** 25 distinct creative angles — one per batch variant for Super Admin AI Generator. */
export const AI_GENERATOR_VARIANT_ANGLES = Object.freeze([
  'Hands-on lab or demonstration with everyday materials',
  'Real-life Indian context (market, farm, festival, transport, or home)',
  'Visual / diagram-first explanation with labelled sketch prompts',
  'Story-based or narrative hook before the concept',
  'Group discussion and peer-teaching activity',
  'Problem-solving with a new numerical or scenario twist',
  'Compare-and-contrast two related ideas within the subtopic',
  'Misconception busting — address a common student error',
  'Quick quiz / rapid-fire recall with fresh question wording',
  'Application to environment, health, or civic life',
  'Historical or scientist discovery angle where relevant',
  'Technology / digital tool connection (apps, maps, simulations)',
  'Art, craft, or creative expression linked to the concept',
  'Sports, games, or puzzles as the learning frame',
  'Local language / bilingual cue words (English + Hindi terms if applicable)',
  'Higher-order thinking (analyse, evaluate, design)',
  'Cross-curricular link (science ↔ maths ↔ social science)',
  'Data table, graph, or pattern observation task',
  'Role-play, debate, or courtroom-style reasoning',
  'Field observation or home survey mini-project',
  'Revision mnemonic, rhyme, or memory palace hook',
  'Exam-style application with marks and marking hints',
  'Differentiated support — scaffold for struggling learners',
  'Extension challenge for advanced learners',
  'Project output — poster, model, comic strip, or presentation',
]);

export function getAiGeneratorVariantAngle(variantIndex) {
  const n = Math.floor(Number(variantIndex) || 0);
  if (n < 1) return '';
  const idx = (n - 1) % AI_GENERATOR_VARIANT_ANGLES.length;
  return AI_GENERATOR_VARIANT_ANGLES[idx] || '';
}

/** Short scenario hooks so fallback/scaffold text differs per variant even when the model fails. */
export const AI_GENERATOR_VARIANT_SCENARIOS = Object.freeze([
  'a local market visit',
  'a school science fair booth',
  'a neighbourhood tree-planting drive',
  'a village sports day',
  'a classroom debate',
  'a home kitchen experiment',
  'a map-and-route planning task',
  'a monsoon preparedness drill',
  'a craft period studio',
  'a peer tutoring circle',
  'a data collection survey',
  'a museum-style gallery walk',
  'a festival preparation committee',
  'a farm/field observation trip',
  'a puzzle-and-game station',
  'a bilingual word-wall activity',
  'a design challenge hackathon',
  'a newspaper headline analysis',
  'a role-play courtroom',
  'a poster-making campaign',
  'a mnemonic song rehearsal',
  'a timed exam practice round',
  'a step-by-step scaffold worksheet',
  'an advanced extension lab',
  'a comic-strip storyboard',
]);

export function getAiGeneratorVariantScenario(variantIndex) {
  const n = Math.floor(Number(variantIndex) || 0);
  if (n < 1) return '';
  return AI_GENERATOR_VARIANT_SCENARIOS[(n - 1) % AI_GENERATOR_VARIANT_SCENARIOS.length] || '';
}
