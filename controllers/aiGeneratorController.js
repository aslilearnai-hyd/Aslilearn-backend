import mongoose from 'mongoose';
import { withMongoRetry, isMongoTransientError } from '../utils/mongo-retry.js';
import PDFDocument from 'pdfkit';
import AiToolGeneration from '../models/AiToolGeneration.js';
import AIGeneratorRecord from '../models/AIGeneratorRecord.js';
import AiToolTopic from '../models/AiToolTopic.js';
import { isDeprecatedAiToolIdentifier, isValidAiToolSlug, formatStructuredToolOutput } from '../config/aiToolTemplates.js';
import { generateStructuredContentForAiGenerator } from '../services/ai-content-engine-service.js';
import { generateSixSectionContent } from '../services/six-section-generator.js';
import { isSixSectionV2Enabled, buildV2VariantHint } from '../prompts/v2/assemble.js';
import { isV2SupportedTool, v2ToolFamily } from '../prompts/v2/tool-packs.js';
import { mapV2StructuredToLegacy } from '../utils/v2-structured-to-legacy.js';
import { auditStoredGenerationDoc } from '../services/v2-content-quality-service.js';
import { runAiGeneratorQualityGate } from '../services/ai-generator-quality-gate.js';
import {
  beginTokenUsageSession,
  endTokenUsageSession,
} from '../services/gemini-service.js';
import {
  boardMongoMatch,
  canonicalBoardLabel,
  lockBoardKey,
  normalizeBoardLabelForGrouping,
  normalizeClassLabelForLock,
  resolveClassLabelForAiToolStorage,
} from '../utils/board-label.js';
import { applyClassLabelMongoFilter, buildCaseInsensitiveExactFilter } from '../utils/ai-tool-data-match.js';
import {
  compareAiToolRecordsByVariantThenDate,
  sortGroupedGeneratorRecords,
} from '../utils/ai-tool-record-sort.js';
import {
  resolveAiToolTopicTaxonomy,
} from '../utils/ai-tool-topic-taxonomy.js';
import {
  getAiGeneratorVariantAngle,
  getAiGeneratorVariantScenario,
} from '../constants/ai-generator-variant-angles.js';
import {
  isAiGeneratorCostSaverEnabled,
  isRecoveryPass,
  shouldUseFlashForAiGeneratorRun,
} from '../utils/ai-generator-batch-config.js';
import { computeGeminiCostFromTokenUsage } from '../utils/gemini-token-cost.js';
import { buildHistoricalGenerationContext } from '../services/ai-generator-historical-index.js';
import { persistGenerationFingerprints } from '../services/ai-generator-fingerprint-service.js';
import {
  validateRecordUniqueness,
  collectQuestionTextsFromStructured,
  dedupeIntraRecordQuestions,
  renumberIntraRecordQuestions,
} from '../services/ai-generator-uniqueness-engine.js';
import { getUniquenessMaxAttempts } from '../utils/ai-generator-batch-config.js';
import { extractTitleFromStructured } from '../services/ai-generator-content-extractor.js';
import { generateBatchAndSave } from '../services/ai-generator-batch-orchestrator.js';
import {
  acquireGenerationLock,
  forceReleaseGenerationLock,
  releaseGenerationLock,
} from '../services/ai-generator-lock-service.js';
import {
  getDuplicateAuditSummary,
  getGenerationAnalytics,
  getTopicSaturationReport,
} from '../services/ai-generator-audit-service.js';
import { AI_TOOL_ORDERED_SLUGS } from '../config/aiToolTemplates.js';

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeClassLabelForTopics(classLabel) {
  const normalized = normalizeText(classLabel);
  if (!normalized) return '';
  if (normalized === 'IIT-6' || normalized === 'Class-6-IIT') return 'Class 6';
  const digits = normalized.match(/\d+/)?.[0];
  if (digits) return `Class ${digits}`;
  return normalized;
}

function buildClassLabelFilter(classLabel, board = '') {
  return applyClassLabelMongoFilter({}, classLabel, board);
}

function getRequestUserName(req) {
  return (
    req.user?.fullName ||
    req.user?.name ||
    req.user?.email ||
    req.body?.createdByName ||
    'Super Admin'
  );
}

function ensureSuperAdmin(req, res) {
  if (req.user?.role !== 'super-admin') {
    res.status(403).json({
      success: false,
      message: 'Access denied. Super admin required.',
    });
    return false;
  }
  return true;
}

/**
 * AI Generator page listing: super-admin Gemini saves use sourceType ai_generator.
 * Older rows may be sourceType legacy with metadata.createdByRole super-admin, or only in ai_generators.
 * Exclude ai_pdf and teacher/LLM rows (no super-admin marker).
 */
function buildGeneratorMongoQuery({
  toolSlug,
  board,
  className,
  subjectName,
  topicName,
  subtopicName,
}) {
  const query = {
    sourceType: { $ne: 'ai_pdf' },
    $or: [
      { sourceType: 'ai_generator' },
      {
        $and: [
          {
            $or: [{ sourceType: 'legacy' }, { sourceType: { $exists: false } }],
          },
          { 'metadata.createdByRole': 'super-admin' },
        ],
      },
      {
        $and: [
          {
            $or: [{ sourceType: 'legacy' }, { sourceType: { $exists: false } }],
          },
          { 'metadata.extraParams': { $exists: true } },
        ],
      },
    ],
  };
  if (toolSlug) query.toolName = toolSlug;
  if (board) query.board = boardMongoMatch(board);
  if (className) query.classLabel = className;
  if (subjectName) query.subject = subjectName;
  if (topicName !== undefined && topicName !== '') query.topic = topicName;
  if (subtopicName) query.subtopic = subtopicName;
  return query;
}

function buildLegacyAiGeneratorsQuery({
  toolSlug,
  board,
  className,
  subjectName,
  topicName,
  subtopicName,
}) {
  const query = {};
  if (toolSlug) query.toolSlug = toolSlug;
  if (board) query.board = boardMongoMatch(board);
  if (className) query.className = className;
  if (subjectName) query.subjectName = subjectName;
  if (topicName !== undefined && topicName !== '') query.topicName = topicName;
  if (subtopicName) query.subtopicName = subtopicName;
  return query;
}

