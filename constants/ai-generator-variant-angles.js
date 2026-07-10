import { canonicalStoryPassageSubject } from '../utils/story-passage-subject.js';

/** Base creative angles — combined programmatically with scenarios for 1000+ unique pairs. */
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
  'Map-based or geography-linked exploration',
  'Timeline or cause-effect chain reasoning',
  'Case study from Indian news or community context',
  'Simulation or thought-experiment framing',
  'Peer assessment and self-reflection loop',
  'Inquiry-based discovery with guiding questions',
  'STEM integration with measurement and units',
  'Ethical dilemma or values-education angle',
  'Career connection — how professionals use this idea',
  'Vocabulary-first approach with word webs',
  'Chunked micro-lesson with checkpoint pauses',
  'Reverse teaching — students explain to the class',
  'Gamified challenge with levels and badges',
  'Outdoor learning or nature-linked observation',
  'Digital portfolio artifact creation',
]);

/** Short scenario hooks — paired with angles for large combination space. */
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
  'a railway station crowd scene',
  'a school assembly demonstration',
  'a riverside ecology walk',
  'a community health camp',
  'a solar cooker trial at home',
  'a weather diary for one week',
  'a heritage monument visit',
  'a cooperative group market survey',
  'a kitchen measurement challenge',
  'a classroom election simulation',
  'a local newspaper letter to the editor',
  'a science club exhibition',
  'a math trail around the school',
  'a storytelling corner in the library',
  'a rainwater harvesting model',
]);

const MONOLINGUAL_STORY_ANGLE =
  'Indian cultural story setting (festival, village, or market) — narration entirely in the output language only';

const MONOLINGUAL_STORY_SCENARIO = 'a classroom story-reading circle in the output language';

function isMonolingualStorySubject(subject) {
  const canonical = canonicalStoryPassageSubject(subject);
  return canonical === 'Hindi' || canonical === 'Telugu';
}

export function getVariantCombinationCount() {
  return AI_GENERATOR_VARIANT_ANGLES.length * AI_GENERATOR_VARIANT_SCENARIOS.length;
}

export function getAiGeneratorVariantAngle(variantIndex, subject = '') {
  const n = Math.floor(Number(variantIndex) || 0);
  if (n < 1) return '';
  const idx = (n - 1) % AI_GENERATOR_VARIANT_ANGLES.length;
  const angle = AI_GENERATOR_VARIANT_ANGLES[idx] || '';
  if (isMonolingualStorySubject(subject) && /bilingual|english \+ hindi/i.test(angle)) {
    return MONOLINGUAL_STORY_ANGLE;
  }
  return angle;
}

export function getAiGeneratorVariantScenario(variantIndex, subject = '') {
  // Scenarios are kept for batch metadata only — not injected into question text (precision mode).
  void variantIndex;
  void subject;
  return '';
}
