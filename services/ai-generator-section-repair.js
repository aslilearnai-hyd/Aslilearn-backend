import geminiService from './gemini-service.js';
import { getAiToolTemplate } from '../config/aiToolTemplates.js';
import { getAiGeneratorGeminiModel } from '../utils/ai-generator-batch-config.js';
import { buildCanonicalFieldsRetryHint } from '../utils/ai-generator-section-pad.js';
import { extractJsonObject } from '../utils/ai-json-extract.js';
import { resolvePracticeQaTopicLabel } from '../utils/practice-qa-topic-bank.js';
import { getFactBankHint } from '../utils/subject-topic-fact-bank.js';
import { buildStoryPassageLanguagePromptBlock, buildStoryPassageContentPromptBlock, buildStoryPassageMonolingualOverrideBlock } from '../utils/story-passage-subject.js';
import { buildPromptEngineRepairPrompt, isPromptEngineEnabled } from '../prompts/registry.js';

function deepMergeStructured(base, patch) {
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
  for (const [key, val] of Object.entries(patch)) {
    if (val == null) continue;
    if (Array.isArray(val) && val.length) {
      out[key] = val;
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      out[key] = { ...(out[key] && typeof out[key] === 'object' ? out[key] : {}), ...val };
    } else if (String(val).trim()) {
      out[key] = val;
    }
  }
  return out;
}

/**
 * LLM repair pass — generate ONLY missing canonical sections (no local scaffold).
 * @param {string} toolSlug
 * @param {Record<string, unknown>} structured
 * @param {string[]} missingSections
 * @param {Record<string, unknown>} meta
 * @param {string} historicalBlock
 */
export async function repairMissingSectionsViaLlm(
  toolSlug,
  structured,
  missingSections = [],
  meta = {},
  historicalBlock = '',
) {
  const slug = String(toolSlug || '').trim();
  const missing = Array.isArray(missingSections) ? missingSections.filter(Boolean) : [];
  if (!missing.length) return structured;

  const t = getAiToolTemplate(slug);
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const subject = String(meta.subject || 'Science').trim();
  const hint = buildCanonicalFieldsRetryHint(slug, missing);
  const storyLanguageBlock =
    slug === 'reading-practice-room' || slug === 'story-passage-creator'
      ? [
          buildStoryPassageLanguagePromptBlock(subject),
          buildStoryPassageContentPromptBlock(),
          buildStoryPassageMonolingualOverrideBlock(subject),
        ]
          .filter(Boolean)
          .join('\n\n')
      : '';

  const engineRepairBlock = isPromptEngineEnabled()
    ? buildPromptEngineRepairPrompt(slug, {
        ...meta,
        subject,
        topic: meta.topic || '',
        subTopic: topic,
        missingSections: missing,
      })
    : '';

  const prompt = `You are a senior CBSE educator repairing incomplete ${t?.title || slug} JSON for Super Admin AI Generator.

CURRICULUM: ${subject} | Topic: ${meta.topic || ''} | Subtopic: ${topic} | Class: ${meta.classLabel || ''}
${storyLanguageBlock ? `\n${storyLanguageBlock}\n` : ''}

EXISTING structuredContent (preserve all filled fields — do NOT rewrite them):
${JSON.stringify(structured, null, 2)}

MISSING SECTIONS ONLY (generate real, original educational content for each):
${missing.map((m, i) => `${i + 1}. ${m}`).join('\n')}

${hint}

${engineRepairBlock ? `\n${engineRepairBlock}\n` : ''}

${historicalBlock}

Return ONLY valid JSON:
{
  "structuredContent": { ...complete merged object with ALL missing sections filled ... }
}

Rules:
- Fill ONLY missing sections with substantive educator-written content (not placeholders).
- Do NOT repeat questions or activities from the historical index.
- Worksheet tools: ensure Section A MCQs, B Fill blanks, C VSA, D Short answer, E Application each have unique questions.
- Never use banned generic phrases: "Explain the concept", "Discuss with students", "Conduct activity", "Students understand".
- Teacher instructions must include WHO does WHAT with timing and expected student responses.`;

  const model = getAiGeneratorGeminiModel();
  const raw = await geminiService.generateStructuredContent(prompt, 'json', {
    primaryModel: model,
    flashLiteOnly: true,
    temperature: 0.65,
    maxTokens: 8000,
  });
  const json = extractJsonObject(raw);
  const patch =
    json?.structuredContent && typeof json.structuredContent === 'object'
      ? json.structuredContent
      : json && typeof json === 'object'
        ? json
        : {};
  return deepMergeStructured(structured, patch);
}

