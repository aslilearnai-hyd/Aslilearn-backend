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

  const weak = Array.isArray(facts?.weakTopics?.weakTopics) ? facts.weakTopics.weakTopics : [];
  const strong = Array.isArray(facts?.weakTopics?.strongTopics) ? facts.weakTopics.strongTopics : [];
  const subjectPerf = Array.isArray(facts?.performance?.subjectPerformance) ? facts.performance.subjectPerformance : [];
  const examList = Array.isArray(facts?.examList) ? facts.examList : [];
  const marks = facts?.marks || {};
  const perf = facts?.performance || {};
  const recs = facts?.recommendations || {};
  const streak = recs?.streak || {};
  const streakDays = streak?.current ?? streak?.count ?? 0;

  // ── WEAK SUBJECT / TOPIC queries ──────────────────────────────────────────
  if (/weak|struggle|difficult|bad|poor|problem|trouble/.test(q) &&
      /subject|topic|chapter|area/.test(q)) {
    if (!subjectPerf.length && !weak.length) {
      return "I haven't found enough exam data yet to identify weak subjects. Please complete a few exams and I'll give you a detailed analysis.";
    }

    // Build subject-level weakness from subjectPerformance
    const weakSubjects = subjectPerf
      .filter((s) => s.percentage < 60)
      .sort((a, b) => a.percentage - b.percentage);

    // Build chapter/topic level weakness from questionAnalytics
    const weakChapters = weak.slice(0, 5);

    let reply = '';

    if (weakSubjects.length > 0) {
      reply += `📚 **Subjects where you need more work:**\n`;
      weakSubjects.forEach((s) => {
        reply += `• ${s.subject} — ${s.percentage}% average (${s.attempts} exam${s.attempts !== 1 ? 's' : ''})\n`;
      });
      reply += '\n';
    } else if (subjectPerf.length > 0) {
      reply += `✅ You're scoring above 60% in all subjects. Great work!\n\n`;
    }

    if (weakChapters.length > 0) {
      reply += `📖 **Chapters with highest mistake rate:**\n`;
      weakChapters.forEach((c) => {
        reply += `• ${c.chapter} — ${c.wrongRate}% wrong out of ${c.attempts} questions attempted\n`;
      });
      reply += '\n';
    }

    if (recs?.nextActions?.length > 0) {
      reply += `🎯 **What to do next:**\n`;
      recs.nextActions.slice(0, 3).forEach((a) => { reply += `• ${a}\n`; });
    }

    return reply.trim() || 'I reviewed your exams but could not find enough data to identify weak topics yet. Try completing more practice exams.';
  }

  // ── STRONG SUBJECT / TOPIC queries ────────────────────────────────────────
  if (/strong|good|best|excel|top/.test(q) && /subject|topic|chapter|area/.test(q)) {
    const strongSubjects = subjectPerf
      .filter((s) => s.percentage >= 75)
      .sort((a, b) => b.percentage - a.percentage);
    const strongChapters = strong.slice(0, 3);
    let reply = '';
    if (strongSubjects.length) {
      reply += `🏆 **Your strongest subjects:**\n`;
      strongSubjects.forEach((s) => { reply += `• ${s.subject} — ${s.percentage}% average\n`; });
      reply += '\n';
    }
    if (strongChapters.length) {
      reply += `⭐ **Chapters you're doing great in:**\n`;
      strongChapters.forEach((c) => { reply += `• ${c.chapter} — ${c.correctRate}% correct rate\n`; });
    }
    return reply.trim() || 'Complete a few more exams and I will be able to show your strongest areas.';
  }

  // ── MARKS / SCORE / RESULT queries ────────────────────────────────────────
  if (/mark|score|result|percentage|how (much|many|did)/.test(q)) {
    const latest = examList[0];
    if (!latest) return "I don't have any exam results for you yet. Complete an exam and I'll show you your scores.";
    let reply = `📝 **Your most recent exam:**\n• ${latest.examTitle || 'Exam'}: ${latest.percentage ?? 'N/A'}%`;
    if (marks.averagePercentage != null) {
      reply += `\n\n📊 **Overall average:** ${marks.averagePercentage}%`;
    }
    if (marks.highestMark) {
      reply += `\n🏅 **Best exam:** ${marks.highestMark.examTitle} — ${marks.highestMark.percentage}%`;
    }
    if (perf.trendDirection && perf.trendDirection !== 'unknown') {
      const trendEmoji = perf.trendDirection === 'improving' ? '📈' : perf.trendDirection === 'declining' ? '📉' : '➡️';
      reply += `\n${trendEmoji} **Trend:** Your scores are ${perf.trendDirection}.`;
    }
    return reply;
  }

  // ── SUBJECT PERFORMANCE breakdown ─────────────────────────────────────────
  if (/subject|performance|how (am i doing|doing)|overview|summary/.test(q)) {
    if (!subjectPerf.length) return "I need your exam data to show subject performance. Complete an exam first.";
    let reply = `📊 **Your subject-wise performance:**\n`;
    subjectPerf.forEach((s) => {
      const emoji = s.percentage >= 75 ? '✅' : s.percentage >= 50 ? '🟡' : '🔴';
      reply += `${emoji} ${s.subject}: ${s.percentage}% (${s.attempts} exam${s.attempts !== 1 ? 's' : ''})\n`;
    });
    if (perf.trendDirection && perf.trendDirection !== 'unknown') {
      reply += `\n📈 Overall trend: **${perf.trendDirection}**`;
    }
    return reply.trim();
  }

  // ── PROGRESS / IMPROVEMENT queries ────────────────────────────────────────
  if (/progress|improv|getting better|trend/.test(q)) {
    if (perf.trendDirection === 'unknown') {
      return "You need at least 2 exams for me to track your progress trend. Keep taking exams!";
    }
    const delta = perf.deltaVsPrevious;
    const deltaText = delta !== null
      ? `${delta > 0 ? '+' : ''}${delta}% compared to your previous exam`
      : '';
    let reply = `📈 **Your progress:**\n`;
    reply += `• Trend: **${perf.trendDirection}** ${deltaText ? `(${deltaText})` : ''}\n`;
    if (perf.latestPercentage != null) reply += `• Latest score: ${perf.latestPercentage}%\n`;
    if (marks.averagePercentage != null) reply += `• Average: ${marks.averagePercentage}%\n`;
    if (perf.trendDirection === 'declining' && weak.length > 0) {
      reply += `\n💡 Focus on: ${weak[0].chapter} to turn this around.`;
    }
    return reply.trim();
  }

  // ── RANK queries ───────────────────────────────────────────────────────────
  if (/rank|position|standing|topper|top student/.test(q)) {
    return "Your rank within the class is shown on the School Dashboard. Ask your teacher or check the Leaderboard section in your Student Dashboard.";
  }

  // ── RECOMMENDATION / WHAT TO STUDY queries ────────────────────────────────
  if (/recommend|suggest|study|focus|revise|practice|prepare|plan/.test(q)) {
    const card = recs?.actionCard;
    let reply = '';
    if (card) {
      reply += `🎯 **Today's focus:** ${card.action}\n`;
      if (card.reason) reply += `_Reason: ${card.reason}_\n\n`;
    }
    if (recs?.nextActions?.length > 0) {
      reply += `📋 **Your study plan:**\n`;
      recs.nextActions.slice(0, 4).forEach((a) => { reply += `• ${a}\n`; });
    }
    if (weak.length > 0 && !card) {
      reply += `\nStart with **${weak[0].chapter}** — that is where you are making the most mistakes.`;
    }
    return reply.trim() || 'Focus on completing pending exams and reviewing your weak topics.';
  }

  // ── ATTENDANCE / STREAK queries ────────────────────────────────────────────
  if (/attend|streak|consistent|days|daily/.test(q)) {
    let reply = '';
    if (streakDays > 0) {
      reply += `🔥 **Study streak: ${streakDays} day${streakDays !== 1 ? 's' : ''}** — keep going!\n`;
    }
    if (recs?.attendanceRate30d != null) {
      reply += `📅 Attendance (last 30 days): ${recs.attendanceRate30d}%\n`;
      if (recs.attendanceRate30d < 75) {
        reply += `⚠️ Try to study every day — consistency is key to improving your scores.`;
      }
    }
    return reply.trim() || 'Keep studying every day to build your streak!';
  }

  // ── EXAM LIST queries ──────────────────────────────────────────────────────
  if (/exam|test|quiz|assessment/.test(q)) {
    if (!examList.length) return "You haven't taken any exams yet. Check the Exams section in your dashboard.";
    let reply = `📝 **Your recent exams:**\n`;
    examList.slice(0, 5).forEach((e, i) => {
      reply += `${i + 1}. ${e.examTitle || 'Exam'} — ${e.percentage ?? 'N/A'}%\n`;
    });
    if (marks.averagePercentage != null) {
      reply += `\n📊 Average across all exams: **${marks.averagePercentage}%**`;
    }
    return reply.trim();
  }

  // ── HIGHEST MARK ───────────────────────────────────────────────────────────
  if (/highest|best|top mark|top score/.test(q)) {
    if (marks.highestMark) {
      const h = marks.highestMark;
      return `🏅 Your highest score was **${h.percentage}%** in "${h.examTitle}" (${h.obtainedMarks}/${h.totalMarks} marks).`;
    }
    return "I don't have exam records yet. Take an exam and I'll track your best scores.";
  }

  // ── DEFAULT — summarize key facts ─────────────────────────────────────────
  const avgPct = marks.averagePercentage;
  const latestEx = examList[0];
  const topWeak = weak[0];

  if (!examList.length) {
    return "I can see your profile but you haven't taken any exams yet. Head to the Exams section to get started — once you do, I can give you a full analysis.";
  }

  let reply = '';
  if (latestEx) reply += `📝 Last exam: **${latestEx.examTitle}** — ${latestEx.percentage ?? 'N/A'}%\n`;
  if (avgPct != null) reply += `📊 Overall average: **${avgPct}%**\n`;
  if (topWeak) reply += `⚠️ Weakest area: **${topWeak.chapter}** (${topWeak.wrongRate}% mistake rate)\n`;
  if (recs?.actionCard?.action) reply += `🎯 Focus now on: **${recs.actionCard.action}**`;
  return reply.trim() || 'Ask me about your marks, weak topics, progress, or what to study next.';
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
      const conceptAnswer = await generateGeneralKnowledgeAnswer({
        question,
        classLevel,
        subjectContext,
        board: ctx.profile?.board || '',
        weakChapters: (weakTopics?.weakTopics || []).slice(0, 3).map((w) => w.chapter),
        enrolledSubjects: ctx.profile?.subjects || [],
      });
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
    conceptAnswer = await generateGeneralKnowledgeAnswer({
      question,
      classLevel,
      subjectContext,
      board: ctx.profile?.board || '',
      weakChapters: (weakTopics?.weakTopics || []).slice(0, 3).map((w) => w.chapter),
      enrolledSubjects: ctx.profile?.subjects || [],
    });
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

