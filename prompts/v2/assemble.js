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
    `VARIANT ${idx}${total ? ` OF ${total}` : ''} — MANDATORY DIFFERENTIATION (FRESHNESS RULE)`,
    `Several variants are generated for the SAME board/class/subject/subtopic. This is variant #${idx}. It MUST be substantially different from the others.`,
    'Use COMPLETELY DIFFERENT specific numbers, coefficients, equations, values, names, and real-world contexts than a typical or previous version of this topic would use.',
    'Do NOT fall back to the most common textbook examples for this concept (they repeat across variants). Invent fresh problems every time.',
    `${angle ? `Framing angle: ${angle}.` : ''}${scenario ? ` Real-life scenario: ${scenario}.` : ''}`,
    'No question here may be a minor reword of a "standard" version. Vary the title wording too.',
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
  const iitLayer = buildIitLayer({ board, classLabel: params.classLabel });

  // Multiple subtopics → one COMBINED paper spanning all of them (like a unit test).
  const subTopicList = Array.isArray(params.subTopics)
    ? params.subTopics.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const isMultiSubtopic = subTopicList.length > 1;
  const subtopicLine = isMultiSubtopic
    ? `Subtopics (COMBINED — cover ALL): ${subTopicList.join(' | ')}`
    : `Subtopic: ${params.subTopic || params.subtopic || subTopicList[0] || ''}`;

  const userBlock = [
    'USER PARAMETERS',
    `Board/Level: ${board}`,
    `Class: ${params.classLabel || ''}`,
    `Subject: ${params.subject || ''}`,
    `Chapter/Topic: ${params.topic || ''}`,
    subtopicLine,
  ].join('\n');

  const multiSubtopicBlock = isMultiSubtopic
    ? [
        `MULTI-SUBTOPIC COMBINED PAPER (mandatory): This is ONE combined ${'paper/worksheet'} covering ${subTopicList.length} subtopics — ${subTopicList.join('; ')}.`,
        'Distribute questions ACROSS ALL listed subtopics as evenly as the format allows — do not focus on only one. Every listed subtopic must be represented.',
        'Where the tool has sections, spread each subtopic through the sections rather than grouping one subtopic per section.',
        'In each question, make clear (in the answer key / working) which subtopic it targets.',
      ].join('\n')
    : '';

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
    multiSubtopicBlock,
    variantBlock,
    `Return the JSON now, exactly in this shape (fill every field with real content):\n${pack.responseSchema}`,
    'Output ONLY the JSON object with all six sections. No prose, no code fences.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { prompt, responseSchema: pack.responseSchema, supported: true };
}
