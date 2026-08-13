/**
 * On-demand generation when Super Admin AI Tool Data has no usable row
 * for the teacher/student dashboard selection.
 *
 * Catalog-first delivery stays preferred; this only runs after a miss or
 * incomplete/wrong-type gate so classrooms are not blocked on pre-generation.
 */
import mongoose from 'mongoose';
import AiToolGeneration from '../../../models/AiToolGeneration.js';
import { getToolDisplayTitle, isValidAiToolSlug } from '../../../config/aiToolTemplates.js';
import { generateStructuredContentForAiGenerator } from '../core/ai-content-engine-service.js';
import { buildDeliveryMetadataFromDoc, buildRawDataForTool, unwrapStoredAiToolContent } from './build-ai-tool-raw-data.js';
import {
  canonicalBoardLabel,
  lockBoardKey,
  resolveClassLabelForAiToolStorage,
} from '../../../utils/board-label.js';

function envFlagEnabled(name, defaultValue = true) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(raw);
}

export function isAiToolLiveFallbackEnabled() {
  return envFlagEnabled('AI_TOOL_LIVE_FALLBACK', true);
}

function normalizeLabel(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {{
 *   toolType: string,
 *   board?: string,
 *   classDisplay: string,
 *   subject: string,
 *   topic?: string,
 *   subtopic?: string,
 *   userId?: string,
 *   role?: 'teacher' | 'student' | 'dashboard',
 *   extraParams?: Record<string, unknown>,
 * }} opts
 */
export async function generateAiToolLiveFallback(opts = {}) {
  if (!isAiToolLiveFallbackEnabled()) {
    return { ok: false, reason: 'disabled' };
  }

  const toolType = normalizeLabel(opts.toolType);
  if (!toolType || !isValidAiToolSlug(toolType)) {
    return { ok: false, reason: 'unsupported-tool' };
  }

  const subject = normalizeLabel(opts.subject);
  const classDisplay = normalizeLabel(opts.classDisplay);
  if (!subject || !classDisplay) {
    return { ok: false, reason: 'missing-scope' };
  }

  const board = lockBoardKey(
    canonicalBoardLabel(normalizeLabel(opts.board) || 'CBSE'),
  );
  const classLabel = resolveClassLabelForAiToolStorage(classDisplay, board);
  const topicRaw = normalizeLabel(opts.topic);
  const subtopicRaw = normalizeLabel(opts.subtopic);
  const isWholeChapter =
    !subtopicRaw ||
    /^whole[\s_-]*chapter$/i.test(subtopicRaw) ||
    subtopicRaw === '__WHOLE_CHAPTER__';
  const topic = topicRaw || (isWholeChapter ? 'Whole chapter' : subtopicRaw) || 'General';
  const subTopic = isWholeChapter ? topic : subtopicRaw;
  const toolDisplayName = getToolDisplayTitle(toolType) || toolType.replace(/-/g, ' ');

  console.log(
    `[AI_TOOL_LIVE_FALLBACK] Generating ${toolType} — ${classLabel} ${subject} / ${topic}${isWholeChapter ? ' (whole chapter)' : ` / ${subTopic}`}`,
  );

  let generatedContent;
  let structuredContent;
  let contentType;
  const uniqueSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
  const generationVariant =
    Math.floor(Math.abs(Number(opts.extraParams?.generationVariant)) || 0) ||
    (Math.floor(Date.now() / 1000) % 997) + 1;
  try {
    ({ generatedContent, structuredContent, contentType } =
      await generateStructuredContentForAiGenerator(toolType, {
        board,
        classLabel,
        gradeLevel: classLabel,
        subject,
        topic,
        subTopic,
        extraParams: {
          ...(opts.extraParams && typeof opts.extraParams === 'object' ? opts.extraParams : {}),
          dashboardLiveFallback: true,
          qualityTier: 'fast',
          generationVariant,
          variantIndex: generationVariant,
          uniqueSeed,
        },
      }));
  } catch (error) {
    console.warn(
      `[AI_TOOL_LIVE_FALLBACK] Generation failed for ${toolType}:`,
      String(error?.message || error).slice(0, 300),
    );
    return { ok: false, reason: 'generation-failed', error };
  }

  const content = String(generatedContent || '').trim();
  if (!content) {
    return { ok: false, reason: 'empty-content' };
  }

  const uid = opts.userId ? String(opts.userId) : '';
  const teacherId = mongoose.Types.ObjectId.isValid(uid) ? uid : undefined;
  let savedDoc = null;

  try {
    savedDoc = await AiToolGeneration.create({
      toolName: toolType,
      toolDisplayName,
      sourceType: 'ai_generator',
      board,
      classLabel,
      subject,
      topic,
      subtopic: isWholeChapter ? '' : subTopic,
      section: '',
      content,
      generatedContent: content,
      generatedBy: uid || 'dashboard-live-fallback',
      status: 'active',
      reviewStatus: 'approved',
      metadata: {
        board,
        createdByRole: opts.role || 'dashboard',
        contentType,
        structuredContent,
        formatSource: 'aiToolTemplates',
        dashboardLiveFallback: true,
        liveFallbackAt: new Date().toISOString(),
        generationVariant,
        uniqueSeed,
      },
      ...(teacherId ? { teacherId } : {}),
    });
  } catch (saveErr) {
    console.warn(
      '[AI_TOOL_LIVE_FALLBACK] Save skipped:',
      String(saveErr?.message || saveErr).slice(0, 200),
    );
  }

  const deliveryDoc = savedDoc
    ? savedDoc.toObject
      ? savedDoc.toObject()
      : savedDoc
    : {
        toolName: toolType,
        subject,
        topic,
        subtopic: isWholeChapter ? '' : subTopic,
        classLabel,
        generatedContent: content,
        content,
        metadata: {
          board,
          contentType,
          structuredContent,
          dashboardLiveFallback: true,
        },
      };

  const metadataForRaw = buildDeliveryMetadataFromDoc(deliveryDoc);
  const builtRaw = buildRawDataForTool(toolType, content, metadataForRaw);
  const delivered = unwrapStoredAiToolContent(content, builtRaw);

  return {
    ok: true,
    content: delivered.content,
    rawData: delivered.rawData || null,
    savedId: savedDoc?._id ? String(savedDoc._id) : null,
    metadata: {
      source: 'dashboard-live-fallback',
      sourceLabel: 'Generated just now',
      matchType: 'live-fallback',
      totalCandidates: 1,
      selectedIndex: 0,
      liveGenerated: true,
    },
  };
}
