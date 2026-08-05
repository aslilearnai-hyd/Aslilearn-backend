import { buildStudentAiContext } from './student-ai-context-engine.js';
import { analyzeStudentPerformance } from './student-performance-analyzer.js';
import { detectWeakAndStrongTopics } from './weak-topic-detection-engine.js';
import { buildPersonalizedRecommendations } from './personalized-recommendation-engine.js';
import { buildStudyStreak, getLatestProactivePrompt } from './dashboard-sync-service.js';
import { analyzeMarks } from './marks-analysis-service.js';
import { buildAutoGreeting, buildPerformanceSummary } from './performance-summary-engine.js';
import { detectQueryIntent, buildUncertainClarificationMessage, buildGreetingReplyMessage, buildThanksReplyMessage } from './query-intent-detection-engine.js';
import { generateGeneralKnowledgeAnswer } from './gemini-general-knowledge-service.js';
import { buildPlatformProgressFacts } from './platform-progress-facts.js';

const connectionFallbackMessage = () => "I'm having trouble connecting right now. Please try again in a moment.";

function formatExamTrendLine(perf, marks) {
  if (!perf || perf.trendDirection === 'unknown') {
    return 'Exam trend: need at least 2 exams to compare progress.';
  }
  const delta = perf.deltaVsPrevious;
  const deltaText =
    delta != null ? ` (${delta > 0 ? '+' : ''}${delta}% vs previous)` : '';
  let line = `Exam trend: **${perf.trendDirection}**${deltaText}`;
  if (perf.latestPercentage != null) line += ` · latest ${perf.latestPercentage}%`;
  if (marks?.averagePercentage != null) line += ` · average ${marks.averagePercentage}%`;
  return line;
}

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
  const platform = facts?.platform || {};
  const videos = platform?.videos || {};
  const paths = Array.isArray(platform?.learningPaths) ? platform.learningPaths : [];
  const homework = platform?.homework || {};
  const library = platform?.libraryContent || {};

  // ── VIDEOS / EDUOTT / LECTURES ────────────────────────────────────────────
  if (
    /video|lecture|edu\s*ott|watched|watching|watch history|chapters?\s+complet/.test(q) &&
    !/exam|test|quiz|mark|score/.test(q)
  ) {
    const recent = Array.isArray(videos.recent) ? videos.recent : [];
    const chaptersBySubject = Array.isArray(videos.chaptersBySubject) ? videos.chaptersBySubject : [];
    if (!recent.length && !(videos.chaptersCompleted > 0)) {
      return "I don't see any video watch progress yet. Open EduOTT or Video Lectures, watch a lesson, and I'll track what you've completed.";
    }
    let reply = `**Your video progress on the platform:**\n`;
    reply += `• Videos tracked: **${videos.tracked || 0}** (completed **${videos.completed || 0}**`;
    if (videos.inProgress > 0) reply += `, in progress **${videos.inProgress}**`;
    reply += `)\n`;
    if (videos.chaptersCompleted > 0) {
      reply += `• Video chapters fully completed: **${videos.chaptersCompleted}**\n`;
    }
    if (recent.length) {
      reply += `\n**Recently watched:**\n`;
      recent.slice(0, 6).forEach((v, i) => {
        const status = v.completed ? 'done' : `${v.progress || 0}%`;
        reply += `${i + 1}. ${v.title} — ${status}${v.subject ? ` (${v.subject})` : ''}\n`;
      });
    }
    if (chaptersBySubject.length) {
      reply += `\n**Chapters completed by subject:**\n`;
      chaptersBySubject.slice(0, 5).forEach((s) => {
        reply += `• ${s.subjectName}: ${s.completedChapterCount} chapter(s)\n`;
      });
    }
    return reply.trim();
  }

  // ── LEARNING PATHS ────────────────────────────────────────────────────────
  if (/learning\s*path|path\s+progress|enrolled\s+path/.test(q)) {
    if (!paths.length) {
      return "You're not enrolled in any learning paths yet. Open Learning Paths on your dashboard to join one — then I can report your path progress.";
    }
    let reply = `**Your learning paths:**\n`;
    paths.forEach((p, i) => {
      const pct =
        p.progressPct != null ? `${p.progressPct}%` : p.totalVideos ? '0%' : 'enrolled';
      reply += `${i + 1}. ${p.title} — ${pct}`;
      if (p.totalVideos) reply += ` (${p.completedItems || 0}/${p.totalVideos} videos)`;
      reply += `\n`;
    });
    return reply.trim();
  }

  // ── HOMEWORK ──────────────────────────────────────────────────────────────
  if (/homework|assignment|home\s*work/.test(q)) {
    if (!(homework.submitted > 0)) {
      return "I don't have homework submissions for you yet. Submit homework from your student dashboard and I'll track status here.";
    }
    let reply = `**Homework on the platform:**\n`;
    reply += `• Submitted: **${homework.submitted}**\n`;
    reply += `• Graded: **${homework.graded || 0}**\n`;
    if (homework.pendingReview > 0) {
      reply += `• Waiting on teacher review: **${homework.pendingReview}**\n`;
    }
    return reply.trim();
  }

  // ── FULL LEARNING PROGRESS (platform overview) ────────────────────────────
  if (
    /learning\s+progress|overall\s+progress|how\s+am\s+i\s+doing|platform\s+progress|my\s+progress|study\s+progress|what.*(progress|status)/.test(
      q,
    ) &&
    !/only\s+exam/.test(q)
  ) {
    const hasExams = examList.length > 0;
    const hasPlatform = Boolean(platform.hasAnyActivity);
    if (!hasExams && !hasPlatform) {
      return "I can see your profile, but there's little activity yet. Watch a few videos, take an exam, or join a learning path — then ask me again for your learning progress.";
    }
    let reply = `**Your learning progress on Asli Learn:**\n\n`;

    if (hasExams) {
      reply += `**Exams**\n`;
      reply += `• ${formatExamTrendLine(perf, marks)}\n`;
      const latest = examList[0];
      if (latest) {
        reply += `• Latest: **${latest.examTitle || 'Exam'}** — ${latest.percentage ?? 'N/A'}%\n`;
      }
      if (subjectPerf.length) {
        const top = [...subjectPerf].sort((a, b) => b.percentage - a.percentage)[0];
        const low = [...subjectPerf].sort((a, b) => a.percentage - b.percentage)[0];
        if (top) reply += `• Strongest subject (exams): **${top.subject}** (${top.percentage}%)\n`;
        if (low && low.subject !== top?.subject) {
          reply += `• Needs work (exams): **${low.subject}** (${low.percentage}%)\n`;
        }
      }
      reply += `\n`;
    }

    if (videos.tracked > 0 || videos.chaptersCompleted > 0) {
      reply += `**Videos**\n`;
      reply += `• Completed **${videos.completed || 0}** of **${videos.tracked || 0}** tracked videos`;
      if (videos.inProgress > 0) reply += ` (**${videos.inProgress}** still in progress)`;
      reply += `\n`;
      if (videos.chaptersCompleted > 0) {
        reply += `• Chapters finished: **${videos.chaptersCompleted}**\n`;
      }
      const recent = Array.isArray(videos.recent) ? videos.recent.slice(0, 3) : [];
      if (recent.length) {
        reply += `• Recently watched: ${recent.map((v) => v.title).join('; ')}\n`;
      }
      reply += `\n`;
    }

    if (library.tracked > 0) {
      reply += `**Library / content**\n`;
      reply += `• Completed **${library.completed || 0}** of **${library.tracked}** items\n\n`;
    }

    if (paths.length) {
      reply += `**Learning paths**\n`;
      paths.slice(0, 4).forEach((p) => {
        reply += `• ${p.title}: ${p.progressPct != null ? `${p.progressPct}%` : 'enrolled'}\n`;
      });
      reply += `\n`;
    }

    if (homework.submitted > 0) {
      reply += `**Homework**\n`;
      reply += `• Submitted **${homework.submitted}** · graded **${homework.graded || 0}**\n\n`;
    }

    if (streakDays > 0) {
      reply += `**Streak:** ${streakDays} day(s) of study activity\n`;
    }
    if (platform.overallLearningPct != null) {
      reply += `**Content completion rate:** ${platform.overallLearningPct}% of tracked videos/library items\n`;
    }
    if (recs?.actionCard?.action) {
      reply += `\n**Suggested next step:** ${recs.actionCard.action}`;
    }
    return reply.trim();
  }

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
      reply += `**Subjects where you need more work:**\n`;
      weakSubjects.forEach((s) => {
        reply += `• ${s.subject} — ${s.percentage}% average (${s.attempts} exam${s.attempts !== 1 ? 's' : ''})\n`;
      });
      reply += '\n';
    } else if (subjectPerf.length > 0) {
      reply += `You're scoring above 60% in all subjects. Great work!\n\n`;
    }

    if (weakChapters.length > 0) {
      reply += `**Chapters with highest mistake rate:**\n`;
      weakChapters.forEach((c) => {
        reply += `• ${c.chapter} — ${c.wrongRate}% wrong out of ${c.attempts} questions attempted\n`;
      });
      reply += '\n';
    }

    if (recs?.nextActions?.length > 0) {
      reply += `**What to do next:**\n`;
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
      reply += `**Your strongest subjects:**\n`;
      strongSubjects.forEach((s) => { reply += `• ${s.subject} — ${s.percentage}% average\n`; });
      reply += '\n';
    }
    if (strongChapters.length) {
      reply += `**Chapters you're doing great in:**\n`;
      strongChapters.forEach((c) => { reply += `• ${c.chapter} — ${c.correctRate}% correct rate\n`; });
    }
    return reply.trim() || 'Complete a few more exams and I will be able to show your strongest areas.';
  }

  // ── ALL EXAM RESULTS ──────────────────────────────────────────────────────
  if (
    /all\s+(exam|test)|every\s+(exam|test)|all\s+my\s+(exam|test|result)|all\s+exam\s+result/i.test(q) &&
    /result|exam|test|score|mark/i.test(q)
  ) {
    if (!examList.length) {
      return "I don't have any exam results for you yet. Complete an exam and I'll show you your scores.";
    }
    let reply = `**All your recent exam results:**\n`;
    examList.forEach((e, i) => {
      const pctLabel = e.percentage != null ? `${e.percentage}%` : 'N/A';
      const markLabel =
        Number(e.obtainedMarks) >= 0 && Number(e.totalMarks) > 0
          ? ` (${Math.max(0, Number(e.obtainedMarks))}/${e.totalMarks} marks)`
          : '';
      reply += `${i + 1}. ${e.examTitle || 'Exam'} — ${pctLabel}${markLabel}\n`;
    });
    if (marks.averagePercentage != null) {
      reply += `\n**Average across these exams:** ${marks.averagePercentage}%`;
    }
    return reply.trim();
  }

  // ── EXAM STATUS / DID I IMPROVE (exam-focused) ────────────────────────────
  if (/exam\s+status|did\s+i\s+improve|am\s+i\s+improv|getting\s+better|score\s+trend/.test(q) ||
      (/improv|getting better|trend/.test(q) && /exam|test|score|mark/.test(q))) {
    if (!examList.length) {
      return "You haven't taken any exams yet, so I can't judge improvement. Take an exam from your dashboard and ask again.";
    }
    let reply = `**Your exam status:**\n`;
    reply += `• ${formatExamTrendLine(perf, marks)}\n`;
    examList.slice(0, 5).forEach((e, i) => {
      reply += `${i + 1}. ${e.examTitle || 'Exam'} — ${e.percentage ?? 'N/A'}%\n`;
    });
    if (perf.trendDirection === 'improving') {
      reply += `\nYes — your recent scores are trending **up**. Keep reinforcing weak chapters.`;
    } else if (perf.trendDirection === 'declining') {
      reply += `\nYour recent scores dipped. `;
      if (weak[0]) reply += `Focus on **${weak[0].chapter}** next.`;
      else reply += `Review mistakes from your last exam before the next one.`;
    } else if (perf.trendDirection === 'flat') {
      reply += `\nScores are steady. Push practice on weak topics to move upward.`;
    } else {
      reply += `\nI need one more exam after this to say whether you improved.`;
    }
    return reply.trim();
  }

  // ── MARKS / SCORE / RESULT queries ────────────────────────────────────────
  if (/mark|score|result|percentage|how (much|many|did)/.test(q)) {
    const latest = examList[0];
    if (!latest) return "I don't have any exam results for you yet. Complete an exam and I'll show you your scores.";
    let reply = `**Your most recent exam:**\n• ${latest.examTitle || 'Exam'}: ${latest.percentage ?? 'N/A'}%`;
    if (marks.averagePercentage != null) {
      reply += `\n\n**Overall average:** ${marks.averagePercentage}%`;
    }
    if (marks.highestMark) {
      reply += `\n**Best exam:** ${marks.highestMark.examTitle} — ${marks.highestMark.percentage}%`;
    }
    if (perf.trendDirection && perf.trendDirection !== 'unknown') {
      reply += `\n**Trend:** Your scores are ${perf.trendDirection}.`;
    }
    return reply;
  }

  // ── SUBJECT PERFORMANCE breakdown ─────────────────────────────────────────
  if (/subject|performance|how (am i doing|doing)|overview|summary/.test(q)) {
    if (!subjectPerf.length && platform.hasAnyActivity) {
      // Fall through-style: give platform summary when no exams
      return appOnlyReply('what is my learning progress', facts);
    }
    if (!subjectPerf.length) return "I need your exam data to show subject performance. Complete an exam first.";
    let reply = `**Your subject-wise performance:**\n`;
    subjectPerf.forEach((s) => {
      const flag = s.percentage >= 75 ? 'strong' : s.percentage >= 50 ? 'ok' : 'needs work';
      reply += `• ${s.subject}: ${s.percentage}% (${s.attempts} exam${s.attempts !== 1 ? 's' : ''}) — ${flag}\n`;
    });
    if (perf.trendDirection && perf.trendDirection !== 'unknown') {
      reply += `\nOverall trend: **${perf.trendDirection}**`;
    }
    return reply.trim();
  }

  // ── PROGRESS / IMPROVEMENT queries (exam trend + nudge to full progress) ──
  if (/progress|improv|getting better|trend/.test(q)) {
    if (perf.trendDirection === 'unknown' && !platform.hasAnyActivity) {
      return "You need at least 2 exams for me to track your exam progress trend — or watch videos / join a path so I can report learning progress.";
    }
    if (perf.trendDirection === 'unknown' && platform.hasAnyActivity) {
      return appOnlyReply('what is my learning progress', facts);
    }
    const delta = perf.deltaVsPrevious;
    const deltaText = delta !== null
      ? `${delta > 0 ? '+' : ''}${delta}% compared to your previous exam`
      : '';
    let reply = `**Your exam progress:**\n`;
    reply += `• Trend: **${perf.trendDirection}** ${deltaText ? `(${deltaText})` : ''}\n`;
    if (perf.latestPercentage != null) reply += `• Latest score: ${perf.latestPercentage}%\n`;
    if (marks.averagePercentage != null) reply += `• Average: ${marks.averagePercentage}%\n`;
    if (perf.trendDirection === 'declining' && weak.length > 0) {
      reply += `\nFocus on: ${weak[0].chapter} to turn this around.`;
    }
    if (videos.completed > 0 || paths.length) {
      reply += `\n\nAlso ask: **"What videos have I watched?"** or **"What is my learning progress?"** for videos and paths.`;
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
      reply += `**Today's focus:** ${card.action}\n`;
      if (card.reason) reply += `Reason: ${card.reason}\n\n`;
    }
    if (recs?.nextActions?.length > 0) {
      reply += `**Your study plan:**\n`;
      recs.nextActions.slice(0, 4).forEach((a) => { reply += `• ${a}\n`; });
    }
    if (weak.length > 0 && !card) {
      reply += `\nStart with **${weak[0].chapter}** — that is where you are making the most mistakes.`;
    }
    if (videos.inProgress > 0) {
      reply += `\nYou also have **${videos.inProgress}** video(s) in progress — finish those for easy progress.`;
    }
    return reply.trim() || 'Focus on completing pending exams and reviewing your weak topics.';
  }

  // ── ATTENDANCE / STREAK queries ────────────────────────────────────────────
  if (/attend|streak|consistent|days|daily/.test(q)) {
    let reply = '';
    if (streakDays > 0) {
      reply += `**Study streak: ${streakDays} day${streakDays !== 1 ? 's' : ''}** — keep going!\n`;
    }
    if (recs?.attendanceRate30d != null) {
      reply += `Study activity (last 30 days): ${recs.attendanceRate30d}% of days active\n`;
      if (recs.attendanceRate30d < 75) {
        reply += `Try to study every day — consistency is key to improving your scores.`;
      }
    }
    return reply.trim() || 'Keep studying every day to build your streak!';
  }

  // ── EXAM LIST queries ──────────────────────────────────────────────────────
  if (/exam|test|quiz|assessment/.test(q)) {
    if (!examList.length) return "You haven't taken any exams yet. Check the Exams section in your dashboard.";
    let reply = `**Your recent exams:**\n`;
    examList.slice(0, 5).forEach((e, i) => {
      reply += `${i + 1}. ${e.examTitle || 'Exam'} — ${e.percentage ?? 'N/A'}%\n`;
    });
    if (marks.averagePercentage != null) {
      reply += `\nAverage across all exams: **${marks.averagePercentage}%**`;
    }
    if (perf.trendDirection && perf.trendDirection !== 'unknown') {
      reply += `\nTrend: **${perf.trendDirection}**`;
    }
    return reply.trim();
  }

  // ── HIGHEST MARK ───────────────────────────────────────────────────────────
  if (/highest|best|top mark|top score/.test(q)) {
    if (marks.highestMark) {
      const h = marks.highestMark;
      return `Your highest score was **${h.percentage}%** in "${h.examTitle}" (${h.obtainedMarks}/${h.totalMarks} marks).`;
    }
    return "I don't have exam records yet. Take an exam and I'll track your best scores.";
  }

  // ── DEFAULT — platform + exam summary ─────────────────────────────────────
  const avgPct = marks.averagePercentage;
  const latestEx = examList[0];
  const topWeak = weak[0];

  if (!examList.length && !platform.hasAnyActivity) {
    return "I can see your profile but there's little activity yet. Watch videos, take exams, or join a learning path — then ask me about your progress, videos, or exam status.";
  }

  let reply = '';
  if (latestEx) reply += `Last exam: **${latestEx.examTitle}** — ${latestEx.percentage ?? 'N/A'}%\n`;
  if (avgPct != null) reply += `Overall exam average: **${avgPct}%**\n`;
  if (topWeak) reply += `Weakest area: **${topWeak.chapter}** (${topWeak.wrongRate}% mistake rate)\n`;
  if (videos.completed > 0) reply += `Videos completed: **${videos.completed}**\n`;
  if (paths.length) reply += `Learning paths enrolled: **${paths.length}**\n`;
  if (recs?.actionCard?.action) reply += `Focus now on: **${recs.actionCard.action}**\n`;
  reply += `\nTry asking: "What is my learning progress?", "What videos have I watched?", or "Did I improve in exams?"`;
  return reply.trim();
}

