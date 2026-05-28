import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import AiToolGeneration from '../models/AiToolGeneration.js';
import AIGeneratorRecord from '../models/AIGeneratorRecord.js';
import AiToolTopic from '../models/AiToolTopic.js';
import { isDeprecatedAiToolIdentifier, isValidAiToolSlug } from '../config/aiToolTemplates.js';
import { generateStructuredContentForAiGenerator } from '../services/ai-content-engine-service.js';
import { boardMongoMatch, canonicalBoardLabel } from '../utils/board-label.js';

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeClassLabelForTopics(classLabel) {
  const normalized = normalizeText(classLabel);
  if (!normalized) return '';
  if (normalized === 'IIT-6' || normalized === 'Class-6-IIT') return 'IIT-6';
  const digits = normalized.match(/\d+/)?.[0];
  if (digits) return `Class ${digits}`;
  return normalized;
}

function buildClassLabelFilter(classLabel) {
  const normalized = normalizeClassLabelForTopics(classLabel);
  if (!normalized) return null;
  if (normalized === 'IIT-6') return 'IIT-6';
  const digits = normalized.match(/\d+/)?.[0];
  if (!digits) return normalized;
  return { $in: [`Class ${digits}`, digits, `-${digits}`] };
}

function buildCaseInsensitiveExactFilter(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' };
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

function groupAiGeneratorRecords(items) {
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

    const boardName = canonicalBoardLabel(record.board || record?.metadata?.board || '');
    let classNode = toolNode.classes.find(
      (x) => x.className === record.classLabel && String(x.boardName || '') === boardName,
    );
    if (!classNode) {
      classNode = { className: record.classLabel, boardName, subjects: [] };
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
    });
  }

  return Array.from(toolMap.values());
}

export async function generateAndSaveContent(req, res) {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const toolSlug = normalizeText(req.body.toolSlug || req.body.toolType);
    const board = canonicalBoardLabel(normalizeText(req.body.board || req.body.boardName));
    const toolDisplayName = normalizeText(req.body.toolName);
    const className = normalizeText(req.body.className || req.body.classNumber);
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
        message: 'This tool format is no longer supported. Use one of the 17 curriculum tools.',
      });
    }
    if (!isValidAiToolSlug(toolSlug)) {
      return res.status(400).json({
        success: false,
        message: `Invalid toolSlug. Must be one of the 17 AI curriculum tools.`,
      });
    }

    if (toolSlug === 'story-passage-creator' || toolSlug === 'reading-practice-room') {
      const { canonicalStoryPassageSubject, STORY_PASSAGE_SUBJECT_ERROR } = await import(
        '../utils/story-passage-subject.js'
      );
      if (!canonicalStoryPassageSubject(subjectName)) {
        return res.status(400).json({
          success: false,
          message: STORY_PASSAGE_SUBJECT_ERROR,
        });
      }
    }

    const extraParams = req.body.extraParams || {};
    const { generatedContent, structuredContent, contentType } =
      await generateStructuredContentForAiGenerator(toolSlug, {
        board,
        classLabel: className,
        gradeLevel: className,
        subject: subjectName,
        topic: topicName || 'General',
        subTopic: subtopicName,
        extraParams,
      });

    const uid = req.userId;
    const generatedBy = uid || 'unknown';
    const teacherId = mongoose.Types.ObjectId.isValid(uid) ? uid : undefined;

    const explicitReviewStatus = String(req.body.reviewStatus || '').trim();
    const allowedReviewStates = ['approved', 'draft', 'under_review'];
    const reviewStatus = allowedReviewStates.includes(explicitReviewStatus)
      ? explicitReviewStatus
      : (process.env.AI_GENERATOR_DEFAULT_STATE === 'approved' ? 'approved' : 'draft');

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
        extraParams: req.body.extraParams || {},
        contentType,
        structuredContent,
        formatSource: 'aiToolTemplates',
      },
      ...(teacherId ? { teacherId } : {}),
    });

    const lean = record.toObject();
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
    const board = normalizeText(req.query.board);
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

    const [fromMaster, fromLegacyColl] = await Promise.all([
      AiToolGeneration.find(mongoQuery).sort({ createdAt: -1 }).lean(),
      AIGeneratorRecord.find(legacyQuery).sort({ createdAt: -1 }).lean(),
    ]);
    const legacyMapped = fromLegacyColl.map(mapLegacyAiGeneratorDoc).filter(Boolean);
    const items = [...fromMaster, ...legacyMapped].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    );
    const grouped = groupAiGeneratorRecords(items);

    return res.json({
      success: true,
      data: { grouped, total: items.length },
    });
  } catch (error) {
    console.error('getAllGeneratorRecords error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch records.',
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

    let record = await AiToolGeneration.findOne({
      _id: id,
      ...buildGeneratorMongoQuery({}),
    }).lean();
    if (!record) {
      const leg = await AIGeneratorRecord.findById(id).lean();
      record = mapLegacyAiGeneratorDoc(leg);
    }
    if (!record) {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }

    const bodyText = record.generatedContent || record.content || '';

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="ai-generator-${String(record._id)}.pdf"`,
      );
      res.send(pdfBuffer);
    });

    doc.fontSize(18).text('AI Generator Record', { align: 'center' }).moveDown(1);
    doc.fontSize(12).text(`Tool: ${record.toolDisplayName || record.toolName}`);
    doc.text(`Class: ${record.classLabel}`);
    doc.text(`Subject: ${record.subject}`);
    doc.text(`Topic: ${record.topic || 'General'}`);
    doc.text(`Subtopic: ${record.subtopic}`);
    doc.text(`Created At: ${new Date(record.createdAt).toLocaleString()}`).moveDown(1);
    doc.fontSize(11).text(bodyText, { align: 'left' });
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

    const filter = { isActive: true };
    if (board) filter.board = boardMongoMatch(board);
    const classFilter = buildClassLabelFilter(classLabel);
    const subjectFilter = buildCaseInsensitiveExactFilter(subject);
    const topicFilter = buildCaseInsensitiveExactFilter(topicName);
    if (classLabel) filter.classLabel = classFilter || normalizeClassLabelForTopics(classLabel);
    if (subject) filter.subject = subjectFilter || subject;
    if (topicName) filter.topicName = topicFilter || topicName;

    const rows = await AiToolTopic.find(filter)
      .select('board classLabel subject label topicName subTopic')
      .lean();

    const unique = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));

    return res.json({
      success: true,
      data: {
        topics: unique(rows.map((r) => r.topicName)),
        subTopics: unique(rows.map((r) => r.subTopic)),
        labels: unique(rows.map((r) => r.label)),
      },
    });
  } catch (error) {
    console.error('getManagedTopicTaxonomy error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch managed topics.' });
  }
}