/**
 * Regenerate flashcard cards[] only — used when batch output is prompt junk or scaffold padding.
 */
export async function repairFlashcardCardsViaLlm(
  toolSlug,
  structured,
  meta = {},
  historicalBlock = '',
) {
  const slug = String(toolSlug || '').trim();
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const subject = String(meta.subject || 'Science').trim();
  const classLabel = String(meta.classLabel || meta.class || '').trim();
  const minCards = slug === 'my-study-decks' ? 10 : 5;
  const variantAngle = String(meta.variantAngle || '').trim();
  const variantScenario = String(meta.variantScenario || '').trim();

  const prompt = `You are a senior ${subject} educator writing a premium flashcard deck for Class ${classLabel || '10'}.

CURRICULUM: ${subject} | Topic: ${meta.topic || ''} | Subtopic: ${topic}
${variantAngle ? `Variant angle: ${variantAngle}` : ''}
${variantScenario ? `Scenario focus: ${variantScenario}` : ''}

TASK: Replace ONLY the flashcard set with ${minCards}–${Math.max(minCards + 2, 8)} original cards about "${topic}".
Keep any good deck title / topic fields from the existing JSON; do NOT return prompt instructions or validation text.

EXISTING deck (for context — rewrite weak cards completely):
${JSON.stringify(
  {
    flashcard_deck_title: structured?.flashcard_deck_title || structured?.deck_title,
    topic: structured?.topic,
    subtopic: structured?.subtopic,
    learning_objectives: structured?.learning_objectives,
    cards: Array.isArray(structured?.cards) ? structured.cards.slice(0, 3) : [],
  },
  null,
  2,
)}

Return ONLY valid JSON:
{
  "cards": [
    {
      "front": "Specific question, scenario, or task about ${topic}",
      "back": "Complete answer with facts, steps, or worked example — not instructions to the student",
      "difficulty_tag_for_each_card": "Remember|Understand|Apply|Analyze",
      "memory_hook_quick_tip": "short mnemonic or visual cue"
    }
  ],
  "application_hots_cards": [ same items as cards ]
}

QUALITY RULES (mandatory):
- Every front is a REAL question/task naming concepts, processes, or examples from ${topic}.
- Every back is a COMPLETE educator-written answer (2–4 sentences or bullet steps) — never "Students should define…" or "give one example".
- Mix card types: recall, application, compare, diagram-describe, short numerical, real-life case.
- FORBIDDEN fronts/backs: "What are the key ideas about…", "Students should define the concept", "key idea 1", "Valid JSON", "No filler", "Ready to export".
- Use chapter-specific terms (e.g. xylem, phloem, double circulation) — not generic study advice.
${historicalBlock}`;

  const model = getAiGeneratorGeminiModel();
  const raw = await geminiService.generateStructuredContent(prompt, 'json', {
    primaryModel: model,
    flashLiteOnly: true,
    temperature: 0.72,
    maxTokens: 6000,
  });
  const json = extractJsonObject(raw);
  const patch =
    json?.structuredContent && typeof json.structuredContent === 'object'
      ? json.structuredContent
      : json && typeof json === 'object'
        ? json
        : {};
  const repairedCards = Array.isArray(patch.cards)
    ? patch.cards
    : Array.isArray(patch.application_hots_cards)
      ? patch.application_hots_cards
      : [];
  if (!repairedCards.length) return structured;
  return deepMergeStructured(structured, {
    ...patch,
    cards: repairedCards,
    application_hots_cards: Array.isArray(patch.application_hots_cards)
      ? patch.application_hots_cards
      : repairedCards,
    flashcard_set: repairedCards,
  });
}

