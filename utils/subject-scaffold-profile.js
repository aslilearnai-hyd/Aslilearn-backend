/**
 * Subject-aware scaffold profiles for AI Generator section padding.
 * @module utils/subject-scaffold-profile
 */

import { resolveSubjectCategory } from '../prompts/shared/subject-awareness.js';
import { detectAssignmentSectionNum } from '../services/pdf-assignment-section-parser.js';

/** @typedef {'stem'|'english'|'social'|'general'} ScaffoldBand */

/**
 * @param {string} subject
 * @returns {ScaffoldBand}
 */
export function resolveScaffoldBand(subject) {
  const s = String(subject || '').toLowerCase();
  if (
    /social\s*studies|social\s*science|history|geography|civics|economics|political/i.test(s)
  ) {
    return 'social';
  }
  if (/evs|environmental/i.test(s)) return 'social';
  const cat = resolveSubjectCategory(subject);
  if (cat === 'science' || cat === 'maths') return 'stem';
  if (cat === 'english' || cat === 'hindi' || cat === 'telugu') return 'english';
  if (cat === 'social' || cat === 'evs') return 'social';
  return 'general';
}

/** @param {string} subject */
export function isStemSubject(subject) {
  return resolveScaffoldBand(subject) === 'stem';
}

/** @param {string} subject */
export function isEnglishLanguageSubject(subject) {
  return resolveScaffoldBand(subject) === 'english';
}

/** @param {string} subject */
export function isSocialSubject(subject) {
  return resolveScaffoldBand(subject) === 'social';
}

const HOMEWORK_SECTION_HINT = {
  1: /homework\s+title|^title$/i,
  2: /clear\s+student\s+instructions|^instructions/i,
  3: /practice\s+questions/i,
  4: /application/i,
  5: /creative|thinking\s+question/i,
  6: /real[\s-]*life|observation/i,
  7: /challenge/i,
  8: /support\s+hint/i,
  9: /answer\s+hints|key\s+points/i,
  10: /parent\s+note/i,
};

const PRACTICE_QA_SECTION_HINT =
  /^(?:section\s+[a-g]\b|mcqs?|fill\s+in\s+the\s+blanks?|match\s+the\s+following|very\s+short\s+answer|short\s+answer\s+questions?|application\s*\/\s*case|hots\s*\/\s*analytical|real[\s-]*life|answer\s+key|learning\s+objectives?|instructions\s+to\s+students?)/i;

/**
 * @param {string} value
 * @returns {string}
 */
