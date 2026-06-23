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
      script: 'Devanagari (हिंदी)',
      rule: `CRITICAL OUTPUT LANGUAGE RULE (mandatory):
The SUBJECT is Hindi — this is a Hindi language class, not English.
Write ${valueFields} entirely in Hindi using Devanagari script.
Do NOT write the passage, questions, answers, or vocabulary in English.
JSON property names stay in English; only string values must be Hindi.
Allowed exceptions: unavoidable proper nouns (names, places) may appear as in the source.`,
    };
  }

  if (canonical === 'Telugu') {
    return {
      language: 'Telugu',
      script: 'Telugu script (తెలుగు)',
      rule: `CRITICAL OUTPUT LANGUAGE RULE (mandatory):
The SUBJECT is Telugu — this is a Telugu language class, not English.
Write ${valueFields} entirely in Telugu using Telugu script.
Do NOT write the passage, questions, answers, or vocabulary in English.
JSON property names stay in English; only string values must be Telugu.
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
