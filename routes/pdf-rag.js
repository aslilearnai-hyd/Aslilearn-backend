import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { verifyToken, authorizeRoles } from '../middleware/auth.js';
import AiContentEngineSource from '../models/AiContentEngineSource.js';
import AiContentEngineChunk from '../models/AiContentEngineChunk.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import { processPdfSourceWithModels, runHybridRagQuery } from '../services/pdf-rag-service.js';
import { uploadPdfToConfiguredStorage, deleteFromConfiguredStorage } from '../services/cloud-storage.js';
import { isPdfQueueEnabled } from '../queues/pdfProcessingQueue.js';
import {
  classifyPdfContentWithFallback,
  extractTextFromPdfBuffer,
  resolveToolSlugFromLabel,
  getToolLabelFromSlug,
  validateToolSpecificStructuredContent,
  buildRenderableContent,
  regenerateStructuredContentForTool,
  buildDeterministicQuestionSetFromText,
} from '../services/ai-content-engine-service.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfStorage = multer.diskStorage({
  destination: function destination(req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/pdf-knowledge');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function filename(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `pdf-${uniqueSuffix}${ext}`);
  },
});

const pdfUpload = multer({
  storage: pdfStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (String(file.mimetype || '').includes('pdf')) return cb(null, true);
    return cb(new Error('Only PDF files are allowed'));
  },
});

const toClassLabel = (classValue) => {
  const raw = String(classValue || '').trim();
  if (!raw) return '';
  if (/^class\s+/i.test(raw)) return raw.replace(/\s+/g, ' ').trim();
  if (/^\d+$/.test(raw)) return `Class ${raw}`;
  return raw;
};

const toUploadedByRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'super-admin' || normalized === 'admin' || normalized === 'teacher') {
    return normalized;
  }
  return 'admin';
};

const resolveAuthenticatedUserId = (req) => {
  const candidates = [
    req.userId,
    req.user?.userId,
    req.user?.id,
    req.user?._id,
    req.user?.sub,
  ];
  for (const value of candidates) {
    const s = String(value || '').trim();
    if (s) return s;
  }
  return '';
};

const normalizeForMatch = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isSemanticTextMatch = (selectedValue, detectedValue) => {
  const selected = normalizeForMatch(selectedValue);
  const detected = normalizeForMatch(detectedValue);
  if (!selected || !detected) return true;
  if (selected === detected) return true;
  return selected.includes(detected) || detected.includes(selected);
};

const validateSubjectTopicMatch = ({
  selectedSubject,
  selectedTopic,
  detectedSubject,
  detectedTopic,
  subjectTopicValidation,
}) => {
  const geminiSubjectMatched = typeof subjectTopicValidation?.subjectMatched === 'boolean'
    ? subjectTopicValidation.subjectMatched
    : null;
  const geminiTopicMatched = typeof subjectTopicValidation?.topicMatched === 'boolean'
    ? subjectTopicValidation.topicMatched
    : null;

  const fallbackSubjectMatch = isSemanticTextMatch(selectedSubject, detectedSubject);
  const fallbackTopicMatch = isSemanticTextMatch(selectedTopic, detectedTopic);

  const subjectMatched = geminiSubjectMatched === null ? fallbackSubjectMatch : geminiSubjectMatched;
  const topicMatched = geminiTopicMatched === null ? fallbackTopicMatch : geminiTopicMatched;

  return {
    subjectMatched,
    topicMatched,
    reason: String(subjectTopicValidation?.reason || '').trim(),
    confidence: Number(subjectTopicValidation?.confidence || 0),
  };
};

