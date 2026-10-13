function text(value) {
  return String(value || '').trim();
}

function issue(code, message, slotId = '') {
  return { code, message, slotId };
}

function questionRows(structured = {}) {
  const rows = [];
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (text(value.question || value.stem || value.prompt)) rows.push(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  };
  walk(structured);
  return [...new Set(rows)];
}

function mergeElementCounts(target, source, multiplier = 1) {
  for (const [element, count] of Object.entries(source)) {
    target[element] = (target[element] || 0) + count * multiplier;
  }
}

function parseFormulaSegment(formula = '') {
  const cleaned = text(formula)
    .replace(/\((?:aq|s|l|g)\)$/i, '')
    .replace(/[+-]+$/g, '')
    .replace(/\s+/g, '');
  const stack = [{}];
  let index = 0;
  while (index < cleaned.length) {
    const char = cleaned[index];
    if (char === '(' || char === '[') {
      stack.push({});
      index += 1;
      continue;
    }
    if (char === ')' || char === ']') {
      if (stack.length === 1) return {};
      const group = stack.pop();
      index += 1;
      const digits = cleaned.slice(index).match(/^\d+/)?.[0] || '';
      index += digits.length;
      mergeElementCounts(stack[stack.length - 1], group, Number(digits) || 1);
      continue;
    }
    const element = cleaned.slice(index).match(/^[A-Z][a-z]?/)?.[0];
    if (element) {
      index += element.length;
      const digits = cleaned.slice(index).match(/^\d+/)?.[0] || '';
      index += digits.length;
      stack[stack.length - 1][element] = (stack[stack.length - 1][element] || 0) + (Number(digits) || 1);
      continue;
    }
    index += 1;
  }
  return stack.length === 1 ? stack[0] : {};
}

function parseFormula(formula = '') {
  const counts = {};
  for (const hydratePart of text(formula).split(/[·.]/)) {
    const match = hydratePart.trim().match(/^(\d+)\s*(.*)$/);
    mergeElementCounts(counts, parseFormulaSegment(match ? match[2] : hydratePart), match ? Number(match[1]) : 1);
  }
  return counts;
}

function parseChemicalSide(side = '') {
  const total = {};
  for (const raw of text(side).split('+')) {
    const part = raw.trim();
    const match = part.match(/^(\d+)\s*(.*)$/);
    const coefficient = match ? Number(match[1]) : 1;
    const formula = match ? match[2] : part;
    for (const [element, count] of Object.entries(parseFormula(formula))) {
      total[element] = (total[element] || 0) + coefficient * count;
    }
  }
  return total;
}

export function validateChemicalEquationBalance(equation = '') {
  const parts = text(equation).split(/(?:⇌|↔|→|->|=>|=)/);
  if (parts.length !== 2) return { valid: false, reason: 'Equation must contain one reaction arrow.' };
  const left = parseChemicalSide(parts[0]);
  const right = parseChemicalSide(parts[1]);
  const elements = new Set([...Object.keys(left), ...Object.keys(right)]);
  const mismatches = [...elements].filter((element) => left[element] !== right[element]);
  return { valid: mismatches.length === 0 && elements.size > 0, mismatches, left, right };
}

