/**
 * Story & Passage Creator — English, Hindi, and Telugu only.
 */

function plainStoryLanguageKey(subject) {
  const raw = String(subject || '').split('__deleted__')[0].trim();
  if (!raw) return null;
  if (/(telugu|తెలుగు)/i.test(raw)) return 'telugu';
  if (/(hindi|हिंदी|हिन्दी)/i.test(raw)) return 'hindi';
  if (/english/i.test(raw)) return 'english';

  const match = raw.match(/^(.+?)_\d+$/);
  const plain = (match ? match[1] : raw).toLowerCase().trim();
  if (['eng', 'english'].includes(plain) || plain.includes('english')) return 'english';
  if (['hin', 'hindi'].includes(plain) || plain.includes('hindi') || /^hin\d*$/i.test(plain)) return 'hindi';
  if (['tel', 'telugu'].includes(plain) || plain.includes('telugu') || /^tel\d*$/i.test(plain)) return 'telugu';
  return null;
}

export function isStoryPassageAllowedSubject(subject) {
  return plainStoryLanguageKey(subject) != null;
}

/** Map curriculum label → canonical DB subject for lookups. */
export function canonicalStoryPassageSubject(subject) {
  const key = plainStoryLanguageKey(subject);
  if (key === 'telugu') return 'Telugu';
  if (key === 'hindi') return 'Hindi';
  if (key === 'english') return 'English';
  return null;
}

export const STORY_PASSAGE_SUBJECT_ERROR =
  'Story & Passage Creator is only available for English, Hindi, and Telugu subjects.';

/** @typedef {{ language: string, script: string, rule: string }} StoryPassageOutputLanguage */

/** @returns {StoryPassageOutputLanguage | null} */
export function resolveStoryPassageOutputLanguage(subject) {
  const canonical = canonicalStoryPassageSubject(subject);
  if (!canonical) return null;

  const valueFields =
    'passage, story, title, vocabulary, every question, every answer, objectives, NCF alignment text, reflection prompts, and all other JSON string values';

  if (canonical === 'Hindi') {
    return {
      language: 'Hindi',
      script: 'Devanagari script (देवनागरी लिपि)',
      rule: `CRITICAL OUTPUT LANGUAGE RULE (mandatory):
The SUBJECT is Hindi — this is a Hindi language class, not English.
Write ${valueFields} entirely in Hindi using Devanagari script (देवनागरी लिपि).
Do NOT use Roman/English transliteration (e.g. "namaste", "kya") — use Devanagari only.
Do NOT write the passage, questions, answers, or vocabulary in English.
JSON property names stay in English; only string values must be Hindi in Devanagari.
Allowed exceptions: unavoidable proper nouns (names, places) may appear as in the source.`,
    };
  }

  if (canonical === 'Telugu') {
    return {
      language: 'Telugu',
      script: 'Telugu Lipi (తెలుగు లిపి)',
      rule: `CRITICAL OUTPUT LANGUAGE RULE (mandatory):
The SUBJECT is Telugu — this is a Telugu language class, not English.
Write ${valueFields} entirely in Telugu using Telugu Lipi script (తెలుగు లిపి).
Do NOT use Roman/English transliteration (e.g. "telugu", "em chestunnaru") — use Telugu Lipi only.
Do NOT write the passage, questions, answers, or vocabulary in English.
JSON property names stay in English; only string values must be Telugu in Lipi script.
Allowed exceptions: unavoidable proper nouns (names, places) may appear as in the source.`,
    };
  }

  return {
    language: 'English',
    script: 'English',
    rule: `CRITICAL OUTPUT LANGUAGE RULE (mandatory):
The SUBJECT is English — this is an English language class.
Write ${valueFields} entirely in English.
Do NOT mix Hindi or Telugu in the passage, questions, or answers unless quoting a proper noun.`,
  };
}

/** Prompt block for Gemini generation / repair (empty when subject is not a language subject). */
export function buildStoryPassageLanguagePromptBlock(subject) {
  const lang = resolveStoryPassageOutputLanguage(subject);
  if (!lang) return '';
  return `${lang.rule}\nOUTPUT LANGUAGE: ${lang.language} (${lang.script})`;
}

/** Prompt block appended at the END of the prompt (recency bias — model reads this last). */
export function buildStoryPassageLanguagePromptTail(subject) {
  const canonical = canonicalStoryPassageSubject(subject);
  if (!canonical || canonical === 'English') return '';
  const lang = resolveStoryPassageOutputLanguage(subject);
  if (!lang) return '';
  const monolingual = buildStoryPassageMonolingualOverrideBlock(subject);
  return `[FINAL OUTPUT LANGUAGE — NON-NEGOTIABLE]
Subject: ${canonical}. EVERY JSON string value MUST be in ${lang.language} (${lang.script}).
If reference book text or examples are in English, TRANSLATE them — do NOT copy English into passage, questions, or answers.
${monolingual}`.trim();
}

const PASSAGE_FIELD_KEYS = ['passage', 'content', 'story_passage_content', 'story'];
const DEVANAGARI_CHAR_RE = /[\u0900-\u097F]/;
const TELUGU_CHAR_RE = /[\u0C00-\u0C7F]/;

/** @returns {'devanagari' | 'telugu' | 'english' | null} */
export function storyPassageRequiredScript(subject) {
  const canonical = canonicalStoryPassageSubject(subject);
  if (canonical === 'Hindi') return 'devanagari';
  if (canonical === 'Telugu') return 'telugu';
  if (canonical === 'English') return 'english';
  return null;
}

function countMatches(text, re) {
  const source = re instanceof RegExp ? re.source : String(re);
  const flags = re instanceof RegExp && re.flags.includes('i') ? 'gi' : 'g';
  return (String(text).match(new RegExp(source, flags)) || []).length;
}

const ENGLISH_BOILERPLATE_RE =
  /^(?:section\s+[a-g]\s*:|section\s+[a-e]\b|mcq|multiple\s+choice|short\s+answer|long\s+answer|bloom|ncf|marks?\s*:|total\s+marks|answer\s+key|question\s+paper|very\s+short|case[\s-]?based|competency)/i;

/** JSON keys that hold structural labels — not student-facing prose (skip in language walks). */
const LANGUAGE_COMPLIANCE_SKIP_OBJECT_KEYS = new Set([
  'sectionName',
  'section',
  'type',
  'question_type',
  'question_number',
  'marks',
  'difficulty_level',
  'bloom_level',
  'difficulty_tag_for_each_card',
  'content_type',
  'class_level',
]);

function indicScaffoldFilled(value) {
  const t = String(value || '').trim();
  return t.length >= 12 && !isStoryPassagePlaceholderText(t);
}

/** True when a Hindi/Telugu field already has usable Indic prose (not English-only LLM output). */
function indicLanguageFieldFilled(value, requiredScript) {
  const t = String(value || '').trim();
  if (!t || t.length < 8) return false;
  if (isStoryPassagePlaceholderText(t)) return false;
  if (!requiredScript || requiredScript === 'english') return indicScaffoldFilled(t);
  return textMatchesStoryPassageScript(t, requiredScript, { strict: false });
}

function questionBodyNeedsIndicRepair(question, requiredScript) {
  const t = String(question?.question || question?.prompt || '').trim();
  if (t.length < 10) return true;
  if (!requiredScript || requiredScript === 'english') return false;
  return !textMatchesStoryPassageScript(t, requiredScript, { strict: false });
}