function mapLegacyAiGeneratorDoc(r) {
  if (!r) return null;
  const slug = normalizeText(r.toolSlug) || normalizeText(r.toolName);
  const display = normalizeText(r.toolName) || slug;
  return {
    _id: r._id,
    toolName: slug,
    toolDisplayName: display,
    board: canonicalBoardLabel(r.board || r?.metadata?.board || ''),
    classLabel: r.className,
    subject: r.subjectName,
    topic: r.topicName || '',
    subtopic: r.subtopicName,
    generatedContent: r.generatedContent,
    content: r.generatedContent,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function isDeprecatedGeneratorRecord(record) {
  return (
    isDeprecatedAiToolIdentifier(record?.toolName) ||
    isDeprecatedAiToolIdentifier(record?.toolDisplayName) ||
    isDeprecatedAiToolIdentifier(record?.toolSlug)
  );
}

/** Fields loaded for accordion list views — omit full bodies (fetch on View). */
export const GENERATOR_LIST_SELECT =
  'toolName toolDisplayName board classLabel subject topic subtopic createdAt updatedAt metadata.bookTitle metadata.extraParams metadata.generationVariant metadata.formatSource metadata.bookGenerator metadata.listPreview metadata.cost';

/** Short list preview only — full content loads on View/Edit. */
const GENERATOR_LIST_PREVIEW_CHARS = 280;

/** Default cap when client/env omit limit (prevents unbounded list load). */
export const GENERATOR_RECORDS_LIST_DEFAULT_LIMIT = 400;

/** One-line preview for records list (no full structured JSON over the wire). */
export function buildGeneratorListPreview(record) {
  if (!record) return '';
  const meta = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const cached = String(meta.listPreview || '').trim();
  if (cached) return cached.slice(0, GENERATOR_LIST_PREVIEW_CHARS);

  const structured =
    meta.structuredContent && typeof meta.structuredContent === 'object'
      ? meta.structuredContent
      : null;
  if (structured) {
    const title = String(
      structured.reading_practice_title ||
        structured.title ||
        structured.lesson_name ||
        structured.mock_test_title ||
        structured.paper_title ||
        structured.core?.title ||
        '',
    ).trim();
    if (title) return title.slice(0, 200);
  }

  const raw = String(record.generatedContent || record.content || '').trim();
  if (raw) {
    return raw.length <= GENERATOR_LIST_PREVIEW_CHARS
      ? raw
      : raw.slice(0, GENERATOR_LIST_PREVIEW_CHARS);
  }

  return [record.topic, record.subtopic, record.toolDisplayName || record.toolName]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' — ')
    .slice(0, GENERATOR_LIST_PREVIEW_CHARS);
}

/** Shrink a generation row for grouped list APIs (no full structured JSON in list responses). */
export function slimGeneratorRecordForList(record) {
  if (!record) return null;
  const meta = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const extraParams =
    meta.extraParams && typeof meta.extraParams === 'object' ? meta.extraParams : undefined;

  const listPreview = buildGeneratorListPreview(record);

  return {
    _id: record._id,
    toolName: record.toolName,
    toolDisplayName: record.toolDisplayName,
    board: record.board,
    classLabel: record.classLabel,
    subject: record.subject,
    topic: record.topic,
    subtopic: record.subtopic,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    generatedContent: listPreview,
    metadata: {
      bookTitle: meta.bookTitle,
      listPreview,
      extraParams,
      bookGenerator: meta.bookGenerator,
      formatSource: meta.formatSource,
      generationVariant: meta.generationVariant,
      ...(meta.cost && typeof meta.cost === 'object' ? { cost: meta.cost } : {}),
    },
  };
}

export function groupAiGeneratorRecords(items) {
  const toolMap = new Map();

  for (const record of items) {
    if (isDeprecatedGeneratorRecord(record)) continue;
    const slug = record.toolName || '';
    const display = record.toolDisplayName || slug;
    const toolKey = `${slug}::${display}`;
    if (!toolMap.has(toolKey)) {
      toolMap.set(toolKey, {
        toolName: display,
        toolSlug: slug,
        classes: [],
      });
    }
    const toolNode = toolMap.get(toolKey);

    const boardName = normalizeBoardLabelForGrouping(record.board || record?.metadata?.board || '');
    const className = normalizeClassLabelForLock(record.classLabel || '');
    let classNode = toolNode.classes.find(
      (x) => x.className === className && String(x.boardName || '') === boardName,
    );
    if (!classNode) {
      classNode = { className, boardName, subjects: [] };
      toolNode.classes.push(classNode);
    }

    let subjectNode = classNode.subjects.find((x) => x.subjectName === record.subject);
    if (!subjectNode) {
      subjectNode = { subjectName: record.subject, topics: [] };
      classNode.subjects.push(subjectNode);
    }

    const topicNameSafe = record.topic || 'General';
    let topicNode = subjectNode.topics.find((x) => x.topicName === topicNameSafe);
    if (!topicNode) {
      topicNode = { topicName: topicNameSafe, subtopics: [] };
      subjectNode.topics.push(topicNode);
    }

    let subtopicNode = topicNode.subtopics.find((x) => x.subtopicName === record.subtopic);
    if (!subtopicNode) {
      subtopicNode = { subtopicName: record.subtopic, records: [] };
      topicNode.subtopics.push(subtopicNode);
    }

    subtopicNode.records.push({
      _id: record._id,
      toolName: display,
      toolSlug: slug,
      boardName,
      className: record.classLabel,
      subjectName: record.subject,
      topicName: record.topic || '',
      subtopicName: record.subtopic,
      generatedContent: record.generatedContent || record.content || '',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      metadata: record.metadata || {},
      generationVariant:
        record.metadata?.generationVariant ||
        record.metadata?.extraParams?.generationVariant ||
        null,
      variantAngle: record.metadata?.extraParams?.variantAngle || '',
    });
  }

  return sortGroupedGeneratorRecords(Array.from(toolMap.values()));
}

export async function generateAndSaveContent(req, res) {
  let tokenUsage = null;
  let cost = null;
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const toolSlug = normalizeText(req.body.toolSlug || req.body.toolType);
    const board = lockBoardKey(canonicalBoardLabel(normalizeText(req.body.board || req.body.boardName)));
    const toolDisplayName = normalizeText(req.body.toolName);
    const className = resolveClassLabelForAiToolStorage(
      normalizeText(req.body.className || req.body.classNumber),
      board,
    );
    const subjectName = normalizeText(req.body.subjectName || req.body.subject);
    const topicName = normalizeText(req.body.topicName || req.body.topic);
    const subtopicName = normalizeText(req.body.subtopicName || req.body.subTopic || req.body.subtopic);

    if (!toolSlug || !toolDisplayName || !className || !subjectName || !subtopicName) {
      return res.status(400).json({
        success: false,
        message: 'toolSlug, toolName, className, subjectName, and subtopicName are required.',
      });
    }

    if (isDeprecatedAiToolIdentifier(toolSlug) || isDeprecatedAiToolIdentifier(toolDisplayName)) {
      return res.status(400).json({
        success: false,
        message: `This tool format is no longer supported. Use one of the ${AI_TOOL_ORDERED_SLUGS.length} curriculum tools.`,
      });
    }
    if (!isValidAiToolSlug(toolSlug)) {
      return res.status(400).json({
        success: false,
        message: `Invalid toolSlug. Must be one of the ${AI_TOOL_ORDERED_SLUGS.length} AI curriculum tools.`,
      });
    }

    {
      const { validateAiToolSubjectForTool } = await import('../utils/ai-tool-subject-rules.js');
      const subjectError = validateAiToolSubjectForTool(toolSlug, subjectName);
      if (subjectError) {
        return res.status(400).json({
          success: false,
          message: subjectError,
        });
      }
    }

    const generationVariant = Number.parseInt(String(req.body.generationVariant ?? ''), 10);
    const batchSize = Number.parseInt(String(req.body.batchSize ?? ''), 10);
    const extraParams = {
      ...(req.body.extraParams && typeof req.body.extraParams === 'object' ? req.body.extraParams : {}),
      ...(Number.isFinite(generationVariant) && generationVariant > 0
        ? {
            generationVariant,
            variantIndex: generationVariant,
            variantAngle: getAiGeneratorVariantAngle(generationVariant, subjectName),
            variantScenario: getAiGeneratorVariantScenario(generationVariant, subjectName),
            uniqueSeed: `${Date.now()}-v${generationVariant}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 8)}`,
          }
        : {}),
      ...(Number.isFinite(batchSize) && batchSize > 0 ? { batchSize } : {}),
      ...(req.body.recoveryPass === true ? { recoveryPass: true } : {}),
    };

    const isBatchVariant = Number.isFinite(generationVariant) && generationVariant > 0;
    const recoveryPass = isRecoveryPass(extraParams, req.body);

    const scope = {
      toolSlug,
      board,
      className,
      subject: subjectName,
      topic: topicName,
      subtopic: subtopicName,
    };
    const historical = await buildHistoricalGenerationContext(scope);
    const uniquenessCtx = {
      batchTitles: [],
      batchTexts: [],
      historicalTexts: [
        ...historical.questionSnippets,
        ...(historical.fingerprints?.question || []).map((r) => r.originalText).filter(Boolean),
      ],
      historicalTitles: historical.titles,
    };

    if (req.body.batchTitles && Array.isArray(req.body.batchTitles)) {
      uniquenessCtx.batchTitles = req.body.batchTitles.map((t) => String(t || '').trim()).filter(Boolean);
    }
    if (req.body.batchQuestionTexts && Array.isArray(req.body.batchQuestionTexts)) {
      uniquenessCtx.batchTexts = req.body.batchQuestionTexts.map((t) => String(t || '').trim()).filter(Boolean);
    }

    beginTokenUsageSession(
      isBatchVariant ? `ai-generator-variant-${generationVariant}` : 'ai-generator',
    );
    let generatedContent;
    let structuredContent;
    let contentType;
    let sectionRepairCount = 0;
    let duplicatePreventionCount = 0;
    let formatSource = 'aiToolTemplates';
    let schemaVersion = undefined;
    let v2StructuredContent = null;
    let qualityFixes = [];
    let qualityWarnings = [];
    const maxUniquenessAttempts = getUniquenessMaxAttempts();

    try {
      let lastUniquenessError = '';
      let usedV2 = false;

      // Prefer V2 six-section + full quality pipeline (math / Indian / scope / density / scaffold).
      if (isSixSectionV2Enabled() && isV2SupportedTool(toolSlug)) {
        try {
          const v2VariantHint = isBatchVariant
            ? buildV2VariantHint({
                variantIndex: generationVariant,
                batchSize: Number.isFinite(batchSize) ? batchSize : 0,
                family: v2ToolFamily(toolSlug),
                angle: getAiGeneratorVariantAngle(generationVariant, subjectName),
                scenario: getAiGeneratorVariantScenario(generationVariant, subjectName),
                seed: `${Date.now()}-single-v${generationVariant || 1}`,
              })
            : '';
          const v2 = await generateSixSectionContent(
            toolSlug,
            {
              board,
              classLabel: className,
              subject: subjectName,
              topic: topicName || 'General',
              subTopic: subtopicName,
            },
            {
              isBatchVariant: Boolean(isBatchVariant),
              variantHint: v2VariantHint || undefined,
              avoidQuestions: uniquenessCtx.batchTexts.slice(0, 40),
              maxTries: 2,
              llmAudit: undefined,
              softKeepOnQualityFail: false,
            },
          );
          if (v2.ok && v2.structuredContent) {
            const legacy =
              v2.legacyStructured || mapV2StructuredToLegacy(toolSlug, v2.structuredContent);
            let persistContent =
              v2.structuredContent?.core?.title ||
              v2.structuredContent?.core?.worksheetTitle ||
              toolDisplayName;
            if (legacy) {
              try {
                persistContent =
                  formatStructuredToolOutput(toolSlug, legacy) || JSON.stringify(legacy);
              } catch {
                persistContent = JSON.stringify(legacy);
              }
            }
            generatedContent = persistContent;
            structuredContent = legacy || v2.structuredContent;
            v2StructuredContent = v2.structuredContent;
            contentType = 'structured';
            formatSource = 'asli-v2-six-section';
            schemaVersion = 'asli-v2-six-section';
            qualityFixes = v2.qualityFixes || [];
            qualityWarnings = v2.qualityWarnings || [];
            usedV2 = true;

            const uniqueness = validateRecordUniqueness(toolSlug, structuredContent, uniquenessCtx);
            if (!uniqueness.valid) {
              lastUniquenessError = uniqueness.errors.join('; ');
              duplicatePreventionCount += 1;
              // Still save V2 when uniqueness soft-fails (cost-saver) — quality gates already passed.
            }
          }
        } catch (v2Err) {
          console.warn(
            '[generateAndSaveContent] V2 path failed, falling back to legacy:',
            v2Err?.message || v2Err,
          );
        }
      }

      if (!usedV2) {
        for (let uniqAttempt = 1; uniqAttempt <= maxUniquenessAttempts; uniqAttempt += 1) {
          try {
            ({ generatedContent, structuredContent, contentType, sectionRepairCount } =
              await generateStructuredContentForAiGenerator(toolSlug, {
                board,
                classLabel: className,
                gradeLevel: className,
                subject: subjectName,
                topic: topicName || 'General',
                subTopic: subtopicName,
                extraParams: {
                  ...extraParams,
                  ...(uniqAttempt > 1 ? { recoveryPass: true } : {}),
                },
                historicalPromptBlock: historical.promptBlock,
                upgradeToFlash: shouldUseFlashForAiGeneratorRun({
                  upgradeRequested: uniqAttempt > 1,
                  recoveryPass: recoveryPass || uniqAttempt > 1,
                }),
                recoveryPass: recoveryPass || uniqAttempt > 1,
              }));
          } catch (genErr) {
            if (uniqAttempt >= maxUniquenessAttempts) throw genErr;
            duplicatePreventionCount += 1;
            continue;
          }

          structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
          structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);

          const uniqueness = validateRecordUniqueness(toolSlug, structuredContent, uniquenessCtx);
          if (uniqueness.valid) break;
          lastUniquenessError = uniqueness.errors.join('; ');
          duplicatePreventionCount += 1;
          if (uniqAttempt >= maxUniquenessAttempts) {
            break;
          }
        }
      }
      if (lastUniquenessError) {
        /* retained for metadata below */
      }
    } finally {
      tokenUsage = endTokenUsageSession();
      cost = computeGeminiCostFromTokenUsage(tokenUsage);
    }

    const uid = req.userId;
    const generatedBy = uid || 'unknown';
    const teacherId = mongoose.Types.ObjectId.isValid(uid) ? uid : undefined;

    const explicitReviewStatus = String(req.body.reviewStatus || '').trim();
    const allowedReviewStates = ['approved', 'draft', 'under_review'];
    const reviewStatus = allowedReviewStates.includes(explicitReviewStatus)
      ? explicitReviewStatus
      : 'approved';

    const serveAudit = auditStoredGenerationDoc({
      toolName: toolSlug,
      classLabel: className,
      subject: subjectName,
      topic: topicName,
      subtopic: subtopicName,
      content: generatedContent,
      generatedContent,
      metadata: {
        structuredContent: v2StructuredContent || structuredContent,
        schemaVersion,
      },
    });
    if (!serveAudit.ok) {
      return res.status(422).json({
        success: false,
        message: `Quality gate blocked save: ${serveAudit.errors.slice(0, 3).join(' | ')}`,
        qualityErrors: serveAudit.errors,
      });
    }
    if (!v2StructuredContent && structuredContent) {
      const legacyGate = runAiGeneratorQualityGate(toolSlug, structuredContent, {
        strictValidation: true,
        subject: subjectName,
      });
      if (!legacyGate.valid) {
        return res.status(422).json({
          success: false,
          message: `Legacy quality gate blocked save: ${(legacyGate.errors || []).slice(0, 3).join(' | ')}`,
          qualityErrors: legacyGate.errors,
        });
      }
    }

    const record = await AiToolGeneration.create({
      toolName: toolSlug,
      toolDisplayName,
      sourceType: 'ai_generator',
      board,
      classLabel: className,
      subject: subjectName,
      topic: topicName,
      subtopic: subtopicName,
      section: '',
      content: generatedContent,
      generatedContent,
      generatedBy,
      status: 'active',
      reviewStatus,
      metadata: {
        board,
        createdByName: getRequestUserName(req),
        createdByRole: 'super-admin',
        extraParams,
        contentType,
        structuredContent: v2StructuredContent || structuredContent,
        ...(v2StructuredContent && structuredContent && structuredContent !== v2StructuredContent
          ? { legacyStructuredContent: structuredContent }
          : {}),
        formatSource,
        schemaVersion,
        generationVariant: Number.isFinite(generationVariant) && generationVariant > 0 ? generationVariant : undefined,
        batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : undefined,
        existingCountAtGeneration: historical.existingCount,
        sectionRepairCount,
        duplicatePreventionCount,
        tokenUsage,
        cost,
        qualityFixes,
        qualityWarnings,
        qualityAudit: serveAudit,
        qualityGates: [
          'math-accuracy',
          'indian-notation',
          'subtopic-scope',
          'content-density',
          'legacy-scaffold',
          'answer-key-audit',
        ],
      },
      ...(teacherId ? { teacherId } : {}),
    });

    const fingerprintMeta = await persistGenerationFingerprints(
      toolSlug,
      structuredContent,
      scope,
      record._id,
    );
    await AiToolGeneration.updateOne(
      { _id: record._id },
      {
        $set: {
          'metadata.contentFingerprint': fingerprintMeta.contentFingerprint,
          'metadata.questionFingerprints': fingerprintMeta.questionFingerprints,
          'metadata.objectiveFingerprints': fingerprintMeta.objectiveFingerprints,
          'metadata.activityFingerprints': fingerprintMeta.activityFingerprints,
        },
      },
    );

    const lean = record.toObject();
    lean.metadata = { ...lean.metadata, ...fingerprintMeta };
    return res.status(201).json({
      success: true,
      data: {
        ...lean,
        board: lean.board || '',
        className: lean.classLabel,
        subjectName: lean.subject,
        topicName: lean.topic,
        subtopicName: lean.subtopic,
        toolSlug: lean.toolName,
        tokenUsage,
        cost,
      },
      message: 'Content generated and saved successfully.',
    });
  } catch (error) {
    console.error('generateAndSaveContent error:', error);
    const raw = String(error?.message || 'Failed to generate and save content.');
    const isLlmFailure = /Gemini|upstream fallback|LLM|fetch failed|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|\b403\b|\b401\b|\b429\b|API key|empty content/i.test(
      raw,
    );
    let message = raw;
    if (/403[\s\S]*denied access|PERMISSION_DENIED|API_KEY_INVALID/i.test(raw)) {
      message =
        'Google Gemini refused this request (403: project or API key access denied, or billing disabled). Fix the key in Google AI Studio / Cloud Console, or set UPSTREAM_LLM_URL (+ LLM_MODEL_ID) to a running local/OpenAI-compatible server.';
    } else if (/Gemini API key is missing/i.test(raw)) {
      message =
        'No Gemini API key configured. Set GEMINI_API_KEY or VIDYA_AI_GEMINI_API_KEY, or point UPSTREAM_LLM_URL at a local LLM.';
    } else if (/Upstream fallback failed/i.test(raw) && /fetch failed|ECONNREFUSED/i.test(raw)) {
      message =
        'Gemini failed and the backup LLM endpoint is unreachable. Start LM Studio (or your UPSTREAM_LLM_URL server) or fix the URL in .env.';
    } else if (/\b429\b|quota exceeded|Quota exceeded|rate limit|RESOURCE_EXHAUSTED/i.test(raw)) {
      message =
        'Google Gemini returned 429 (rate limit or quota exhausted, including free-tier limits). Wait a minute and try again, enable billing in Google AI / Cloud for higher limits, or configure UPSTREAM_LLM_URL and run a local model (LM Studio, Ollama).';
    }
    return res.status(isLlmFailure ? 502 : 500).json({
      success: false,
      message,
      ...(tokenUsage
        ? {
            data: {
              tokenUsage,
              cost,
            },
          }
        : {}),
    });
  }
}

