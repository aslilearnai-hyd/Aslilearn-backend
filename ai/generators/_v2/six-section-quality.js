const V2_QUESTION_KEYS = Object.freeze([
  'sectionA_mcq',
  'sectionB_fib',
  'sectionC_short',
  'sectionD_application',
  'sectionE_long',
]);

function v2QuestionRows(structuredContent) {
  const core = structuredContent?.core;
  if (!core || typeof core !== 'object') return [];
  return V2_QUESTION_KEYS.flatMap((key) =>
    Array.isArray(core[key]) ? core[key].filter((row) => row && typeof row === 'object') : [],
  );
}

/** Keep the displayed total synchronized with the marks used for evaluation. */
export function reconcileV2InstructionMarks(structuredContent) {
  const rows = v2QuestionRows(structuredContent);
  if (!rows.length) return structuredContent;
  const totalMarks = rows.reduce((sum, row) => {
    const marks = Number(row.marks);
    return sum + (Number.isFinite(marks) && marks > 0 ? marks : 0);
  }, 0);
  if (!totalMarks) return structuredContent;

  const instructions = String(structuredContent?.core?.instructions || '');
  if (!instructions) return structuredContent;
  structuredContent.core.instructions = instructions.replace(
    /((?:total|max(?:imum)?)\s+marks?\s*[:=\-]?\s*)\d+(?:\.\d+)?/gi,
    `$1${totalMarks}`,
  );
  return structuredContent;
}

/** Reject content that looks complete structurally but is unusable in class. */
export function validateV2QuestionContent(structuredContent) {
  const rows = v2QuestionRows(structuredContent);
  if (!rows.length) return { valid: true, errors: [] };

  const errors = [];
  const assessment = structuredContent?.assessment;
  const answerKey = Array.isArray(assessment?.answerKey) ? assessment.answerKey : [];
  if (answerKey.length < rows.length) {
    errors.push(`Answer key has ${answerKey.length} entries for ${rows.length} questions.`);
  }

  const placeholderAnswer =
    /\b(?:use|refer to|consult|see|read)\s+(?:the\s+)?(?:chapter|textbook|book|source|provided material)(?:\s+(?:evidence|content|information|details))?\b/i;
  for (const item of answerKey) {
    const answer = String(item?.answer || '').trim();
    const working = String(item?.working || '').trim();
    if (!answer || placeholderAnswer.test(`${answer} ${working}`)) {
      errors.push('Answer key contains a missing or placeholder answer.');
      break;
    }
  }

  const serialized = JSON.stringify(structuredContent);
  if (/\b(?:pages?|pp\.?|exercise|figure|fig\.)\s*(?:no\.?\s*)?\d+/i.test(serialized)) {
    errors.push('Output exposes a textbook page, exercise, or figure reference.');
  }
  const title = String(structuredContent?.core?.title || '');
  if (/\b(?:adventure|journey|mission|expedition|marketplace exploration|school fair)\b/i.test(title)) {
    errors.push('Assessment title uses a fictional scenario instead of a direct academic title.');
  }
  return { valid: errors.length === 0, errors };
}