/**
 * Regenerate flashcard deck framework sections (Foundations, Study Aids, Wrap-Up) — not cards[].
 */
export async function repairFlashcardFrameworkViaLlm(
  toolSlug,
  structured,
  meta = {},
  historicalBlock = '',
) {
  const slug = String(toolSlug || '').trim();
  if (slug !== 'flashcard-generator') return structured;

  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const subject = String(meta.subject || 'Science').trim();
  const classLabel = String(meta.classLabel || meta.class || '10').trim();
  const classDigits = classLabel.match(/\d+/)?.[0] || classLabel.replace(/\D/g, '') || '10';
  const cardSample = Array.isArray(structured?.cards) ? structured.cards.slice(0, 2) : [];

  const prompt = `You are a senior ${subject} educator writing the framework sections for a Class ${classDigits} flashcard deck on "${topic}".

TASK: Fill ONLY the non-card framework fields below. Do NOT return cards[] or application_hots_cards[].
Use specific facts, processes, and examples from "${topic}" — never generic study advice.

Sample cards already in the deck (match this depth and terminology):
${JSON.stringify(cardSample, null, 2)}

Return ONLY valid JSON:
{
  "topic": "chapter/topic name only",
  "subtopic": "specific subtopic name only",
  "class_level": "Class ${classDigits}",
  "difficulty_level": "Easy|Medium|Hard",
  "bloom_level": "Apply / Analyze",
  "prior_knowledge_required": "2-3 sentences of specific prior knowledge",
  "learning_objectives": ["measurable objective 1", "measurable objective 2"],
  "ncf_competency_alignment": "specific NCF competency line for ${topic}",
  "deck_memory_hook": "one vivid mnemonic linking deck ideas",
  "common_mistakes_to_avoid": ["specific misconception 1", "specific misconception 2"],
  "self_check_rapid_recall_round": "5 oral rapid-fire prompts as one paragraph or numbered list",
  "real_life_connection": "concrete daily-life link for Indian students",
  "differentiation_support": "support + extension for Below/At/Above level",
  "reflection_exit_ticket": "one metacognitive exit question"
}

FORBIDDEN phrases: "key ideas about", "Students should recall/define", "Students should explain", "Link each idea to a vivid daily-life image", "Rapid recall: cover each card", "Which card was hardest".
${historicalBlock}`;

  const model = getAiGeneratorGeminiModel();
  const raw = await geminiService.generateStructuredContent(prompt, 'json', {
    primaryModel: model,
    flashLiteOnly: true,
    temperature: 0.68,
    maxTokens: 4000,
  });
  const json = extractJsonObject(raw);
  const patch =
    json?.structuredContent && typeof json.structuredContent === 'object'
      ? json.structuredContent
      : json && typeof json === 'object'
        ? json
        : {};
  if (!patch || typeof patch !== 'object') return structured;

  const { cards, application_hots_cards, flashcard_set, ...frameworkOnly } = patch;
  return deepMergeStructured(structured, frameworkOnly);
}

/**
 * Regenerate Practice Q&A sections A–G when output is scaffold junk or missing real questions.
 */
