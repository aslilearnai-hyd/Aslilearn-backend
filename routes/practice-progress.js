import express from 'express';
import mongoose from 'mongoose';
import { verifyToken } from '../middleware/auth.js';
import UserProgress from '../models/UserProgress.js';
import ExamResult from '../models/ExamResult.js';
import Exam from '../models/Exam.js';
import vidyaService from '../services/vidya-service.js';

const router = express.Router();

const safeObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch (_) {
    return null;
  }
};

router.post(
  '/student/ai-practice/submit',
  verifyToken,
  async (req, res) => {
    try {
      const userId = safeObjectId(req.userId);
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Invalid user.' });
      }
      const {
        toolType,
        subject,
        topic,
        subTopic,
        classNumber,
        questionId,
        isCorrect,
        timeSpentSec,
        contentId,
      } = req.body || {};

      if (!subject || !topic) {
        return res.status(400).json({
          success: false,
          message: 'subject and topic are required.',
        });
      }

      const correct = Boolean(isCorrect);
      const time = Number(timeSpentSec || 0);

      const contentObjectId = contentId ? safeObjectId(contentId) : null;
      let progressDoc = await UserProgress.findOne({
        userId,
        subject,
        topic,
      });
      if (!progressDoc) {
        progressDoc = new UserProgress({
          userId,
          subject,
          topic,
          subTopic: subTopic || '',
          toolType: toolType || '',
          classNumber: classNumber || '',
          contentId: contentObjectId || undefined,
        });
      }

      const newAttempts = (progressDoc.attempts || 0) + 1;
      const newCorrect = (progressDoc.correctCount || 0) + (correct ? 1 : 0);
      const accuracyPct = newAttempts > 0 ? Math.round((newCorrect / newAttempts) * 100) : 0;

      progressDoc.attempts = newAttempts;
      progressDoc.correctCount = newCorrect;
      progressDoc.subTopic = subTopic || progressDoc.subTopic || '';
      progressDoc.toolType = toolType || progressDoc.toolType || '';
      progressDoc.classNumber = classNumber || progressDoc.classNumber || '';
      progressDoc.timeSpent = (progressDoc.timeSpent || 0) + (time > 0 ? time : 0);
      progressDoc.score = accuracyPct;
      const computedProgress = Math.min(100, Math.round((newAttempts / 5) * 50 + accuracyPct * 0.5));
      progressDoc.progress = Math.max(progressDoc.progress || 0, computedProgress);
      progressDoc.completed = progressDoc.progress >= 80 && accuracyPct >= 70;
      progressDoc.lastAccessed = new Date();
      if (questionId) progressDoc.lastQuestionId = String(questionId);
      if (contentObjectId && !progressDoc.contentId) progressDoc.contentId = contentObjectId;

      await progressDoc.save();

      res.json({
        success: true,
        progress: {
          subject,
          topic,
          subTopic: subTopic || '',
          attempts: newAttempts,
          correctCount: newCorrect,
          accuracyPct,
          progressPercent: progressDoc.progress,
          completed: progressDoc.completed,
        },
      });
    } catch (err) {
      console.error('ai-practice/submit error:', err);
      res.status(500).json({ success: false, message: 'Failed to record practice attempt.' });
    }
  }
);

router.get(
  '/student/ai-practice/progress',
  verifyToken,
  async (req, res) => {
    try {
      const userId = safeObjectId(req.userId);
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Invalid user.' });
      }
      const rows = await UserProgress.find({ userId })
        .sort({ lastAccessed: -1 })
        .limit(100)
        .lean();
      res.json({ success: true, progress: rows });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to fetch progress.' });
    }
  }
);

router.post(
  '/student/exams/:id/vidya-debrief',
  verifyToken,
  async (req, res) => {
    try {
      const examIdRaw = req.params.id;
      const examResultObjectId = safeObjectId(examIdRaw);
      const role = String(req.user?.role || 'student');

      let examResult = null;
      if (examResultObjectId) {
        examResult = await ExamResult.findOne({
          $or: [
            { _id: examResultObjectId, userId: safeObjectId(req.userId) },
            { examId: examResultObjectId, userId: safeObjectId(req.userId) },
          ],
        })
          .sort({ completedAt: -1 })
          .lean();
      }
      if (!examResult) {
        return res.status(404).json({ success: false, message: 'Exam result not found.' });
      }

      const exam = await Exam.findById(examResult.examId).lean().catch(() => null);

      const totalAnswered = (Number(examResult.correctAnswers || 0) + Number(examResult.wrongAnswers || 0));
      const wrongCount = Number(examResult.wrongAnswers || 0);
      const scorePct =
        typeof examResult.percentage === 'number' ? Math.round(examResult.percentage) : null;

      const weakChapters = new Set();
      const missed = [];
      if (Array.isArray(examResult.questionAnalytics)) {
        for (const q of examResult.questionAnalytics) {
          if (q?.status === 'wrong' || q?.status === 'not_answered') {
            if (q.chapter) weakChapters.add(q.chapter);
            missed.push({
              subject: q.subject || '',
              chapter: q.chapter || '',
              status: q.status,
            });
          }
        }
      }

      const greeting =
        scorePct !== null
          ? `I noticed you finished "${examResult.examTitle || exam?.title || 'your recent exam'}" with ${scorePct}%`
          : `I noticed you finished "${examResult.examTitle || exam?.title || 'your recent exam'}"`;
      const wrongPart =
        wrongCount > 0
          ? ` and ${wrongCount} question${wrongCount === 1 ? '' : 's'} went wrong.`
          : '.';
      const offer = wrongCount > 0
        ? ' Want to look at the ones you missed together? I can also give you 2-3 short practice questions on the weak chapters.'
        : ' Want to lock this in with a small practice set, or try a slightly harder set?';

      const seedQuestion = `${greeting}${wrongPart}${offer}`;

      const session = await vidyaService.seedDebriefSession({
        userId: req.userId,
        role,
        examResult,
        suggestedQuestion: seedQuestion,
      });

      res.json({
        success: true,
        sessionId: String(session._id),
        prompt: seedQuestion,
        summary: {
          examTitle: examResult.examTitle || exam?.title || '',
          scorePct,
          totalAnswered,
          wrongCount,
          weakChapters: Array.from(weakChapters).slice(0, 6),
          missed: missed.slice(0, 8),
        },
      });
    } catch (err) {
      console.error('vidya-debrief error:', err);
      res.status(500).json({ success: false, message: 'Failed to prepare exam debrief.' });
    }
  }
);

export default router;
