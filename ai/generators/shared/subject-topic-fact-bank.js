/**
 * Shared subtopic fact hints for the AI Generator scaffold-repair pass.
 *
 * ⚠️  REVIEW REQUIRED — these facts are HAND-AUTHORED and must be verified by a
 *     subject expert before they are trusted for published content. They are
 *     injected ONLY as optional grounding hints for the LLM scaffold-repair
 *     pass; the model still writes the final questions and answers. They are a
 *     quality booster for a few high-use CBSE subtopics, not the source of truth.
 *
 * Disable entirely with env AI_GENERATOR_FACT_BANK=off.
 * Add a subtopic by pushing { subject, keywords, facts } — keep facts short,
 * NCERT-accurate, and free of question phrasing.
 */

const FACT_BANK = [
  {
    subject: 'Science',
    keywords: ['photosynthesis', 'autotrophic nutrition', 'chlorophyll', 'how do plants make food'],
    facts: [
      'Photosynthesis is the process by which green plants prepare their own food (glucose) using carbon dioxide and water in the presence of sunlight and chlorophyll.',
      'Word equation: Carbon dioxide + Water --(sunlight, chlorophyll)--> Glucose + Oxygen + Water.',
      'Chlorophyll is the green pigment present in chloroplasts that absorbs light energy for the reaction.',
      'Exchange of gases in leaves happens through tiny pores called stomata, which are bordered by guard cells.',
      'Raw materials: carbon dioxide enters through stomata; water is absorbed by roots and carried up by xylem.',
    ],
  },
  {
    subject: 'Science',
    keywords: ['nutrition', 'autotrophic', 'heterotrophic', 'holozoic', 'amoeba nutrition', 'digestion'],
    facts: [
      'Autotrophic nutrition: organisms (green plants, some bacteria) make their own food from simple inorganic substances.',
      'Heterotrophic nutrition: organisms depend on other organisms for food; types include saprophytic, parasitic, and holozoic.',
      'In Amoeba, food is engulfed by finger-like pseudopodia forming a food vacuole where digestion occurs (holozoic nutrition).',
      'Human digestion begins in the mouth, where salivary amylase (ptyalin) breaks starch into sugars.',
      'The small intestine is the main site of complete digestion and absorption of digested food.',
    ],
  },
  {
    subject: 'Science',
    keywords: ['respiration', 'aerobic', 'anaerobic', 'breathing', 'glucose breakdown'],
    facts: [
      'Respiration is the breakdown of glucose to release energy stored as ATP.',
      'Aerobic respiration (in presence of oxygen) breaks glucose completely into carbon dioxide and water, releasing more energy.',
      'Anaerobic respiration (without oxygen) in muscles produces lactic acid; in yeast it produces ethanol and carbon dioxide.',
      'In humans, exchange of gases occurs in the alveoli of the lungs, which have thin walls and a rich blood supply.',
      'Breathing supplies oxygen and removes carbon dioxide; respiration is the cellular energy-release process.',
    ],
  },
  {
    subject: 'Science',
    keywords: ['transportation', 'circulatory system', 'heart', 'double circulation', 'blood', 'xylem', 'phloem'],
    facts: [
      'The human heart has four chambers: two atria (upper) and two ventricles (lower).',
      'Double circulation: blood passes through the heart twice in one complete cycle (pulmonary and systemic circulation).',
      'Arteries carry blood away from the heart; veins carry blood back to the heart; capillaries allow exchange with tissues.',
      'In plants, xylem transports water and minerals upward from roots; phloem transports food (translocation) made in leaves.',
      'Transpiration (loss of water vapour from leaves) helps pull water upward through the xylem.',
    ],
  },
  {
    subject: 'Science',
    keywords: [
      'sexual reproduction in flowering plants',
      'reproduction in plants',
      'flower',
      'pollination',
      'fertilisation',
      'stamen',
      'pistil',
    ],
    facts: [
      'The flower is the reproductive part of a flowering plant; stamen is the male part and pistil (carpel) is the female part.',
      'Stamen consists of anther (produces pollen grains) and filament.',
      'Pistil consists of stigma, style, and ovary; the ovary contains ovules.',
      'Pollination is the transfer of pollen from anther to stigma; it may be self-pollination or cross-pollination.',
      'Fertilisation is the fusion of the male gamete (from pollen) with the female gamete (egg) in the ovule; the ovary then develops into a fruit and ovules into seeds.',
    ],
  },
  {
    subject: 'Science',
    keywords: ['cell', 'fundamental unit of life', 'cell organelles', 'nucleus', 'plant cell', 'animal cell'],
    facts: [
      'The cell is the basic structural and functional unit of life; it was first observed by Robert Hooke.',
      'A plant cell has a rigid cell wall, a large central vacuole, and plastids (including chloroplasts); an animal cell lacks these.',
      'The nucleus controls cell activities and contains the genetic material (DNA).',
      'Mitochondria are the "powerhouse of the cell", releasing energy through respiration.',
      'The cell membrane is selectively permeable and controls movement of substances in and out of the cell.',
    ],
  },
];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isFactBankEnabled() {
  return String(process.env.AI_GENERATOR_FACT_BANK || '').toLowerCase() !== 'off';
}

/**
 * Return newline-joined verified facts for the best-matching subtopic, or '' if
 * no confident match / disabled. Keyword-overlap match against topic + subtopic.
 * @returns {string}
 */
export function getFactBankHint(subject, topic, subtopic) {
  if (!isFactBankEnabled()) return '';
  const haystack = normalize(`${topic || ''} ${subtopic || ''}`);
  if (!haystack) return '';
  const subj = normalize(subject);

  let best = null;
  let bestScore = 0;
  for (const entry of FACT_BANK) {
    if (subj && normalize(entry.subject) && !subj.includes(normalize(entry.subject))) {
      // subject given but does not match this entry's subject — skip
      if (normalize(entry.subject) !== subj) continue;
    }
    let score = 0;
    for (const kw of entry.keywords) {
      if (haystack.includes(normalize(kw))) score += normalize(kw).split(' ').length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  if (!best || bestScore < 1) return '';
  return best.facts.map((f) => `- ${f}`).join('\n');
}

export { FACT_BANK };
