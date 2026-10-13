import crypto from 'node:crypto';

export const EXAM_PROFILES = Object.freeze({
  FOUNDATION: { difficulty: ['easy', 'medium'], reasoningSteps: [1, 2], sourceTypes: ['textbook', 'notes'] },
  BOARD: { difficulty: ['easy', 'medium', 'hard'], reasoningSteps: [1, 2, 3], sourceTypes: ['textbook', 'notes', 'question_bank'] },
  JEE_MAIN: { difficulty: ['medium', 'hard'], reasoningSteps: [2, 3, 4], sourceTypes: ['textbook', 'coaching', 'question_bank'] },
  JEE_ADVANCED: { difficulty: ['hard'], reasoningSteps: [4, 5, 6], sourceTypes: ['textbook', 'coaching', 'question_bank'] },
  NEET: { difficulty: ['medium', 'hard'], reasoningSteps: [1, 2, 3], sourceTypes: ['textbook', 'coaching', 'question_bank'] },
});

function clean(value) {
  return String(value || '').trim();
}

export function normalizeExamProfile(value = '') {
  const key = clean(value).toUpperCase().replace(/[\s/-]+/g, '_');
  if (key.includes('ADVANCED')) return 'JEE_ADVANCED';
  if (key.includes('JEE')) return 'JEE_MAIN';
  if (key.includes('NEET')) return 'NEET';
  if (key.includes('FOUNDATION')) return 'FOUNDATION';
  return 'BOARD';
}

function subjectFamily(subject = '') {
  const value = clean(subject).toLowerCase();
  if (/math/.test(value)) return 'mathematics';
  if (/chem/.test(value)) return 'chemistry';
  if (/physics/.test(value)) return 'physics';
  if (/biology|botany|zoology/.test(value)) return 'biology';
  return 'general';
}

function representationFor(family, index, profile) {
  if (family === 'mathematics') return index % 3 === 2 ? 'graph_or_geometry' : 'equation_numerical';
  if (family === 'chemistry') return index % 3 === 1 ? 'chemical_equation' : 'text';
  if (family === 'physics') return index % 3 === 0 ? 'diagram_plus_numerical' : 'equation_numerical';
  if (family === 'biology') return profile === 'NEET' && index % 3 === 0 ? 'source_figure' : 'text';
  return 'text';
}

function bloomFor(difficulty, index) {
  if (difficulty === 'hard') return index % 2 ? 'analyse' : 'apply';
  if (difficulty === 'medium') return index % 2 ? 'understand' : 'apply';
  return index % 2 ? 'remember' : 'understand';
}

function signatureFor(slot) {
  return crypto
    .createHash('sha256')
    .update([
      slot.examProfile,
      slot.difficulty,
      slot.bloom,
      slot.representation,
      slot.reasoningSteps,
      ...(slot.conceptIds || []),
    ].join('|'))
    .digest('hex')
    .slice(0, 20);
}

/**
 * Backend-owned assessment plan. Gemini writes assigned slots; it does not
 * choose curriculum scope, difficulty, representation, or historical gaps.
 */
export function planQuestionSlots(options = {}) {
  const count = Math.max(1, Math.min(100, Number(options.count) || 5));
  const examProfile = normalizeExamProfile(options.examProfile || options.productCategory);
  const profile = EXAM_PROFILES[examProfile];
  const family = subjectFamily(options.subject);
  const concepts = (Array.isArray(options.conceptIds) ? options.conceptIds : [options.subtopic, options.topic])
    .map(clean)
    .filter(Boolean);
  const historical = new Set(
    (Array.isArray(options.forbiddenSignatures) ? options.forbiddenSignatures : [])
      .map(clean)
      .filter(Boolean),
  );
  const slots = [];
  let cursor = Math.max(0, Number(options.variantIndex || options.generationVariant || 1) - 1);
  let guard = 0;
  while (slots.length < count && guard < count * 20) {
    const difficulty = profile.difficulty[cursor % profile.difficulty.length];
    const representation = representationFor(family, cursor, examProfile);
    const visualRequired = ['graph_or_geometry', 'diagram_plus_numerical', 'source_figure'].includes(representation);
    const equationRequired = ['equation_numerical', 'chemical_equation', 'diagram_plus_numerical'].includes(representation);
    const concept = concepts.length ? concepts[cursor % concepts.length] : 'CURRICULUM_SCOPE';
    const slot = {
      slotId: `Q${slots.length + 1}`,
      examProfile,
      difficulty,
      bloom: bloomFor(difficulty, cursor),
      conceptIds: [concept],
      reasoningSteps: profile.reasoningSteps[cursor % profile.reasoningSteps.length],
      representation,
      visualRequired,
      equationRequired,
      sourceTypePreference: [...profile.sourceTypes],
      forbiddenSignatures: [...historical].slice(-200),
    };
    slot.signature = signatureFor(slot);
    cursor += 1;
    guard += 1;
    if (historical.has(slot.signature)) continue;
    historical.add(slot.signature);
    slots.push(slot);
  }
  return slots;
}

export function buildQuestionSlotPrompt(slots = []) {
  if (!Array.isArray(slots) || !slots.length) return '';
  return `QUESTION SLOT PLAN (backend-owned; fill every slot exactly once):\n${JSON.stringify(slots)}\nReturn slotId, sourceChunkIds, sourceAssetIds, equationIds and validationFlags with each generated question. If a required source is absent, return INSUFFICIENT_CONTEXT or INSUFFICIENT_VISUAL_CONTEXT for that slot.`;
}

export function buildGenerationCountTelemetry({ attempted = 0, generated = 0, repaired = 0 } = {}) {
  return {
    attempt_count: Math.max(0, Number(attempted) || 0),
    generated_count: Math.max(0, Number(generated) || 0),
    repaired_count: Math.max(0, Number(repaired) || 0),
  };
}

/** Attach backend-controlled slot/source metadata in stable document order. */
export function applyQuestionSlotMetadata(structured = {}, slots = [], sources = {}) {
  const copy = JSON.parse(JSON.stringify(structured || {}));
  let cursor = 0;
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const isQuestion = clean(value.question || value.stem || value.prompt).length >= 4;
    if (isQuestion && cursor < slots.length) {
      const slot = slots[cursor];
      value.slotId = slot.slotId;
      value.examProfile = slot.examProfile;
      value.difficulty = value.difficulty || slot.difficulty;
      value.bloom = value.bloom || slot.bloom;
      value.conceptIds = Array.isArray(value.conceptIds) && value.conceptIds.length
        ? value.conceptIds
        : slot.conceptIds;
      value.reasoningSteps = Number(value.reasoningSteps) || slot.reasoningSteps;
      value.representation = value.representation || slot.representation;
      value.sourceChunkIds = Array.isArray(value.sourceChunkIds) && value.sourceChunkIds.length
        ? value.sourceChunkIds
        : (sources.sourceChunkIds || []);
      value.sourceAssetIds = Array.isArray(value.sourceAssetIds) && value.sourceAssetIds.length
        ? value.sourceAssetIds
        : slot.visualRequired
          ? (sources.sourceAssetIds || [])
          : [];
      value.validationFlags = Array.isArray(value.validationFlags) ? value.validationFlags : [];
      cursor += 1;
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  };
  walk(copy);
  return { structuredContent: copy, assignedCount: cursor };
}