export async function getAllGeneratorRecords(req, res) {
  try {
    const role = req.user?.role;
    if (!['super-admin', 'teacher'].includes(role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const toolSlug = normalizeText(req.query.toolSlug);
    const boardRaw = normalizeText(req.query.board);
    const board = boardRaw ? lockBoardKey(boardRaw) : '';
    const className = normalizeText(req.query.className);
    const subjectName = normalizeText(req.query.subjectName);
    const topicName = normalizeText(req.query.topicName);
    const subtopicName = normalizeText(req.query.subtopicName);

    const mongoQuery = buildGeneratorMongoQuery({
      toolSlug,
      board,
      className,
      subjectName,
      topicName,
      subtopicName,
    });
    const legacyQuery = buildLegacyAiGeneratorsQuery({
      toolSlug,
      board,
      className,
      subjectName,
      topicName,
      subtopicName,
    });

    const limitRaw = Number(req.query.limit);
    const envCap = Number(process.env.AI_GENERATOR_RECORDS_LIST_LIMIT || 0);
    const listLimit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, 10000)
        : Number.isFinite(envCap) && envCap > 0
          ? Math.min(envCap, 10000)
          : GENERATOR_RECORDS_LIST_DEFAULT_LIMIT;

    // List view: metadata + curriculum only (no generatedContent/content bodies).
    const masterQuery = AiToolGeneration.find(mongoQuery)
      .select(GENERATOR_LIST_SELECT)
      .sort({ createdAt: -1 })
      .limit(listLimit)
      .lean();
    // Legacy collection: small cap only — most traffic is on AiToolGeneration now.
    const legacyLimit = Math.min(50, listLimit);
    const legacyQueryFind = AIGeneratorRecord.find(legacyQuery)
      .select(
        'toolSlug toolName board className subjectName topicName subtopicName createdAt updatedAt',
      )
      .sort({ createdAt: -1 })
      .limit(legacyLimit)
      .lean();

    const [totalMaster, totalLegacy, fromMaster, fromLegacyColl] = await withMongoRetry(() =>
      Promise.all([
        AiToolGeneration.countDocuments(mongoQuery),
        AIGeneratorRecord.countDocuments(legacyQuery),
        masterQuery,
        legacyQueryFind,
      ]),
    );
    const legacyMapped = fromLegacyColl.map(mapLegacyAiGeneratorDoc).filter(Boolean);
    const items = [...fromMaster, ...legacyMapped]
      .map(slimGeneratorRecordForList)
      .filter(Boolean)
      .sort(compareAiToolRecordsByVariantThenDate)
      .slice(0, listLimit);
    const grouped = groupAiGeneratorRecords(items);
    const total = totalMaster + totalLegacy;

    return res.json({
      success: true,
      data: {
        grouped,
        total,
        loadedCount: items.length,
        truncated: total > items.length,
      },
    });
  } catch (error) {
    console.error('getAllGeneratorRecords error:', error);
    const transient = isMongoTransientError(error);
    return res.status(transient ? 503 : 500).json({
      success: false,
      message: transient
        ? 'Database temporarily unavailable. Please retry in a moment.'
        : 'Failed to fetch records.',
      retryable: transient,
    });
  }
}

export async function getSingleGeneratorRecord(req, res) {
  try {
    const role = req.user?.role;
    if (!['super-admin', 'teacher'].includes(role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid record id.' });
    }

    let item = await AiToolGeneration.findOne({
      _id: id,
      ...buildGeneratorMongoQuery({}),
    }).lean();
    if (!item) {
      const leg = await AIGeneratorRecord.findById(id).lean();
      const mapped = mapLegacyAiGeneratorDoc(leg);
      item = mapped;
    }
    if (!item) {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }

    return res.json({
      success: true,
      data: {
        ...item,
        className: item.classLabel,
        subjectName: item.subject,
        topicName: item.topic,
        subtopicName: item.subtopic,
        toolSlug: item.toolName,
        generatedContent: item.generatedContent || item.content,
      },
    });
  } catch (error) {
    console.error('getSingleGeneratorRecord error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch record.',
    });
  }
}

export async function updateGeneratorRecord(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid record id.' });
    }

    const generatedContent = String(req.body.generatedContent || '').trim();
    if (!generatedContent) {
      return res.status(400).json({
        success: false,
        message: 'generatedContent is required.',
      });
    }

    const toolDisplayName = normalizeText(req.body.toolName);
    const toolSlug = normalizeText(req.body.toolSlug);
    const className = normalizeText(req.body.className);
    const subjectName = normalizeText(req.body.subjectName);
    const topicName = normalizeText(req.body.topicName);
    const subtopicName = normalizeText(req.body.subtopicName);

    const update = {
      generatedContent,
      content: generatedContent,
    };
    if (toolDisplayName) update.toolDisplayName = toolDisplayName;
    if (toolSlug) update.toolName = toolSlug;
    if (className) update.classLabel = className;
    if (subjectName) update.subject = subjectName;
    if (topicName !== undefined) update.topic = topicName;
    if (subtopicName) update.subtopic = subtopicName;

    let item = await AiToolGeneration.findOneAndUpdate(
      { _id: id, ...buildGeneratorMongoQuery({}) },
      { $set: update },
      { new: true },
    ).lean();
    if (!item) {
      const legUpdate = { generatedContent };
      if (toolDisplayName) legUpdate.toolName = toolDisplayName;
      if (toolSlug) legUpdate.toolSlug = toolSlug;
      if (className) legUpdate.className = className;
      if (subjectName) legUpdate.subjectName = subjectName;
      if (topicName !== undefined) legUpdate.topicName = topicName;
      if (subtopicName) legUpdate.subtopicName = subtopicName;
      const leg = await AIGeneratorRecord.findByIdAndUpdate(id, { $set: legUpdate }, { new: true }).lean();
      item = mapLegacyAiGeneratorDoc(leg);
    }
    if (!item) {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }

    return res.json({
      success: true,
      data: {
        ...item,
        className: item.classLabel,
        subjectName: item.subject,
        topicName: item.topic,
        subtopicName: item.subtopic,
        toolSlug: item.toolName,
        generatedContent: item.generatedContent || item.content,
      },
      message: 'Record updated successfully.',
    });
  } catch (error) {
    console.error('updateGeneratorRecord error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update record.',
    });
  }
}

