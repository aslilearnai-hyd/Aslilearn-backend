/**
 * Strict subtopic scope for book / V2 generation.
 * Blocks later-chapter concepts when a specific subtopic is selected.
 */

/** Later-topic keyword packs keyed by early-chapter concept families. */
const LATER_TOPIC_BLOCKS = [
  {
    // Number System early sections (place value, comparing, Indian/International)
    whenSubtopic: /\b(place\s*value|indian\s*system|international\s*system|comparing\s*numbers|large\s*numbers|reading\s*and\s*writing|numerals?)\b/i,
    block: [
      'factor',
      'factors',
      'multiple',
      'multiples',
      'prime',
      'composite',
      'hcf',
      'lcm',
      'divisor',
      'divisors',
      'divisibility',
      'coprime',
      'prime factor',
    ],
    label: 'factors/multiples/primes (later Number System topics)',
  },
  {
    whenSubtopic: /\b(whole\s*numbers?|natural\s*numbers?|integers?)\b/i,
    block: ['fraction', 'decimal', 'rational', 'irrational', 'percentage', 'ratio', 'proportion'],
    label: 'fractions/decimals/ratios (later topics)',
  },
  {
    whenSubtopic: /\b(fractions?)\b/i,
    block: ['percentage', 'profit', 'loss', 'interest', 'algebra', 'equation'],
    label: 'percentages/commercial maths/algebra (later topics)',
  },
];

export function getBlockedTopicTerms({ subTopic, topic, chapterScope } = {}) {
  if (chapterScope) return { blocked: [], labels: [] };
  const sub = String(subTopic || '').trim();
  if (!sub) return { blocked: [], labels: [] };

  const blocked = new Set();
  const labels = [];
  for (const pack of LATER_TOPIC_BLOCKS) {
    if (!pack.whenSubtopic.test(sub) && !pack.whenSubtopic.test(String(topic || ''))) continue;
    pack.block.forEach((t) => blocked.add(t.toLowerCase()));
    labels.push(pack.label);
  }
  return { blocked: [...blocked], labels };
}

/**
 * Prompt layer: lock generation to the selected subtopic.
 */
export function buildSubtopicScopeLayer(params = {}) {
  const chapterScope = Boolean(params.chapterScope);
  const subTopics = Array.isArray(params.subTopics)
    ? params.subTopics.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const sub =
    subTopics.length > 1
      ? null
      : String(params.subTopic || params.subtopic || subTopics[0] || '').trim();

  if (chapterScope || !sub) {
    return [
      'SUBTOPIC SCOPE: WHOLE CHAPTER — cover the full Chapter/Topic as selected.',
      'You may use any concept from this chapter that belongs on the syllabus for this class.',
    ].join('\n');
  }

  const { blocked, labels } = getBlockedTopicTerms({
    subTopic: sub,
    topic: params.topic,
    chapterScope: false,
  });

  const lines = [
    'STRICT SUBTOPIC LOCK (CRITICAL — do not violate):',
    `Generate ONLY for this subtopic: "${sub}".`,
    'Do NOT introduce later sections of the same chapter unless they are required to answer a question that is still about this subtopic.',
    'Every question stem, example, and answer must be answerable using only this subtopic\'s ideas.',
  ];
  if (blocked.length) {
    lines.push(
      `FORBIDDEN for this subtopic (later topics — do not ask about): ${blocked.join(', ')}.`,
    );
    if (labels.length) lines.push(`Blocked families: ${labels.join('; ')}.`);
  }
  return lines.join('\n');
}

/**
 * Post-check: flag questions that mention blocked later-topic terms.
 */
export function validateSubtopicScope(structured, params = {}) {
  const { blocked, labels } = getBlockedTopicTerms(params);
  const errors = [];
  if (!blocked.length || !structured?.core) return { valid: true, errors, blocked, labels };

  const text = JSON.stringify(structured.core).toLowerCase();
  // Avoid false positives like "multiple choice" / "multiple options".
  const scrubbed = text
    .replace(/\bmultiple\s+choice\b/g, ' ')
    .replace(/\bmultiple\s+options?\b/g, ' ')
    .replace(/\bmultiple\s+correct\b/g, ' ');

  for (const term of blocked) {
    const re = new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(scrubbed)) {
      errors.push(`Subtopic scope leak: content mentions forbidden later topic "${term}".`);
    }
  }
  return { valid: errors.length === 0, errors, blocked, labels };
}

export default {
  getBlockedTopicTerms,
  buildSubtopicScopeLayer,
  validateSubtopicScope,
};
