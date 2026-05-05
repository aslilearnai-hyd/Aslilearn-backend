import VidyaCallLog from '../models/VidyaCallLog.js';
import { buildStudentAiContext } from '../services/vidya-student/student-ai-context-engine.js';
import { analyzeStudentPerformance } from '../services/vidya-student/student-performance-analyzer.js';
import { detectWeakAndStrongTopics } from '../services/vidya-student/weak-topic-detection-engine.js';
import { buildPersonalizedRecommendations } from '../services/vidya-student/personalized-recommendation-engine.js';
import { buildStudyStreak, getLatestProactivePrompt } from '../services/vidya-student/dashboard-sync-service.js';
import { markProactivePromptDelivered } from '../services/vidya-student/post-exam-trigger-service.js';
import { analyzeMarks } from '../services/vidya-student/marks-analysis-service.js';
import { buildAutoGreeting, buildPerformanceSummary } from '../services/vidya-student/performance-summary-engine.js';
import { runHybridStudentVidyaChat } from '../services/vidya-student/hybrid-ai-chat-controller.js';

export async function postStudentMentorChat(req, res) {
  const started = Date.now();
  try {
    const question = String(req.body?.message || '').trim();
    const studentId = req.body?.studentId ? String(req.body.studentId) : String(req.userId);
    if (!question) return res.status(400).json({ success: false, message: 'message is required' });

    const result = await runHybridStudentVidyaChat({
      viewerRole: req.user?.role,
      viewerUserId: req.userId,
      studentId,
      question,
    });

    await VidyaCallLog.create({
      userId: String(req.userId),
      role: String(req.user?.role || ''),
      route: 'analysis',
      prompt: question,
      response: result.message,
      provider: 'gemini',
      success: true,
      latencyMs: Date.now() - started,
      safetyBlocked: false,
      safetyDetails: {
        groundingStatus: result.groundingStatus,
        scope: 'student-mentor',
        mode: result.mode || 'application',
        intent: result.intent || null,
      },
      requestIp: req.ip || '',
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
    }).catch(() => null);

    return res.json({
      success: true,
      message: result.message,
      mode: result.mode || 'application',
      intent: result.intent || null,
      groundingStatus: result.groundingStatus,
      studentId,
      facts: result.facts,
      summary: result.summary || null,
      autoGreeting: result.autoGreeting || null,
    });
  } catch (err) {
    const status = Number(err?.statusCode) || 500;
    return res.status(status).json({
      success: false,
      message: err?.message || 'Failed to process student mentor chat.',
    });
  }
}

export async function getStudentFocusCard(req, res) {
  try {
    const studentId = req.query?.studentId ? String(req.query.studentId) : String(req.userId);
    const ctx = await buildStudentAiContext({
      viewerRole: req.user?.role,
      viewerUserId: req.userId,
      studentId,
    });
    if (!ctx.ok) return res.status(403).json({ success: false, message: ctx.reason });
    const perf = analyzeStudentPerformance(ctx);
    const weak = detectWeakAndStrongTopics(ctx);
    const marks = analyzeMarks(ctx.exams?.recentResults || []);
    const recs = buildPersonalizedRecommendations({ ctx, performance: perf, weakTopics: weak });
    const streak = await buildStudyStreak(ctx.studentId);
    const proactive = await getLatestProactivePrompt(ctx.studentId);
    const rankings = { classRank: null, subjectRank: null, leaderboardPosition: null };
    const summary = buildPerformanceSummary({
      ctx,
      performance: perf,
      weakTopics: weak,
      marks,
      recommendations: recs,
      rankings,
    });
    const autoGreeting = buildAutoGreeting(summary);
    return res.json({
      success: true,
      focusCard: recs.actionCard,
      studyStreak: streak,
      proactivePrompt: proactive?.delivered ? null : proactive,
      alerts: recs.interventionAlerts,
      todayFocus: recs.actionCard,
      summary,
      autoGreeting,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || 'Failed to build focus card' });
  }
}

export async function markProactiveDelivered(req, res) {
  try {
    const { promptId } = req.body || {};
    if (!promptId) return res.status(400).json({ success: false, message: 'promptId is required' });
    const row = await markProactivePromptDelivered(promptId);
    return res.json({ success: true, prompt: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || 'Failed to update proactive prompt' });
  }
}

