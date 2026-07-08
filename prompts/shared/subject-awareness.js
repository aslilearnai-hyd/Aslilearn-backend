/**
 * Subject-specific generation instructions.
 * @module prompts/shared/subject-awareness
 */

const SUBJECT_RULES = Object.freeze({
  science: [
    'Start with observation or a "What do you notice?" moment before naming concepts.',
    'Include a simple hands-on or thought experiment using materials available in Indian schools.',
    'Use prediction → observation → explanation sequence.',
    'Name scientific terms only AFTER students have encountered the phenomenon.',
    'Include safety notes for any practical work.',
    'Real-life: Indian agriculture, weather, health, environment, daily technology.',
  ],
  maths: [
    'Show step-by-step reasoning with "Think:" and "Therefore:" structure.',
    'Include a visual representation suggestion (number line, diagram, table).',
    'Common error: show the wrong method first, then correct with "Why this fails:".',
    'Mental math shortcuts where appropriate for the class level.',
    'Word problems must use Indian currency (₹), distances (km), and familiar contexts.',
  ],
  english: [
    'Creative, varied sentence structures. Model good prose in teacher script.',
    'Vocabulary: pre-teach 3–5 words with context sentences before the passage.',
    'Include reading comprehension moves: predict, infer, summarise, author purpose.',
    'Grammar integration must be in-context, not isolated drill unless worksheet demands it.',
    'Speaking/listening: pair tasks with clear roles and time limits.',
  ],
  hindi: [
    'सभी सामग्री हिंदी में — शुद्ध, बच्चों की समझ के अनुसार।',
    'कहानी/पाठ में भाव, संवाद, और सांस्कृतिक संदर्भ।',
    'शब्दार्थ संदर्भ वाक्य के साथ।',
    'मौखिक गतिविधि और लेखन कार्य दोनों शामिल करें।',
  ],
  telugu: [
    'అన్ని విషయాలు తెలుగులో — పాఠ్యపుస్తక శైలిలో.',
    'కథ/పాఠంలో భావోద్వేగం, సంభాషణ, స్థానిక ఉదాహరణలు.',
    'పదజాలం సందర్భ వాక్యాలతో.',
  ],
  social: [
    'Use maps, timelines, case studies from Indian history/geography/civics.',
    'Source-based questions: quote a short excerpt, ask interpretation.',
    'Connect past events to present-day India where possible.',
    'Debate or role-play with defined historical/fictional personas.',
  ],
  evs: [
    'Local environment examples: school garden, neighbourhood, festivals, seasons.',
    'Sensory observation activities suitable for primary learners.',
    'Care for community and nature — NEP values integration.',
  ],
});

/**
 * @param {string} subject
 * @returns {'science'|'maths'|'english'|'hindi'|'telugu'|'social'|'evs'|'general'}
 */
export function resolveSubjectCategory(subject) {
  const s = String(subject || '').toLowerCase();
  if (/physics|chemistry|biology|science|विज्ञान/i.test(s)) return 'science';
  if (/math|गणित/i.test(s)) return 'maths';
  if (/english/i.test(s)) return 'english';
  if (/hindi|हिंदी|हिन्दी/i.test(s)) return 'hindi';
  if (/telugu|తెలుగు/i.test(s)) return 'telugu';
  if (/social|history|geography|civics|economics|political/i.test(s)) return 'social';
  if (/evs|environmental/i.test(s)) return 'evs';
  return 'general';
}

/**
 * @param {string} subject
 * @returns {string}
 */
export function buildSubjectAwarenessBlock(subject) {
  const cat = resolveSubjectCategory(subject);
  const rules = SUBJECT_RULES[cat];
  if (!rules) {
    return [
      `SUBJECT: ${subject}`,
      'Adapt examples, vocabulary, and activities to this subject\'s disciplinary practices.',
      'Science: observation and experiment. Maths: step reasoning. Languages: communication skills. Social: evidence and perspective.',
    ].join('\n');
  }
  return [`SUBJECT MODE: ${subject} (${cat})`, ...rules].join('\n');
}
