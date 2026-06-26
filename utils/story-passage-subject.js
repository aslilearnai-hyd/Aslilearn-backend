/**
 * Story & Passage Creator — English, Hindi, and Telugu only.
 */

export function isStoryPassageAllowedSubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return false;
  if (/(telugu|తెలుగు)/i.test(s)) return true;
  if (/(hindi|हिंदी|हिन्दी)/i.test(s)) return true;
  if (/english/i.test(s)) return true;
  return false;
}

/** Map curriculum label → canonical DB subject for lookups. */
export function canonicalStoryPassageSubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return null;
  if (/(telugu|తెలుగు)/i.test(s)) return 'Telugu';
  if (/(hindi|हिंदी|हिन्दी)/i.test(s)) return 'Hindi';
  if (/english/i.test(s)) return 'English';
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
  return (String(text).match(re) || []).length;
}

/** True when a user-facing string matches the required script for Hindi/Telugu/English subjects. */
export function textMatchesStoryPassageScript(text, requiredScript) {
  const t = String(text || '').trim();
  if (!t || t.length < 10) return true;

  const devCount = countMatches(t, DEVANAGARI_CHAR_RE);
  const telCount = countMatches(t, TELUGU_CHAR_RE);
  const latinLetters = (t.match(/[A-Za-z]/g) || []).length;

  if (requiredScript === 'devanagari') {
    if (devCount < 6) return false;
    if (telCount > Math.max(3, devCount * 0.15)) return false;
    return latinLetters <= Math.max(12, Math.floor(devCount * 0.2));
  }

  if (requiredScript === 'telugu') {
    if (telCount < 6) return false;
    if (devCount > Math.max(3, telCount * 0.15)) return false;
    return latinLetters <= Math.max(12, Math.floor(telCount * 0.2));
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
export function validateStoryPassageLanguageCompliance(subject, structured) {
  const required = storyPassageRequiredScript(subject);
  if (!required || required === 'english') {
    return { valid: true, errors: [] };
  }

  const errors = [];
  const label =
    required === 'devanagari'
      ? 'Hindi (Devanagari script only)'
      : 'Telugu (Telugu Lipi only)';

  for (const text of walkStoryPassageStringValues(structured)) {
    const t = String(text || '').trim();
    if (t.length < 16) continue;
    if (!textMatchesStoryPassageScript(t, required)) {
      errors.push(
        `${label}: content must not mix English or other languages — "${t.slice(0, 72)}${t.length > 72 ? '…' : ''}"`,
      );
      if (errors.length >= 3) break;
    }
  }

  return { valid: errors.length === 0, errors };
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