export async function deleteGeneratorRecord(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid record id.' });
    }

    let deleted = await AiToolGeneration.findOneAndDelete({
      _id: id,
      ...buildGeneratorMongoQuery({}),
    }).lean();
    if (!deleted) {
      deleted = await AIGeneratorRecord.findByIdAndDelete(id).lean();
    }
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }

    return res.json({ success: true, message: 'Record deleted successfully.' });
  } catch (error) {
    console.error('deleteGeneratorRecord error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete record.',
    });
  }
}

export async function deleteAllGeneratorRecords(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const board = normalizeText(req.query.board);
    const mongoQuery = buildGeneratorMongoQuery({ board });
    const legacyQuery = buildLegacyAiGeneratorsQuery({ board });

    const [masterResult, legacyResult] = await Promise.all([
      AiToolGeneration.deleteMany(mongoQuery),
      AIGeneratorRecord.deleteMany(legacyQuery),
    ]);

    const deletedCount =
      Number(masterResult?.deletedCount || 0) + Number(legacyResult?.deletedCount || 0);

    return res.json({
      success: true,
      data: { deletedCount },
      message: `Deleted ${deletedCount} record${deletedCount === 1 ? '' : 's'}.`,
    });
  } catch (error) {
    console.error('deleteAllGeneratorRecords error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete all records.',
    });
  }
}

