import { buildStudentAiContext } from './student-ai-context-engine.js';
import { analyzeStudentPerformance } from './student-performance-analyzer.js';
import { detectWeakAndStrongTopics } from './weak-topic-detection-engine.js';
import { buildPersonalizedRecommendations } from './personalized-recommendation-engine.js';
import { buildStudyStreak, getLatestProactivePrompt } from './dashboard-sync-service.js';
import { analyzeMarks } from './marks-analysis-service.js';
import { buildAutoGreeting, buildPerformanceSummary } from './performance-summary-engine.js';
import { detectQueryIntent, buildUncertainClarificationMessage } from './query-intent-detection-engine.js';
import { generateGeneralKnowledgeAnswer } from './gemini-general-knowledge-service.js';

const connectionFallbackMessage = () => "I'm having trouble connecting right now. Please try again in a moment.";

function appOnlyReply(question, facts) {
  const q = String(question || '').toLowerCase();
  if (/highest/.test(q) && facts.marks?.highestMark) {
    const h = facts.marks.highestMark;
    return `Your highest score was in ${h.examTitle} where you scored ${h.percentage}%.`;
  }
  return 'I reviewed your dashboard data and prepared your learning guidance.';
}

export async function runHybridStudentVidyaChat({ viewerRole, viewerUserId, studentId, question }) {
  const intent = detectQueryIntent(question);
  if (intent.type === 'uncertain') {
    return {
      mode: 'uncertain',
      intent,
      message: buildUncertainClarificationMessage(),
      groundingStatus: 'clarification_required',
      facts: null,
      summary: null,
      autoGreeting: null,
    };
  }

  const ctx = await buildStudentAiContext({ viewerRole, viewerUserId, studentId });
  if (!ctx.ok) {
    const e = new Error(ctx.reason || 'Unable to load student context.');
    e.statusCode = 403;
    throw e;
  }

  const performance = analyzeStudentPerformance(ctx);
  const weakTopics = detectWeakAndStrongTopics(ctx);
  const marks = analyzeMarks(ctx.exams?.recentResults || []);
  const recommendations = buildPersonalizedRecommendations({ ctx, performance, weakTopics });
  const streak = await buildStudyStreak(ctx.studentId);
  const latestProactive = await getLatestProactivePrompt(ctx.studentId);
  const facts = {
    profile: ctx.profile,
    performance,
    weakTopics,
    marks,
    recommendations: { ...recommendations, streak },
    latestProactivePrompt: latestProactive?.promptText || '',
    examList: (ctx.exams?.recentResults || []).slice(0, 10),
  };
  const summary = buildPerformanceSummary({ ctx, performance, weakTopics, marks, recommendations });
  const autoGreeting = buildAutoGreeting(summary);

  if (intent.type === 'application') {
    return {
      mode: 'application',
      intent,
      message: appOnlyReply(question, facts),
      groundingStatus: 'application',
      facts,
      summary,
      autoGreeting,
    };
  }

  const classLevel = String(ctx.profile?.classNumber || '').replace(/[^\d]/g, '');
  const subjectContext = Array.isArray(ctx.profile?.subjects) ? ctx.profile.subjects[0] : '';

  if (intent.type === 'general') {
    try {
      const conceptAnswer = await generateGeneralKnowledgeAnswer({ question, classLevel, subjectContext });
      return {
        mode: 'general',
        intent,
        message: conceptAnswer,
        groundingStatus: 'general_knowledge',
        facts: { profile: ctx.profile },
        summary: null,
        autoGreeting: null,
      };
    } catch (err) {
      return {
        mode: 'general',
        intent,
        message: connectionFallbackMessage(),
        groundingStatus: 'general_knowledge_error',
        facts: { profile: ctx.profile, error: String(err?.message || err) },
        summary: null,
        autoGreeting: null,
      };
    }
  }

  let conceptAnswer = '';
  try {
    conceptAnswer = await generateGeneralKnowledgeAnswer({ question, classLevel, subjectContext });
  } catch {
    conceptAnswer = connectionFallbackMessage();
  }
  return {
    mode: 'hybrid',
    intent,
    message: `${appOnlyReply(question, facts)}\n\nConcept Help:\n${conceptAnswer}`,
    groundingStatus: 'hybrid',
    facts,
    summary,
    autoGreeting,
  };
}

