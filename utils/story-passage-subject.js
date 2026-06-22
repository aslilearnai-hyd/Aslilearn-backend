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