export async function bulkDeleteGeneratorRecords(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [...new Set(rawIds.map((x) => String(x || '').trim()).filter(Boolean))].filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid record ids provided.' });
    }

    let deletedCount = 0;
    const errors = [];
    for (const id of ids) {
      let deleted = await AiToolGeneration.findOneAndDelete({
        _id: id,
        ...buildGeneratorMongoQuery({}),
      }).lean();
      if (!deleted) {
        deleted = await AIGeneratorRecord.findByIdAndDelete(id).lean();
      }
      if (deleted) {
        deletedCount += 1;
      } else {
        errors.push({ id, message: 'Record not found.' });
      }
    }

    return res.json({
      success: deletedCount > 0,
      data: { deletedCount, failedCount: errors.length },
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
      message: `Deleted ${deletedCount} of ${ids.length} record(s).`,
    });
  } catch (error) {
    console.error('bulkDeleteGeneratorRecords error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to bulk delete records.',
    });
  }
}

export async function getReviewQueue(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;
    const status = String(req.query.status || 'draft').trim();
    const allowed = ['draft', 'under_review', 'rejected', 'archived'];
    const filter = allowed.includes(status)
      ? { reviewStatus: status }
      : { reviewStatus: { $in: ['draft', 'under_review'] } };
    const items = await AiToolGeneration.find(filter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    return res.json({ success: true, status, count: items.length, items });
  } catch (error) {
    console.error('getReviewQueue error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch review queue.' });
  }
}