const buildAiToolContentFromPdfSource = (source) => {
  const sections = [];
  sections.push(`Tool: ${getToolLabelFromSlug(String(source.toolType || '').trim()) || source.toolType || '-'}`);
  sections.push(`Class: ${String(source.classLabel || '').trim() || '-'}`);
  sections.push(`Subject: ${String(source.subject || '').trim() || '-'}`);
  sections.push(`Topic: ${String(source.topic || source.chapter || '').trim() || '-'}`);
  sections.push(`Subtopic: ${String(source.subTopic || '').trim() || '-'}`);

  const renderContent = source.renderContent && typeof source.renderContent === 'object'
    ? source.renderContent
    : source.structuredContent;
  const jsonBlock = renderContent ? JSON.stringify(renderContent, null, 2) : '';
  if (jsonBlock) {
    sections.push('Content:');
    sections.push(jsonBlock);
  }

  return sections.join('\n');
};

const syncPdfSourceToAiToolData = async (source) => {
  if (!source?._id) return;
  const toolSlug = String(source.toolType || '').trim();
  const textContent = buildAiToolContentFromPdfSource(source);
  const payload = {
    toolName: toolSlug,
    toolDisplayName: getToolLabelFromSlug(toolSlug) || toolSlug,
    sourceType: 'ai_pdf',
    classLabel: String(source.classLabel || '').trim(),
    subject: String(source.subject || '').trim(),
    topic: String(source.topic || source.chapter || '').trim(),
    subtopic: String(source.subTopic || '').trim(),
    section: '',
    content: textContent,
    generatedContent: textContent,
    pdfFileUrl: String(source.fileUrl || '').trim(),
    pdfFileName: String(source.originalName || '').trim(),
    generatedBy: source.uploadedBy ?? null,
    status: String(source.processingStatus || 'pending'),
    metadata: {
      contentEngineSourceId: String(source._id),
      aiPdfSourceId: String(source._id),
      structuredContent: source.structuredContent,
      renderContent: source.renderContent,
      contentType: String(source.contentType || '').trim(),
      approvalStatus: String(source.approvalStatus || 'pending'),
      processingStatus: String(source.processingStatus || 'pending'),
      chunkCount: source.chunkCount || 0,
      processingError: String(source.processingError || '').trim(),
      uploadedByRole: String(source.uploadedByRole || '').trim(),
      geminiDetected: source.geminiDetected,
      validation: source.validation,
    },
  };

  if (source.uploadedBy && mongoose.Types.ObjectId.isValid(source.uploadedBy)) {
    payload.teacherId = source.uploadedBy;
  }

  await AiToolGeneration.findOneAndUpdate(
    {
      $or: [
        { 'metadata.contentEngineSourceId': String(source._id) },
        { 'metadata.aiPdfSourceId': String(source._id) },
      ],
    },
    { $set: payload },
    { upsert: true, new: true },
  );
};

function mapMasterPdfToListRow(doc) {
  const m = doc.metadata || {};
  return {
    _id: doc._id,
    originalName: doc.pdfFileName || m.originalName || '',
    fileUrl: doc.pdfFileUrl || '',
    subject: doc.subject,
    classLabel: doc.classLabel,
    chapter: doc.topic || '',
    topic: doc.topic || '',
    subTopic: doc.subtopic || '',
    processingStatus: m.processingStatus || doc.status || 'pending',
    approvalStatus: m.approvalStatus || 'pending',
    toolType: doc.toolName,
    contentType: m.contentType || '',
    structuredContent: m.structuredContent || {},
    renderContent: m.renderContent || {},
    chunkCount: m.chunkCount ?? 0,
    uploadDate: doc.createdAt,
    updatedAt: doc.updatedAt,
    uploadedBy: doc.generatedBy,
    uploadedByRole: m.uploadedByRole || '',
    geminiDetected: m.geminiDetected,
    validation: m.validation,
  };
}