/** Prefer curriculum subject; fall back to book.subject when only the book is tagged Hindi/Telugu. */
export function resolveLanguageSubjectForGeneration(subject = '', bookSubject = '') {
  const primary = String(subject || '').trim();
  const fromBook = String(bookSubject || '').trim();
  if (mustEnforceStoryPassageLanguageCompliance(primary)) return primary;
  if (mustEnforceStoryPassageLanguageCompliance(fromBook)) return fromBook;
  return primary || fromBook;
}

function extractLongestIndicRun(text, script) {
  const re = script === 'telugu' ? TELUGU_CHAR_RE : DEVANAGARI_CHAR_RE;
  const runs = [];
  let current = '';
  for (const ch of String(text || '')) {
    if (re.test(ch)) {
      current += ch;
    } else if (current.length >= 2) {
      runs.push(current);
      current = '';
    } else {
      current = '';
    }
  }
  if (current.length >= 2) runs.push(current);
  return runs.sort((a, b) => b.length - a.length)[0] || '';
}

const HINDI_SCAFFOLD_TOPIC_HINTS = [
  [/swadesh/i, 'स्वदेश'],
  [/kavita|poems?|poem/i, 'कविता'],
  [/paath\s*se\s*pehle|pre-?reading|let['']?s?\s*begin/i, 'पाठ से पहले'],
  [/post-?reading|paath\s*ke\s*baad/i, 'पाठ के बाद'],
  [/grammar|vyakaran/i, 'व्याकरण'],
  [/prose|gadya/i, 'गद्य'],
];

const TELUGU_SCAFFOLD_TOPIC_HINTS = [
  [/pre-?reading|patha\s*mundhu/i, 'పాఠం ముందు'],
  [/post-?reading|patha\s*tarvata/i, 'పాఠం తర్వాత'],
  [/kavita|poems?|poem/i, 'కవిత'],
  [/grammar|vyakaranam/i, 'వ్యాకరణం'],
];

/**
 * Hindi/Telugu scaffolds must not embed long Latin NCERT labels (e.g. "Pre-reading / Paath se Pehle")
 * or language validation fails even when question bodies are valid Devanagari.
 */
export function resolveIndicScaffoldTopic(meta = {}, subjectOrScript = '') {
  const subject = String(subjectOrScript || meta.subject || '').trim();
  const script = ['devanagari', 'telugu'].includes(subjectOrScript)
    ? subjectOrScript
    : storyPassageRequiredScript(subject);
  const isTelugu = script === 'telugu';
  const fallback = isTelugu ? 'ఈ విషయం' : 'यह विषय';
  const indicScript = isTelugu ? 'telugu' : 'devanagari';

  const candidates = [
    meta.subTopic,
    meta.subtopic,
    meta.topic,
    meta.topicName,
    meta.chapter,
    meta.chapterTitle,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  const blob = candidates.join(' ');
  let bestRun = '';
  for (const c of candidates) {
    const run = extractLongestIndicRun(c, indicScript);
    if (run.length > bestRun.length) bestRun = run;
  }
  if (bestRun.length >= 3) return bestRun.trim();

  const hints = isTelugu ? TELUGU_SCAFFOLD_TOPIC_HINTS : HINDI_SCAFFOLD_TOPIC_HINTS;
  for (const [re, label] of hints) {
    if (re.test(blob)) return label;
  }

  const topicOnly = String(meta.topic || meta.topicName || '').trim();
  if (topicOnly) {
    for (const [re, label] of hints) {
      if (re.test(topicOnly)) return label;
    }
  }

  return fallback;
}

/**
 * Skip English section labels / placeholders during language-compliance walks.
 * Exam papers and mixed schemas often keep Latin headers beside Indic question bodies.
 */
export function shouldSkipLanguageComplianceString(text, options = {}) {
  const t = String(text || '').trim();
  if (!t || t.length < 12) return true;
  if (isStoryPassagePlaceholderText(t)) return true;
  if (STORY_SECTION_LABEL_PREFIX.test(t)) return true;
  if (ENGLISH_BOILERPLATE_RE.test(t)) return true;

  const devCount = countMatches(t, DEVANAGARI_CHAR_RE);
  const telCount = countMatches(t, TELUGU_CHAR_RE);
  const latinLetters = (t.match(/[A-Za-z]/g) || []).length;
  const indicCount = devCount + telCount;

  if (indicCount === 0 && latinLetters > 0 && t.length <= 140) return true;

  // MCQ labels (A)–D)) and short Latin-only tokens beside Indic question bodies.
  if (/^[A-Da-d][\).:\-\s]/.test(t) && t.length <= 120) return true;
  if (/^Q\s*\d+[\).:\-\s]/i.test(t) && t.length <= 100) return true;

  if (options.relaxedWalk && indicCount < 14 && latinLetters > indicCount * 1.5) {
    return true;
  }

  return false;
}

/** True when a user-facing string matches the required script for Hindi/Telugu/English subjects. */
export function textMatchesStoryPassageScript(text, requiredScript, opts = {}) {
  const strict = opts.strict === true;
  const t = String(text || '').trim();
  if (!t || t.length < 10) return true;

  const devCount = countMatches(t, DEVANAGARI_CHAR_RE);
  const telCount = countMatches(t, TELUGU_CHAR_RE);
  const latinLetters = (t.match(/[A-Za-z]/g) || []).length;

  if (requiredScript === 'devanagari') {
    const minDev = strict ? 35 : 8;
    if (devCount < minDev) return false;
    if (telCount > Math.max(4, devCount * 0.15)) return false;
    const totalLetters = devCount + latinLetters;
    const latinRatio = totalLetters > 0 ? latinLetters / totalLetters : 0;
    // Hindi papers often embed NCERT subtopic labels (Latin) inside Devanagari questions.
    if (!strict && devCount >= 8 && latinLetters <= 56 && latinRatio <= 0.55) {
      return true;
    }
    if (totalLetters > 20 && latinRatio > (strict ? 0.14 : 0.18)) return false;
    return latinLetters <= (strict ? 35 : Math.max(10, Math.floor(devCount * 0.12)));
  }

  if (requiredScript === 'telugu') {
    const minTel = strict ? 35 : 8;
    if (telCount < minTel) return false;
    if (devCount > Math.max(4, telCount * 0.15)) return false;
    const totalLetters = telCount + latinLetters;
    const latinRatio = totalLetters > 0 ? latinLetters / totalLetters : 0;
    if (!strict && telCount >= 8 && latinLetters <= 56 && latinRatio <= 0.55) {
      return true;
    }
    if (totalLetters > 20 && latinRatio > (strict ? 0.14 : 0.18)) return false;
    return latinLetters <= (strict ? 35 : Math.max(10, Math.floor(telCount * 0.12)));
  }

  if (requiredScript === 'english') {
    const indicCount = devCount + telCount;
    return indicCount <= Math.max(8, Math.floor(latinLetters * 0.15));
  }

  return true;
}

function walkStoryPassageStringValues(value, out = [], parentKey = '') {
  if (value == null) return out;
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStoryPassageStringValues(item, out, parentKey);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (LANGUAGE_COMPLIANCE_SKIP_OBJECT_KEYS.has(key)) continue;
      walkStoryPassageStringValues(v, out, key);
    }
  }
  return out;
}

