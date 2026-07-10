/**
 * Subject-specific generation instructions.
 * @module prompts/shared/subject-awareness
 */

const PRECISION_RULES = Object.freeze([
  'PRECISION: Every question names the exact subtopic and tests one clear skill — no story setup or role-play frame.',
  'TEXTBOOK FIT: Match NCERT/CBSE exercise types (MCQ, FIB, VSA, SA, numerical, match, activity) from the chapter.',
  'BAN: "Imagine…", "During…", "Design a poster…", "Role-play…", "In your community…", "Set the scene…".',
  'DEPTH: Use definitions, formulas, numericals, cause–effect, and evidence — not thin activity wrappers.',
  'Each line must be understandable without reading a fictional situation first.',
]);

const SUBJECT_RULES = Object.freeze({
  science: [
    'Lead with the concept, definition, and formula (if any) for the subtopic.',
    'Questions: define terms, state SI units, calculate with given values, explain cause–effect.',
    'Numericals must show Given → Formula → Substitution → Answer with units.',
    'One brief real device or phenomenon example only when it directly illustrates the subtopic.',
    'Include safety notes only when a practical step is explicitly required.',
  ],
  maths: [
    'STRICT NUMERICAL MODE for Mathematics: every practice item is a calculation or data-based problem.',
    'Every question must require step-by-step working (Given, Method, Working, Answer).',
    'Use realistic values (₹, km, cm, kg, time) inline — not a long story before the numbers.',
    'No essay, summary, speaking, or literature-style prompts.',
    'Show step-by-step reasoning with "Given:", "Method:", "Therefore:" structure.',
    'Common error: show the wrong method first, then correct with "Why this fails:".',
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
    'Use maps, timelines, and source excerpts from Indian history/geography/civics.',
    'Source-based questions: quote a short excerpt, ask interpretation with evidence.',
    'Connect past events to present-day India with named facts — not open-ended scenario prompts.',
    'Avoid role-play; use direct analytical questions on causes, effects, and significance.',
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
  return [`SUBJECT MODE: ${subject} (${cat})`, ...PRECISION_RULES, ...rules].join('\n');
}
