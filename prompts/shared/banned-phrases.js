/**
 * Phrases that signal generic AI output — auto-rejected by quality gate.
 * @module prompts/shared/banned-phrases
 */

/** Exact or regex patterns — generic teacher instructions with no classroom detail. */
export const BANNED_GENERIC_PHRASES = Object.freeze([
  /^explain the concept\.?$/i,
  /^discuss with students\.?$/i,
  /^conduct activity\.?$/i,
  /^ask questions\.?$/i,
  /^write homework\.?$/i,
  /^students understand\.?$/i,
  /^students will understand\.?$/i,
  /^introduce the topic\.?$/i,
  /^revise the chapter\.?$/i,
  /^complete the exercise\.?$/i,
  /^read the chapter\.?$/i,
  /^note down the points\.?$/i,
  /^solve the problems\.?$/i,
  /^practice questions\.?$/i,
  /^group discussion\.?$/i,
  /^teacher explains\.?$/i,
  /^teacher discusses\.?$/i,
  /^facilitate learning\.?$/i,
  /^engage students\.?$/i,
  /^assess understanding\.?$/i,
  /\bexplain\s+the\s+concept\s+of\b/i,
  /\bdiscuss\s+the\s+importance\s+of\b/i,
  /\bstudents\s+will\s+learn\s+about\b/i,
  /\bthis\s+lesson\s+will\s+help\s+students\s+understand\b/i,
  /\bin\s+this\s+lesson,?\s+students\s+will\b/i,
  /\bthe\s+teacher\s+should\s+explain\b/i,
  /\bconduct\s+a\s+classroom\s+activity\b/i,
  /\bask\s+relevant\s+questions\b/i,
  /\bwrite\s+answers\s+in\s+your\s+notebook\b/i,
  /\bcomplete\s+the\s+following\s+exercise\b/i,
  /\bwork\s+in\s+groups\s+and\s+discuss\b/i,
  /\bshare\s+your\s+answers\s+with\s+the\s+class\b/i,
  /\brecap\s+the\s+main\s+points\b/i,
  /\bsummarise\s+the\s+chapter\b/i,
  /\bgo\s+through\s+the\s+textbook\b/i,
  /\buse\s+the\s+blackboard\b/i,
  /\bwrite\s+on\s+the\s+board\b/i,
  /\bgive\s+homework\b/i,
  /\bassign\s+homework\b/i,
]);

/** Obvious AI assistant markers — reject in educational prose. */
export const BANNED_AI_MARKERS = Object.freeze([
  /\bas an ai\b/i,
  /\bi hope this helps\b/i,
  /\blet me know if\b/i,
  /\bin conclusion,?\s+this\s+(lesson|activity|worksheet)\b/i,
  /\bhere is a (lesson|worksheet|story|plan)\b/i,
  /\bfeel free to\b/i,
  /\bplease note that\b/i,
  /\bit is important to note\b/i,
  /\bthis (content|material) (is|has been) (designed|created)\b/i,
  /\bcomprehensive (overview|guide)\b/i,
  /\bkey takeaways?\b/i,
  /\bin today's (lesson|class)\b/i,
  /\bwithout further ado\b/i,
]);

/** Minimum specificity signals — content lacking these in key fields may fail quality check. */
export const REQUIRED_SPECIFICITY_MARKERS = Object.freeze({
  teacherScript: /\b(teacher|say|ask|display|show|hold up|point to|write on|collect|wait for|call on)\b/i,
  studentResponse: /\b(expected|students?\s+(may|might|will|can)\s+(say|answer|respond)|sample\s+answers?)\b/i,
  misconception: /\b(misconception|confus|mistaken|wrong\s+belief|students?\s+often\s+think)\b/i,
  bloom: /\b(remember|understand|apply|analyse|analyze|evaluate|create|recall|infer|justify)\b/i,
});

/**
 * @param {string} text
 * @returns {{ banned: boolean, reason?: string }}
 */
export function detectBannedPhrase(text) {
  const t = String(text || '').trim();
  if (!t) return { banned: false };
  for (const re of BANNED_GENERIC_PHRASES) {
    if (re.test(t)) return { banned: true, reason: `Generic phrase detected: ${re}` };
  }
  for (const re of BANNED_AI_MARKERS) {
    if (re.test(t)) return { banned: true, reason: `AI marker detected: ${re}` };
  }
  return { banned: false };
}

/**
 * Scan all string values in structured content for banned phrases.
 * @param {unknown} structured
 * @returns {string[]} error messages
 */
export function scanStructuredForBannedPhrases(structured) {
  const errors = [];
  const walk = (obj, path = '') => {
    if (obj == null) return;
    if (typeof obj === 'string') {
      const { banned, reason } = detectBannedPhrase(obj);
      if (banned && obj.length > 20) {
        errors.push(`${path || 'field'}: ${reason} — "${obj.slice(0, 80)}…"`);
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(structured);
  return errors.slice(0, 8);
}
