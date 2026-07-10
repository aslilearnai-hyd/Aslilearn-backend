/**
 * Subject-aware scaffold profiles for AI Generator section padding.
 * @module utils/subject-scaffold-profile
 */

import { resolveSubjectCategory } from '../prompts/shared/subject-awareness.js';
import { detectAssignmentSectionNum } from '../services/pdf-assignment-section-parser.js';

/** @typedef {'maths'|'stem'|'english'|'social'|'general'} ScaffoldBand */

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
  if (/math|गणित/i.test(s)) return 'maths';
  const cat = resolveSubjectCategory(subject);
  if (cat === 'maths') return 'maths';
  if (cat === 'science') return 'stem';
  if (cat === 'english' || cat === 'hindi' || cat === 'telugu') return 'english';
  if (cat === 'social' || cat === 'evs') return 'social';
  return 'general';
}

/** @param {string} subject */
export function isMathsSubject(subject) {
  return resolveScaffoldBand(subject) === 'maths';
}

/** @param {ScaffoldBand} band */
export function isMathsBand(band) {
  return band === 'maths';
}

/** @param {ScaffoldBand} band */
export function isNumericalBand(band) {
  return band === 'maths' || band === 'stem';
}

/** @param {string} subject */
export function isStemSubject(subject) {
  const band = resolveScaffoldBand(subject);
  return band === 'stem' || band === 'maths';
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
    `Define key terms in ${topic} and use correct ${subject} terminology and SI units.`,
    `Apply the formula(s) for ${topic} to solve numerical problems with full working.`,
    `Explain the cause–effect relationship central to ${topic} with one supporting example.`,
  ];
}

/**
 * @param {string} topic
 * @param {string} subject
 * @returns {string[]}
 */
export function englishLearningObjectives(topic, subject) {
  return [
    `Identify and explain the central theme and key ideas in ${topic}.`,
    `Analyse language, structure, or character/action in ${topic} with evidence from the text.`,
  ];
}

/**
 * @param {string} topic
 * @param {string} subject
 * @returns {string[]}
 */
export function generalLearningObjectives(topic, subject) {
  return [
    `State and explain the main ideas of ${topic} clearly.`,
    `Apply ${topic} to answer short written questions with relevant examples.`,
  ];
}

export function mathsLearningObjectives(topic, subject) {
  return [
    `Solve standard numerical problems on ${topic} using the correct method and units.`,
    `Apply ${topic} to one-step and two-step calculations with given data.`,
    `Verify answers for ${topic} using estimation or reverse calculation.`,
  ];
}

/**
 * @param {string} topic
 * @param {string} subject
 * @param {ScaffoldBand} band
 * @returns {string[]}
 */
export function learningObjectivesForBand(topic, subject, band) {
  if (band === 'maths') return mathsLearningObjectives(topic, subject);
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
    band === 'maths'
      ? `Show Given, Formula/Method, Substitution, and final answer with correct units for ${topic}.`
      : band === 'stem'
        ? `Use definitions, formulas, and examples from ${topic} in ${subject}.`
        : band === 'english'
          ? `Support your response with ideas from ${topic} in ${subject}.`
          : `Use relevant examples and reasoning about ${topic} in ${subject}.`;
  return {
    question_number: n,
    question: prompt,
    type: band === 'maths' ? 'NUM' : n === 1 ? 'SA' : 'VSA',
    marks: band === 'maths' ? (n === 1 ? 2 : n === 2 ? 3 : 4) : n === 1 ? 3 : 2,
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
  if (band === 'maths') {
    return [
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        1,
        `Solve a direct numerical on ${topic}. Show Given, Method, Working, and Answer.`,
        `Write Given, Method, Working, and Answer with units if needed.`,
      ),
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        2,
        `Given the required data for ${topic}, calculate the unknown. Show each step.`,
        `Show clear step-by-step calculation and final answer with units.`,
      ),
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        3,
        `Solve a two-step numerical on ${topic}. Show full working for both steps.`,
        `Show both steps with formula/method and final answer.`,
      ),
    ];
  }
  if (band === 'stem') {
    return [
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        1,
        `Define ${topic}. State the formula used (if any) and its SI unit.`,
        `State the definition, formula, and correct unit for ${topic}.`,
      ),
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        2,
        `Using the formula for ${topic}, calculate the result when V = 220 V and I = 2 A. Show substitution and units.`,
        `Show formula substitution with correct units and final value.`,
      ),
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        3,
        `Explain the relationship between the quantities in ${topic}. Give one numerical example.`,
        `Clear explanation of the relationship plus one worked numerical.`,
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
        `State the central theme of ${topic} in one or two sentences.`,
      ),
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        2,
        `Quote one line from ${topic} and explain how it supports the main idea.`,
      ),
      scaffoldQuestionRow(
        topic,
        subject,
        band,
        3,
        `Explain one literary device or structural choice used in ${topic} with evidence from the text.`,
      ),
    ];
  }
  return [
    scaffoldQuestionRow(topic, subject, band, 1, `Define ${topic} and state its importance in ${subject}.`),
    scaffoldQuestionRow(topic, subject, band, 2, `Explain two key points about ${topic} with brief examples.`),
    scaffoldQuestionRow(topic, subject, band, 3, `Analyse why ${topic} is significant in ${subject}.`),
  ];
}

/**
 * @param {string} topic
 * @param {string} subject
 * @param {ScaffoldBand} band
 * @returns {string}
 */
