import { validateDashboardAiToolDoc } from './ai-tool-dashboard-validation.js';
import { extractStructuredFromStoredContent } from './ai-tool-dashboard-validation.js';
import {
  reconcileV2InstructionMarks,
  validateV2QuestionContent,
} from '../generators/_v2/six-section-quality.js';
import { isV2SixSectionStructured } from '../../utils/v2-structured-to-legacy.js';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalized(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(class|grade|standard|std)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function valuesConflict(a, b) {
  const left = normalized(a);
  const right = normalized(b);
  return Boolean(left && right && left !== right && !left.includes(right) && !right.includes(left));
}

function issue(code, message, severity = 'error', repairable = false) {
  return { code, message, severity, repairable };
}

function detectMetadataConflicts(row, issues) {
  const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const comparisons = [
    ['board', row.board, meta.board],
    ['class', row.classLabel, meta.classLabel || meta.className || meta.class],
    ['subject', row.subject, meta.subject || meta.subjectName],
    ['topic', row.topic, meta.topic || meta.topicName || meta.chapter],
    ['subtopic', row.subtopic, meta.subtopic || meta.subTopic || meta.subtopicName],
  ];
  for (const [field, stored, embedded] of comparisons) {
    if (valuesConflict(stored, embedded)) {
      issues.push(
        issue(
          `CURRICULUM_${String(field).toUpperCase()}_MISMATCH`,
          `Stored ${field} "${stored}" conflicts with generated metadata "${embedded}".`,
        ),
      );
    }
  }
}

function detectTextQuality(text, issues) {
  const source = String(text || '');
  if (!source.trim()) {
    issues.push(issue('EMPTY_CONTENT', 'Record has no generated content.'));
    return;
  }
  if (/\b(?:use|refer to|consult|see|read)\s+(?:the\s+)?(?:chapter|textbook|book|source|provided material)\s+(?:evidence|content|information|details)\b/i.test(source)) {
    issues.push(issue('PLACEHOLDER_ANSWER', 'Record contains a textbook-reference placeholder instead of an answer.'));
  }
  if (/\b(?:system prompt|developer message|ignore previous|rag context|textbook_instructions|sourcechunkid=)\b/i.test(source)) {
    issues.push(issue('PROMPT_OR_RAG_LEAK', 'Record exposes internal prompt or RAG control text.'));
  }
  if (/\b(?:pages?|pp\.?|exercise|figure|fig\.)\s*(?:no\.?\s*)?\d+/i.test(source)) {
    issues.push(issue('SOURCE_REFERENCE_LEAK', 'Record exposes a specific source page/exercise/figure reference.', 'warning'));
  }
  if (/\b(?:lorem ipsum|todo|tbd|not available|coming soon)\b/i.test(source)) {
    issues.push(issue('PLACEHOLDER_CONTENT', 'Record contains unfinished placeholder text.'));
  }
  if (/PENDING_ASSET_APPROVAL/i.test(source)) {
    issues.push(issue('PENDING_ASSET_APPROVAL', 'Record depends on a generated asset that has not been approved.'));
  }
}

function contentLooksJson(text) {
  const value = String(text || '').trim();
  return value.startsWith('{') || value.startsWith('[');
}

/** Comprehensive deterministic audit for a stored AI Tool Data record. */
export function auditAiToolRecordQuality(row) {
  const issues = [];
  const toolName = String(row?.toolName || '').trim();
  const content = String(row?.content || row?.generatedContent || '').trim();
  detectMetadataConflicts(row, issues);
  detectTextQuality(content, issues);

  const gate = toolName
    ? validateDashboardAiToolDoc(toolName, {
        ...row,
        content,
        generatedContent: row?.generatedContent || content,
      })
    : { valid: false, missingSections: ['toolName'], message: 'Missing tool name.' };
  if (!gate.valid) {
    issues.push(
      issue(
        'SCHEMA_OR_SECTION_MISMATCH',
        gate.message || `Missing/invalid sections: ${(gate.missingSections || []).join(', ')}`,
      ),
    );
  }

  const storedStructured =
    row?.metadata?.structuredContent && typeof row.metadata.structuredContent === 'object'
      ? row.metadata.structuredContent
      : extractStructuredFromStoredContent(content, row?.metadata || {});
  let repairedStructured = null;

  if (isV2SixSectionStructured(storedStructured)) {
    const quality = validateV2QuestionContent(storedStructured);
    for (const message of quality.errors || []) {
      issues.push(issue('V2_QUESTION_QUALITY', message));
    }

    const before = JSON.stringify(storedStructured);
    const candidate = reconcileV2InstructionMarks(clone(storedStructured));
    if (JSON.stringify(candidate) !== before) {
      repairedStructured = candidate;
      issues.push(
        issue(
          'DECLARED_MARKS_MISMATCH',
          'Declared total marks did not match the sum of question marks.',
          'error',
          true,
        ),
      );
    }
  }

  const uniqueIssues = [];
  const seen = new Set();
  for (const item of issues) {
    const key = `${item.code}:${item.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueIssues.push(item);
    }
  }

  const errorCount = uniqueIssues.filter((item) => item.severity === 'error').length;
  return {
    valid: errorCount === 0,
    errorCount,
    warningCount: uniqueIssues.length - errorCount,
    issues: uniqueIssues,
    repair: repairedStructured
      ? {
          structuredContent: repairedStructured,
          syncJsonContent: contentLooksJson(content),
        }
      : null,
  };
}

