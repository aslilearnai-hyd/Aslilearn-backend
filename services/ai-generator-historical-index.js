import AiToolGeneration from '../models/AiToolGeneration.js';

import {

  loadHistoricalFingerprints,

  countExistingGenerations,

  scopeQuery,

  normalizeScope,

} from './ai-generator-fingerprint-service.js';

import { extractTitleFromStructured } from './ai-generator-content-extractor.js';

import { collectForbiddenOpenings } from '../utils/ai-generator-dedup.js';

import { computeTopicSaturation } from './ai-generator-topic-saturation.js';
import { isAiGeneratorCostSaverEnabled } from '../utils/ai-generator-batch-config.js';



const ORIGINALITY_PREAMBLE = `ORIGINALITY REQUIREMENT (mandatory):

Generate completely original educational content for this curriculum slot.

Do NOT repeat or closely resemble any previously generated content stored in the system.

Do NOT reuse question wording, activity descriptions, assignment prompts, flashcard fronts/backs, worksheet items, or titles from historical generations.

Create entirely new educational material with fresh examples, scenarios, and question phrasing.`;



function getHistoricalPromptLimit() {
  if (isAiGeneratorCostSaverEnabled()) {
    const eco = Number(process.env.AI_GENERATOR_HISTORICAL_PROMPT_LIMIT_ECONOMY);
    if (Number.isFinite(eco) && eco > 0) return Math.min(eco, 10);
    return 3;
  }
  const n = Number(process.env.AI_GENERATOR_HISTORICAL_PROMPT_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 20;
}



function getFingerprintPromptLimit() {
  if (isAiGeneratorCostSaverEnabled()) return 5;
  const n = Number(process.env.AI_GENERATOR_FINGERPRINT_PROMPT_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 20;
}



/**

 * Load compact historical context — NEVER full history (scales to 100k+ records).

 * Uses: existing count, top-N recent records, top-N fingerprint samples only.

 * @param {Record<string, unknown>} scope

 */

export async function buildHistoricalGenerationContext(scope) {

  const s = normalizeScope(scope);

  const existingCount = await countExistingGenerations(s);

  const saturation = await computeTopicSaturation(s);

  const query = scopeQuery(s);

  const promptLimit = getHistoricalPromptLimit();
  const economyMode = isAiGeneratorCostSaverEnabled();

  const recentRecords = await AiToolGeneration.find(query)

    .sort({ createdAt: -1 })

    .limit(promptLimit)

    .select('generatedContent metadata createdAt')

    .lean();



  const titles = [];

  const questionSnippets = [];

  const objectiveSnippets = [];

  const activitySnippets = [];



  for (const rec of recentRecords) {

    const structured =

      rec.metadata?.structuredContent && typeof rec.metadata.structuredContent === 'object'

        ? rec.metadata.structuredContent

        : {};

    const title = extractTitleFromStructured(structured);

    if (title) titles.push(title);



    const qs = extractQuestionSnippetsFromStructured(structured, 3);

    questionSnippets.push(...qs);



    for (const o of structured.learning_objectives || structured.objectives || []) {

      if (String(o || '').trim()) objectiveSnippets.push(String(o).trim().slice(0, 120));

    }

    for (const a of structured.teaching_activities || structured.activities || []) {

      if (String(a || '').trim()) activitySnippets.push(String(a).trim().slice(0, 120));

    }

  }



  const fingerprints = economyMode
    ? { title: [], question: [], all: [] }
    : await loadHistoricalFingerprints(s, {
        limit: getFingerprintPromptLimit() * 10,
      });



  const fpTitleSamples = (fingerprints.title || [])

    .slice(0, getFingerprintPromptLimit())

    .map((r) => String(r.originalText || '').slice(0, 80))

    .filter(Boolean);

  const fpQuestionSamples = (fingerprints.question || [])

    .slice(0, getFingerprintPromptLimit())

    .map((r) => String(r.originalText || '').slice(0, 100))

    .filter(Boolean);



  const forbiddenOpenings = collectForbiddenOpenings(

    recentRecords.map((r) => r.generatedContent || '').filter(Boolean),

    6,

  );



  const summaryLines = [

    `Existing records in this slot: ${existingCount}. Saturation: ${saturation.saturationLevel} (score ${saturation.topicSaturationScore}). Your variant must expand the library (record #${existingCount + 1}+), not duplicate prior content.`,

    `Historical prompt uses only the ${promptLimit} most recent records — not the full ${existingCount} record archive.`,

  ];



  const uniqueTitles = [...new Set([...titles, ...fpTitleSamples])].slice(0, promptLimit);

  const uniqueQuestions = [...new Set([...questionSnippets, ...fpQuestionSamples])].slice(

    0,

    promptLimit,

  );



  if (uniqueTitles.length) {

    summaryLines.push(`Recent titles (do NOT reuse): ${uniqueTitles.join(' | ')}`);

  }

  if (uniqueQuestions.length) {

    summaryLines.push(`Recent questions (write NEW): ${uniqueQuestions.join(' || ')}`);

  }

  if (!economyMode && objectiveSnippets.length) {

    summaryLines.push(`Recent objectives (write NEW): ${[...new Set(objectiveSnippets)].slice(0, 8).join(' | ')}`);

  }

  if (!economyMode && forbiddenOpenings.length) {

    summaryLines.push(`Avoid openings similar to: ${forbiddenOpenings.join(' | ')}`);

  }



  if (!economyMode) {
    summaryLines.push(`Fingerprint index sample size: ${fingerprints.all.length} (of ${saturation.fingerprintCount} total in slot)`);
  }



  const promptBlock = economyMode
    ? [
        `Library: ${existingCount} existing record(s). Write original ${s.subject || 'topic'} content — do not reuse prior titles.`,
        uniqueTitles.length ? `Avoid these recent titles: ${uniqueTitles.slice(0, 3).join(' | ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : `${ORIGINALITY_PREAMBLE}\n\nHISTORICAL CONTENT INDEX (compact — top ${promptLimit} nearest):\n${summaryLines.join('\n')}`;

  return {

    existingCount,

    recordCount: existingCount,

    saturation,

    promptBlock,

    titles: uniqueTitles,

    questionSnippets: uniqueQuestions,

    fingerprints,

    forbiddenOpenings,

    recentRecordLimit: promptLimit,

  };

}



function extractQuestionSnippetsFromStructured(structured, limit = 20) {

  const out = [];

  if (!structured || typeof structured !== 'object') return out;



  const pushQ = (q) => {

    const text = typeof q === 'string' ? q : String(q?.question || q?.prompt || q?.text || '').trim();

    if (text.length >= 10) out.push(text.slice(0, 140));

  };



  for (const q of structured.questions || []) pushQ(q);

  for (const sec of structured.sections || []) {

    for (const q of sec?.questions || []) pushQ(q);

  }

  for (const key of ['section_a', 'section_b', 'section_c', 'section_d', 'section_e']) {

    for (const q of structured[key] || []) pushQ(q);

  }

  return out.slice(0, limit);

}



export { ORIGINALITY_PREAMBLE };