/** Legacy rows only in aicontentenginesources (no master in aitoolgenerations yet). */
function mapSourcePdfToListRow(source) {
  if (!source) return null;
  return {
    _id: source._id,
    originalName: source.originalName || '',
    fileUrl: source.fileUrl || '',
    subject: source.subject,
    classLabel: source.classLabel,
    chapter: source.chapter || source.topic || '',
    topic: source.topic || '',
    subTopic: source.subTopic || '',
    processingStatus: source.processingStatus || 'pending',
    approvalStatus: source.approvalStatus || 'pending',
    toolType: source.toolType,
    contentType: source.contentType || '',
    structuredContent: source.structuredContent || {},
    renderContent: source.renderContent || {},
    chunkCount: source.chunkCount ?? 0,
    uploadDate: source.uploadDate || source.createdAt,
    updatedAt: source.updatedAt,
    uploadedBy: source.uploadedBy,
    uploadedByRole: source.uploadedByRole || '',
    geminiDetected: source.geminiDetected,
    validation: source.validation,
  };
}

async function resolvePdfMasterAndSource(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return { master: null, source: null };
  const master = await AiToolGeneration.findOne({ _id: id, sourceType: 'ai_pdf' }).lean();
  if (master) {
    const ceId = master.metadata?.contentEngineSourceId || master.metadata?.aiPdfSourceId;
    if (ceId) {
      const source = await AiContentEngineSource.findById(ceId).lean();
      return { master, source };
    }
    return { master, source: null };
  }
  const source = await AiContentEngineSource.findById(id).lean();
  if (!source) return { master: null, source: null };
  const m = await AiToolGeneration.findOne({
    $or: [
      { 'metadata.contentEngineSourceId': String(source._id) },
      { 'metadata.aiPdfSourceId': String(source._id) },
    ],
  }).lean();
  return { master: m, source };
}

/** Resolve request id to AiContentEngineSource _id (handles master row id from aitoolgenerations). */
async function resolveContentEngineSourceId(rawId) {
  if (!mongoose.Types.ObjectId.isValid(rawId)) return null;
  const direct = await AiContentEngineSource.findById(rawId).select('_id').lean();
  if (direct) return String(direct._id);
  const { source } = await resolvePdfMasterAndSource(rawId);
  return source?._id ? String(source._id) : null;
}