export async function repairPracticeQaViaLlm(
  toolSlug,
  structured,
  meta = {},
  historicalBlock = '',
) {
  const slug = String(toolSlug || 'smart-qa-practice-generator').trim();
  const topic = resolvePracticeQaTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const classLabel = String(meta.classLabel || meta.class || '10').trim();
  const chapterTopic = String(meta.topic || '').trim();

  const prompt = `You are a senior CBSE Class ${classLabel} ${subject} educator writing a Smart Q&A Practice set.

CURRICULUM: ${subject} | Chapter/Topic: ${chapterTopic} | Subtopic: ${topic}
Board: CBSE | Tool: Smart Q&A Practice Generator (Sections A–G)

TASK: Replace weak or placeholder questions with REAL, subtopic-specific practice items about "${topic}".
Keep a short clean title (max 12 words). Do NOT repeat section numbers like "7.5" inside every question stem.

EXISTING JSON (preserve good fields; rewrite weak questions completely):
${JSON.stringify(
  {
    title: structured?.title || structured?.practice_set_title,
    learning_objectives: structured?.learning_objectives,
    instructions: structured?.instructions,
    sections: Array.isArray(structured?.sections)
      ? structured.sections.map((s) => ({
          sectionName: s.sectionName,
          questions: (s.questions || []).slice(0, 2),
        }))
      : [],
  },
  null,
  2,
)}

Return ONLY valid JSON:
{
  "structuredContent": {
    "title": "Short practice set title about ${topic}",
    "learning_objectives": ["3 specific objectives"],
    "instructions": "Clear student instructions",
    "sections": [
      {
        "sectionName": "Section A: MCQs",
        "questions": [{ "question": "...", "type": "MCQ", "options": ["A)...","B)...","C)...","D)..."], "answer": "B) ...", "marks": 1, "bloom_level": "Remember" }]
      },
      { "sectionName": "Section B: Fill in the Blanks", "questions": [{ "question": "...", "type": "FIB", "answer": "...", "marks": 1 }] },
      { "sectionName": "Section C: True or False", "questions": [{ "question": "State whether true or false: A key NCERT fact for this subtopic is correctly stated.", "type": "TF", "options": ["True", "False"], "answer": "True", "marks": 1 }] },
      { "sectionName": "Section D: Very Short Answer Questions", "questions": [{ "question": "...", "type": "VSA", "answer": "...", "marks": 2 }] },
      { "sectionName": "Section E: Short Answer Questions", "questions": [{ "question": "...", "type": "SA", "answer": "...", "marks": 3 }] },
      { "sectionName": "Section F: Application / Case-based Questions", "questions": [{ "question": "Indian real-life scenario about ${topic}...", "type": "APPLICATION", "answer": "...", "marks": 4 }] },
      { "sectionName": "Section G: HOTS / Analytical Questions", "questions": [{ "question": "...", "type": "HOTS", "answer": "...", "marks": 5 }] }
    ]
  }
}

QUALITY RULES (mandatory):
- Every question tests NCERT Class ${classLabel} facts about ${topic} — use correct terms (e.g. stamen, pistil, pollination, fertilisation for flowering plants).
- Every answer is a COMPLETE educator-written answer — never "Students should..." or "A precise term from the subtopic".
- Section A MCQs: plausible distractors from the same chapter, one clearly correct.
- Section F: at least one Indian context (farm, garden, school lab, local crop).
- FORBIDDEN: "pick the claim that fits", "claim without evidence", "core idea of subtopic", repeating "${topic}" in every line.
${historicalBlock}`;

  const model = getAiGeneratorGeminiModel();
  const raw = await geminiService.generateStructuredContent(prompt, 'json', {
    primaryModel: model,
    flashLiteOnly: true,
    temperature: 0.68,
    maxTokens: 8000,
  });
  const json = extractJsonObject(raw);
  const patch =
    json?.structuredContent && typeof json.structuredContent === 'object'
      ? json.structuredContent
      : json && typeof json === 'object'
        ? json
        : {};
  if (!Array.isArray(patch.sections) || !patch.sections.length) return structured;
  return deepMergeStructured(structured, patch);
}

