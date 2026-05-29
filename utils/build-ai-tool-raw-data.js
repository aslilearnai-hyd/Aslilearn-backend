import {
  normalizeActivityStructuredContent,
  normalizeConceptBreakdownStructuredContent,
  normalizeMyStudyDecksStructuredContent,
  normalizePracticeQaStructuredContent,
  finalizeChapterSummaryStructuredContent,
  normalizeStudyGuideStructuredContent,
  normalizeWorksheetStructuredContent,
  normalizeRubricStructuredContent,
  finalizeRubricStructuredContent,
} from '../services/ai-content-engine-service.js';
import { extractStructuredFromStoredContent } from '../services/ai-tool-dashboard-validation.js';

export function tryParseJsonPayload(content) {
  const text = String(content || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pushActivityRow(rows, row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return;
  rows.push(row);
}

/** Unwrap nested { structuredContent }, { activity }, or arrays from Super Admin saves. */
function unwrapActivityStructuredNode(node) {
  let current = node;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current) return null;
    if (Array.isArray(current)) return current;
    if (typeof current !== 'object') return null;
    if (Array.isArray(current.activities)) return current.activities;
    if (Array.isArray(current.items)) return current.items;
    if (current.structuredContent && typeof current.structuredContent === 'object') {
      current = current.structuredContent;
      continue;
    }
    if (current.activity && typeof current.activity === 'object' && !Array.isArray(current.activity)) {
      current = current.activity;
      continue;
    }
    return current;
  }
  return typeof current === 'object' ? current : null;
}

function collectRowsFromStructuredNode(node, rows) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((row) => pushActivityRow(rows, row));
    return;
  }
  if (typeof node !== 'object') return;
  if (Array.isArray(node.activities)) {
    node.activities.forEach((row) => pushActivityRow(rows, row));
    return;
  }
  if (Array.isArray(node.items)) {
    node.items.forEach((row) => pushActivityRow(rows, row));
    return;
  }
  if (
    node.title ||
    node.steps ||
    node.materials ||
    node.subtopic_link_prior_knowledge ||
    node.learning_objectives ||
    node.learningObjectives ||
    node.creative_output_final_product ||
    node.expected_learning_outcomes
  ) {
    pushActivityRow(rows, node);
  }
}

function extractActivityRows(parsed, metadata = {}) {
  const rows = [];
  const meta = metadata && typeof metadata === 'object' ? metadata : {};

  if (meta.structuredContent != null) {
    collectRowsFromStructuredNode(unwrapActivityStructuredNode(meta.structuredContent), rows);
  }

  const structured = extractStructuredFromStoredContent('', meta);
  collectRowsFromStructuredNode(unwrapActivityStructuredNode(structured), rows);

  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed)) {
      parsed.forEach((row) => pushActivityRow(rows, row));
    } else {
      if (Array.isArray(parsed.activities)) {
        parsed.activities.forEach((row) => pushActivityRow(rows, row));
      }
      if (Array.isArray(parsed.projects)) {
        parsed.projects.forEach((row) => pushActivityRow(rows, row));
      }
      if (Array.isArray(parsed.data?.activities)) {
        parsed.data.activities.forEach((row) => pushActivityRow(rows, row));
      }
      if (Array.isArray(parsed.data?.projects)) {
        parsed.data.projects.forEach((row) => pushActivityRow(rows, row));
      }
      if (parsed.structuredContent && typeof parsed.structuredContent === 'object') {
        const inner = parsed.structuredContent;
        if (Array.isArray(inner)) inner.forEach((row) => pushActivityRow(rows, row));
        else pushActivityRow(rows, inner);
      }
      pushActivityRow(rows, parsed);
    }
  }

  const seen = new Set();
  return rows.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build dashboard rawData for tools that need structured JSON alongside markdown.
 * For Project Idea Lab / Activity Generator, prefers metadata.structuredContent so
 * all canonical fields reach the client even when markdown omitted alternate keys.
 */
export function buildRawDataForTool(toolType, content, metadata = {}) {
  const slug = String(toolType || '').trim();
  const parsed = tryParseJsonPayload(content);

  if (slug === 'activity-project-generator' || slug === 'project-idea-lab') {
    const rows = extractActivityRows(parsed, metadata);
    if (!rows.length) return null;
    const activities = rows.map((row) => normalizeActivityStructuredContent(row, {}, slug));
    return { activities };
  }

  if (slug === 'smart-study-guide-generator') {
    const structured = extractStructuredFromStoredContent(content, metadata);
    if (structured && typeof structured === 'object' && Object.keys(structured).length) {
      return normalizeStudyGuideStructuredContent(structured);
    }
    if (parsed && typeof parsed === 'object') {
      return normalizeStudyGuideStructuredContent(parsed);
    }
    return null;
  }

  if (slug === 'concept-breakdown-explainer') {
    const structured = extractStructuredFromStoredContent(content, metadata);
    if (structured && typeof structured === 'object' && Object.keys(structured).length) {
      return normalizeConceptBreakdownStructuredContent(structured);
    }
    if (parsed && typeof parsed === 'object') {
      return normalizeConceptBreakdownStructuredContent(parsed);
    }
    return null;
  }

  if (slug === 'smart-qa-practice-generator') {
    const structured = extractStructuredFromStoredContent(content, metadata);
    if (structured && typeof structured === 'object' && Object.keys(structured).length) {
      return normalizePracticeQaStructuredContent(structured, content);
    }
    if (parsed && typeof parsed === 'object') {
      return normalizePracticeQaStructuredContent(parsed, content);
    }
    return null;
  }

  if (slug === 'chapter-summary-creator') {
    const structured = extractStructuredFromStoredContent(content, metadata);
    if (structured && typeof structured === 'object' && Object.keys(structured).length) {
      return finalizeChapterSummaryStructuredContent(structured, {});
    }
    if (parsed && typeof parsed === 'object') {
      return finalizeChapterSummaryStructuredContent(parsed, {});
    }
    return null;
  }

  if (slug === 'worksheet-mcq-generator') {
    const structured = extractStructuredFromStoredContent(content, metadata);
    if (structured && typeof structured === 'object' && Object.keys(structured).length) {
      return normalizeWorksheetStructuredContent(structured, content);
    }
    if (parsed && typeof parsed === 'object') {
      return normalizeWorksheetStructuredContent(parsed, content);
    }
    return null;
  }

  if (slug === 'rubrics-evaluation-generator') {
    const structured = extractStructuredFromStoredContent(content, metadata);
    if (structured && typeof structured === 'object' && Object.keys(structured).length) {
      return finalizeRubricStructuredContent(structured, metadata);
    }
    if (parsed && typeof parsed === 'object') {
      return finalizeRubricStructuredContent(parsed, metadata);
    }
    return null;
  }

  if (slug === 'my-study-decks' || slug === 'flashcard-generator') {
    const structured = extractStructuredFromStoredContent(content, metadata);
    if (structured && typeof structured === 'object' && Object.keys(structured).length) {
      return normalizeMyStudyDecksStructuredContent(structured);
    }
    if (parsed && typeof parsed === 'object') {
      return normalizeMyStudyDecksStructuredContent(parsed);
    }
    return null;
  }

  if (parsed && typeof parsed === 'object') return parsed;

  const structured = extractStructuredFromStoredContent(content, metadata);
  if (structured && typeof structured === 'object' && Object.keys(structured).length) {
    return structured;
  }

  return null;
}