/**
 * Reject Hindi/Telugu generations that mix English or the wrong Indic script.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStoryPassageLanguageCompliance(subject, structured, options = {}) {
  const required = storyPassageRequiredScript(subject);
  if (!required || required === 'english') {
    return { valid: true, errors: [] };
  }

  const toolSlug = String(options.toolSlug || '').trim();
  const isFlashcardTool = toolSlug === 'flashcard-generator' || toolSlug === 'my-study-decks';
  const requirePassage = options.requirePassage !== false && !isFlashcardTool;
  const errors = [];
  const label =
    required === 'devanagari'
      ? 'Hindi (Devanagari script only)'
      : 'Telugu (Telugu Lipi only)';

  const data = structured && typeof structured === 'object' ? structured : {};

  const relaxedWalk =
    !isStoryPassageLanguageToolSlug(toolSlug) && !requirePassage;

  const checkText = (text, strict = false) => {
    const t = String(text || '').trim();
    if (t.length < 12) return;
    if (shouldSkipLanguageComplianceString(t, { relaxedWalk })) return;
    if (!textMatchesStoryPassageScript(t, required, { strict })) {
      errors.push(
        `${label}: content must not mix English or other languages — "${t.slice(0, 72)}${t.length > 72 ? '…' : ''}"`,
      );
    }
  };

  if (isFlashcardTool) {
    const minCards = toolSlug === 'my-study-decks' ? 10 : 5;
    const cards = Array.isArray(data.cards) ? data.cards : [];
    let validCards = 0;
    for (const card of cards) {
      if (!card || typeof card !== 'object') continue;
      const front = String(card.front || card.task || card.question || card.term || '').trim();
      const back = String(card.back || card.solution || card.answer || card.definition || '').trim();
      if (front.length < 4 || back.length < 4) continue;
      if (
        textMatchesStoryPassageScript(front, required, { strict: false }) &&
        textMatchesStoryPassageScript(back, required, { strict: false })
      ) {
        validCards += 1;
      }
    }
    if (validCards < minCards) {
      errors.push(
        `${label}: need at least ${minCards} flashcards with front and back in ${label} (found ${validCards}).`,
      );
    }
    return { valid: errors.length === 0, errors };
  }

  if (requirePassage) {
    let passageChecked = false;
    for (const key of PASSAGE_FIELD_KEYS) {
      const passage = String(data[key] || '').trim();
      if (!passage || passage.length < 40) continue;
      passageChecked = true;
      if (!textMatchesStoryPassageScript(passage, required, { strict: true })) {
        errors.push(
          `${label}: passage/story must be written entirely in ${label} — not English. Found: "${passage.slice(0, 72)}${passage.length > 72 ? '…' : ''}"`,
        );
        break;
      }
    }
    if (!passageChecked) {
      errors.push(`${label}: passage/story field is missing or too short.`);
    }
  }

  if (!errors.length) {
    for (const text of walkStoryPassageStringValues(data)) {
      const t = String(text || '').trim();
      if (t.length < 12) continue;
      if (shouldSkipLanguageComplianceString(t, { relaxedWalk })) continue;
      if (!textMatchesStoryPassageScript(t, required)) {
        errors.push(
          `${label}: content must not mix English or other languages — "${t.slice(0, 72)}${t.length > 72 ? '…' : ''}"`,
        );
        if (errors.length >= (relaxedWalk ? 6 : 4)) break;
      }
    }
    // Non-story tools: pass when most checked prose is in the target script (LLM may leave Latin labels).
    if (relaxedWalk && errors.length > 0 && errors.length <= 5) {
      let checked = 0;
      let passed = 0;
      for (const text of walkStoryPassageStringValues(data)) {
        const t = String(text || '').trim();
        if (t.length < 16) continue;
        if (shouldSkipLanguageComplianceString(t, { relaxedWalk: true })) continue;
        checked += 1;
        if (textMatchesStoryPassageScript(t, required)) passed += 1;
      }
      if (checked >= 4 && passed / checked >= 0.72) {
        errors.length = 0;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Skip English/mixed records when serving Hindi/Telugu language-subject content from rotation. */
export function storyPassageRecordLanguageValid(toolSlug, subject, doc) {
  if (!mustEnforceStoryPassageLanguageCompliance(subject)) return true;

  const docSubject = String(subject || doc?.subject || '').trim();
  const slug = String(toolSlug || doc?.toolName || '').trim();
  const structured = doc?.metadata?.structuredContent;
  if (structured && typeof structured === 'object') {
    // Pass toolSlug so flashcards only check card front/back (not English scaffold labels).
    return validateStoryPassageLanguageCompliance(docSubject, structured, {
      toolSlug: slug,
    }).valid;
  }

  const required = storyPassageRequiredScript(docSubject);
  const text = String(doc?.generatedContent || doc?.content || '').trim();
  if (!text || text.length < 40) return false;
  // Markdown body: lenient script check (titles may include Latin topic names).
  if (required === 'devanagari') {
    return textMatchesStoryPassageScript(text, 'devanagari', { strict: false });
  }
  if (required === 'telugu') {
    return textMatchesStoryPassageScript(text, 'telugu', { strict: false });
  }
  return true;
}

/** Extra prompt lines when batch variant angles might encourage bilingual output. */
export function buildStoryPassageMonolingualOverrideBlock(subject) {
  const canonical = canonicalStoryPassageSubject(subject);
  if (canonical === 'Hindi') {
    return `MONOLINGUAL OVERRIDE (mandatory): Write 100% in Hindi Devanagari only. Do NOT use English words, Roman transliteration, or Telugu script — even if a creative angle mentions bilingual or English terms.`;
  }
  if (canonical === 'Telugu') {
    return `MONOLINGUAL OVERRIDE (mandatory): Write 100% in Telugu Lipi only. Do NOT use English words, Roman transliteration, Hindi/Devanagari, or bilingual mixing — even if a creative angle mentions bilingual or English terms.`;
  }
  return '';
}

export function buildStoryPassageLanguageRetryHint(subject) {
  const lang = resolveStoryPassageOutputLanguage(subject);
  if (!lang || lang.language === 'English') return '';
  return `LANGUAGE RETRY (critical): Regenerate ALL string values in ${lang.language} using ${lang.script} only. Remove every English sentence, English question, and Roman transliteration.`;
}

export function isStoryPassageLanguageToolSlug(toolSlug) {
  const slug = String(toolSlug || '').trim();
  return slug === 'reading-practice-room' || slug === 'story-passage-creator';
}

/** Tools where Hindi/Telugu subject requires Devanagari/Lipi in ALL string fields. */
export function isIndicLanguageOutputToolSlug(toolSlug) {
  const slug = String(toolSlug || '').trim();
  return (
    isStoryPassageLanguageToolSlug(slug) ||
    slug === 'flashcard-generator' ||
    slug === 'my-study-decks'
  );
}

/** Hindi/Telugu language-class subjects must pass script compliance — never bypass for cost saver. */
export function mustEnforceStoryPassageLanguageCompliance(subject) {
  const required = storyPassageRequiredScript(subject);
  return required === 'devanagari' || required === 'telugu';
}

