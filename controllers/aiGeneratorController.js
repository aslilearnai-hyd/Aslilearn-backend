import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import AiToolGeneration from '../models/AiToolGeneration.js';
import AIGeneratorRecord from '../models/AIGeneratorRecord.js';
import AiToolTopic from '../models/AiToolTopic.js';
import { generateTeacherTool } from '../services/gemini-service.js';

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
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
  if (className) query.classLabel = className;
  if (subjectName) query.subject = subjectName;
  if (topicName !== undefined && topicName !== '') query.topic = topicName;
  if (subtopicName) query.subtopic = subtopicName;
  return query;
}

function buildLegacyAiGeneratorsQuery({
  toolSlug,
  className,
  subjectName,
  topicName,
  subtopicName,
}) {
  const query = {};
  if (toolSlug) query.toolSlug = toolSlug;
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

function groupAiGeneratorRecords(items) {
  const toolMap = new Map();

  for (const record of items) {
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

    let classNode = toolNode.classes.find((x) => x.className === record.classLabel);
    if (!classNode) {
      classNode = { className: record.classLabel, subjects: [] };
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

    const extraParams = req.body.extraParams || {};
    const generatedContent = await generateTeacherTool(toolSlug, {
      toolDisplayName,
      gradeLevel: className,
      subject: subjectName,
      topic: topicName || 'General',
      subTopic: subtopicName,
      ...extraParams,
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
        createdByName: getRequestUserName(req),
        createdByRole: 'super-admin',
        extraParams: req.body.extraParams || {},
      },
      ...(teacherId ? { teacherId } : {}),
    });

    const lean = record.toObject();
    return res.status(201).json({
      success: true,
      data: {
        ...lean,
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
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate and save content.',
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
    const className = normalizeText(req.query.className);
    const subjectName = normalizeText(req.query.subjectName);
    const topicName = normalizeText(req.query.topicName);
    const subtopicName = normalizeText(req.query.subtopicName);

    const mongoQuery = buildGeneratorMongoQuery({
      toolSlug,
      className,
      subjectName,
      topicName,
      subtopicName,
    });
    const legacyQuery = buildLegacyAiGeneratorsQuery({
      toolSlug,
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
    if (board) filter.board = board;
    if (classLabel) filter.classLabel = classLabel;
    if (subject) filter.subject = subject;
    if (topicName) filter.topicName = topicName;

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
