/**
 * V2 six-section prompt assembler.
 * Stitches Master + Tool Pack + Board + [RAG] + [IIT] + user input into one prompt,
 * in the exact order defined by the spec, and returns the response JSON schema.
 */

import { MASTER_SYSTEM_PROMPT } from './master-prompt.js';
import { buildToolPack } from './tool-packs.js';
import { buildBoardLayer, buildRagLayer, buildIitLayer } from './layers.js';

/** Feature flag — on by default; set AI_GENERATOR_V2_SIX_SECTION=off to disable. */
export function isSixSectionV2Enabled() {
  const raw = String(process.env.AI_GENERATOR_V2_SIX_SECTION ?? 'on').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/**
 * Build a per-variant differentiation directive so multiple generations for the
 * SAME topic diverge (different questions, examples, framing) instead of coming
 * out near-identical. Pass the result as opts.variantHint to generateSixSectionContent.
 * @param {{ variantIndex:number, batchSize?:number, angle?:string, scenario?:string, seed?:string|number }} p
 */
export function buildV2VariantHint({ variantIndex, batchSize, angle, scenario, seed } = {}) {
  const idx = Number(variantIndex) || 1;
  const total = Number(batchSize) || 0;
  return [
    `VARIANT ${idx}${total ? ` OF ${total}` : ''} — MANDATORY DIFFERENTIATION`,
    `Several variants are generated for the SAME board/class/subject/topic/subtopic. This is variant #${idx}.`,
    'Produce a DISTINCT variant: use DIFFERENT question stems, different numbers/data/examples, and a fresh framing',
    `${angle ? `angle (${angle})` : 'angle'}${scenario ? ` with a different real-life scenario (${scenario})` : ''}.`,
    'Do NOT reuse the wording, questions, or examples another variant for this exact topic would produce. Vary the title wording too.',
    seed ? `Uniqueness key (do not print in output): ${seed}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {string} toolSlug
 * @param {{ board?:string, classLabel?:string, subject?:string, topic?:string, subTopic?:string }} params
 * @param {{ ragContext?:string, variantHint?:string }} [opts]
 * @returns {{ prompt:string, responseSchema:string, supported:boolean } | { supported:false }}
 */
export function assembleSixSectionPrompt(toolSlug, params = {}, opts = {}) {
  const pack = buildToolPack(toolSlug);
  if (!pack) return { supported: false };

  const board = params.board || 'CBSE';
  const boardLayer = buildBoardLayer({ board, classLabel: params.classLabel, subject: params.subject });
  const ragLayer = buildRagLayer(opts.ragContext);
  const iitLayer = buildIitLayer({ board });

  const userBlock = [
    'USER PARAMETERS',
    `Board/Level: ${board}`,
    `Class: ${params.classLabel || ''}`,
    `Subject: ${params.subject || ''}`,
    `Chapter/Topic: ${params.topic || ''}`,
    `Subtopic: ${params.subTopic || params.subtopic || ''}`,
  ].join('\n');

  // Per-variant differentiation: multiple variants are generated for the SAME
  // topic. Without this each variant is near-identical. The hint carries a
  // distinct angle/scenario/seed so variants diverge in questions and examples.
  const variantBlock = opts.variantHint ? String(opts.variantHint).trim() : '';

  const prompt = [
    MASTER_SYSTEM_PROMPT,
    pack.instructions,
    boardLayer,
    ragLayer,
    iitLayer,
    userBlock,
    variantBlock,
    `Return the JSON now, exactly in this shape (fill every field with real content):\n${pack.responseSchema}`,
    'Output ONLY the JSON object with all six sections. No prose, no code fences.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { prompt, responseSchema: pack.responseSchema, supported: true };
}