/** Hindi/Telugu language-class subjects — skip English finalize/scaffold injection. */
export function shouldSkipEnglishScaffoldForLanguageSubject(subject) {
  return mustEnforceStoryPassageLanguageCompliance(subject);
}

/** Prompt block for ANY AI tool when SUBJECT is Hindi, Telugu, or English (language class). */
export function buildUniversalLanguageSubjectPromptBlock(subject) {
  const canonical = canonicalStoryPassageSubject(subject);
  if (!canonical) return '';
  const languageBlock = buildStoryPassageLanguagePromptBlock(subject);
  const monolingual = buildStoryPassageMonolingualOverrideBlock(subject);
  const parts = [
    languageBlock,
    monolingual,
    `UNIVERSAL OUTPUT LANGUAGE (all curriculum tools): SUBJECT is ${canonical} — a language class.`,
    'Write EVERY JSON string value in the output language: titles, instructions, questions, MCQ options, answers, objectives, rubrics, homework, lesson steps, flashcard fronts/backs, project steps, summaries.',
    'Never use English sentences or English boilerplate when SUBJECT is Hindi or Telugu. JSON property names stay in English.',
  ].filter(Boolean);
  return parts.join('\n');
}

/** True when economy-mode validation bypass would save mixed-language output. */
export function shouldBlockCostSaverForStoryLanguage(toolSlug, subject, structured, validationMessage = '') {
  if (!mustEnforceStoryPassageLanguageCompliance(subject)) return false;
  const langCheck = validateStoryPassageLanguageCompliance(subject, structured, {
    toolSlug: String(toolSlug || '').trim(),
    requirePassage: isStoryPassageLanguageToolSlug(toolSlug),
  });
  if (!langCheck.valid) return true;
  const msg = String(validationMessage || '').toLowerCase();
  return (
    msg.includes('devanagari') ||
    msg.includes('telugu lipi') ||
    msg.includes('must not mix') ||
    msg.includes('hindi (devanagari') ||
    msg.includes('telugu (telugu lipi')
  );
}

