import express from 'express';
import mongoose from 'mongoose';
import { verifyToken } from '../middleware/auth.js';
import {
  aiChatGlobalLimiter,
  aiChatPerUserLimiter,
  aiHeavyLimiter,
} from '../middleware/rate-limit.js';
import vidyaService from '../services/vidya-service.js';
import VidyaCallLog from '../models/VidyaCallLog.js';
import ChatSession from '../models/ChatSession.js';
import * as vidyaAiControl from '../controllers/vidyaAiControlController.js';
import * as vidyaStudent from '../controllers/vidyaStudentController.js';
import { requireVidyaSchoolAccess } from '../middleware/vidya-school-access.js';

const router = express.Router();

router.use(aiChatGlobalLimiter);

const studentTeacherVidya = [verifyToken, requireVidyaSchoolAccess];

const requestMeta = (req) => ({
  requestIp: req.ip || req.headers['x-forwarded-for'] || '',
  userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
});

router.post(
  '/vidya/control/query',
  verifyToken,
  aiChatPerUserLimiter,
  (req, res) => vidyaAiControl.postVidyaControlQuery(req, res),
);

router.get(
  '/vidya/control/history',
  verifyToken,
  async (req, res) => vidyaAiControl.getVidyaControlHistory(req, res),
);

router.delete(
  '/vidya/control/history',
  verifyToken,
  async (req, res) => vidyaAiControl.deleteVidyaControlHistory(req, res),
);

router.post(
  '/vidya/student/chat',
  ...studentTeacherVidya,
  aiChatPerUserLimiter,
  async (req, res) => vidyaStudent.postStudentMentorChat(req, res),
);

router.get(
  '/vidya/student/focus-card',
  ...studentTeacherVidya,
  async (req, res) => vidyaStudent.getStudentFocusCard(req, res),
);

router.post(
  '/vidya/student/proactive/delivered',
  ...studentTeacherVidya,
  async (req, res) => vidyaStudent.markProactiveDelivered(req, res),
);

router.post(
  '/ai-chat',
  ...studentTeacherVidya,
  aiChatPerUserLimiter,
  async (req, res) => {
    try {
      const { message, context, sessionId } = req.body || {};
      const result = await vidyaService.handleChat({
        userId: req.userId,
        role: req.user?.role,
        message,
        context: context || {},
        sessionId,
        ...requestMeta(req),
      });
      res.json(result);
    } catch (err) {
      const status = Number(err?.statusCode) || 500;
      res.status(status).json({
        success: false,
        retryable: Boolean(err?.retryable) || status >= 500,
        message: err?.message || 'Vidya is briefly unavailable. Please try again.',
      });
    }
  }
);

router.post(
  '/ai-chat/stream',
  ...studentTeacherVidya,
  aiChatPerUserLimiter,
  async (req, res) => {
    const { message, context, sessionId } = req.body || {};
    try {
      await vidyaService.handleStreamingChat({
        userId: req.userId,
        role: req.user?.role,
        message,
        context: context || {},
        sessionId,
        res,
        ...requestMeta(req),
      });
    } catch (err) {
      try {
        res.write(`event: error\n`);
        res.write(
          `data: ${JSON.stringify({
            message: err?.message || 'Vidya is briefly unavailable.',
            retryable: true,
          })}\n\n`
        );
        res.end();
      } catch (_) {}
    }
  }
);

router.post(
  '/ai-chat/analyze-image',
  ...studentTeacherVidya,
  aiHeavyLimiter,
  async (req, res) => {
    try {
      const { image, context } = req.body || {};
      if (!image) {
        return res.status(400).json({ success: false, message: 'Image is required' });
      }
      const base64Data = String(image).replace(/^data:image\/[a-z]+;base64,/, '');
      const result = await vidyaService.handleVisionAnalyse({
        userId: req.userId,
        role: req.user?.role,
        imageBase64: base64Data,
        context: context || '',
        ...requestMeta(req),
      });
      res.json({ success: true, ...result });
    } catch (err) {
      const status = Number(err?.statusCode) || 500;
      res.status(status).json({
        success: false,
        retryable: Boolean(err?.retryable) || status >= 500,
        message: err?.message || 'Vidya could not analyse the image.',
      });
    }
  }
);

router.get(
  '/users/:userId/chat-sessions',
  verifyToken,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const requesterId = String(req.userId || '');
      const role = String(req.user?.role || '');
      const isPrivileged = ['admin', 'super-admin'].includes(role);
      if (!isPrivileged && requesterId !== String(userId)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }
      const limit = Number(req.query.limit) || 30;
      const sessions = await vidyaService.listChatSessions({ userId, limit });
      res.json({ success: true, sessions });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to fetch chat sessions' });
    }
  }
);

router.get(
  '/chat-sessions/:sessionId',
  verifyToken,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        return res.status(400).json({ success: false, message: 'Invalid session id' });
      }
      const role = String(req.user?.role || '');
      const isPrivileged = ['admin', 'super-admin'].includes(role);
      const sessionDoc = await ChatSession.findById(sessionId).lean();
      if (!sessionDoc) {
        return res.status(404).json({ success: false, message: 'Session not found' });
      }
      if (!isPrivileged && String(sessionDoc.userId) !== String(req.userId)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }
      res.json({ success: true, session: sessionDoc });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to fetch chat session' });
    }
  }
);

