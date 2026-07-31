import { canonicalStoryPassageSubject } from '../../shared/story-passage-subject.js';
import {
  PRECISION_VARIANT_FOCUSES,
  getPrecisionVariantFocus,
} from '../../prompt-engine/shared/precision-generation.js';

/**
 * Variant “angles” are precision classroom focuses — not story/market scenarios.
 * Kept under the old export names so batch orchestrators keep working.
 */
export const AI_GENERATOR_VARIANT_ANGLES = PRECISION_VARIANT_FOCUSES;

/** Legacy list retained for combination-count math only — never injected into prompts. */
export const AI_GENERATOR_VARIANT_SCENARIOS = Object.freeze([
  'precision-definitions',
  'precision-numericals',
  'precision-cause-effect',
  'precision-compare-contrast',
  'precision-misconceptions',
  'precision-exam-style',
  'precision-data-units',
  'precision-assertion',
]);

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
  // Story/reading tools still get a language-safe focus; never market/adventure frames.
  if (isMonolingualStorySubject(subject)) {
    return 'Definitions, vocabulary, and comprehension questions in the output language only';
  }
  return getPrecisionVariantFocus(n);
}

export function getAiGeneratorVariantScenario(variantIndex, subject = '') {
  // Precision mode: never inject scenario flavour into generation.
  void variantIndex;
  void subject;
  return '';
}