export async function runHybridStudentVidyaChat({ viewerRole, viewerUserId, studentId, question }) {
  const intent = detectQueryIntent(question);

  // Thanks — short warm reply, no clarification
  if (intent.type === 'thanks') {
    return {
      mode: 'thanks',
      intent,
      message: buildThanksReplyMessage(),
      groundingStatus: 'social',
      facts: null,
      summary: null,
      autoGreeting: null,
    };
  }

  // Greeting — load context when possible so we can use the student's name
  if (intent.type === 'greeting') {
    try {
      const ctx = await buildStudentAiContext({ viewerRole, viewerUserId, studentId });
      const name = ctx?.ok
        ? String(ctx.profile?.name || ctx.profile?.studentName || '').trim()
        : '';
      return {
        mode: 'greeting',
        intent,
        message: buildGreetingReplyMessage(name),
        groundingStatus: 'social',
        facts: null,
        summary: null,
        autoGreeting: null,
      };
    } catch {
      return {
        mode: 'greeting',
        intent,
        message: buildGreetingReplyMessage(''),
        groundingStatus: 'social',
        facts: null,
        summary: null,
        autoGreeting: null,
      };
    }
  }

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
  const platform = buildPlatformProgressFacts(ctx);
  const recommendations = buildPersonalizedRecommendations({
    ctx,
    performance,
    weakTopics,
    platform,
  });
  const streak = await buildStudyStreak(ctx.studentId);
  const latestProactive = await getLatestProactivePrompt(ctx.studentId);
  const facts = {
    profile: ctx.profile,
    performance,
    weakTopics,
    marks,
    platform,
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