export function stripNumberedSectionPrefix(value) {
  const raw = String(value ?? '').trim().replace(/^#{1,3}\s*/, '');
  const withoutNum = raw.replace(/^\d{1,2}\.\s*/, '').trim();
  return withoutNum || raw;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isQuickAssignmentSectionHeader(value) {
  const title = stripNumberedSectionPrefix(value);
  if (!title || title.length > 96) return false;
  return detectAssignmentSectionNum(title) > 0;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isHomeworkSectionHeader(value) {
  const title = stripNumberedSectionPrefix(value);
  if (!title || title.length > 96) return false;
  for (const [num, hint] of Object.entries(HOMEWORK_SECTION_HINT)) {
    if (hint.test(title)) return Number(num) > 0;
  }
  const m = title.match(/^(\d{1,2})\.\s+(.+)$/);
  if (m) {
    const hint = HOMEWORK_SECTION_HINT[Number(m[1])];
    if (hint?.test(m[2])) return true;
  }
  return false;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isPracticeQaSectionHeader(value) {
  const title = stripNumberedSectionPrefix(value);
  if (!title || title.length > 96) return false;
  if (PRACTICE_QA_SECTION_HINT.test(title)) return true;
  if (isQuickAssignmentSectionHeader(title)) return true;
  return false;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isTemplateSectionHeaderLine(value) {
  return (
    isQuickAssignmentSectionHeader(value) ||
    isHomeworkSectionHeader(value) ||
    isPracticeQaSectionHeader(value)
  );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function questionTextFromRow(value) {
  if (value && typeof value === 'object') {
    return String(value.question || value.prompt || value.text || '').trim();
  }
  return String(value ?? '').trim();
}

/**
 * @param {unknown[]} rows
 * @param {number} minLen
 * @returns {number}
 */
export function countValidQuestionRows(rows, minLen = 4) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const text = questionTextFromRow(row);
    return text.length >= minLen && !isTemplateSectionHeaderLine(text);
  }).length;
}

/**
 * @param {string} topic
 * @param {string} subject
 * @param {ScaffoldBand} band
 * @returns {string[]}
 */
export function stemLearningObjectives(topic, subject) {
  return [
    `Define and explain the core ideas of ${topic} using correct ${subject} terminology.`,
    `Apply formulas and principles from ${topic} to solve short numerical or reasoning problems.`,
    `Analyse one real-life application of ${topic} in everyday devices or situations.`,
  ];
}

/**
 * @param {string} topic
 * @param {string} subject
 * @returns {string[]}
 */
export function englishLearningObjectives(topic, subject) {
  return [
    `Recall and explain central ideas from ${topic}.`,
    `Apply listening and speaking skills to discuss ${topic} in ${subject}.`,
  ];
}

/**
 * @param {string} topic
 * @param {string} subject
 * @returns {string[]}
 */
export function generalLearningObjectives(topic, subject) {
  return [
    `Explain the main ideas of ${topic} clearly.`,
    `Apply ${topic} to a short task with examples from daily life.`,
  ];
}

/**
 * @param {string} topic
 * @param {string} subject
 * @param {ScaffoldBand} band
 * @returns {string[]}
 */
export function learningObjectivesForBand(topic, subject, band) {
  if (band === 'stem') return stemLearningObjectives(topic, subject);
  if (band === 'english') return englishLearningObjectives(topic, subject);
  if (band === 'social') {
    return [
      `Identify key facts and perspectives related to ${topic}.`,
      `Use evidence from sources to explain ${topic} in ${subject}.`,
    ];
  }
  return generalLearningObjectives(topic, subject);
}

/**
 * @param {string} topic
 * @param {string} subject
 * @param {ScaffoldBand} band
 * @param {number} n
 * @param {string} [answer]
 */
export function scaffoldQuestionRow(topic, subject, band, n, prompt, answer) {
  const defaultAnswer =
    band === 'stem'
      ? `Use definitions, formulas, and examples from ${topic} in ${subject}.`
      : band === 'english'
        ? `Support your response with ideas from ${topic} in ${subject}.`
        : `Use relevant examples and reasoning about ${topic} in ${subject}.`;
  return {
    question_number: n,
    question: prompt,
    type: n === 1 ? 'SA' : 'VSA',
    marks: n === 1 ? 3 : 2,
    answer: answer || defaultAnswer,
  };
}

/**
 * @param {string} topic
 * @param {string} subject
 * @param {ScaffoldBand} band
 * @returns {Array<Record<string, unknown>>}
 */
export function conceptQuestionsForBand(topic, subject, band) {
  if (band === 'stem') {
    return [
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        1,
        `Define ${topic} and state its SI unit (if applicable).`,
        `State the definition and correct unit for ${topic}.`,
      ),
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        2,
        `A device operates at 220 V and draws 2 A. Calculate the related quantity for ${topic} using the correct formula.`,
        `Show formula substitution with correct units.`,
      ),
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        3,
        `Give two real-life examples where ${topic} is used to compare or choose devices or situations.`,
        `Examples should be specific to ${subject} and ${topic}.`,
      ),
    ];
  }
  if (band === 'english') {
    return [
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        1,
        `Summarise the main message of ${topic} in your own words.`,
      ),
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        2,
        `Identify two speaking situations where ideas from ${topic} would help.`,
      ),
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        3,
        `Why is ${topic} relevant for learners studying ${subject}?`,
      ),
    ];
  }
  return [
    scaffoldQuestionRow(topic, subject, band, 1, `Explain the main idea of ${topic} in your own words.`),
    scaffoldQuestionRow(topic, subject, band, 2, `Give two examples of ${topic} from daily life.`),
    scaffoldQuestionRow(topic, subject, band, 3, `Why is ${topic} important in ${subject}?`),
  ];
}

/**
 * @param {string} topic
 * @param {string} subject
 * @param {ScaffoldBand} band
 * @returns {string}
 */
export function instructionsForBand(topic, subject, band) {
  if (band === 'stem') {
    return `Complete all sections on ${topic}. Show formula substitutions, units, and reasoning for numerical answers.`;
  }
  if (band === 'english') {
    return `Complete all sections on ${topic}. Write clearly and use examples from the text where asked.`;
  }
  return `Complete all sections on ${topic}. Write clearly and support answers with relevant examples.`;
}

/**
 * @param {string} label
 * @param {string} topic
 * @param {string} subject
 * @param {ScaffoldBand} band
 * @param {boolean} isList
 * @returns {string|string[]}
 */
export function genericSectionFallback(label, topic, subject, band, isList = false) {
  const text =
    band === 'stem'
      ? `${label} for ${topic}: use definitions, formulas, and a worked example (${subject}).`
      : band === 'english'
        ? `${label} for ${topic}: use evidence from the text and clear communication (${subject}).`
        : band === 'social'
          ? `${label} for ${topic}: use facts, sources, and Indian-context examples (${subject}).`
          : `${label} for ${topic} in ${subject}.`;
  return isList ? [text] : text;
}
