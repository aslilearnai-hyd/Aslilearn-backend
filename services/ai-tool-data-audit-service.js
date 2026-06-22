/**
 * Section completeness check for Super Admin AI tool data browse flags.
 */
import AiToolGeneration from '../models/AiToolGeneration.js';
import AIGeneratorRecord from '../models/AIGeneratorRecord.js';
import { boardMongoMatch } from '../utils/board-label.js';
import { isDeprecatedAiToolIdentifier } from '../config/aiToolTemplates.js';
import { validateDashboardAiToolDoc } from './ai-tool-dashboard-validation.js';

const MASTER_FIELDS =
  'toolName toolDisplayName sourceType board classLabel subject topic subtopic content generatedContent createdAt metadata';
const LEGACY_FIELDS =
  'toolSlug toolName className subjectName topicName subtopicName board generatedContent createdAt';

function buildScopeFilter(scope = {}) {
  const filter = { sourceType: { $ne: 'ai_pdf' } };
  if (scope.toolName) filter.toolName = scope.toolName;
  if ('board' in scope) filter.board = boardMongoMatch(scope.board ?? '');
  return filter;
}

function buildLegacyScopeFilter(scope = {}) {
  const filter = {};
  if (scope.toolName) filter.toolSlug = scope.toolName;
  if ('board' in scope) filter.board = boardMongoMatch(scope.board ?? '');
  return filter;
}

function mapMasterRow(doc) {
  return {
    _id: doc._id,
    sourceType: doc.sourceType || 'legacy',
    toolName: doc.toolName || '',
    toolDisplayName: doc.toolDisplayName || '',
    board: doc.board || '',
    classLabel: doc.classLabel || '',
    subject: doc.subject || '',
    topic: doc.topic || '',
    subtopic: doc.subtopic || '',
    createdAt: doc.createdAt || null,
    content: doc.content || doc.generatedContent || '',
    generatedContent: doc.generatedContent || doc.content || '',
    metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : undefined,
  };
}

function mapLegacyRow(doc) {
  return {
    _id: doc._id,
    sourceType: 'ai_generator',
    toolName: doc.toolSlug || doc.toolName || '',
    toolDisplayName: doc.toolName || doc.toolSlug || '',
    board: doc.board || '',
    classLabel: doc.className || '',
    subject: doc.subjectName || '',
    topic: doc.topicName || '',
    subtopic: doc.subtopicName || '',
    createdAt: doc.createdAt || null,
    content: doc.generatedContent || '',
    generatedContent: doc.generatedContent || '',
    metadata: { source: 'ai_generators_legacy_collection' },
  };
}

function isAuditableRow(row) {
  if (!row?.toolName || isDeprecatedAiToolIdentifier(row.toolName)) return false;
  if (isDeprecatedAiToolIdentifier(row.toolDisplayName)) return false;
  if (row.sourceType === 'ai_pdf') return false;
  return true;
}

async function loadToolRows(scope = {}) {
  const masterFilter = buildScopeFilter(scope);
  const legacyFilter = buildLegacyScopeFilter(scope);

  const [masterRows, legacyRows] = await Promise.all([
    AiToolGeneration.find(masterFilter).select(MASTER_FIELDS).lean(),
    AIGeneratorRecord.find(legacyFilter).select(LEGACY_FIELDS).lean(),
  ]);

  return [
    ...masterRows.map(mapMasterRow),
    ...legacyRows.map(mapLegacyRow),
  ].filter(isAuditableRow);
}

const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
/** @type {Map<string, { at: number, data: object }>} */
const sectionGapSummaryCache = new Map();

function summaryCacheKey(scope = {}) {
  return 'board' in scope ? String(scope.board ?? '') : '';
}

function buildGapItem(row, sectionGap) {
  return {
    _id: String(row._id),
    toolName: row.toolName,
    toolDisplayName: row.toolDisplayName || row.toolName,
    board: row.board || '',
    classLabel: row.classLabel || '',
    subject: row.subject || '',
    topic: row.topic || '',
    subtopic: row.subtopic || '',
    createdAt: row.createdAt,
    sectionGap,
  };
}

/** One DB pass for all tools; cached per board for repeat requests. */
export async function getSectionGapSummariesByTool(scope = {}, options = {}) {
  const { bypassCache = false } = options;
  const cacheKey = summaryCacheKey(scope);

  if (!bypassCache) {
    const hit = sectionGapSummaryCache.get(cacheKey);
    if (hit && Date.now() - hit.at < SUMMARY_CACHE_TTL_MS) {
      return hit.data;
    }
  }

  const limitPerTool = Math.min(100, Math.max(1, parseInt(scope.limit, 10) || 50));
  const rows = await loadToolRows(scope);
  /** @type {Record<string, { toolName: string, toolDisplayName: string, totalScanned: number, incompleteCount: number, truncated: boolean, items: object[] }>} */
  const byTool = {};
  const scannedByTool = {};

  for (const row of rows) {
    const toolName = row.toolName;
    scannedByTool[toolName] = (scannedByTool[toolName] || 0) + 1;

    const sectionGap = checkRecordSectionGap(row);
    if (sectionGap.complete) continue;

    if (!byTool[toolName]) {
      byTool[toolName] = {
        toolName,
        toolDisplayName: row.toolDisplayName || toolName,
        totalScanned: 0,
        incompleteCount: 0,
        truncated: false,
        items: [],
      };
    }

    const bucket = byTool[toolName];
    bucket.incompleteCount += 1;
    if (bucket.items.length < limitPerTool) {
      bucket.items.push(buildGapItem(row, sectionGap));
    }
  }

  for (const toolName of Object.keys(byTool)) {
    const bucket = byTool[toolName];
    bucket.totalScanned = scannedByTool[toolName] || 0;
    bucket.truncated = bucket.incompleteCount > bucket.items.length;
    bucket.items.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );
  }

  const data = {
    totalScanned: rows.length,
    cachedAt: new Date().toISOString(),
    byTool,
  };

  sectionGapSummaryCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

/** Section gap status for a single stored record (browse list flag). */
export function checkRecordSectionGap(row) {
  if (!row?.toolName || row.sourceType === 'ai_pdf') {
    return { complete: true, missingSections: [], optionalMissingSections: [] };
  }
  if (isDeprecatedAiToolIdentifier(row.toolName) || isDeprecatedAiToolIdentifier(row.toolDisplayName)) {
    return { complete: true, missingSections: [], optionalMissingSections: [] };
  }

  const gate = validateDashboardAiToolDoc(row.toolName, {
    toolName: row.toolName,
    content: row.content || row.generatedContent || '',
    generatedContent: row.generatedContent || row.content || '',
    metadata: row.metadata,
  });

  return {
    complete: Boolean(gate.valid),
    missingSections: gate.missingSections || [],
    optionalMissingSections: gate.optionalMissingSections || [],
  };
}

/** All incomplete records for one tool — derived from the shared scan cache when possible. */
export async function getToolSectionGapSummary(scope = {}) {
  const toolName = String(scope.toolName || '').trim();
  if (!toolName) {
    throw new Error('toolName is required');
  }

  const { byTool } = await getSectionGapSummariesByTool(scope);
  const summary = byTool[toolName];
  if (summary) return summary;

  const rows = await loadToolRows(scope);
  return {
    toolName,
    toolDisplayName: toolName,
    totalScanned: rows.length,
    incompleteCount: 0,
    truncated: false,
    items: [],
  };
}