/** Question tools whose scaffold/filler rows can be repaired in-place by the LLM. */
export const SCAFFOLD_REPAIRABLE_TOOLS = new Set([
  'worksheet-mcq-generator',
  'homework-creator',
  'mock-test-builder',
  'exam-question-paper-generator',
  'quick-assignment-builder',
]);

/**
 * Generic scaffold repair for question tools — schema-agnostic.
 * Shows the model the EXISTING structuredContent and asks it to replace only the
 * placeholder/scaffold questions (and their answers/options) with real,
 * chapter-specific content, keeping the exact same JSON shape, keys, section
 * names, question types, and counts. Used by every question tool except Smart
 * Q&A (which has its own dedicated pass).
 */
export async function repairScaffoldQuestionsViaLlm(
  toolSlug,
  structured,
  meta = {},
  historicalBlock = '',
) {
  const slug = String(toolSlug || '').trim();
  const t = getAiToolTemplate(slug);
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const chapterTopic = String(meta.topic || '').trim();
  const subject = String(meta.subject || 'Science').trim();
  const classLabel = String(meta.classLabel || meta.class || '10').trim();
  const factHint = getFactBankHint(subject, chapterTopic, topic);

  const prompt = `You are a senior CBSE Class ${classLabel} ${subject} educator repairing a ${t?.title || slug} for the Super Admin AI Generator.

CURRICULUM: ${subject} | Chapter/Topic: ${chapterTopic} | Subtopic: ${topic} | Board: CBSE
${factHint ? `\nVERIFIED SUBTOPIC FACTS you may draw on (rephrase, do not copy verbatim):\n${factHint}\n` : ''}
The JSON below contains generic template/scaffold questions and answers — for example:
"A claim supported by evidence from the lesson", "A guess without checking",
"Expected term or phrase about ...", "Short accurate point about ... (set N)",
"Clear explanation linking ... (variant N)", "Structured response with steps, evidence, and conclusion",
"claim without evidence", "pick the claim that fits".

TASK: Rewrite EVERY scaffold/placeholder question together with its answer and options into REAL,
chapter-specific ${subject} content about "${topic}". Preserve any question that is already real.
Keep the EXACT same JSON structure, keys, section names, question types, marks, and question counts —
only replace the text of scaffold questions/answers/options.

EXISTING JSON:
${JSON.stringify(structured, null, 2)}

Return ONLY valid JSON:
{ "structuredContent": { ...same shape, scaffold questions replaced with real ones... } }

QUALITY RULES (mandatory):
- Use correct NCERT Class ${classLabel} terminology for "${topic}".
- MCQ: exactly four options, one clearly correct, distractors drawn from the same chapter.
- Fill-in-the-blank: a real sentence with a single blank; the answer is the exact missing term.
- Short/Long answer: a complete educator-written model answer — never "Students should ..." or a template.
- FORBIDDEN phrases: "A claim supported by evidence from the lesson", "A guess without checking",
  "Expected term or phrase about", "Short accurate point about", "Structured response with steps, evidence, and conclusion",
  "claim without evidence", "pick the claim that fits", and repeating "${topic}" in every line.
${historicalBlock}`;

  const model = getAiGeneratorGeminiModel();
  const raw = await geminiService.generateStructuredContent(prompt, 'json', {
    primaryModel: model,
    flashLiteOnly: true,
    temperature: 0.62,
    maxTokens: 9000,
  });
  const json = extractJsonObject(raw);
  const patch =
    json?.structuredContent && typeof json.structuredContent === 'object'
      ? json.structuredContent
      : json && typeof json === 'object'
        ? json
        : {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structured;
  // Only accept the repair if it carries question content (sections/questions arrays).
  const hasContent =
    Array.isArray(patch.sections) ||
    Array.isArray(patch.questions) ||
    Object.keys(patch).some((k) => /^section_[a-e]/i.test(k) && Array.isArray(patch[k]));
  if (!hasContent) return structured;
  return deepMergeStructured(structured, patch);
}

export { deepMergeStructured };
