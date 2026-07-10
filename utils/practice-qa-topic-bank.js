/**
 * Topic-grounded Practice Q&A question bank for Smart Q&A when LLM output is sparse or scaffold-padded.
 * Matches by keywords in the resolved subtopic label (section numbers like "7.5" are stripped).
 */

const PRACTICE_QA_TOPIC_BANK = [
  {
    keywords: [
      'sexual reproduction in flowering plants',
      'flowering plant reproduction',
      'reproduction in flowering plants',
      'floral reproduction',
      'flower reproduction',
    ],
    title: 'Sexual Reproduction in Flowering Plants — Practice Set',
    learningObjectives: [
      'Identify and describe the structure and function of stamen, pistil, pollen, and ovule in a flower.',
      'Explain pollination, pollen tube growth, double fertilisation, and seed/fruit formation.',
      'Relate floral reproduction to fruit yield, hybrid seeds, and pollination challenges in Indian crops.',
    ],
    instructions:
      'Attempt Sections A–G in order. Use precise NCERT terms (stamen, pistil, stigma, anther, ovule, zygote, endosperm). Draw a labelled flower diagram where helpful. Section A: one correct option only. Section C: write the full matching pairs.',
    sections: {
      'Section A: MCQs': [
        {
          type: 'MCQ',
          question: 'Which part of the stamen produces pollen grains?',
          options: ['A) Filament', 'B) Anther', 'C) Stigma', 'D) Style'],
          answer: 'B) Anther',
          marks: 1,
          bloom_level: 'Remember',
        },
        {
          type: 'MCQ',
          question: 'Pollination is best defined as the transfer of pollen grains from the',
          options: [
            'A) Stigma to anther',
            'B) Anther to stigma',
            'C) Ovary to petal',
            'D) Sepal to filament',
          ],
          answer: 'B) Anther to stigma',
          marks: 1,
          bloom_level: 'Remember',
        },
        {
          type: 'MCQ',
          question: 'After fertilisation in a flowering plant, the ovule develops into the',
          options: ['A) Pollen grain', 'B) Petal', 'C) Seed', 'D) Nectar'],
          answer: 'C) Seed',
          marks: 1,
          bloom_level: 'Understand',
        },
      ],
      'Section B: Fill in the Blanks': [
        {
          type: 'FIB',
          question: 'The female reproductive part of a flower is called the _____.',
          answer: 'Pistil (or carpel)',
          marks: 1,
          bloom_level: 'Remember',
        },
        {
          type: 'FIB',
          question: 'Fusion of the male gamete with the female gamete inside the ovule is called _____.',
          answer: 'Fertilisation',
          marks: 1,
          bloom_level: 'Remember',
        },
        {
          type: 'FIB',
          question: 'The transfer of pollen by wind, water, insects, or animals is known as _____.',
          answer: 'Pollination',
          marks: 1,
          bloom_level: 'Remember',
        },
      ],
      'Section C: Match the Following': [
        {
          type: 'MATCH',
          question: 'Match Column A with Column B.',
          options: [
            '1. Stamen | A. Male reproductive part',
            '2. Pistil | B. Female reproductive part',
            '3. Pollen grain | C. Male gametophyte',
            '4. Ovule | D. Contains female gamete',
          ],
          answer: '1-A, 2-B, 3-C, 4-D',
          marks: 2,
          bloom_level: 'Understand',
        },
        {
          type: 'MATCH',
          question: 'Match the floral structure with its function.',
          options: [
            '1. Anther | A. Produces pollen',
            '2. Stigma | B. Receives pollen',
            '3. Ovary | C. Contains ovules',
            '4. Style | D. Connects stigma to ovary',
          ],
          answer: '1-A, 2-B, 3-C, 4-D',
          marks: 2,
          bloom_level: 'Understand',
        },
      ],
      'Section D: Very Short Answer Questions': [
        {
          type: 'VSA',
          question: 'Name the two main parts of a stamen.',
          answer: 'Filament and anther.',
          marks: 2,
          bloom_level: 'Remember',
        },
        {
          type: 'VSA',
          question: 'What is the function of the stigma in a flower?',
          answer: 'It is the receptive surface where pollen grains land and germinate during pollination.',
          marks: 2,
          bloom_level: 'Understand',
        },
      ],
      'Section E: Short Answer Questions': [
        {
          type: 'SA',
          question:
            'Describe the sequence of events from pollination to seed formation in a flowering plant.',
          answer:
            'Pollen lands on the stigma and forms a pollen tube that reaches the ovule; male gamete fuses with the egg (fertilisation); the zygote develops into an embryo and the ovule becomes a seed, while the ovary may develop into a fruit.',
          marks: 3,
          bloom_level: 'Understand',
        },
        {
          type: 'SA',
          question: 'Differentiate between self-pollination and cross-pollination with one example each.',
          answer:
            'Self-pollination: pollen transfers to the stigma of the same flower (e.g. pea). Cross-pollination: pollen transfers to the stigma of another flower of the same species (e.g. mustard, mango), often aided by insects or wind.',
          marks: 3,
          bloom_level: 'Apply',
        },
      ],
      'Section F: Application / Case-based Questions': [
        {
          type: 'APPLICATION',
          question:
            'A mango orchard near Lucknow has plenty of flowers but very few fruits. Suggest two pollination-related reasons and one practical step the farmer can take.',
          answer:
            'Reasons: insufficient pollinators (bees), heavy rain washing pollen, or monoculture reducing cross-pollination. Steps: keep bee boxes, plant pollinator-friendly border crops, or use assisted pollination during flowering.',
          marks: 4,
          bloom_level: 'Apply',
        },
        {
          type: 'APPLICATION',
          question:
            'Students dissect a hibiscus flower in the lab. Which structures should they label as male parts, female parts, and where fertilisation occurs?',
          answer:
            'Male: stamen (anther + filament). Female: pistil (stigma, style, ovary). Fertilisation occurs inside the ovule in the ovary after pollen tube growth.',
          marks: 4,
          bloom_level: 'Apply',
        },
      ],
      'Section G: HOTS / Analytical Questions': [
        {
          type: 'HOTS',
          question:
            'A student claims, "Bright petals are only for decoration and play no role in reproduction." Evaluate this statement using floral structure and function.',
          answer:
            'Incorrect. Bright petals and scent attract insect pollinators, improving cross-pollination and seed set; petals also protect inner floral parts before flowering. Decoration is not the primary reproductive role.',
          marks: 5,
          bloom_level: 'Analyze',
        },
        {
          type: 'HOTS',
          question:
            'Compare wind-pollinated and insect-pollinated flowers. Which type is more likely to produce heavy, sticky pollen and why?',
          answer:
            'Insect-pollinated flowers produce sticky or spiky pollen that adheres to insects; they often have colourful petals and nectar. Wind-pollinated flowers produce light, dry pollen in large amounts, with reduced petals and feathery stigmas.',
          marks: 5,
          bloom_level: 'Analyze',
        },
      ],
    },
  },
];