router.delete(
  '/chat-sessions/:sessionId',
  verifyToken,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        return res.status(400).json({ success: false, message: 'Invalid session id' });
      }
      const ok = await vidyaService.deleteChatSession({
        userId: req.userId,
        sessionId,
      });
      if (!ok) return res.status(404).json({ success: false, message: 'Session not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to delete chat session' });
    }
  }
);

router.get(
  '/vidya/admin/call-logs',
  verifyToken,
  async (req, res) => {
    if (!['super-admin'].includes(String(req.user?.role || ''))) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const logs = await VidyaCallLog.find({})
        .sort({ ts: -1 })
        .limit(limit)
        .lean();
      res.json({ success: true, logs });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to fetch logs' });
    }
  }
);

router.get(
  '/vidya/admin/retrieval-tiers',
  verifyToken,
  async (req, res) => {
    if (!['super-admin', 'admin'].includes(String(req.user?.role || ''))) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    try {
      const since = new Date(Date.now() - (Number(req.query.days) || 14) * 24 * 60 * 60 * 1000);
      const aggregate = await VidyaCallLog.aggregate([
        { $match: { ts: { $gte: since }, route: { $in: ['chat', 'chat-stream'] } } },
        {
          $group: {
            _id: '$priorityTier',
            count: { $sum: 1 },
            avgLatency: { $avg: '$latencyMs' },
            success: { $sum: { $cond: ['$success', 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      res.json({ success: true, since, aggregate });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to compute tiers' });
    }
  }
);

router.get(
  '/vidya/admin/safety-blocks',
  verifyToken,
  async (req, res) => {
    if (!['super-admin'].includes(String(req.user?.role || ''))) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    try {
      const since = new Date(Date.now() - (Number(req.query.days) || 7) * 24 * 60 * 60 * 1000);
      const [items, totals] = await Promise.all([
        VidyaCallLog.find({ ts: { $gte: since }, safetyBlocked: true })
          .sort({ ts: -1 })
          .limit(200)
          .select('userId role prompt safetyDetails ts subject classLabel')
          .lean(),
        VidyaCallLog.aggregate([
          { $match: { ts: { $gte: since } } },
          {
            $group: {
              _id: null,
              totalCalls: { $sum: 1 },
              safetyBlocks: { $sum: { $cond: ['$safetyBlocked', 1, 0] } },
            },
          },
        ]),
      ]);
      const t = totals[0] || { totalCalls: 0, safetyBlocks: 0 };
      const blockRate = t.totalCalls > 0 ? Number(((t.safetyBlocks / t.totalCalls) * 100).toFixed(2)) : 0;
      res.json({
        success: true,
        since,
        totals: { totalCalls: t.totalCalls, safetyBlocks: t.safetyBlocks, blockRatePct: blockRate },
        items,
        alert:
          t.safetyBlocks > 0
            ? `Vidya refused ${t.safetyBlocks} legitimate-looking question${t.safetyBlocks === 1 ? '' : 's'} in the last ${Number(req.query.days) || 7} days. Review and adjust filters if needed.`
            : 'No safety-filter blocks in the selected window.',
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to compute safety report' });
    }
  }
);

router.get(
  '/vidya/admin/usage-story',
  verifyToken,
  async (req, res) => {
    if (!['super-admin', 'admin'].includes(String(req.user?.role || ''))) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    try {
      const days = Number(req.query.days) || 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const [byTier, byProvider, topTopics, total] = await Promise.all([
        VidyaCallLog.aggregate([
          { $match: { ts: { $gte: since }, route: { $in: ['chat', 'chat-stream'] } } },
          { $group: { _id: '$priorityTier', count: { $sum: 1 } } },
        ]),
        VidyaCallLog.aggregate([
          { $match: { ts: { $gte: since } } },
          { $group: { _id: '$provider', count: { $sum: 1 } } },
        ]),
        VidyaCallLog.aggregate([
          { $match: { ts: { $gte: since }, priorityTier: 3, route: { $in: ['chat', 'chat-stream'] } } },
          { $group: { _id: { subject: '$subject', classLabel: '$classLabel' }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        VidyaCallLog.countDocuments({ ts: { $gte: since } }),
      ]);

      const tierCounts = byTier.reduce((acc, row) => {
        acc[row._id || 0] = row.count;
        return acc;
      }, { 1: 0, 2: 0, 3: 0 });
      const tierTotal = (tierCounts[1] || 0) + (tierCounts[2] || 0) + (tierCounts[3] || 0);
      const fromLibraryPct = tierTotal > 0 ? Math.round(((tierCounts[1] + tierCounts[2]) / tierTotal) * 100) : 0;

      const story =
        total === 0
          ? 'No Vidya activity yet in this window.'
          : `In the last ${days} days, Vidya answered ${total} questions. ${fromLibraryPct}% were grounded in your AsliLearn library; ${100 - fromLibraryPct}% came from general knowledge. ${
              topTopics.length
                ? 'Topics most often falling outside your library: ' +
                  topTopics
                    .slice(0, 5)
                    .map((t) => `${t._id?.subject || 'Subject?'} (${t._id?.classLabel || 'Class?'})`)
                    .join(', ') +
                  '.'
                : ''
            }`;

      res.json({
        success: true,
        since,
        totals: { total, fromLibraryPct, tierCounts, byProvider },
        topUnservedTopics: topTopics,
        story,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to compute usage story' });
    }
  }
);

export default router;
