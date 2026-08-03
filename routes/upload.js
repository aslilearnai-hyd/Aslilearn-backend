/**
 * Authenticated file upload for homework (teacher assign / student submit)
 * and other school document attachments. Clients call POST /api/upload.
 */
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_EXT = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]);

const ALLOWED_MIME_RE =
  /^(application\/(pdf|msword|vnd\.|octet-stream)|text\/plain|image\/(png|jpeg|webp|jpg))/i;

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/content');
    try {
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      fs.accessSync(uploadDir, fs.constants.W_OK);
    } catch (e) {
      console.error('[upload] Cannot use uploads directory:', uploadDir, e?.code || e?.message);
      return cb(
        new Error(
          'Upload directory is missing or not writable on the server. Contact support if this continues.'
        )
      );
    }
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname || '').toLowerCase() || '';
    const role = String(req.user?.role || 'user').replace(/[^a-z0-9_-]/gi, '');
    cb(null, `homework-${role}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — homework PDFs
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '');
    if (!ALLOWED_EXT.has(ext) && !ALLOWED_MIME_RE.test(mime)) {
      return cb(
        new Error(
          'Unsupported file type. Use PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT, or a common image format.'
        )
      );
    }
    cb(null, true);
  },
});

router.post(
  '/',
  verifyToken,
  authorizeRoles('teacher', 'student', 'admin', 'super-admin'),
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error('Upload multer error:', err?.code || err?.message, err);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File too large. Maximum size is 25MB.',
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error',
          code: err.code || undefined,
        });
      }
      next();
    });
  },
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file provided. Choose a file and try again.',
        });
      }

      const fileUrl = `/uploads/content/${req.file.filename}`;
      console.log('File uploaded via /api/upload:', {
        fileUrl,
        role: req.user?.role,
        size: req.file.size,
        originalName: req.file.originalname,
      });

      // Clients expect `url` and/or `fileUrl`
      res.json({
        success: true,
        url: fileUrl,
        fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        message: 'File uploaded successfully',
      });
    } catch (error) {
      console.error('Failed to finalize upload:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload file',
        error: error.message,
      });
    }
  }
);

export default router;