// POST /api/pdf/upload
router.post(
  '/pdf/upload',
  verifyToken,
  authorizeRoles('teacher', 'admin', 'super-admin'),
  (req, res, next) => {
    pdfUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      return res.status(400).json({
        success: false,
        message: err.message || 'PDF upload failed',
      });
    });
  },
  async (req, res) => {
    try {
      const { subject, class: classInput, chapter, topic, subTopic, toolType } = req.body;
      const uploaderId = resolveAuthenticatedUserId(req);
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'PDF file is required' });
      }
      if (!subject || !classInput || !chapter) {
        return res.status(400).json({ success: false, message: 'subject, class and chapter are required' });
      }
      if (!uploaderId) {
        console.error('AI PDF upload auth id missing:', {
          reqUserId: req.userId,
          reqUser: req.user,
        });
        return res.status(400).json({ success: false, message: 'Invalid authenticated user for upload.' });
      }

      const fileUrl = `/uploads/pdf-knowledge/${req.file.filename}`;
      let extractedText = '';
      try {
        extractedText = await extractTextFromPdfBuffer(fs.readFileSync(req.file.path));
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid or corrupted PDF. Could not extract text.' });
      }
      if (!extractedText) {
        return res.status(400).json({ success: false, message: 'Empty extraction from PDF. Upload a readable educational PDF.' });
      }

      let analysis;
      try {
        analysis = await classifyPdfContentWithFallback(extractedText, {
          subject: String(subject || '').trim(),
          classLabel: toClassLabel(classInput),
          chapter: String(chapter || '').trim(),
          topic: String(topic || '').trim(),
          subTopic: String(subTopic || '').trim(),
          toolType: String(toolType || '').trim(),
        });
      } catch (geminiError) {
        return res.status(502).json({
          success: false,
          message: `Gemini analysis failed: ${geminiError.message || 'Unknown error'}`,
        });
      }

      if (analysis.isFallback) {
        const subjectMentioned = Boolean(analysis.fallbackValidation?.subjectMentioned);
        const topicMentioned = Boolean(analysis.fallbackValidation?.topicMentioned);
        if (!subjectMentioned || !topicMentioned) {
          return res.status(400).json({
            success: false,
            message: 'PDF content does not appear to match selected subject/topic in fallback validation mode.',
            data: {
              selectedSubject: String(subject || '').trim(),
              selectedTopic: String(topic || chapter || '').trim(),
              subjectMentioned,
              topicMentioned,
            },
          });
        }
      }

      const detectedToolSlug = resolveToolSlugFromLabel(analysis.bestMatchingToolLabel);
      if (!detectedToolSlug || detectedToolSlug !== String(toolType || '').trim()) {
        return res.status(400).json({
          success: false,
          message: 'Uploaded PDF does not match the selected tool type. Please upload correct content.',
          data: {
            selectedTool: getToolLabelFromSlug(String(toolType || '').trim()),
            detectedTool: analysis.bestMatchingToolLabel || 'Unknown',
          },
        });
      }

      const selectedSubject = String(subject || '').trim();
      const selectedTopic = String(topic || chapter || '').trim();
      const detectedSubject = String(analysis.subject || '').trim();
      const detectedTopic = String(analysis.topic || '').trim();
      const subjectTopicMatch = validateSubjectTopicMatch({
        selectedSubject,
        selectedTopic,
        detectedSubject,
        detectedTopic,
        subjectTopicValidation: analysis.subjectTopicValidation,
      });
      const subjectMatched = subjectTopicMatch.subjectMatched;
      const topicMatched = subjectTopicMatch.topicMatched;
      if (!subjectMatched || !topicMatched) {
        return res.status(400).json({
          success: false,
          message: 'Uploaded PDF content does not match selected subject/topic. Please upload correct content.',
          data: {
            selectedSubject,
            detectedSubject: detectedSubject || 'Unknown',
            selectedTopic,
            detectedTopic: detectedTopic || 'Unknown',
            geminiReason: subjectTopicMatch.reason || 'No reason returned by Gemini.',
            geminiConfidence: subjectTopicMatch.confidence,
          },
        });
      }

      let structuredValidation = validateToolSpecificStructuredContent(
        detectedToolSlug,
        analysis.structuredContent,
        analysis.contentType,
        extractedText,
      );
      if (!structuredValidation.valid && detectedToolSlug === 'worksheet-mcq-generator') {
        try {
          const regenerated = await regenerateStructuredContentForTool(extractedText, { toolType: detectedToolSlug });
          structuredValidation = validateToolSpecificStructuredContent(
            detectedToolSlug,
            regenerated.structuredContent,
            regenerated.contentType || analysis.contentType,
            extractedText,
          );
          if (structuredValidation.valid) {
            analysis.structuredContent = structuredValidation.normalizedStructuredContent || regenerated.structuredContent;
            analysis.contentType = structuredValidation.normalizedType || regenerated.contentType || analysis.contentType;
          }
        } catch {
          const deterministic = buildDeterministicQuestionSetFromText(extractedText, 20);
          if (Array.isArray(deterministic.questions) && deterministic.questions.length > 0) {
            structuredValidation = validateToolSpecificStructuredContent(
              detectedToolSlug,
              deterministic,
              analysis.contentType || 'Worksheet',
              extractedText,
            );
            if (structuredValidation.valid) {
              analysis.structuredContent = structuredValidation.normalizedStructuredContent || deterministic;
              analysis.contentType = structuredValidation.normalizedType || analysis.contentType || 'Worksheet';
            }
          }
        }
      }
      if (!structuredValidation.valid) {
        return res.status(400).json({
          success: false,
          message: structuredValidation.message || 'Unsupported content type for selected tool.',
          data: {
            selectedTool: getToolLabelFromSlug(String(toolType || '').trim()),
            detectedContentType: String(analysis.contentType || '').trim(),
          },
        });
      }

      let uploaded = {
        fileName: req.file.filename,
        fileUrl,
        storageProvider: 'local',
        storageKey: '',
        shouldDeleteLocal: false,
      };
      try {
        uploaded = await uploadPdfToConfiguredStorage({
          localPath: req.file.path,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
        });
      } catch (storageError) {
        console.error('Cloud upload failed, keeping local storage:', storageError.message);
      }

      if (uploaded.shouldDeleteLocal) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore
        }
      }
      const source = await AiContentEngineSource.create({
        fileName: uploaded.fileName,
        originalName: req.file.originalname,
        fileUrl: uploaded.fileUrl,
        storageProvider: uploaded.storageProvider,
        storageKey: uploaded.storageKey,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        subject: String(subject).trim(),
        classLabel: toClassLabel(classInput),
        chapter: String(chapter).trim(),
        topic: String(topic || analysis.topic || chapter || '').trim(),
        subTopic: String(subTopic || analysis.subTopic || '').trim(),
        toolType: String(toolType || detectedToolSlug || '').trim(),
        contentType: String(structuredValidation.normalizedType || analysis.contentType || '').trim(),
        structuredContent: structuredValidation.normalizedStructuredContent || analysis.structuredContent || {},
        renderContent: buildRenderableContent(
          String(toolType || detectedToolSlug || '').trim(),
          String(structuredValidation.normalizedType || analysis.contentType || '').trim(),
          structuredValidation.normalizedStructuredContent || analysis.structuredContent || {},
        ),
        geminiDetected: {
          classLabel: String(analysis.classLabel || ''),
          subject: String(analysis.subject || ''),
          topic: String(analysis.topic || ''),
          subTopic: String(analysis.subTopic || ''),
          bestMatchingToolLabel: String(analysis.bestMatchingToolLabel || ''),
          contentType: String(analysis.contentType || ''),
        },
        analysisStatus: 'analyzed',
        approvalStatus: 'pending',
        validation: {
          toolMatched: true,
          mismatchReason: analysis.isFallback ? String(analysis.fallbackReason || 'Fallback analysis mode') : '',
          subjectTopicMatched: Boolean(subjectMatched && topicMatched),
          subjectTopicReason: subjectTopicMatch.reason || '',
          subjectTopicConfidence: subjectTopicMatch.confidence || 0,
        },
        uploadedBy: uploaderId,
        uploadedByRole: toUploadedByRole(req.user?.role),
      });

      try {
        await syncPdfSourceToAiToolData(source);
      } catch (syncError) {
        console.error('AI PDF -> AiToolGeneration sync failed (non-fatal):', syncError);
      }

      const master = await AiToolGeneration.findOne({
        $or: [
          { 'metadata.contentEngineSourceId': String(source._id) },
          { 'metadata.aiPdfSourceId': String(source._id) },
        ],
      })
        .select('_id')
        .lean();

      return res.status(201).json({
        success: true,
        data: {
          id: master?._id || source._id,
          sourcePdfId: source._id,
          fileName: source.originalName,
          subject: source.subject,
          class: source.classLabel,
          chapter: source.chapter,
          topic: source.topic,
          subTopic: source.subTopic,
          toolType: source.toolType,
          contentType: source.contentType,
          approvalStatus: source.approvalStatus,
          uploadedBy: source.uploadedBy,
          uploadDate: source.uploadDate,
          processingStatus: source.processingStatus,
          analysisMode: analysis.analysisMode || 'gemini',
        },
      });
    } catch (error) {
      console.error('AI PDF upload error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Upload failed' });
    }
  }
);

