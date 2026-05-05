import express from 'express';
import mongoose from 'mongoose';
import { verifyToken } from '../middleware/auth.js';
import User from '../models/User.js';
import ExamResult from '../models/ExamResult.js';
import UserProgress from '../models/UserProgress.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import AiContentEngineSource from '../models/AiContentEngineSource.js';
import AiContentEngineChunk from '../models/AiContentEngineChunk.js';
import VidyaCallLog from '../models/VidyaCallLog.js';
import LearningPath from '../models/LearningPath.js';

const router = express.Router();

const safeObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch (_) {
    return null;
  }
};

const istDateString = (d = new Date()) => {
  const offset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(d.getTime() + offset);
  return ist.toISOString().slice(0, 10);
};

const daysBetween = (a, b) => {
  if (!a || !b) return 0;
  const ms = 24 * 60 * 60 * 1000;
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / ms);
};

/* ===========================================================
   Super Admin dashboard (Phase 3.3a)
   =========================================================== */

router.get(
  '/super-admin/dashboard/just-happened',
  verifyToken,
  async (req, res) => {
    if (req.user?.role !== 'super-admin') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [recentSources, recentGenerations, chunkCount, sourceCount] = await Promise.all([
        AiContentEngineSource.find({ createdAt: { $gte: since } })
          .sort({ createdAt: -1 })
          .limit(20)
          .select('originalName subject classLabel chapter chunkCount processingStatus archived createdAt uploadedBy')
          .lean(),
        AiToolGeneration.find({ createdAt: { $gte: since } })
          .sort({ createdAt: -1 })
          .limit(20)
          .select('toolDisplayName toolName classLabel subject topic reviewStatus sourceType createdAt')
          .lean(),
        AiContentEngineChunk.estimatedDocumentCount(),
        AiContentEngineSource.countDocuments({ archived: { $ne: true } }),
      ]);

      const items = [];
      for (const s of recentSources) {
        items.push({
          ts: s.createdAt,
          kind: 'pdf-upload',
          summary: `PDF "${s.originalName}" uploaded for ${s.subject} / ${s.classLabel} / ${s.chapter} → ${s.chunkCount || 0} chunks (${s.processingStatus})${s.archived ? ' [archived]' : ''}`,
          ref: { sourceId: String(s._id) },
        });
      }
      for (const g of recentGenerations) {
        items.push({
          ts: g.createdAt,
          kind: g.sourceType === 'ai_pdf' ? 'ai-pdf-record' : 'ai-generator',
          summary: `${g.toolDisplayName || g.toolName} generated for ${g.classLabel} / ${g.subject} / ${g.topic || 'General'} (${g.reviewStatus || 'approved'})`,
          ref: { id: String(g._id) },
        });
      }
      items.sort((a, b) => new Date(b.ts) - new Date(a.ts));

      res.json({
        success: true,
        windowHours: 24,
        totals: {
          activePdfSources: sourceCount,
          totalChunks: chunkCount,
          eventsLast24h: items.length,
        },
        items: items.slice(0, 30),
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to build feed.' });
    }
  }
);

/* ===========================================================
   School Admin dashboard (Phase 3.3b)
   =========================================================== */

router.get(
  '/school-admin/dashboard/health',
  verifyToken,
  async (req, res) => {
    if (!['admin', 'school-admin', 'super-admin'].includes(String(req.user?.role || ''))) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    try {
      const adminId = safeObjectId(req.userId);
      const studentFilter = req.user?.role === 'super-admin' ? { role: 'student' } : { role: 'student', assignedAdmin: adminId };

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [students, recentExams, activeStudentIds] = await Promise.all([
        User.find(studentFilter).select('_id fullName classNumber lastLogin overallProgress studyStreak').lean(),
        ExamResult.aggregate([
          { $match: { completedAt: { $gte: thirtyDaysAgo } } },
          { $group: { _id: '$userId', avgPct: { $avg: '$percentage' }, count: { $sum: 1 } } },
        ]),
        User.distinct('_id', {
          ...studentFilter,
          lastLogin: { $gte: sevenDaysAgo },
        }),
      ]);

      const examMap = new Map(recentExams.map((r) => [String(r._id), r]));
      const totalStudents = students.length;
      const activeStudents = activeStudentIds.length;
      const adoptionPct = totalStudents > 0 ? Math.round((activeStudents / totalStudents) * 100) : 0;

      let masteryAccum = 0;
      let masteryN = 0;
      const atRisk = [];
      for (const s of students) {
        const ex = examMap.get(String(s._id));
        if (ex && Number.isFinite(ex.avgPct)) {
          masteryAccum += ex.avgPct;
          masteryN += 1;
          if (ex.avgPct < 45) {
            atRisk.push({
              userId: String(s._id),
              fullName: s.fullName,
              classNumber: s.classNumber,
              avgPct: Math.round(ex.avgPct),
              suggestion:
                'Likely needs the daily error-log loop and weak-topic drills. Consider assigning a 2-day Concept Breakdown plan.',
            });
          }
        }
      }
      const avgMastery = masteryN > 0 ? Math.round(masteryAccum / masteryN) : 0;

      const score = Math.round(0.4 * adoptionPct + 0.45 * avgMastery + 0.15 * (totalStudents > 0 ? 100 : 0));
      const trend = score >= 65 ? 'up' : score >= 45 ? 'stable' : 'down';

      atRisk.sort((a, b) => a.avgPct - b.avgPct);

      res.json({
        success: true,
        schoolHealthScore: {
          value: score,
          method: 'rule-based',
          methodLabel:
            'Weighted average of weekly student adoption (40%), 30-day average exam mastery (45%) and onboarding (15%).',
          components: {
            adoptionPct,
            avgMasteryPct: avgMastery,
            studentsTotal: totalStudents,
          },
          trend,
        },
        studentsNeedingAttention: atRisk.slice(0, 10),
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to compute school health.' });
    }
  }
);

/* ===========================================================
   Teacher dashboard (Phase 3.3c)
   =========================================================== */

router.get(
  '/teacher/dashboard/morning-briefing',
  verifyToken,
  async (req, res) => {
    if (String(req.user?.role || '') !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    try {
      const teacherId = safeObjectId(req.userId);
      const yesterdayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const studentIds = await User.distinct('_id', { assignedTeacher: teacherId });

      const [yesterdayResults, weekResults, readyContent] = await Promise.all([
        ExamResult.find({
          userId: { $in: studentIds },
          completedAt: { $gte: yesterdayStart },
        })
          .sort({ completedAt: -1 })
          .limit(50)
          .select('userId examTitle percentage questionAnalytics completedAt')
          .lean(),
        ExamResult.aggregate([
          { $match: { userId: { $in: studentIds }, completedAt: { $gte: sevenDaysAgo } } },
          { $unwind: { path: '$questionAnalytics', preserveNullAndEmptyArrays: false } },
          {
            $match: {
              $or: [
                { 'questionAnalytics.status': 'wrong' },
                { 'questionAnalytics.status': 'not_answered' },
              ],
            },
          },
          {
            $group: {
              _id: { subject: '$questionAnalytics.subject', chapter: '$questionAnalytics.chapter' },
              missCount: { $sum: 1 },
            },
          },
          { $sort: { missCount: -1 } },
          { $limit: 8 },
        ]),
        AiToolGeneration.find({
          $or: [
            { reviewStatus: 'approved' },
            { reviewStatus: { $exists: false } },
          ],
          createdAt: { $gte: sevenDaysAgo },
        })
          .sort({ createdAt: -1 })
          .limit(10)
          .select('toolDisplayName toolName classLabel subject topic createdAt')
          .lean(),
      ]);

      const strugglers = yesterdayResults
        .filter((r) => Number(r.percentage || 0) < 50)
        .slice(0, 10)
        .map((r) => ({
          userId: String(r.userId),
          examTitle: r.examTitle,
          scorePct: Math.round(r.percentage || 0),
        }));

      res.json({
        success: true,
        briefing: {
          studentsStrugglingYesterday: strugglers,
          classWeakChaptersThisWeek: weekResults.map((r) => ({
            subject: r._id.subject || '',
            chapter: r._id.chapter || '',
            missCount: r.missCount,
          })),
          aiContentReadyForToday: readyContent,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to build morning briefing.' });
    }
  }
);

/* ===========================================================
   Student dashboard (Phase 3.3d)
   =========================================================== */

router.post(
  '/student/dashboard/streak/ping',
  verifyToken,
  async (req, res) => {
    try {
      const userId = safeObjectId(req.userId);
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Invalid user.' });
      }
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }
      const today = istDateString();
      const last = user.studyStreak?.lastActiveDate || '';
      let current = user.studyStreak?.current || 0;
      let longest = user.studyStreak?.longest || 0;

      if (last === today) {
        // already counted today
      } else if (last && daysBetween(last, today) === 1) {
        current += 1;
      } else {
        current = 1;
      }
      if (current > longest) longest = current;

      user.studyStreak = { current, longest, lastActiveDate: today };
      await user.save();

      const willBreakSoon =
        last && daysBetween(last, today) >= 1 ? false : current > 0 && new Date().getHours() >= 19;

      res.json({
        success: true,
        streak: { current, longest, lastActiveDate: today, willBreakSoonReminder: willBreakSoon },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to update streak.' });
    }
  }
);

router.get(
  '/student/dashboard/today',
  verifyToken,
  async (req, res) => {
    try {
      const userId = safeObjectId(req.userId);
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Invalid user.' });
      }
      const user = await User.findById(userId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [recentExam, recentProgress, activePath, weakProgress] = await Promise.all([
        ExamResult.findOne({ userId, completedAt: { $gte: sevenDaysAgo } })
          .sort({ completedAt: -1 })
          .lean(),
        UserProgress.find({ userId })
          .sort({ lastAccessed: -1 })
          .limit(5)
          .lean(),
        LearningPath.findOne({ enrolledUsers: userId, isPublished: true }).sort({ updatedAt: -1 }).lean(),
        UserProgress.findOne({
          userId,
          progress: { $lt: 80 },
          subject: { $ne: '' },
          topic: { $ne: '' },
        })
          .sort({ lastAccessed: -1 })
          .lean(),
      ]);

      let card = null;

      if (recentExam && Number(recentExam.percentage || 100) < 65) {
        card = {
          kind: 'post-exam',
          title: `Score dropped on ${recentExam.examTitle || 'your exam'}`,
          body: `You finished with ${Math.round(recentExam.percentage || 0)}%. Let's look at the questions you missed together.`,
          cta: 'Open Vidya debrief',
          ctaPath: `/api/student/exams/${recentExam._id}/vidya-debrief`,
        };
      } else if (weakProgress) {
        card = {
          kind: 'weak-topic',
          title: `Pick up where you left off — ${weakProgress.subject} / ${weakProgress.topic}`,
          body: `You are ${weakProgress.progress || 0}% through this topic. 5 quick questions today will move you up fast.`,
          cta: 'Start 5-question practice',
          ctaPath: `/practice/${encodeURIComponent(weakProgress.subject)}/${encodeURIComponent(weakProgress.topic)}`,
        };
      } else if (activePath) {
        card = {
          kind: 'learning-path',
          title: `Continue ${activePath.title}`,
          body: `Stay on track with your active learning path.`,
          cta: 'Continue path',
          ctaPath: `/learning-path/${activePath._id}`,
        };
      } else if (recentProgress[0]) {
        const p = recentProgress[0];
        card = {
          kind: 'continue',
          title: `Continue ${p.subject || ''} ${p.topic ? '— ' + p.topic : ''}`.trim(),
          body: `You are ${p.progress || 0}% through this. A short session today keeps the momentum.`,
          cta: 'Resume',
          ctaPath: `/study/${encodeURIComponent(p.subject || '')}`,
        };
      } else {
        card = {
          kind: 'fallback',
          title: 'Ask Vidya something you want to learn today',
          body: 'Tell Vidya the chapter or topic you want to start with — she will guide you.',
          cta: 'Open Vidya',
          ctaPath: `/vidya`,
        };
      }

      res.json({
        success: true,
        focusCard: card,
        streak: user.studyStreak || { current: 0, longest: 0, lastActiveDate: '' },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to build today card.' });
    }
  }
);

export default router;