export async function reviewGeneratorRecord(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid record id.' });
    }
    const action = String(req.body.action || '').trim();
    const allowedActions = ['approve', 'reject', 'archive', 'request-review', 'unapprove'];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `action must be one of ${allowedActions.join(', ')}`,
      });
    }
    const stateMap = {
      approve: 'approved',
      reject: 'rejected',
      archive: 'archived',
      'request-review': 'under_review',
      unapprove: 'draft',
    };
    const newStatus = stateMap[action];
    const reviewerNotes = String(req.body.notes || '').trim();
    const updated = await AiToolGeneration.findByIdAndUpdate(
      id,
      {
        $set: {
          reviewStatus: newStatus,
          reviewedBy: req.userId || null,
          reviewedAt: new Date(),
          reviewerNotes,
        },
      },
      { new: true }
    ).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }
    return res.json({
      success: true,
      message: `Record ${action}d.`,
      data: updated,
    });
  } catch (error) {
    console.error('reviewGeneratorRecord error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update review state.' });
  }
}

/** Human-readable label from a structuredContent key (e.g. sectionA_mcq -> "Section A — MCQ"). */
function humanizeV2Key(k) {
  let s = String(k || '');
  const sec = s.match(/^section([A-E])_?(.*)$/i);
  if (sec) {
    const kind = sec[2]
      .replace(/mcq/i, 'MCQ')
      .replace(/fib/i, 'Fill in the Blanks')
      .replace(/([a-z])([A-Z])/g, '$1 $2');
    return `Section ${sec[1].toUpperCase()}${kind ? ' — ' + kind.replace(/\b\w/g, (c) => c.toUpperCase()) : ''}`;
  }
  s = s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Render a V2 six-section structuredContent object into readable plain text for the PDF. */
function formatV2SixSectionToText(sc) {
  const lines = [];
  const SECTIONS = [
    ['core', 'CONTENT'],
    ['objectives', 'LEARNING OBJECTIVES'],
    ['differentiation', 'DIFFERENTIATION & SUPPORT'],
    ['assessment', 'ANSWER KEY & ASSESSMENT'],
    ['teacher', "TEACHER'S IMPLEMENTATION GUIDE"],
    ['reallife', 'REAL-LIFE CONNECTION'],
  ];
  const walk = (val, indent) => {
    if (val == null || val === '') return;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      lines.push(indent + String(val));
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          walk(item, indent);
          lines.push('');
        } else {
          walk(item, `${indent}• `);
        }
      }
      return;
    }
    if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) {
        if (v == null || v === '') continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          lines.push(`${indent}${humanizeV2Key(k)}: ${v}`);
        } else {
          lines.push(`${indent}${humanizeV2Key(k)}:`);
          walk(v, `${indent}  `);
        }
      }
    }
  };
  for (const [key, title] of SECTIONS) {
    if (!sc || !sc[key]) continue;
    lines.push('');
    lines.push(title);
    walk(sc[key], '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function generatePDF(req, res) {
  try {
    const role = req.user?.role;
    if (!['super-admin', 'teacher'].includes(role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid record id.' });
    }

    // By-id fetch for a record the user is already viewing (role checked above).
    // Only exclude ai_pdf; the restrictive list-scoping $or wrongly dropped
    // book_rag (book-based) records, causing "Record not found" on their PDF.
    let record = await AiToolGeneration.findOne({
      _id: id,
      sourceType: { $ne: 'ai_pdf' },
    }).lean();
    if (!record) {
      const leg = await AIGeneratorRecord.findById(id).lean();
      record = mapLegacyAiGeneratorDoc(leg);
    }
    if (!record) {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }

    // V2 six-section records store only the title in content/generatedContent;
    // the full content lives in metadata.structuredContent. Render it so the PDF
    // isn't just the title.
    const v2sc = record.metadata?.structuredContent;
    const isV2Record =
      record.metadata?.formatSource === 'asli-v2-six-section' ||
      record.metadata?.schemaVersion === 'asli-v2-six-section' ||
      v2sc?.schema === 'asli-v2-six-section';
    const bodyText =
      isV2Record && v2sc
        ? formatV2SixSectionToText(v2sc)
        : String(record.generatedContent || record.content || '').trim();
    const toolName = String(record.toolDisplayName || record.toolName || 'AI Tool').trim();
    const metaRows = [
      ['Class', record.classLabel],
      ['Subject', record.subject],
      ['Topic', record.topic || 'General'],
      ['Subtopic', record.subtopic],
      ['Board', record.board],
      ['Generated', record.createdAt ? new Date(record.createdAt).toLocaleString() : '—'],
    ].filter(([, v]) => String(v || '').trim());

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="aslilearn-${String(record._id)}.pdf"`,
      );
      res.send(pdfBuffer);
    });

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.save();
    doc.roundedRect(doc.page.margins.left, doc.y, pageW, 88, 12).fill('#4f46e5');
    doc.fillColor('#ffffff');
    doc.fontSize(9).text('ASLILEARN · AI V2', doc.page.margins.left + 16, doc.y + 14);
    doc.fontSize(18).text(toolName, doc.page.margins.left + 16, doc.y + 30, {
      width: pageW - 32,
    });
    doc.fontSize(10).text('Premium curriculum export', doc.page.margins.left + 16, doc.y + 58);
    doc.restore();
    doc.y += 100;

    doc.fillColor('#1e293b').fontSize(11);
    for (const [label, value] of metaRows) {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(String(value));
    }
    doc.moveDown(1);

    doc.strokeColor('#e2e8f0').moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageW, doc.y).stroke();
    doc.moveDown(0.75);

    doc.fillColor('#334155').fontSize(10).font('Helvetica');
    doc.text(bodyText || '(no content)', {
      align: 'left',
      width: pageW,
      lineGap: 3,
    });

    doc.end();
  } catch (error) {
    console.error('generatePDF error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate PDF.',
    });
  }
}

export async function getManagedTopicTaxonomy(req, res) {
  try {
    const role = req.user?.role;
    if (!['super-admin', 'teacher', 'student', 'admin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const board = normalizeText(req.query.board);
    const classLabel = normalizeText(req.query.classLabel || req.query.classId);
    const subject = normalizeText(req.query.subject || req.query.subjectId);
    const topicName = normalizeText(req.query.topicName || req.query.topicId);

    const data = await resolveAiToolTopicTaxonomy({
      board,
      productCategory: req.query.productCategory,
      classLabel,
      subject,
      topicName,
    });

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('getManagedTopicTaxonomy error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch managed topics.' });
  }
}

export async function generateBatchContent(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const toolSlug = normalizeText(req.body.toolSlug || req.body.toolType);
    const board = lockBoardKey(canonicalBoardLabel(normalizeText(req.body.board || req.body.boardName)));
    const toolDisplayName = normalizeText(req.body.toolName);
    const className = resolveClassLabelForAiToolStorage(
      normalizeText(req.body.className || req.body.classNumber),
      board,
    );
    const subjectName = normalizeText(req.body.subjectName || req.body.subject);
    const topicName = normalizeText(req.body.topicName || req.body.topic);
    // Multi-subtopic (combined paper): accept an array; fall back to single subtopic.
    const subTopics = (Array.isArray(req.body.subTopics) ? req.body.subTopics : [])
      .map((s) => normalizeText(s))
      .filter(Boolean);
    const subtopicName =
      normalizeText(req.body.subtopicName || req.body.subTopic || req.body.subtopic) ||
      subTopics.join(', ');
    const batchSize = Number.parseInt(String(req.body.batchSize ?? '25'), 10);
    const forceGenerate =
      req.body.forceGenerate === true ||
      req.body.forceGenerateNew === true ||
      req.body.extraParams?.forceGenerate === true;

    if (!toolSlug || !toolDisplayName || !className || !subjectName || !subtopicName) {
      return res.status(400).json({
        success: false,
        message: 'toolSlug, toolName, className, subjectName, and subtopicName are required.',
      });
    }
    if (!isValidAiToolSlug(toolSlug)) {
      return res.status(400).json({
        success: false,
        message: `Invalid toolSlug. Must be one of the ${AI_TOOL_ORDERED_SLUGS.length} AI curriculum tools.`,
      });
    }

    const result = await generateBatchAndSave(
      {
        toolSlug,
        toolName: toolDisplayName,
        board,
        productCategory:
          req.body.productCategory ?? req.body.extraParams?.productCategory ?? '',
        className,
        subjectName,
        topicName,
        subtopicName,
        ...(subTopics.length > 1 ? { subTopics } : {}),
        qualityTier: normalizeText(req.body.qualityTier),
        extraParams: req.body.extraParams,
        reviewStatus: req.body.reviewStatus,
        forceGenerate,
        forceGenerateNew: forceGenerate,
        forceUnlock: req.body.forceUnlock === true,
      },
      {
        batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 25,
        reqUser: {
          userId: req.userId,
          name: getRequestUserName(req),
        },
      },
    );

    if (result.locked) {
      return res.status(409).json({
        success: false,
        message: result.message || 'Generation already in progress.',
        data: { locked: true },
      });
    }

    return res.status(result.success ? 201 : 207).json({
      success: result.success,
      data: {
        savedCount: result.savedCount,
        failedCount: result.failedCount,
        batchSize: result.batchSize,
        existingCountBefore: result.existingCountBefore,
        records: result.records,
        failures: result.failures,
        tokenUsage: result.tokenUsage,
        cost: result.cost,
        mode: result.mode,
        saturation: result.saturation,
        strategy: result.strategy,
        geminiGenerationsAvoided: result.geminiGenerationsAvoided || 0,
        tokenSavingsEstimate: result.tokenSavingsEstimate || 0,
        duplicatePreventionCount: result.duplicatePreventionCount || 0,
      },
      message:
        result.message ||
        (result.success
          ? `${result.savedCount} unique records saved.`
          : `${result.savedCount}/${result.batchSize} records saved; ${result.failedCount} failed.`),
    });
  } catch (error) {
    console.error('generateBatchContent error:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Batch generation failed.',
    });
  }
}

export async function releaseAiGeneratorLock(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const toolSlug = normalizeText(req.body.toolSlug || req.body.toolType);
    const board = lockBoardKey(canonicalBoardLabel(normalizeText(req.body.board || req.body.boardName)));
    const className = resolveClassLabelForAiToolStorage(
      normalizeText(req.body.className || req.body.classNumber),
      board,
    );
    const subjectName = normalizeText(req.body.subjectName || req.body.subject);
    const topicName = normalizeText(req.body.topicName || req.body.topic);
    const subtopicName = normalizeText(req.body.subtopicName || req.body.subTopic || req.body.subtopic);

    if (!toolSlug || !className || !subjectName || !subtopicName) {
      return res.status(400).json({
        success: false,
        message: 'toolSlug, className, subjectName, and subtopicName are required.',
      });
    }

    const released = await forceReleaseGenerationLock({
      toolSlug,
      board,
      className,
      subject: subjectName,
      topic: topicName,
      subtopic: subtopicName,
    });

    return res.json({
      success: true,
      message:
        released > 0
          ? `Cleared ${released} stuck lock${released === 1 ? '' : 's'}. You can generate again.`
          : 'No active lock found. You can try generating again.',
      data: { released },
    });
  } catch (error) {
    console.error('releaseAiGeneratorLock error:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to release lock.',
    });
  }
}

/**
 * Bulk re-audit active generations. Marks metadata.qualityAudit and optionally
 * quarantines failures (reviewStatus=under_review) when quarantine=true.
 * POST /api/ai-generator/audit/quality
 * body: { toolSlug?, board?, className?, subjectName?, limit?, quarantine? }
 */
export async function bulkQualityAudit(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const toolSlug = normalizeText(req.body.toolSlug || req.query.toolSlug);
    const board = normalizeText(req.body.board || req.query.board);
    const className = normalizeText(req.body.className || req.query.className);
    const subjectName = normalizeText(req.body.subjectName || req.body.subject || req.query.subjectName);
    const limit = Math.min(500, Math.max(1, Number(req.body.limit || req.query.limit || 100) || 100));
    const quarantine = req.body.quarantine === true || req.query.quarantine === 'true';

    const filter = { status: 'active' };
    if (toolSlug) filter.toolName = toolSlug;
    if (board) Object.assign(filter, boardMongoMatch(board));
    if (className) applyClassLabelMongoFilter(filter, className, board);
    if (subjectName) Object.assign(filter, buildCaseInsensitiveExactFilter('subject', subjectName));

    const docs = await AiToolGeneration.find(filter)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    const results = [];
    let pass = 0;
    let fail = 0;
    for (const doc of docs) {
      const audit = auditStoredGenerationDoc(doc);
      const update = { 'metadata.qualityAudit': audit };
      if (quarantine && !audit.ok) {
        update.reviewStatus = 'under_review';
      }
      await AiToolGeneration.updateOne({ _id: doc._id }, { $set: update });
      if (audit.ok) pass += 1;
      else fail += 1;
      results.push({
        id: String(doc._id),
        toolName: doc.toolName,
        classLabel: doc.classLabel,
        subject: doc.subject,
        topic: doc.topic,
        subtopic: doc.subtopic,
        ok: audit.ok,
        errors: audit.errors.slice(0, 5),
        warnings: (audit.warnings || []).slice(0, 3),
      });
    }

    return res.json({
      success: true,
      data: {
        scanned: docs.length,
        pass,
        fail,
        quarantine,
        results,
      },
      message: `Quality audit: ${pass} pass, ${fail} fail of ${docs.length} records.`,
    });
  } catch (error) {
    console.error('bulkQualityAudit error:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Bulk quality audit failed.',
    });
  }
}

export async function getDuplicateAudit(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;
    const summary = await getDuplicateAuditSummary({
      toolSlug: normalizeText(req.query.toolSlug),
      board: normalizeText(req.query.board),
      className: normalizeText(req.query.className),
      subject: normalizeText(req.query.subjectName || req.query.subject),
      topic: normalizeText(req.query.topicName || req.query.topic),
      subtopic: normalizeText(req.query.subtopicName || req.query.subtopic),
    });
    return res.json({ success: true, data: summary });
  } catch (error) {
    console.error('getDuplicateAudit error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load duplicate audit.' });
  }
}

export async function getAiGeneratorAnalytics(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;
    const analytics = await getGenerationAnalytics({
      toolSlug: normalizeText(req.query.toolSlug),
      board: normalizeText(req.query.board),
    });
    return res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('getAiGeneratorAnalytics error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load analytics.' });
  }
}

export async function getTopicSaturation(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;
    const report = await getTopicSaturationReport({
      toolSlug: normalizeText(req.query.toolSlug),
      board: normalizeText(req.query.board),
      className: normalizeText(req.query.className),
      subject: normalizeText(req.query.subjectName || req.query.subject),
      topic: normalizeText(req.query.topicName || req.query.topic),
      subtopic: normalizeText(req.query.subtopicName || req.query.subtopic),
    });
    return res.json({ success: true, data: report });
  } catch (error) {
    console.error('getTopicSaturation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load topic saturation.' });
  }
}
