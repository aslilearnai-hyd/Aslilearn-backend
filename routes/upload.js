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
import UploadAsset from '../models/UploadAsset.js';
import { isAllowedUploadMetadata, matchesUploadBytes } from '../utils/upload-validation.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    const mime = String(file.mimetype || '');
    if (!isAllowedUploadMetadata(file.originalname, mime)) {
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
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file provided. Choose a file and try again.',
        });
      }

      const fileUrl = `/uploads/content/${req.file.filename}`;
      const handle = await fs.promises.open(req.file.path, 'r');
      let header;
      try {
        const buffer = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        header = buffer.subarray(0, bytesRead);
      } finally { await handle.close(); }
      if (!matchesUploadBytes(req.file.filename, header)) {
        await fs.promises.unlink(req.file.path);
        return res.status(400).json({ success: false, message: 'File contents do not match the declared type.' });
      }
      await UploadAsset.create({ path: fileUrl, ownerId: req.userId, ownerRole: req.user.role });
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
      if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
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