// POST /api/pdf/process
router.post('/pdf/process', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const { sourcePdfId, async: runAsync } = req.body;
    if (!sourcePdfId) {
      return res.status(400).json({ success: false, message: 'sourcePdfId is required' });
    }
    const resolvedSourceId = await resolveContentEngineSourceId(String(sourcePdfId));
    if (!resolvedSourceId) {
      return res.status(404).json({ success: false, message: 'PDF source not found' });
    }
    if (runAsync) {
      // Keep AI PDF processing isolated from shared queue schema.
      const queued = { enqueued: false, jobId: null };
      if (!queued.enqueued) {
        processPdfSourceWithModels(resolvedSourceId, {
          sourceModel: AiContentEngineSource,
          chunkModel: AiContentEngineChunk,
        })
          .then(async () => {
            const refreshed = await AiContentEngineSource.findById(resolvedSourceId);
            if (refreshed) {
              try {
                await syncPdfSourceToAiToolData(refreshed);
              } catch (syncError) {
                console.error('AI PDF async post-process master sync failed (non-fatal):', syncError);
              }
            }
          })
          .catch((err) => {
            console.error('Async PDF process failed:', err.message);
          });
      }
      return res.json({
        success: true,
        data: {
          sourceId: resolvedSourceId,
          status: 'processing-started',
          queueEnabled: isPdfQueueEnabled(),
          jobId: queued.jobId || null,
        },
      });
    }
    const result = await processPdfSourceWithModels(resolvedSourceId, {
      sourceModel: AiContentEngineSource,
      chunkModel: AiContentEngineChunk,
    });
    const refreshed = await AiContentEngineSource.findById(resolvedSourceId);
    if (refreshed) {
      try {
        await syncPdfSourceToAiToolData(refreshed);
      } catch (syncError) {
        console.error('AI PDF post-process master sync failed (non-fatal):', syncError);
      }
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Processing failed' });
  }
});