/** Canonical section labels echoed back as fake content (e.g. "Passage / Story for … in Hindi."). */
const STORY_SECTION_LABEL_PREFIX =
  /^(?:Reading Practice(?: Title)?|Subtopic Link and Prior Knowledge(?: Required)?|Learning Objectives(?:\s*[-–]\s*Bloom'?s Taxonomy Aligned)?|NCF Competency(?:\s*\/\s*Learning Outcome Alignment)?|Vocabulary Warm-up|Passage(?:\s*\/\s*Story)?|Read and Recall Questions?|Think and Infer Questions?|Apply and Connect Questions?|Vocabulary(?: and Grammar)? Practice|Answer Key(?:\s*\/\s*Suggested Responses)?|Expected Learning Outcomes?|Reflection(?:\s*\/\s*Exit Ticket)?|Story(?:\s*\/\s*Passage)?(?: Title| Content)?|Topic and Subtopic Connection|Prior Knowledge(?: Required)?|Pre-reading Thinking Prompt|Creative Response Activity|Common Mistakes to Avoid|Differentiation Support|Real-life Application)\b/i;

/** True when Gemini copied a template heading instead of writing real passage / question content. */
export function isStoryPassagePlaceholderText(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 12) return true;
  if (/^(reading practice|story|passage|title|n\/?a|tbd)$/i.test(t)) return true;
  if (STORY_SECTION_LABEL_PREFIX.test(t) && /\bfor\b/i.test(t)) return true;
  if (/\bfor\s+[^:]+:\s*.+\s+in\s+(Hindi|Telugu|English)\b/i.test(t)) return true;
  if (STORY_SECTION_LABEL_PREFIX.test(t) && /\(\s*(Hindi|Telugu|English)\s*\)\s*\.?$/i.test(t)) {
    return true;
  }
  return false;
}

/** Devanagari/Lipi scaffold for missing Story & Passage Creator sections (never English). */
export function fillIndicStoryPassageScaffold(s, meta = {}) {
  const storyLanguage = canonicalStoryPassageSubject(meta.subject);
  if (storyLanguage !== 'Hindi' && storyLanguage !== 'Telugu') return s;

  const topic = resolveIndicScaffoldTopic(meta, storyLanguage === 'Telugu' ? 'telugu' : 'devanagari');

  if (storyLanguage === 'Hindi') {
    if (!indicScaffoldFilled(s.topic_subtopic_connection)) {
      s.topic_subtopic_connection = `यह कहानी ${topic} से जुड़ी है और कक्षा के पाठ्यक्रम के साथ मेल खाती है।`;
    }
    if (!indicScaffoldFilled(s.prior_knowledge_required)) {
      s.prior_knowledge_required = `विद्यार्थियों को पढ़ने से पहले ${topic} से संबंधित मूलभूत बातें याद होनी चाहिए।`;
    }
    if (!Array.isArray(s.learning_objectives) || s.learning_objectives.length < 2) {
      s.learning_objectives = [
        `${topic} से जुड़े मुख्य विचारों को पढ़कर समझना।`,
        `गद्यांश पर आधारित स्मरण और अनुमान वाले प्रश्नों के उत्तर देना।`,
        `${topic} को दैनिक जीवन के उदाहरण से जोड़ना।`,
      ];
    }
    if (!indicScaffoldFilled(s.ncf_competency_alignment)) {
      s.ncf_competency_alignment = `एनसीएफ-एसई 2023 के अनुसार पठन, समझ और संवाद से संबंधित दक्षताओं के साथ संरेखित — ${topic} पर केंद्रित।`;
    }
    if (!Array.isArray(s.vocabulary_warmup) || s.vocabulary_warmup.length < 3) {
      s.vocabulary_warmup = ['अवलोकन', 'साक्ष्य', 'निष्कर्ष', 'अनुमान'];
    }
    if (!indicScaffoldFilled(s.pre_reading_thinking_prompt)) {
      s.pre_reading_thinking_prompt = `पढ़ने से पहले ${topic} के बारे में आप क्या जानते हैं? आपके मन में कौन से प्रश्न हैं?`;
    }
    if (!indicScaffoldFilled(s.vocabulary_grammar_practice)) {
      s.vocabulary_grammar_practice = `शब्दावली सूची के शब्दों का उपयोग करके ${topic} पर दो मूल वाक्य लिखिए।`;
    }
    if (!indicScaffoldFilled(s.creative_response_activity)) {
      s.creative_response_activity = `${topic} को दैनिक जीवन में दिखाते हुए एक छोटी डायरी प्रविष्टि या चित्र कथा बनाइए।`;
    }
    if (!indicScaffoldFilled(s.common_mistakes_to_avoid)) {
      s.common_mistakes_to_avoid =
        'गद्यांश की पंक्तियाँ बिना व्याख्या के न कॉपी करें; हर उत्तर में पाठ से साक्ष्य दें।';
    }
    if (!indicScaffoldFilled(s.differentiation_support)) {
      s.differentiation_support =
        'सहायता: वाक्य आरंभकर्ता और शब्दकोश। विस्तार: ${topic} से जुड़े दो उदाहरणों की तुलना करें।'.replace(
          '${topic}',
          topic,
        );
    }
    if (!Array.isArray(s.expected_learning_outcomes) || s.expected_learning_outcomes.length < 2) {
      s.expected_learning_outcomes = [
        `विद्यार्थी ${topic} का मुख्य विचार अपने शब्दों में समझा सकें।`,
        'विद्यार्थी पाठ के आधार पर स्मरण और अनुमान वाले प्रश्नों के उत्तर दे सकें।',
      ];
    }
    if (!indicScaffoldFilled(s.real_life_application)) {
      s.real_life_application = `चर्चा करें कि ${topic} से जुड़े विचार घर, समाचार या समुदाय में कहाँ दिखाई देते हैं।`;
    }
    if (!indicScaffoldFilled(s.reflection_exit_ticket)) {
      s.reflection_exit_ticket = `${topic} के बारे में आपने क्या नया सीखा? आपके मन में अभी भी कौन सा प्रश्न है?`;
    }
  } else {
    if (!indicScaffoldFilled(s.topic_subtopic_connection)) {
      s.topic_subtopic_connection = `ఈ కథ ${topic}కు సంబంధించినది మరియు తరగతి పాఠ్యాంశంతో సరిపోతుంది.`;
    }
    if (!indicScaffoldFilled(s.prior_knowledge_required)) {
      s.prior_knowledge_required = `విద్యార్థులు చదవడానికి ముందు ${topic}కు సంబంధించిన ప్రాథమిక అంశాలు గుర్తుండాలి.`;
    }
    if (!Array.isArray(s.learning_objectives) || s.learning_objectives.length < 2) {
      s.learning_objectives = [
        `${topic}కు సంబంధించిన ప్రధాన ఆలోచనలను చదివి అర్థం చేసుకోవడం.`,
        `పాఠ్యభాగంపై ఆధారపడి స్మరణ మరియు అనుమాన ప్రశ్నలకు సమాధానం ఇవ్వడం.`,
        `${topic}ను దైనందిన జీవిత ఉదాహరణతో అనుసంధానం చేయడం.`,
      ];
    }
    if (!indicScaffoldFilled(s.ncf_competency_alignment)) {
      s.ncf_competency_alignment = `ఎన్‌సిఎఫ్-ఎస్‌ఈ 2023 పఠన, అవగాహన మరియు సంభాషణ నైపుణ్యాలకు అనుగుణం — ${topic}పై కేంద్రీకృతం.`;
    }
    if (!Array.isArray(s.vocabulary_warmup) || s.vocabulary_warmup.length < 3) {
      s.vocabulary_warmup = ['పరిశీలన', 'సాక్ష్యం', 'నిర్ణయం', 'అనుమానం'];
    }
    if (!indicScaffoldFilled(s.pre_reading_thinking_prompt)) {
      s.pre_reading_thinking_prompt = `చదవడానికి ముందు ${topic} గురించి మీకు ఇప్పటికే ఏమి తెలుసు? మీ మనస్సులో ఏ ప్రశ్నలు ఉన్నాయి?`;
    }
    if (!indicScaffoldFilled(s.vocabulary_grammar_practice)) {
      s.vocabulary_grammar_practice = `పదజాలం జాబితాలోని పదాలను ఉపయోగించి ${topic}పై రెండు మూల వాక్యాలు రాయండి.`;
    }
    if (!indicScaffoldFilled(s.creative_response_activity)) {
      s.creative_response_activity = `${topic}ను దైనందిన జీవితంలో చూపించే చిన్న డైరీ ఎంట్రీ లేదా చిత్ర కథను సృష్టించండి.`;
    }
    if (!indicScaffoldFilled(s.common_mistakes_to_avoid)) {
      s.common_mistakes_to_avoid =
        'పాఠ్యభాగం పంక్తులను వివరణ లేకుండా కాపీ చేయకండి; ప్రతి సమాధానంలో పాఠ్య సాక్ష్యం ఇవ్వండి.';
    }
    if (!indicScaffoldFilled(s.differentiation_support)) {
      s.differentiation_support = `సహాయం: వాక్య ప్రారంభకర్తలు మరియు పదకోశం. విస్తరణ: ${topic}కు సంబంధించిన రెండు ఉదాహరణలను పోల్చండి.`;
    }
    if (!Array.isArray(s.expected_learning_outcomes) || s.expected_learning_outcomes.length < 2) {
      s.expected_learning_outcomes = [
        `విద్యార్థులు ${topic} యొక్క ప్రధాన ఆలోచనను తమ మాటల్లో వివరించగలరు.`,
        'విద్యార్థులు పాఠ్య ఆధారంగా స్మరణ మరియు అనుమాన ప్రశ్నలకు సమాధానం ఇవ్వగలరు.',
      ];
    }
    if (!indicScaffoldFilled(s.real_life_application)) {
      s.real_life_application = `${topic}కు సంబంధించిన ఆలోచనలు ఇల్లు, వార్తలు లేదా సమాజంలో ఎక్కడ కనిపిస్తాయో చర్చించండి.`;
    }
    if (!indicScaffoldFilled(s.reflection_exit_ticket)) {
      s.reflection_exit_ticket = `${topic} గురించి మీరు కొత్తగా ఏమి నేర్చుకున్నారు? మీ మనస్సులో ఇంకా ఏ ప్రశ్న ఉంది?`;
    }
  }

  return s;
}

/** Devanagari/Lipi scaffold for Reading Practice Room metadata fields (not the passage). */
export function fillIndicReadingPracticeScaffold(s, meta = {}) {
  const storyLanguage = canonicalStoryPassageSubject(meta.subject);
  if (storyLanguage !== 'Hindi' && storyLanguage !== 'Telugu') return s;

  const topic = resolveIndicScaffoldTopic(meta, storyLanguage === 'Telugu' ? 'telugu' : 'devanagari');

  if (storyLanguage === 'Hindi') {
    if (!indicScaffoldFilled(s.subtopic_link_prior_knowledge)) {
      s.subtopic_link_prior_knowledge = `यह पाठ ${topic} से जुड़ा है। पढ़ने से पहले विषय की मूल बातें दोहराएँ।`;
    }
    if (!Array.isArray(s.learning_objectives) || s.learning_objectives.length < 2) {
      s.learning_objectives = [
        `${topic} से जुड़े मुख्य विचार समझना।`,
        'गद्यांश पर आधारित प्रश्नों के उत्तर देना।',
      ];
    }
    if (!indicScaffoldFilled(s.ncf_competency_alignment)) {
      s.ncf_competency_alignment = `पठन और समझ दक्षताओं के साथ संरेखित — ${topic} पर केंद्रित।`;
    }
    if (!Array.isArray(s.vocabulary_warmup) || s.vocabulary_warmup.length < 3) {
      s.vocabulary_warmup = ['अवलोकन', 'साक्ष्य', 'निष्कर्ष'];
    }
    if (!indicScaffoldFilled(s.reflection_exit_ticket)) {
      s.reflection_exit_ticket = `${topic} के बारे में आपने क्या नया सीखा?`;
    }
  } else {
    if (!indicScaffoldFilled(s.subtopic_link_prior_knowledge)) {
      s.subtopic_link_prior_knowledge = `ఈ పాఠం ${topic}కు సంబంధించినది. చదవడానికి ముందు ప్రాథమిక అంశాలను గుర్తు చేసుకోండి.`;
    }
    if (!Array.isArray(s.learning_objectives) || s.learning_objectives.length < 2) {
      s.learning_objectives = [
        `${topic}కు సంబంధించిన ప్రధాన ఆలోచనలను అర్థం చేసుకోవడం.`,
        'పాఠ్యభాగంపై ఆధారపడి ప్రశ్నలకు సమాధానం ఇవ్వడం.',
      ];
    }
    if (!indicScaffoldFilled(s.ncf_competency_alignment)) {
      s.ncf_competency_alignment = `పఠన మరియు అవగాహన నైపుణ్యాలకు అనుగుణం — ${topic}పై కేంద్రీకృతం.`;
    }
    if (!Array.isArray(s.vocabulary_warmup) || s.vocabulary_warmup.length < 3) {
      s.vocabulary_warmup = ['పరిశీలన', 'సాక్ష్యం', 'నిర్ణయం'];
    }
    if (!indicScaffoldFilled(s.reflection_exit_ticket)) {
      s.reflection_exit_ticket = `${topic} గురించి మీరు కొత్తగా ఏమి నేర్చుకున్నారు?`;
    }
  }

  return s;
}

function parseIndicBlueprintCounts(blueprint = '') {
  const text = String(blueprint || '');
  const pick = (letter) => {
    const m = text.match(new RegExp(`section\\s*${letter}[^\\d]*(\\d+)`, 'i'));
    return m ? Math.max(0, Number(m[1])) : 0;
  };
  const parsed = { a: pick('a'), b: pick('b'), c: pick('c'), d: pick('d'), e: pick('e') };
  const total = parsed.a + parsed.b + parsed.c + parsed.d + parsed.e;
  if (total === 0) return { a: 2, b: 1, c: 1, d: 1, e: 1 };
  return {
    a: parsed.a || 1,
    b: parsed.b || 1,
    c: parsed.c || 1,
    d: parsed.d || 1,
    e: parsed.e || 1,
  };
}

/** Hindi/Telugu exam questions when the model returns too few items. */
export function buildIndicScaffoldExamQuestions(meta = {}, blueprint = '') {
  const lang = canonicalStoryPassageSubject(meta.subject);
  const topic = resolveIndicScaffoldTopic(meta, lang === 'Telugu' ? 'telugu' : 'devanagari');
  const isTelugu = lang === 'Telugu';
  const counts = parseIndicBlueprintCounts(blueprint);
  const buckets = { section_a: [], section_b: [], section_c: [], section_d: [], section_e: [] };
  let n = 1;

  if (isTelugu) {
    for (let i = 0; i < counts.a; i += 1) {
      buckets.section_a.push({
        question_number: n++,
        question: `${topic} గురించి క్రింది వాటిలో ఏది సరైనది? (బహువికల్పం ${i + 1})`,
        options: [
          'A) ఆధారం లేకుండా అభిప్రాయం',
          'B) పరిశీలన మరియు సాక్ష్యంతో కూడిన వివరణ',
          'C) కేవలం పురావృత్తం',
          'D) పరీక్షించలేని ఆచారం',
        ],
        answer: 'B) పరిశీలన మరియు సాక్ష్యంతో కూడిన వివరణ',
        marks: 1,
      });
    }
    for (let i = 0; i < counts.b; i += 1) {
      buckets.section_b.push({
        question_number: n++,
        question: `${topic}కు సంబంధించిన ఒక ముఖ్య పదాన్ని నిర్వచించండి. (చాలా చిన్న సమాధానం ${i + 1})`,
        answer: `${topic}కు సంబంధించిన సంక్షిప్త నిర్వచనం.`,
        marks: 2,
      });
    }
    for (let i = 0; i < counts.c; i += 1) {
      buckets.section_c.push({
        question_number: n++,
        question: `${topic} దైనందిన జీవితంలో ఎలా ఉపయోగపడుతుందో వివరించండి. (చిన్న సమాధానం ${i + 1})`,
        answer: `${topic}కు సంబంధించిన ఉదాహరణతో సమాధానం.`,
        marks: 3,
      });
    }
    for (let i = 0; i < counts.d; i += 1) {
      buckets.section_d.push({
        question_number: n++,
        question: `${topic} యొక్క ప్రధాన ఆలోచనలను వివరంగా రాయండి. (దీర్ఘ సమాధానం ${i + 1})`,
        answer: `${topic}కు సంబంధించిన వివరణాత్మక సమాధానం.`,
        marks: 5,
      });
    }
    for (let i = 0; i < counts.e; i += 1) {
      buckets.section_e.push({
        question_number: n++,
        question: `${topic}పై కేస్ స్టడీ: పరిస్థితిని చదివి (ఎ)–(డ) ప్రశ్నలకు సమాధానం ఇవ్వండి.`,
        answer: `పాఠ్య సాక్ష్యంతో ${topic}కు సంబంధించిన సమాధానాలు.`,
        marks: 6,
      });
    }
    return buckets;
  }

  for (let i = 0; i < counts.a; i += 1) {
    buckets.section_a.push({
      question_number: n++,
      question: `${topic} के बारे में निम्न में से कौन-सा कथन सबसे उपयुक्त है? (बहुविकल्पीय ${i + 1})`,
      options: [
        'A) बिना साक्ष्य के अनुमान',
        'B) प्रेक्षण और साक्ष्य पर आधारित तर्क',
        'C) केवल रूढ़िवादी मान्यता',
        'D) जाँच न की जा सकने वाली परंपरा',
      ],
      answer: 'B) प्रेक्षण और साक्ष्य पर आधारित तर्क',
      marks: 1,
    });
  }
  for (let i = 0; i < counts.b; i += 1) {
    buckets.section_b.push({
      question_number: n++,
      question: `${topic} से जुड़ा एक मुख्य शब्द परिभाषित कीजिए। (अति लघु उत्तर ${i + 1})`,
      answer: `${topic} की संक्षिप्त परिभाषा।`,
      marks: 2,
    });
  }
  for (let i = 0; i < counts.c; i += 1) {
    buckets.section_c.push({
      question_number: n++,
      question: `${topic} दैनिक जीवन में कैसे उपयोगी है — एक उदाहरण सहित समझाइए। (लघु उत्तर ${i + 1})`,
      answer: `${topic} से जुड़े वास्तविक उदाहरण पर आधारित उत्तर।`,
      marks: 3,
    });
  }
  for (let i = 0; i < counts.d; i += 1) {
    buckets.section_d.push({
      question_number: n++,
      question: `${topic} के मुख्य बिंदुओं को विस्तार से लिखिए। (दीर्घ उत्तर ${i + 1})`,
      answer: `${topic} पर विस्तृत, तर्कसंगत उत्तर।`,
      marks: 5,
    });
  }
  for (let i = 0; i < counts.e; i += 1) {
    buckets.section_e.push({
      question_number: n++,
      question: `${topic} पर आधारित प्रसंग अध्ययन पढ़कर (क)–(घ) के उत्तर दीजिए।`,
      answer: `पाठ्य सामग्री के साक्ष्य से ${topic} से संबंधित उत्तर।`,
      marks: 6,
    });
  }
  return buckets;
}

/** Pad Exam Question Paper metadata and questions in Hindi/Telugu (never English scaffold). */
export function fillIndicExamPaperScaffold(s, meta = {}) {
  const resolvedSubject = resolveLanguageSubjectForGeneration(meta.subject, meta.bookSubject);
  const indicMeta = { ...meta, subject: resolvedSubject };
  const storyLanguage = canonicalStoryPassageSubject(resolvedSubject);
  if (storyLanguage !== 'Hindi' && storyLanguage !== 'Telugu') return s;

  const requiredScript = storyPassageRequiredScript(resolvedSubject);
  const topic = resolveIndicScaffoldTopic(indicMeta, requiredScript);
  const subjectLabel = storyLanguage === 'Hindi' ? 'हिंदी' : 'తెలుగు';

  const sectionKeys = ['section_a', 'section_b', 'section_c', 'section_d', 'section_e'];

  // Lift questions from sections[] when Gemini only returns grouped sections.
  if (Array.isArray(s.sections)) {
    for (const sec of s.sections) {
      if (!sec || typeof sec !== 'object') continue;
      const name = String(sec.sectionName || sec.name || sec.title || '').trim().toLowerCase();
      let key = '';
      if (/section\s*a\b|\bmcq|multiple\s*choice/.test(name)) key = 'section_a';
      else if (/section\s*b\b|very\s*short|vsa/.test(name)) key = 'section_b';
      else if (/section\s*c\b|short\s*answer/.test(name) && !/very\s*short|vsa/.test(name)) key = 'section_c';
      else if (/section\s*d\b|long\s*answer|essay/.test(name)) key = 'section_d';
      else if (/section\s*e\b|case|competency|competence/.test(name)) key = 'section_e';
      const rows = Array.isArray(sec.questions) ? sec.questions : [];
      if (!key || !rows.length) continue;
      const existing = Array.isArray(s[key]) ? s[key] : [];
      s[key] = existing.length ? existing : rows;
    }
  }

  if (Array.isArray(s.questions) && s.questions.length) {
    let qNum = 1;
    for (const key of sectionKeys) {
      if (Array.isArray(s[key]) && s[key].length) continue;
      const pick = s.questions[qNum - 1];
      if (!pick) break;
      s[key] = [typeof pick === 'string' ? { question: pick, answer: '' } : pick];
      qNum += 1;
    }
  }

  const scaffold = buildIndicScaffoldExamQuestions(indicMeta, s.blueprint || '');

  if (!indicLanguageFieldFilled(s.paper_title, requiredScript) && !indicLanguageFieldFilled(s.title, requiredScript)) {
    const title =
      storyLanguage === 'Hindi'
        ? `${topic} — ${subjectLabel} प्रश्न पत्र`
        : `${topic} — ${subjectLabel} ప్రశ్న పత్రం`;
    s.paper_title = title;
    s.title = title;
  }
  if (!indicLanguageFieldFilled(s.instructions, requiredScript)) {
    s.instructions =
      storyLanguage === 'Hindi'
        ? `सभी निर्देश ध्यान से पढ़िए। हर प्रश्न का उत्तर निर्धारित स्थान पर लिखिए। विषय: ${topic}।`
        : `అన్ని సూచనలు జాగ్రత్తగా చదవండి. ప్రతి ప్రశ్నకు నిర్దిష్ట స్థలంలో సమాధానం రాయండి. విషయం: ${topic}.`;
  }
  if (!indicLanguageFieldFilled(s.blueprint, requiredScript)) {
    s.blueprint =
      storyLanguage === 'Hindi'
        ? `प्रश्न पत्र खाका: खंड क (२ बहुविकल्पीय), खंड ख (१ अति लघु), खंड ग (१ लघु), खंड घ (१ दीर्घ), खंड घर (१ प्रसंग आधारित) — विषय: ${topic}।`
        : `ప్రశ్న పత్రం రూపరేఖ: విభాగం A (2 బహువికల్పం), B (1 చాలా చిన్న), C (1 చిన్న), D (1 పొడవైన), E (1 పరిస్థితి) — విషయం: ${topic}.`;
  }
  if (!indicLanguageFieldFilled(s.internal_choices, requiredScript)) {
    s.internal_choices =
      storyLanguage === 'Hindi'
        ? 'जहाँ "अथवा" दिया हो, केवल एक प्रश्न हल कीजिए। आंतरिक विकल्प खंड घ और घर में लागू हो सकता है।'
        : 'ఎక్కడ "లేదా" ఉందో, ఒక ప్రశ్న మాత్రమే పరిష్కరించండి. అంతర్గత ఎంపికలు D మరియు E విభాగాల్లో వర్తిస్తాయి.';
  }
  if (!indicLanguageFieldFilled(s.marking_scheme, requiredScript)) {
    s.marking_scheme =
      storyLanguage === 'Hindi'
        ? `सही अवधारणा, प्रक्रिया और इकाई के लिए अंक दें। विषय: ${topic}।`
        : `సరైన అవగాహన, ప్రక్రియ మరియు యూనిట్లకు మార్కులు ఇవ్వండి. విషయం: ${topic}.`;
  }
  if (!indicLanguageFieldFilled(s.open_ended_rubric, requiredScript)) {
    s.open_ended_rubric =
      storyLanguage === 'Hindi'
        ? `स्तर 4: पूर्ण और स्पष्ट; स्तर 3: अधिकांश सही; स्तर 2: आंशिक; स्तर 1: न्यूनतम समझ (${topic})।`
        : `స్థాయి 4: పూర్తి మరియు స్పష్టం; 3: చాలా వరకు సరైనది; 2: పాక్షికం; 1: కనీస అవగాహన (${topic}).`;
  }

  for (const key of sectionKeys) {
    const existing = Array.isArray(s[key]) ? s[key] : [];
    const scaffoldRows = Array.isArray(scaffold[key]) ? scaffold[key] : [];
    const repaired = [];
    const targetCount = Math.max(existing.length, scaffoldRows.length ? 1 : 0, 1);
    for (let i = 0; i < targetCount; i += 1) {
      const q = existing[i];
      const pick = scaffoldRows[i] || scaffoldRows[scaffoldRows.length - 1];
      if (q && !questionBodyNeedsIndicRepair(q, requiredScript)) {
        repaired.push(q);
      } else if (pick) {
        repaired.push({
          ...pick,
          question_number: q?.question_number ?? pick.question_number ?? i + 1,
        });
      }
    }
    const valid = repaired.filter((q) => String(q?.question || q?.prompt || '').trim().length >= 10);
    s[key] = valid.length ? valid : scaffoldRows;
  }

  let totalQuestions = sectionKeys.reduce((n, key) => {
    const rows = Array.isArray(s[key]) ? s[key] : [];
    return (
      n +
      rows.filter((q) => String(q?.question || q?.prompt || '').trim().length >= 10).length
    );
  }, 0);
  if (totalQuestions < 3) {
    for (const key of sectionKeys) {
      if (totalQuestions >= 3) break;
      const scaffoldRows = Array.isArray(scaffold[key]) ? scaffold[key] : [];
      if (!scaffoldRows.length) continue;
      s[key] = scaffoldRows;
      totalQuestions += scaffoldRows.length;
    }
  }

  const lines = [];
  for (const key of sectionKeys) {
    for (const q of Array.isArray(s[key]) ? s[key] : []) {
      if (String(q?.answer || '').trim()) {
        const n = q.question_number != null ? `प्र${q.question_number}` : 'प्र';
        lines.push(storyLanguage === 'Hindi' ? `${n}: ${q.answer}` : `Q${q.question_number ?? ''}: ${q.answer}`);
      }
    }
  }
  if (lines.length) {
    s.answer_key = lines.join('\n');
  } else if (!indicLanguageFieldFilled(s.answer_key, requiredScript)) {
    s.answer_key =
      storyLanguage === 'Hindi'
        ? `उत्तर कुंजी: ${topic} पर आधारित मॉडल उत्तर संलग्न हैं।`
        : `సమాధాన కీ: ${topic}పై ఆధారిత మోడల్ సమాధానాలు ఇవ్వబడ్డాయి.`;
  }

  return s;
}

/**
 * Repair Hindi/Telugu structured output before save — replaces English LLM/RAG text with Indic scaffolds.
 * @param {string} toolSlug
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} meta
 */
export function enforceIndicLanguageStructuredContent(toolSlug, data, meta = {}) {
  const subject = resolveLanguageSubjectForGeneration(meta.subject, meta.bookSubject);
  if (!mustEnforceStoryPassageLanguageCompliance(subject)) {
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }
  const enrichedMeta = { ...meta, subject };
  let s = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  const slug = String(toolSlug || '').trim();

  if (slug === 'exam-question-paper-generator' || slug === 'mock-test-builder') {
    s = fillIndicExamPaperScaffold(s, enrichedMeta);
  } else if (slug === 'daily-class-plan-maker') {
    s = fillIndicDailyClassPlanScaffold(s, enrichedMeta);
  } else if (slug === 'story-passage-creator') {
    s = fillIndicStoryPassageScaffold(s, enrichedMeta);
  } else if (slug === 'reading-practice-room') {
    s = fillIndicReadingPracticeScaffold(s, enrichedMeta);
  }

  return s;
}

/** Pad Daily Class Plan fields in Hindi/Telugu. */
export function fillIndicDailyClassPlanScaffold(s, meta = {}) {
  const storyLanguage = canonicalStoryPassageSubject(meta.subject);
  if (storyLanguage !== 'Hindi' && storyLanguage !== 'Telugu') return s;

  const topic = resolveIndicScaffoldTopic(meta, storyLanguage === 'Telugu' ? 'telugu' : 'devanagari');

  if (storyLanguage === 'Hindi') {
    if (!indicScaffoldFilled(s.day_period_topic_breakup)) {
      s.day_period_topic_breakup = `${topic} — कक्षा अवधि विषय योजना।`;
    }
    if (!indicScaffoldFilled(s.title)) s.title = s.day_period_topic_breakup;
    if (!Array.isArray(s.objectives) || s.objectives.length < 1) {
      s.objectives = [
        `${topic} के मुख्य विचारों को समझना।`,
        `${topic} को उदाहरणों से जोड़ना।`,
      ];
    }
    if (!Array.isArray(s.teaching_methods) || s.teaching_methods.length < 1) {
      s.teaching_methods = ['चर्चा', 'प्रदर्शन', 'समूह गतिविधि'];
    }
    if (!Array.isArray(s.classroom_activity) || s.classroom_activity.length < 1) {
      s.classroom_activity = [`${topic} से जुड़ी कक्षा गतिविधि।`];
    }
    if (!indicScaffoldFilled(s.exit_ticket)) {
      s.exit_ticket = `${topic} के बारे में आज आपने क्या सीखा?`;
    }
    if (!indicScaffoldFilled(s.differentiated_support)) {
      s.differentiated_support = 'सहायता: वाक्य आरंभकर्ता। विस्तार: दो नए उदाहरण बनाइए।';
    }
    if (!indicScaffoldFilled(s.homework_followup)) {
      s.homework_followup = `${topic} पर नोट्स दोहराएँ और दो प्रश्न लिखिए।`;
    }
    if (!Array.isArray(s.teaching_aids) || s.teaching_aids.length < 1) {
      s.teaching_aids = ['पाठ्यपुस्तक', 'चार्ट', 'कार्यपत्रक'];
    }
    if (!indicScaffoldFilled(s.teacher_reflection_notes)) {
      s.teacher_reflection_notes = `${topic} पाठ पर शिक्षक प्रतिबिंब — क्या काम किया, क्या सुधारना है।`;
    }
  } else {
    if (!indicScaffoldFilled(s.day_period_topic_breakup)) {
      s.day_period_topic_breakup = `${topic} — తరగతి కాల విషయ ప్రణాళిక.`;
    }
    if (!indicScaffoldFilled(s.title)) s.title = s.day_period_topic_breakup;
    if (!Array.isArray(s.objectives) || s.objectives.length < 1) {
      s.objectives = [
        `${topic} ప్రధాన ఆలోచనలను అర్థం చేసుకోవడం.`,
        `${topic}ను ఉదాహరణలతో అనుసంధానం చేయడం.`,
      ];
    }
    if (!Array.isArray(s.teaching_methods) || s.teaching_methods.length < 1) {
      s.teaching_methods = ['చర్చ', 'ప్రదర్శన', 'సమూహ కార్యకలాపం'];
    }
    if (!Array.isArray(s.classroom_activity) || s.classroom_activity.length < 1) {
      s.classroom_activity = [`${topic}కు సంబంధించిన తరగతి కార్యకలాపం.`];
    }
    if (!indicScaffoldFilled(s.exit_ticket)) {
      s.exit_ticket = `${topic} గురించి ఈరోజు మీరు ఏమి నేర్చుకున్నారు?`;
    }
    if (!indicScaffoldFilled(s.differentiated_support)) {
      s.differentiated_support = 'సహాయం: వాక్య ప్రారంభకర్తలు. విస్తరణ: రెండు కొత్త ఉదాహరణలు.';
    }
    if (!indicScaffoldFilled(s.homework_followup)) {
      s.homework_followup = `${topic}పై నోట్స్ సమీక్షించి రెండు ప్రశ్నలు రాయండి.`;
    }
    if (!Array.isArray(s.teaching_aids) || s.teaching_aids.length < 1) {
      s.teaching_aids = ['పాఠ్యపుస్తకం', 'చార్ట్', 'వర్క్‌షీట్'];
    }
    if (!indicScaffoldFilled(s.teacher_reflection_notes)) {
      s.teacher_reflection_notes = `${topic} పాఠంపై ఉపాధ్యాయ ప్రతిబింబం.`;
    }
  }
  return s;
}

/** Anti-placeholder rules shared by Reading Practice Room and Story & Passage Creator prompts. */
export function buildStoryPassageContentPromptBlock() {
  return `CRITICAL CONTENT RULE (mandatory):
Every JSON string value must be REAL classroom content — never a description of what the section should contain.
NEVER repeat canonical section headings or field labels as the content itself.
BAD (reject): "Passage / Story for Pre-reading: Let's Begin in Hindi."
BAD (reject): "Learning Objectives - Bloom's Taxonomy Aligned for … (Hindi)."
GOOD: passage = a full story (minimum ~120 words) in the output language; questions = actual recall/infer/connect questions students can answer.
GOOD: learning_objectives[] = 3+ measurable objectives written as complete sentences in the output language.
GOOD: vocabulary_warmup[] = real words with brief meanings in the output language — not section titles.
The title must be a creative story/passage name — not "Reading Practice" or a section label.`;
}
