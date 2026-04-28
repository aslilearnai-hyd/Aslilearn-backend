import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { verifyToken, authorizeRoles } from '../middleware/auth.js';
import AiContentEngineSource from '../models/AiContentEngineSource.js';
import AiContentEngineChunk from '../models/AiContentEngineChunk.js';
import { processPdfSourceWithModels, runHybridRagQuery } from '../services/pdf-rag-service.js';
import { uploadPdfToConfiguredStorage, deleteFromConfiguredStorage } from '../services/cloud-storage.js';
import { isPdfQueueEnabled } from '../queues/pdfProcessingQueue.js';

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
      const uploaderId = req.userId || req.user?.id || req.user?._id;
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'PDF file is required' });
      }
      if (!subject || !classInput || !chapter) {
        return res.status(400).json({ success: false, message: 'subject, class and chapter are required' });
      }
      if (!uploaderId || !mongoose.Types.ObjectId.isValid(String(uploaderId))) {
        return res.status(400).json({ success: false, message: 'Invalid authenticated user for upload.' });
      }

      const fileUrl = `/uploads/pdf-knowledge/${req.file.filename}`;
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
        topic: String(topic || chapter || '').trim(),
        subTopic: String(subTopic || '').trim(),
        toolType: String(toolType || '').trim(),
        uploadedBy: String(uploaderId),
        uploadedByRole: toUploadedByRole(req.user?.role),
      });

      return res.status(201).json({
        success: true,
        data: {
          id: source._id,
          fileName: source.originalName,
          subject: source.subject,
          class: source.classLabel,
          chapter: source.chapter,
          uploadedBy: source.uploadedBy,
          uploadDate: source.uploadDate,
          processingStatus: source.processingStatus,
        },
      });
    } catch (error) {
      console.error('AI Content Engine upload error:', error);
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
    if (runAsync) {
      // Keep AI Content Engine processing isolated from shared queue schema.
      const queued = { enqueued: false, jobId: null };
      if (!queued.enqueued) {
        processPdfSourceWithModels(sourcePdfId, {
          sourceModel: AiContentEngineSource,
          chunkModel: AiContentEngineChunk,
        }).catch((err) => {
          console.error('Async PDF process failed:', err.message);
        });
      }
      return res.json({
        success: true,
        data: {
          sourceId: sourcePdfId,
          status: 'processing-started',
          queueEnabled: isPdfQueueEnabled(),
          jobId: queued.jobId || null,
        },
      });
    }
    const result = await processPdfSourceWithModels(sourcePdfId, {
      sourceModel: AiContentEngineSource,
      chunkModel: AiContentEngineChunk,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Processing failed' });
  }
});

// GET /api/pdf/list
router.get('/pdf/list', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const { subject, class: classInput, status } = req.query;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const filter = {
      ...(subject ? { subject: String(subject).trim() } : {}),
      ...(classInput ? { classLabel: toClassLabel(classInput) } : {}),
      ...(status ? { processingStatus: String(status).trim() } : {}),
    };
    const total = await AiContentEngineSource.countDocuments(filter);
    const docs = await AiContentEngineSource.find(filter)
      .sort({ uploadDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('originalName fileUrl subject classLabel chapter topic subTopic toolType uploadedBy uploadedByRole uploadDate processingStatus chunkCount')
      .lean();
    return res.json({
      success: true,
      data: docs,
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

// DELETE /api/pdf/:id
router.delete('/pdf/:id', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const source = await AiContentEngineSource.findById(req.params.id);
    if (!source) {
      return res.status(404).json({ success: false, message: 'PDF source not found' });
    }
    await AiContentEngineChunk.deleteMany({ sourcePdfId: source._id });
    await deleteFromConfiguredStorage({
      storageKey: source.storageKey,
      fileUrl: source.fileUrl,
      storageProvider: source.storageProvider,
    });
    await AiContentEngineSource.findByIdAndDelete(source._id);
    return res.json({ success: true, message: 'PDF source and chunks deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Delete failed' });
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

