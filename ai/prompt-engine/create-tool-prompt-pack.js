/**
 * Factory for per-tool prompt packs — shared structure, tool-specific blocks.
 * @module prompts/create-tool-prompt-pack
 */

import { buildEducatorSystemPrompt, buildUniversalQualityBlock } from './shared/educator-persona.js';
import { buildGradeLevelBlock } from './shared/grade-level.js';
import { buildSubjectAwarenessBlock } from './shared/subject-awareness.js';
import { buildPrecisionGenerationBlock } from './shared/precision-generation.js';
import {
  buildPedagogyDepthBlock,
  buildDifferentiationBlock,
  buildTeacherScriptBlock,
  buildBloomQuestionBlock,
  buildMisconceptionBlock,
  buildVisualLearningBlock,
  buildClassroomEngagementBlock,
} from './shared/pedagogy-depth.js';

/**
 * @typedef {object} ToolPromptPackConfig
 * @property {string} slug
 * @property {string} toolTitle
 * @property {string} [focus] one-line tool mission
 * @property {string[]} [generationRules] tool-specific generation instructions
 * @property {string[]} [rewriteRules] extra retry guidance
 * @property {string[]} [repairRules] section repair guidance
 * @property {boolean} [includeTeacherScript]
 * @property {boolean} [includeMisconceptions]
 * @property {boolean} [includeBloom]
 * @property {boolean} [includeDifferentiation]
 * @property {boolean} [includeVisualLearning]
 * @property {boolean} [includeEngagement]
 * @property {boolean} [includePedagogyChecklist]
 */

/**
 * @param {ToolPromptPackConfig} config
 * @returns {import('../prompt-registry/types.js').ToolPromptPack}
 */
export function createToolPromptPack(config) {
  const {
    slug,
    toolTitle,
    focus = '',
    generationRules = [],
    rewriteRules = [],
    repairRules = [],
    includeTeacherScript = false,
    includeMisconceptions = false,
    includeBloom = false,
    includeDifferentiation = true,
    includeVisualLearning = false,
    includeEngagement = false,
    includePedagogyChecklist = false,
  } = config;

  const buildGenerationExtras = (ctx) => {
    const blocks = [
      focus ? `TOOL MISSION: ${focus}` : '',
      buildPrecisionGenerationBlock(),
      buildGradeLevelBlock(ctx.classLabel || ctx.gradeLevel),
      buildSubjectAwarenessBlock(ctx.subject),
      includePedagogyChecklist ? buildPedagogyDepthBlock() : '',
      includeTeacherScript ? buildTeacherScriptBlock() : '',
      includeMisconceptions ? buildMisconceptionBlock() : '',
      includeBloom ? buildBloomQuestionBlock() : '',
      includeDifferentiation ? buildDifferentiationBlock() : '',
      includeVisualLearning ? buildVisualLearningBlock() : '',
      includeEngagement ? buildClassroomEngagementBlock() : '',
      ...generationRules,
    ].filter(Boolean);
    return blocks.join('\n\n');
  };

  return {
    slug,
    toolTitle,

    system(ctx = {}) {
      return [
        buildEducatorSystemPrompt({ toolTitle }),
        buildUniversalQualityBlock(),
      ].join('\n\n');
    },

    generation(ctx = {}) {
      return buildGenerationExtras(ctx);
    },

    rewrite(ctx = {}) {
      const {
        attempt = 1,
        validationMessage = '',
        missingSections = [],
      } = ctx;
      const missingHint = missingSections.length
        ? `Missing sections: ${missingSections.join('; ')}.`
        : '';
      return [
        `QUALITY REWRITE (attempt ${attempt}): Previous output failed: ${validationMessage || 'quality check'}.`,
        missingHint,
        'Rewrite with SPECIFIC classroom detail — no generic instructions.',
        buildTeacherScriptBlock(),
        buildUniversalQualityBlock(),
        ...rewriteRules,
      ]
        .filter(Boolean)
        .join('\n\n');
    },

    repair(ctx = {}) {
      const { missingSections = [], topic = '', subTopic = '' } = ctx;
      return [
        `Repair ONLY these missing sections for ${toolTitle}: ${missingSections.join('; ')}`,
        `Subtopic: ${subTopic || topic} — every repaired field must reference this subtopic specifically.`,
        'Write as a senior CBSE educator. No placeholders. No generic phrases.',
        buildUniversalQualityBlock(),
        ...repairRules,
      ]
        .filter(Boolean)
        .join('\n\n');
    },
  };
}
