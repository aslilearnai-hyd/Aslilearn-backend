/** Output token budget per tool — 2200 was truncating multi-section JSON (empty sections). */
const HEAVY_TOOLS = new Set([
  'story-passage-creator',
  'reading-practice-room',
  'mock-test-builder',
  'exam-question-paper-generator',
  'smart-qa-practice-generator',
  'lesson-planner',
  'study-schedule-maker',
  'activity-project-generator',
  'project-idea-lab',
]);

const MEDIUM_TOOLS = new Set([
  'concept-mastery-helper',
  'smart-study-guide-generator',
  'chapter-summary-creator',
  'concept-breakdown-explainer',
  'key-points-formula-extractor',
  'flashcard-generator',
  'my-study-decks',
  'daily-class-plan-maker',
  'homework-creator',
  'worksheet-mcq-generator',
  'quick-assignment-builder',
  'short-notes-summaries-maker',
]);

export function getAiGeneratorMaxTokens(toolSlug, options = {}) {
  const slug = String(toolSlug || '').trim();
  const qualityTier = String(options.qualityTier || '').toLowerCase();
  const qualityTierProtectsBudget = qualityTier === 'premium' || qualityTier === 'balanced';
  const skipUltra = options.skipUltraEconomyCaps === true || qualityTierProtectsBudget;
  const ultra =
    !skipUltra &&
    (String(process.env.AI_GENERATOR_ULTRA_ECONOMY ?? 'false').trim().toLowerCase() === 'true' ||
      String(process.env.AI_GENERATOR_ULTRA_ECONOMY ?? 'false').trim() === '1');
  const costSaver = !qualityTierProtectsBudget &&
    String(process.env.AI_GENERATOR_COST_SAVER ?? 'false').trim().toLowerCase() !== 'false' &&
    String(process.env.AI_GENERATOR_COST_SAVER ?? 'false').trim().toLowerCase() !== '0' &&
    String(process.env.AI_GENERATOR_COST_SAVER ?? 'false').trim().toLowerCase() !== 'off';
  const padEnabled =
    String(process.env.AI_GENERATOR_SECTION_PAD ?? 'false').trim().toLowerCase() !== 'false' &&
    String(process.env.AI_GENERATOR_SECTION_PAD ?? 'false').trim().toLowerCase() !== '0' &&
    String(process.env.AI_GENERATOR_SECTION_PAD ?? 'false').trim().toLowerCase() !== 'off';
  // Smart Q&A now has a compact A-G schema. A 10-question paper fits well below
  // the generic heavy-tool ceiling; the lower cap prevents verbose/runaway
  // completions while retaining enough room for worked answers.
  if (slug === 'smart-qa-practice-generator') {
    const base = ultra ? 4200 : costSaver ? 4800 : 6500;
    return Math.min(
      8000,
      Math.max(3000, Number(process.env.AI_GENERATOR_MAX_TOKENS_SMART_QA) || base),
    );
  }
  if (HEAVY_TOOLS.has(slug)) {
    const base = ultra ? 4200 : costSaver ? 4800 : padEnabled ? 7000 : 10000;
    return Math.min(16000, Math.max(3000, Number(process.env.AI_GENERATOR_MAX_TOKENS_HEAVY) || base));
  }
  if (MEDIUM_TOOLS.has(slug)) {
    const base = ultra ? 2600 : costSaver ? 3400 : padEnabled ? 5000 : 7000;
    return Math.min(12000, Math.max(2000, Number(process.env.AI_GENERATOR_MAX_TOKENS_MEDIUM) || base));
  }
  const base = ultra ? 2200 : costSaver ? 2800 : padEnabled ? 3500 : 5000;
  return Math.min(8000, Math.max(1800, Number(process.env.AI_GENERATOR_MAX_TOKENS_DEFAULT) || base));
}