export function instructionsForBand(topic, subject, band) {
  if (band === 'maths') {
    return `Solve all questions on ${topic} like textbook exercises. Show Given, Method, Working, and Answer. Use correct units.`;
  }
  if (band === 'stem') {
    return `Answer all questions on ${topic} in textbook exercise style. Show formulas, substitutions, and units where needed.`;
  }
  if (band === 'english') {
    return `Answer all questions on ${topic}. Use evidence from the text where asked.`;
  }
  return `Answer all questions on ${topic} clearly, as in end-of-section textbook exercises.`;
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
    band === 'maths'
      ? `${label} for ${topic}: numerical/word-problem practice only — show step-by-step working (${subject}).`
      : band === 'stem'
        ? `${label} for ${topic}: use definitions, formulas, and a worked example (${subject}).`
        : band === 'english'
          ? `${label} for ${topic}: use evidence from the text and clear communication (${subject}).`
          : band === 'social'
            ? `${label} for ${topic}: use facts, sources, and Indian-context examples (${subject}).`
            : `${label} for ${topic} in ${subject}.`;
  return isList ? [text] : text;
}

export function applicationTasksForBand(topic, subject, band) {
  if (band === 'maths') {
    return [
      `Solve five numericals on ${topic}. Show Given, Method, Working, and Answer.`,
      `Solve one multi-step numerical on ${topic} and verify the answer by a second method.`,
    ];
  }
  if (band === 'stem') {
    return [
      `Solve three numericals on ${topic} using the correct formula and SI units.`,
      `Explain how ${topic} applies to one electrical or mechanical device — name the formula and one calculation.`,
    ];
  }
  if (band === 'english') {
    return [
      `Write a paragraph analysing the theme of ${topic} with two text references.`,
      `Identify and explain one figure of speech in ${topic} with a quoted line.`,
    ];
  }
  return [
    `Answer two short questions applying ${topic} in ${subject} with evidence or examples.`,
    `Write a structured paragraph explaining ${topic} and its significance.`,
  ];
}

export function realLifeActivityForBand(topic, subject, band) {
  if (band === 'maths') {
    return `Form and solve one numerical on ${topic} using three given measurements from the lesson data set.`;
  }
  if (band === 'stem') {
    return `State the formula for ${topic}, substitute given values, and calculate with correct units.`;
  }
  if (band === 'english') {
    return `Select two quotations from ${topic} and explain what each reveals about the theme.`;
  }
  return `List two facts about ${topic} and explain how each supports understanding in ${subject}.`;
}

export function creativeQuestionForBand(topic, subject, band) {
  if (band === 'maths') {
    return `Construct one original numerical on ${topic} with realistic data. Solve it and check by estimation.`;
  }
  if (band === 'stem') {
    return `Derive or explain the formula for ${topic} and solve one non-standard numerical using it.`;
  }
  if (band === 'english') {
    return `Analyse how the author develops the central idea in ${topic} — cite two specific lines.`;
  }
  return `Compare two key aspects of ${topic} and state which is more significant for ${subject}, with reasons.`;
}

export function collaborativeTaskForBand(topic, subject, band) {
  if (band === 'maths') {
    return `Compare two solution methods for the same ${topic} numerical and state which is more efficient.`;
  }
  if (band === 'stem') {
    return `Explain ${topic} to a peer using definition, formula, and one worked numerical.`;
  }
  if (band === 'english') {
    return `Identify the strongest evidence for the theme in ${topic} and justify your choice in writing.`;
  }
  return `Write three precise points about ${topic} and rank them by importance with justification.`;
}

export function challengeQuestionForBand(topic, subject, band) {
  if (band === 'maths') {
    return `Solve a multi-step numerical on ${topic}. Show full working and verify the final answer.`;
  }
  if (band === 'stem') {
    return `Solve a two-part problem on ${topic}: (a) recall the formula, (b) calculate with given data and explain units.`;
  }
  if (band === 'english') {
    return `Evaluate two interpretations of the theme in ${topic} and justify the stronger reading with evidence.`;
  }
  return `Identify a common misconception about ${topic} and correct it with accurate ${subject} reasoning.`;
}

export function assessmentRubricForBand(band) {
  if (band === 'maths') {
    return `Correct method, accurate calculation, units, neat working, and final answer (4-point scale).`;
  }
  if (band === 'stem') {
    return `Concept accuracy, correct formula use, units, reasoning, and presentation (4-point scale).`;
  }
  if (band === 'english') {
    return `Clarity, evidence from text, participation, and accuracy of language (4-point scale).`;
  }
  return `Clarity, accuracy, use of examples, and completeness (4-point scale).`;
}

export function expectedOutcomesForBand(topic, subject, band) {
  if (band === 'maths') {
    return [
      `Students can solve direct and word-problem numericals on ${topic} with clear working.`,
      `Students can check answers using estimation or reverse calculation.`,
    ];
  }
  if (band === 'stem') {
    return [
      `Students can define ${topic}, state the formula, and use correct SI units.`,
      `Students can solve numerical and explanatory questions on ${topic} with clear reasoning.`,
    ];
  }
  if (band === 'english') {
    return [
      `Students can state the theme and key ideas of ${topic} with textual evidence.`,
      `Students can analyse language and structure in ${topic} in short written responses.`,
    ];
  }
  return [
    `Students can explain key ideas from ${topic} accurately.`,
    `Students can apply ${topic} in short written answers in ${subject}.`,
  ];
}