/** Strip leading section numbers (e.g. "7.5 ") for student-facing text. */
export function resolvePracticeQaTopicLabel(meta = {}) {
  let label = String(meta.subTopic || meta.subtopic || meta.topic || '').trim();
  label = label.replace(/^\d+(?:\.\d+)*\s+/, '').trim();
  label = label.replace(/\s*\(Chapter\s*\d+[^)]*\)\s*$/i, '').trim();
  if (!label || /^this\s+topic$/i.test(label)) {
    const fallback = String(meta.topic || meta.bookTitle || '').trim();
    return fallback.replace(/^\d+(?:\.\d+)*\s+/, '').trim() || 'this topic';
  }
  return label;
}

function normalizeTopicKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** @returns {typeof PRACTICE_QA_TOPIC_BANK[0] | null} */
export function matchPracticeQaTopicBank(topicLabel) {
  const key = normalizeTopicKey(topicLabel);
  if (!key) return null;
  let best = null;
  let bestScore = 0;
  for (const entry of PRACTICE_QA_TOPIC_BANK) {
    let score = 0;
    for (const kw of entry.keywords) {
      const nkw = normalizeTopicKey(kw);
      if (!nkw) continue;
      if (key.includes(nkw) || nkw.includes(key)) score += nkw.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return bestScore >= 12 ? best : null;
}

/**
 * Pick a bank question for a Practice Q&A section.
 * @param {string} sectionName
 * @param {string} topicLabel
 * @param {Record<string, unknown>} meta
 */
export function pickPracticeQaBankQuestion(sectionName, topicLabel, meta = {}) {
  const bank = matchPracticeQaTopicBank(topicLabel);
  if (!bank?.sections?.[sectionName]?.length) return null;
  const pool = bank.sections[sectionName];
  const variant = Number(meta.generationVariant) || 1;
  const qNum = Number(meta.questionNumber) || 1;
  const idx = Math.abs((variant * 31 + qNum * 7 + sectionName.length) % pool.length);
  return { ...pool[idx] };
}

export function getPracticeQaBankFramework(topicLabel) {
  const bank = matchPracticeQaTopicBank(topicLabel);
  if (!bank) return null;
  return {
    title: bank.title,
    learning_objectives: bank.learningObjectives,
    instructions: bank.instructions,
  };
}