// GET /api/pdf/list — masters in aitoolgenerations + legacy-only aicontentenginesources
router.get('/pdf/list', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const { subject, class: classInput, status } = req.query;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const filter = { sourceType: 'ai_pdf' };
    if (subject) filter.subject = String(subject).trim();
    if (classInput) filter.classLabel = toClassLabel(classInput);
    if (status) {
      filter.$or = [
        { status: String(status).trim() },
        { 'metadata.processingStatus': String(status).trim() },
      ];
    }

    const masterDocs = await AiToolGeneration.find(filter).sort({ createdAt: -1 }).lean();
    const linkedIds = [
      ...new Set(
        masterDocs
          .flatMap((m) => [m.metadata?.contentEngineSourceId, m.metadata?.aiPdfSourceId].filter(Boolean))
          .map(String)
          .filter((id) => mongoose.Types.ObjectId.isValid(id)),
      ),
    ].map((id) => new mongoose.Types.ObjectId(id));

    const orphanFilter = {};
    if (subject) orphanFilter.subject = String(subject).trim();
    if (classInput) orphanFilter.classLabel = toClassLabel(classInput);
    if (status) orphanFilter.processingStatus = String(status).trim();
    if (linkedIds.length > 0) {
      orphanFilter._id = { $nin: linkedIds };
    }

    const orphanDocs = await AiContentEngineSource.find(orphanFilter).sort({ uploadDate: -1 }).lean();

    const combined = [
      ...masterDocs.map(mapMasterPdfToListRow),
      ...orphanDocs.map(mapSourcePdfToListRow).filter(Boolean),
    ].sort((a, b) => {
      const ta = new Date(a.uploadDate || a.updatedAt || 0).getTime();
      const tb = new Date(b.uploadDate || b.updatedAt || 0).getTime();
      return tb - ta;
    });

    const total = combined.length;
    const data = combined.slice((page - 1) * limit, page * limit);
    return res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch list' });
  }
});

// DELETE /api/pdf/:id — accepts master (aitoolgenerations) id or legacy content-engine source id
router.delete('/pdf/:id', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const { master, source } = await resolvePdfMasterAndSource(req.params.id);
    const src = source;
    if (!src && !master) {
      return res.status(404).json({ success: false, message: 'PDF source not found' });
    }
    if (src) {
      await AiContentEngineChunk.deleteMany({ sourcePdfId: src._id });
      await deleteFromConfiguredStorage({
        storageKey: src.storageKey,
        fileUrl: src.fileUrl,
        storageProvider: src.storageProvider,
      });
      await AiContentEngineSource.findByIdAndDelete(src._id);
    }
    if (master) {
      await AiToolGeneration.findByIdAndDelete(master._id);
    } else if (src) {
      await AiToolGeneration.deleteMany({
        $or: [
          { 'metadata.contentEngineSourceId': String(src._id) },
          { 'metadata.aiPdfSourceId': String(src._id) },
        ],
      });
    }
    return res.json({ success: true, message: 'PDF source and chunks deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Delete failed' });
  }
});

