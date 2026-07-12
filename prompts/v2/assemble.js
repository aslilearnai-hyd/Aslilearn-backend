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
/** Distinct primary focus per generation — rotates so N papers on ONE subtopic
 *  differ in KIND, not just numbers. This is the strongest anti-repetition lever. */
const VARIANT_FOCI = [
  'NUMERICAL & problem-solving — mostly calculation/formula-application questions with fresh values',
  'CONCEPTUAL — definitions, "why/how" reasoning, and understanding-check questions',
  'APPLICATION & real-world case scenarios grounded in Indian daily life',
  'DIAGRAM / GRAPH / data-interpretation — sketch, label, read-off, and analyse questions',
  'COMPARISON, assertion-reason, and error/misconception analysis',
  'MIXED higher-order thinking (HOTS) — multi-step, evaluate, and design questions',
];

export function buildV2VariantHint({ variantIndex, batchSize, angle, scenario, seed } = {}) {
  const idx = Number(variantIndex) || 1;
  const total = Number(batchSize) || 0;
  const focus = VARIANT_FOCI[(idx - 1) % VARIANT_FOCI.length];
  return [
    `VARIANT ${idx}${total ? ` OF ${total}` : ''} — MANDATORY DIFFERENTIATION (STRICT FRESHNESS RULE)`,
    `Many papers are generated for the SAME subtopic. This is variant #${idx}. It MUST be substantially different from every other variant — a teacher comparing them should NOT feel they are the same paper reworded.`,
    `PRIMARY FOCUS for THIS variant (make most questions fit this): ${focus}.`,
    'Use COMPLETELY DIFFERENT specific numbers, coefficients, equations, ions, cells, values, names, and contexts than a typical or previous version would use. Change the actual problems, not just the numbers.',
    'Do NOT fall back to the most common textbook examples for this concept — they repeat across variants. Invent genuinely fresh problems every time.',
    `${angle ? `Secondary angle: ${angle}.` : ''}${scenario ? ` Scenario flavour: ${scenario}.` : ''}`,
    'No question may be a minor reword of a "standard" version or of another variant. Vary the title wording too.',
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

  // Cross-slot dedup: the caller passes the exact problems already used for this
  // subtopic (this batch + recent saved records) so the model cannot repeat them.
  const avoid = Array.isArray(opts.avoidQuestions)
    ? opts.avoidQuestions.map((q) => String(q || '').trim()).filter(Boolean).slice(0, 40)
    : [];
  const avoidBlock = avoid.length
    ? [
        `ALREADY-USED PROBLEMS — DO NOT REPEAT OR LIGHTLY REWORD ANY OF THESE ${avoid.length} (they were used in other papers on this SAME subtopic). Every question you write must be genuinely different:`,
        ...avoid.map((q, i) => `${i + 1}. ${q.slice(0, 150)}`),
        'If any draft question matches one above in its underlying problem, numbers pattern, or scenario, THROW IT OUT and write a fresh, different one.',
      ].join('\n')
    : '';

  const prompt = [
    MASTER_SYSTEM_PROMPT,
    pack.instructions,
    boardLayer,
    ragLayer,
    iitLayer,
    userBlock,
    multiSubtopicBlock,
    variantBlock,
    avoidBlock,
    `Return the JSON now, exactly in this shape (fill every field with real content):\n${pack.responseSchema}`,
    'Output ONLY the JSON object with all six sections. No prose, no code fences.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { prompt, responseSchema: pack.responseSchema, supported: true };
}
