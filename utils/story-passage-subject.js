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
  if (['hin', 'hindi'].includes(plain) || plain.includes('hindi')) return 'hindi';
  if (['tel', 'telugu'].includes(plain) || plain.includes('telugu')) return 'telugu';
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
  /^(?:section\s+[a-e]\b|mcq|multiple\s+choice|short\s+answer|long\s+answer|bloom|ncf|marks?\s*:|total\s+marks|answer\s+key|question\s+paper)/i;

function indicScaffoldFilled(value) {
  const t = String(value || '').trim();
  return t.length >= 12 && !isStoryPassagePlaceholderText(t);
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
    if (totalLetters > 20 && latinLetters / totalLetters > (strict ? 0.14 : 0.18)) return false;
    return latinLetters <= (strict ? 35 : Math.max(10, Math.floor(devCount * 0.12)));
  }

  if (requiredScript === 'telugu') {
    const minTel = strict ? 35 : 8;
    if (telCount < minTel) return false;
    if (devCount > Math.max(4, telCount * 0.15)) return false;
    const totalLetters = telCount + latinLetters;
    if (totalLetters > 20 && latinLetters / totalLetters > (strict ? 0.14 : 0.18)) return false;
    return latinLetters <= (strict ? 35 : Math.max(10, Math.floor(telCount * 0.12)));
  }

  if (requiredScript === 'english') {
    const indicCount = devCount + telCount;
    return indicCount <= Math.max(8, Math.floor(latinLetters * 0.15));
  }

  return true;
}

function walkStoryPassageStringValues(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStoryPassageStringValues(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) walkStoryPassageStringValues(v, out);
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
        if (errors.length >= 4) break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Skip English/mixed records when serving Hindi/Telugu language-subject content from rotation. */
export function storyPassageRecordLanguageValid(_toolSlug, subject, doc) {
  if (!mustEnforceStoryPassageLanguageCompliance(subject)) return true;

  const docSubject = String(subject || doc?.subject || '').trim();
  const structured = doc?.metadata?.structuredContent;
  if (structured && typeof structured === 'object') {
    return validateStoryPassageLanguageCompliance(docSubject, structured).valid;
  }

  const required = storyPassageRequiredScript(docSubject);
  const text = String(doc?.generatedContent || doc?.content || '').trim();
  if (!text || text.length < 40) return false;
  if (required === 'devanagari') {
    return textMatchesStoryPassageScript(text, 'devanagari', { strict: true });
  }
  if (required === 'telugu') {
    return textMatchesStoryPassageScript(text, 'telugu', { strict: true });
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

  const topic =
    String(meta.subTopic || meta.subtopic || meta.topic || '').trim() ||
    (storyLanguage === 'Hindi' ? 'विषय' : 'విషయం');

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

  const topic =
    String(meta.subTopic || meta.subtopic || meta.topic || '').trim() ||
    (storyLanguage === 'Hindi' ? 'विषय' : 'విషయం');

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