// GET /api/pdf/:id
router.get('/pdf/:id', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const { master, source } = await resolvePdfMasterAndSource(req.params.id);
    if (master && source) {
      return res.json({
        success: true,
        data: {
          ...source,
          _id: master._id,
          structuredContent: master.metadata?.structuredContent ?? source.structuredContent,
          renderContent: master.metadata?.renderContent ?? source.renderContent,
        },
      });
    }
    if (source) {
      return res.json({ success: true, data: source });
    }
    if (master) {
      const m = master.metadata || {};
      return res.json({
        success: true,
        data: {
          _id: master._id,
          originalName: master.pdfFileName,
          fileUrl: master.pdfFileUrl,
          subject: master.subject,
          classLabel: master.classLabel,
          chapter: master.topic,
          topic: master.topic,
          subTopic: master.subtopic,
          toolType: master.toolName,
          contentType: m.contentType,
          structuredContent: m.structuredContent || {},
          renderContent: m.renderContent || {},
          approvalStatus: m.approvalStatus,
          processingStatus: m.processingStatus,
          chunkCount: m.chunkCount,
          uploadDate: master.createdAt,
        },
      });
    }
    return res.status(404).json({ success: false, message: 'PDF source not found' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Fetch failed' });
  }
});

// PATCH /api/pdf/:id
router.patch('/pdf/:id', verifyToken, authorizeRoles('admin', 'super-admin'), async (req, res) => {
  try {
    const { structuredContent, contentType, topic, subTopic, toolType } = req.body || {};
    const { master, source } = await resolvePdfMasterAndSource(req.params.id);
    const existing = source;
    if (!existing) {
      return res.status(404).json({ success: false, message: 'PDF source not found' });
    }
    const effectiveToolType = toolType !== undefined ? String(toolType || '').trim() : String(existing.toolType || '').trim();
    const effectiveContentType = contentType !== undefined ? String(contentType || '').trim() : String(existing.contentType || '').trim();
    const effectiveStructuredContent = structuredContent !== undefined ? structuredContent : existing.structuredContent;
    const structuredValidation = validateToolSpecificStructuredContent(
      effectiveToolType,
      effectiveStructuredContent,
      effectiveContentType,
    );
    if (!structuredValidation.valid) {
      return res.status(400).json({ success: false, message: structuredValidation.message || 'Invalid content for selected tool.' });
    }
    const update = {
      ...(structuredContent && typeof structuredContent === 'object'
        ? { structuredContent: structuredValidation.normalizedStructuredContent || structuredContent }
        : {}),
      ...(contentType ? { contentType: String(structuredValidation.normalizedType || contentType).trim() } : {}),
      ...(topic !== undefined ? { topic: String(topic || '').trim() } : {}),
      ...(subTopic !== undefined ? { subTopic: String(subTopic || '').trim() } : {}),
      ...(toolType !== undefined ? { toolType: String(toolType || '').trim() } : {}),
    };
    const nextTool = String(update.toolType || effectiveToolType || '').trim();
    const nextType = String(update.contentType || effectiveContentType || '').trim();
    const nextStructured = update.structuredContent || structuredValidation.normalizedStructuredContent || effectiveStructuredContent || {};
    update.renderContent = buildRenderableContent(nextTool, nextType, nextStructured);
    const doc = await AiContentEngineSource.findByIdAndUpdate(existing._id, update, { new: true }).lean();
    try {
      await syncPdfSourceToAiToolData(doc);
    } catch (syncError) {
      console.error('AI PDF update sync failed (non-fatal):', syncError);
    }
    const out = master ? { ...doc, _id: master._id } : doc;
    return res.json({ success: true, data: out });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Update failed' });
  }
});