export function validateLatexIntegrity(latex = '') {
  const value = text(latex);
  let braces = 0;
  for (const char of value) {
    if (char === '{') braces += 1;
    if (char === '}') braces -= 1;
    if (braces < 0) return { valid: false, reason: 'Unbalanced LaTeX braces.' };
  }
  if (braces !== 0) return { valid: false, reason: 'Unbalanced LaTeX braces.' };
  if (/\\(?:frac|sqrt)\b/.test(value) && !/{/.test(value)) return { valid: false, reason: 'Incomplete LaTeX command.' };
  return { valid: Boolean(value), reason: value ? '' : 'Empty equation.' };
}

function validateOptions(row, findings, expectedOptionCount = 0) {
  const type = text(row.type || row.questionType || row.question_type).toUpperCase();
  const section = text(row.section || row.sectionName).toUpperCase();
  const rawOptions = Array.isArray(row.options) ? row.options : [];
  const isMcq =
    type === 'MCQ' ||
    /MULTIPLE\s*CHOICE|SECTION\s*A\s*:\s*MCQ/.test(section) ||
    (!type && rawOptions.some((option) => text(option)));

  // V2 gives every question row an options array. Empty arrays on FIB/VSA/SA/
  // LAQ rows are not malformed MCQs and must not produce MCQ_OPTION_COUNT.
  if (!isMcq) return;

  const options = rawOptions.map(text).filter(Boolean);
  if (options.length < 2) findings.push(issue('MCQ_OPTION_COUNT', 'MCQ requires at least two non-empty options.', row.slotId));
  if (expectedOptionCount > 0 && options.length !== expectedOptionCount) {
    findings.push(issue('MCQ_OPTION_COUNT', `MCQ requires exactly ${expectedOptionCount} options.`, row.slotId));
  }
  if (new Set(options.map((value) => value.toLowerCase())).size !== options.length) {
    findings.push(issue('MCQ_DUPLICATE_OPTION', 'MCQ options must be unique.', row.slotId));
  }
  const answer = text(row.answer || row.correctAnswer || row.correct_option);
  if (!answer) findings.push(issue('MISSING_ANSWER', 'Question is missing an answer.', row.slotId));
  if (Array.isArray(row.correctAnswers) && row.correctAnswers.filter(Boolean).length !== 1) {
    findings.push(issue('MCQ_CORRECT_COUNT', 'MCQ must declare exactly one correct answer.', row.slotId));
  }
}

export function validateStemQuestionSet(structured = {}, context = {}) {
  const findings = [];
  const approvedAssets = new Set((context.approvedAssetIds || []).map(text));
  const approvedChunks = new Set((context.approvedChunkIds || []).map(text));
  const slots = new Map((context.slots || []).map((slot) => [text(slot.slotId), slot]));
  const rows = questionRows(structured);
  let totalMarks = 0;
  for (const row of rows) {
    validateOptions(row, findings, Math.max(0, Number(context.optionCount) || 0));
    const slot = slots.get(text(row.slotId));
    const assetIds = (Array.isArray(row.sourceAssetIds) ? row.sourceAssetIds : []).map(text).filter(Boolean);
    const chunkIds = (Array.isArray(row.sourceChunkIds) ? row.sourceChunkIds : []).map(text).filter(Boolean);
    if (slot?.visualRequired && !assetIds.length) {
      findings.push(issue('VISUAL_SOURCE_REQUIRED', 'Visual-required slot has no sourceAssetIds.', row.slotId));
    }
    if (slot && !chunkIds.length && !assetIds.length) {
      findings.push(issue('GROUNDING_SOURCE_REQUIRED', 'Planned question has no source chunk or asset.', row.slotId));
    }
    for (const id of assetIds) if (approvedAssets.size && !approvedAssets.has(id)) {
      findings.push(issue('UNAPPROVED_ASSET', `Unknown or unapproved sourceAssetId ${id}.`, row.slotId));
    }
    for (const id of chunkIds) if (approvedChunks.size && !approvedChunks.has(id)) {
      findings.push(issue('UNKNOWN_SOURCE_CHUNK', `Unknown sourceChunkId ${id}.`, row.slotId));
    }
    const latex = text(row.latex || row.equationLatex || row.canonicalEquation);
    if (latex) {
      const result = validateLatexIntegrity(latex);
      if (!result.valid) findings.push(issue('INVALID_LATEX', result.reason, row.slotId));
    }
    const chemistry = text(row.chemicalEquation || row.reactionEquation);
    if (chemistry) {
      const result = validateChemicalEquationBalance(chemistry);
      if (!result.valid) findings.push(issue('UNBALANCED_CHEMICAL_EQUATION', `Chemical equation is not balanced: ${(result.mismatches || []).join(', ')}`, row.slotId));
    }
    const marks = Number(row.marks);
    if (row.marks != null && (!Number.isFinite(marks) || marks <= 0)) {
      findings.push(issue('INVALID_MARKS', 'Question marks must be a positive number.', row.slotId));
    }
    if (Number.isFinite(marks) && marks > 0) totalMarks += marks;
    const markingSteps = Array.isArray(row.stepMarks)
      ? row.stepMarks
      : Array.isArray(row.markingScheme)
        ? row.markingScheme
        : [];
    if (markingSteps.length && Number.isFinite(marks)) {
      const stepTotal = markingSteps.reduce((sum, step) => sum + (Number(step?.marks ?? step) || 0), 0);
      if (Math.abs(stepTotal - marks) > 0.001) {
        findings.push(issue('STEP_MARKS_MISMATCH', `Step marks total ${stepTotal}, but question marks are ${marks}.`, row.slotId));
      }
    }
    const allowedBloom = new Set((context.allowedBloom || ['remember', 'understand', 'apply', 'analyse', 'analyze', 'evaluate', 'create']).map((v) => text(v).toLowerCase()));
    const bloom = text(row.bloom || row.bloom_level).toLowerCase();
    if (bloom && !allowedBloom.has(bloom)) findings.push(issue('INVALID_BLOOM', `Unsupported Bloom value ${bloom}.`, row.slotId));
    const allowedDifficulty = new Set((context.allowedDifficulty || ['easy', 'medium', 'hard']).map((v) => text(v).toLowerCase()));
    const difficulty = text(row.difficulty || row.difficulty_tag).toLowerCase();
    if (difficulty && !allowedDifficulty.has(difficulty)) findings.push(issue('INVALID_DIFFICULTY', `Unsupported difficulty ${difficulty}.`, row.slotId));
    const allowedConceptIds = new Set((context.allowedConceptIds || []).map(text));
    if (allowedConceptIds.size) {
      for (const conceptId of (Array.isArray(row.conceptIds) ? row.conceptIds : []).map(text)) {
        if (!allowedConceptIds.has(conceptId)) findings.push(issue('UNKNOWN_CONCEPT_ID', `Unknown conceptId ${conceptId}.`, row.slotId));
      }
    }
    const expectedUnit = text(row.expectedUnit || row.unit);
    const answerText = text(row.answer || row.correctAnswer || row.working);
    if (expectedUnit && answerText && !answerText.toLowerCase().includes(expectedUnit.toLowerCase())) {
      findings.push(issue('UNIT_MISMATCH', `Answer does not contain expected unit ${expectedUnit}.`, row.slotId));
    }
  }
  const expectedCount = Math.max(0, Number(context.expectedCount) || 0);
  if (expectedCount && rows.length !== expectedCount) {
    findings.push(issue('QUESTION_COUNT_MISMATCH', `Expected ${expectedCount} questions but found ${rows.length}.`));
  }
  const expectedTotalMarks = Math.max(0, Number(context.totalMarks) || 0);
  if (expectedTotalMarks && Math.abs(totalMarks - expectedTotalMarks) > 0.001) {
    findings.push(issue('TOTAL_MARKS_MISMATCH', `Question marks total ${totalMarks}, expected ${expectedTotalMarks}.`));
  }
  return { valid: findings.length === 0, findings, questionCount: rows.length, totalMarks, questions: rows };
}
