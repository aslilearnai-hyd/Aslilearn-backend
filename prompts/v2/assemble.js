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
 * @param {string} toolSlug
 * @param {{ board?:string, classLabel?:string, subject?:string, topic?:string, subTopic?:string }} params
 * @param {{ ragContext?:string }} [opts]
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

  const prompt = [
    MASTER_SYSTEM_PROMPT,
    pack.instructions,
    boardLayer,
    ragLayer,
    iitLayer,
    userBlock,
    `Return the JSON now, exactly in this shape (fill every field with real content):\n${pack.responseSchema}`,
    'Output ONLY the JSON object with all six sections. No prose, no code fences.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { prompt, responseSchema: pack.responseSchema, supported: true };
}