// PATCH /api/pdf/:id/review
router.patch('/pdf/:id/review', verifyToken, authorizeRoles('admin', 'super-admin'), async (req, res) => {
  try {
    const { action, comment, toolType } = req.body || {};
    if (!['approve', 'reject', 'reassign'].includes(String(action))) {
      return res.status(400).json({ success: false, message: 'action must be approve/reject/reassign' });
    }
    const { master, source } = await resolvePdfMasterAndSource(req.params.id);
    const existing = source;
    if (!existing) {
      return res.status(404).json({ success: false, message: 'PDF source not found' });
    }
    const update = {};
    if (action === 'approve') {
      const structuredValidation = validateToolSpecificStructuredContent(
        String(existing.toolType || '').trim(),
        existing.structuredContent,
        existing.contentType,
      );
      if (!structuredValidation.valid) {
        return res.status(400).json({ success: false, message: structuredValidation.message || 'Cannot approve invalid structured content.' });
      }
      update.approvalStatus = 'approved';
      update.approvedBy = resolveAuthenticatedUserId(req) || null;
      update.approvedAt = new Date();
      update.reviewComment = String(comment || '').trim();
      update.structuredContent = structuredValidation.normalizedStructuredContent || existing.structuredContent;
      update.contentType = String(structuredValidation.normalizedType || existing.contentType || '').trim();
      update.renderContent = buildRenderableContent(
        String(existing.toolType || '').trim(),
        String(update.contentType || existing.contentType || '').trim(),
        update.structuredContent,
      );
    } else if (action === 'reject') {
      update.approvalStatus = 'rejected';
      update.approvedBy = resolveAuthenticatedUserId(req) || null;
      update.approvedAt = new Date();
      update.reviewComment = String(comment || '').trim();
    } else {
      const reassignedTool = String(toolType || '').trim();
      const structuredValidation = validateToolSpecificStructuredContent(
        reassignedTool,
        existing.structuredContent,
        existing.contentType,
      );
      if (!structuredValidation.valid) {
        return res.status(400).json({ success: false, message: structuredValidation.message || 'Reassigned tool is not compatible with extracted content.' });
      }
      update.toolType = reassignedTool;
      update.contentType = String(structuredValidation.normalizedType || existing.contentType || '').trim();
      update.structuredContent = structuredValidation.normalizedStructuredContent || existing.structuredContent;
      update.renderContent = buildRenderableContent(
        reassignedTool,
        String(update.contentType || existing.contentType || '').trim(),
        update.structuredContent,
      );
      update.reviewComment = String(comment || '').trim();
    }
    const doc = await AiContentEngineSource.findByIdAndUpdate(existing._id, update, { new: true }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'PDF source not found' });
    }
    try {
      await syncPdfSourceToAiToolData(doc);
    } catch (syncError) {
      console.error('AI PDF review sync failed (non-fatal):', syncError);
    }
    const out = master ? { ...doc, _id: master._id } : doc;
    return res.json({ success: true, data: out });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Review action failed' });
  }
});

// POST /api/ai/rag-query
router.post('/ai/rag-query', verifyToken, authorizeRoles('student', 'teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const { query, subject, class: classInput, toolType } = req.body;
    if (!query || !String(query).trim()) {
      return res.status(400).json({ success: false, message: 'query is required' });
    }
    const result = await runHybridRagQuery({
      query: String(query).trim(),
      subject: String(subject || '').trim(),
      classLabel: toClassLabel(classInput),
      toolType: String(toolType || 'rag-query'),
      role: req.user.role,
      cacheKey: String(query).trim().slice(0, 120),
      metadata: { userId: req.userId, role: req.user.role },
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'RAG query failed' });
  }
});

export default router;

