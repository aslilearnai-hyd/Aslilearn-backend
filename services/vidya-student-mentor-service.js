import geminiService from './gemini-service.js';
import { buildStudentDashboardContext } from './vidya-student/student-dashboard-context-engine.js';
import { analyzeStudentPerformance } from './vidya-student/student-performance-analyzer.js';
import { detectWeakAndStrongTopics } from './vidya-student/weak-topic-detection-engine.js';
import { buildPersonalizedRecommendations } from './vidya-student/personalized-recommendation-engine.js';
import { retrieveStudentContent } from './vidya-student/content-retrieval-layer.js';
import { upsertStudentMemory } from './vidya-student/vidya-student-memory-service.js';
import { buildStudyStreak, getLatestProactivePrompt } from './vidya-student/dashboard-sync-service.js';
import { analyzeMarks } from './vidya-student/marks-analysis-service.js';
import { buildAutoGreeting, buildPerformanceSummary } from './vidya-student/performance-summary-engine.js';
import { buildStrictStudentMentorPrompt } from './vidya-student/gemini-formatting-layer.js';

const BANNED_APPROX = ['approximately', 'approx', 'around', 'about', 'likely', 'probably', 'estimated', 'maybe'];
const METRIC_QUERY_REGEX =
  /highest mark|best score|highest score|rank|leaderboard|percentage|marks|score|attempted exams|how many tests|tests did i complete|weak subject|compare .*math|maths.*science|science.*math|wrong|mistake|weak topic|revise before next exam|what exams|tests did i|exams did i write|how did i perform|performance|study today|today focus|improve/;

function isMetricQuery(question) {
  return METRIC_QUERY_REGEX.test(String(question || '').toLowerCase());
}

function inferPreferredSubject(question, subjects = []) {
  const q = String(question || '').toLowerCase();
  const known = Array.isArray(subjects) ? subjects : [];
  const direct = known.find((s) => q.includes(String(s || '').toLowerCase()));
  if (direct) return direct;
  if (/math|maths|mathematics/.test(q)) return known.find((s) => /math/i.test(s)) || 'Maths';
  if (/science|physics|chemistry|biology/.test(q)) return known.find((s) => /science|physics|chemistry|biology/i.test(s)) || 'Science';
  if (/english/.test(q)) return known.find((s) => /english/i.test(s)) || 'English';
  if (/ai|artificial intelligence|computer|coding|programming/.test(q)) {
    return known.find((s) => /computer|it|science/i.test(s)) || known[0] || '';
  }
  return known[0] || '';
}

function collectNums(v, out = new Set()) {
  if (v === null || v === undefined) return out;
  if (typeof v === 'number' && Number.isFinite(v)) out.add(String(v));
  else if (Array.isArray(v)) v.forEach((x) => collectNums(x, out));
  else if (typeof v === 'object') Object.values(v).forEach((x) => collectNums(x, out));
  return out;
}

function validateGroundedText(text, facts, options = {}) {
  const strictNumbers = Boolean(options.strictNumbers);
  const t = String(text || '').trim();
  if (!t) return { ok: false, reason: 'empty' };
  const lower = t.toLowerCase();
  if (BANNED_APPROX.some((w) => lower.includes(w))) return { ok: false, reason: 'approx_word' };
  if (!strictNumbers) return { ok: true };
  const allowed = collectNums(facts);
  const nums = t.match(/\b\d+(?:\.\d+)?\b/g) || [];
  for (const n of nums) {
    if (!allowed.has(n)) return { ok: false, reason: `unexpected_number:${n}` };
  }
  return { ok: true };
}

function deterministicStudentReply({ question, facts }) {
  const q = String(question || '').toLowerCase();
  const perf = facts.performance || {};
  const weak = facts.weakTopics?.weakTopics || [];
  const recs = facts.recommendations || {};
  const marks = facts.marks || {};
  const rankings = facts.rankings || {};
  const examRows = facts.examList || [];
  if (/how did i perform|performance|score in/.test(q)) {
    if (perf.latestPercentage == null) return 'I could not find your exam records for this period.';
    return `In your recent exam, you scored ${perf.latestPercentage}%. Your trend is ${perf.trendDirection}.`;
  }
  if (/highest mark|best score|highest score/.test(q)) {
    if (!marks.highestMark) return 'I could not find your exam records for this period.';
    return `Your highest score was in ${marks.highestMark.examTitle} where you scored ${marks.highestMark.percentage}% (${marks.highestMark.obtainedMarks}/${marks.highestMark.totalMarks} marks).`;
  }
  if (/what exams|tests did i|exams did i write/.test(q)) {
    if (!examRows.length) return 'I could not find your exam records for this period.';
    const names = examRows.map((r) => r.examTitle).filter(Boolean);
    return `You completed: ${names.join(', ')}.`;
  }
  if (/attempted exams|how many tests|tests did i complete/.test(q)) {
    if (!examRows.length) return 'I could not find your exam records for this period.';
    return `You have completed ${examRows.length} recent exam attempt(s).`;
  }
  if (/where should i improve|improve/.test(q)) {
    if (!weak.length) return 'I could not find matching weak-topic records in your recent exam data.';
    return `You need improvement in: ${weak.slice(0, 4).map((x) => x.chapter).join(', ')}.`;
  }
  if (/where am i weak|where i am weak|where i'm weak/.test(q)) {
    if (!weak.length) return 'I could not find matching weak-topic records in your recent exam data.';
    return `You are currently weak in: ${weak.slice(0, 4).map((x) => x.chapter).join(', ')}.`;
  }
  if (/what should i study today|study today|today focus/.test(q)) {
    if (!recs.actionCard?.action) return 'I could not find enough progress data to suggest today focus.';
    return `Today Focus: ${recs.actionCard.action}. ${recs.actionCard.reason}`;
  }
  if (/weak subject/.test(q)) {
    const subjectPerf = perf.subjectPerformance || [];
    if (!subjectPerf.length) return 'I could not find enough subject performance data.';
    const weakest = subjectPerf[subjectPerf.length - 1];
    return `Your weakest subject currently is ${weakest.subject} at ${weakest.percentage}%.`;
  }
  if (/rank|leaderboard/.test(q)) {
    if (!rankings.classRank && !rankings.subjectRank && !rankings.leaderboardPosition) {
      return 'I could not find your exam records for this period.';
    }
    return `Your ranking snapshot: class rank ${rankings.classRank ?? 'N/A'}, subject rank ${rankings.subjectRank ?? 'N/A'}, leaderboard position ${rankings.leaderboardPosition ?? 'N/A'}.`;
  }
  if (/compare .*math|maths.*science|science.*math/.test(q)) {
    const subjectPerf = perf.subjectPerformance || [];
    const math = subjectPerf.find((s) => /math/i.test(String(s.subject || '')));
    const science = subjectPerf.find((s) => /science/i.test(String(s.subject || '')));
    if (!math && !science) return 'I could not find enough subject performance data.';
    if (math && science) return `Maths: ${math.percentage}%, Science: ${science.percentage}%.`;
    if (math) return `Maths: ${math.percentage}%. I could not find Science score in recent records.`;
    return `Science: ${science.percentage}%. I could not find Maths score in recent records.`;
  }
  if (/wrong|mistake|weak topic|revise before next exam/.test(q)) {
    if (!weak.length) return 'I could not find matching weak-topic records in your recent exam data.';
    return `Your weak topics are: ${weak.slice(0, 5).map((x) => x.chapter).join(', ')}.`;
  }
  if (/what is|explain|define|how does|difference between|help me in|teach me/.test(q)) {
    const library = facts.contentSources?.schoolContent || [];
    const gen = facts.contentSources?.aiGenerator || [];
    const top = library[0] || gen[0] || null;
    if (top?.topic) {
      return `Let us study ${top.topic}. Start with this concept, then solve 5 practice questions and revise key definitions.`;
    }
    const preferred = inferPreferredSubject(question, facts.profile?.subjects || []);
    return `I can help with ${preferred || 'your subject'} right now. Ask a specific chapter or concept and I will guide you step by step.`;
  }
  return 'I have loaded your academic context and prepared grounded recommendations.';
}

export async function handleStudentMentorChat({
  viewerRole,
  viewerUserId,
  studentId,
  question,
}) {
  const contextResult = await buildStudentDashboardContext({
    viewerRole,
    viewerUserId,
    studentId,
  });
  if (!contextResult.ok) {
    const e = new Error(contextResult.reason || 'Unable to load student context.');
    e.statusCode = 403;
    throw e;
  }
  const ctx = contextResult;
  const performance = analyzeStudentPerformance(ctx);
  const weakTopics = detectWeakAndStrongTopics(ctx);
  const marks = analyzeMarks(ctx.dashboard?.examHistory?.attemptedExams || []);
  const recommendations = buildPersonalizedRecommendations({ ctx, performance, weakTopics });
  const streak = await buildStudyStreak(ctx.studentId);
  const latestProactive = await getLatestProactivePrompt(ctx.studentId);
  const rankings = { classRank: null, subjectRank: null, leaderboardPosition: null };

  const content = await retrieveStudentContent({
    query: question,
    classNumber: ctx.profile.classNumber,
    subject: inferPreferredSubject(question, ctx.profile.subjects),
  });

  const facts = {
    profile: ctx.profile,
    performance,
    marks,
    rankings,
    weakTopics,
    recommendations: { ...recommendations, streak },
    examList: ctx.exams.recentResults.slice(0, 10).map((r) => ({
      examTitle: r.examTitle,
      percentage: r.percentage,
      obtainedMarks: r.obtainedMarks,
      totalMarks: r.totalMarks,
      completedAt: r.completedAt,
    })),
    latestProactivePrompt: latestProactive?.promptText || '',
    contentSources: content,
  };

  const summary = buildPerformanceSummary({ ctx, performance, weakTopics, marks, recommendations, rankings });
  const autoGreeting = buildAutoGreeting(summary);

  // Update memory snapshot for follow-up chats.
  await upsertStudentMemory({
    studentId: ctx.studentId,
    weakTopics: weakTopics.weakTopics,
    strongTopics: weakTopics.strongTopics,
    recommendations: recommendations.nextActions,
    actionCard: recommendations.actionCard,
    streakDays: streak.current,
    lastExamSummary: facts.examList[0] || null,
  }).catch(() => null);

  const strictPrompt = buildStrictStudentMentorPrompt({ question, facts });

  let answer = '';
  let groundingStatus = 'strict_pass';
  const strictNumbers = isMetricQuery(question);
  try {
    answer = String(await geminiService.generateStructuredContent(strictPrompt, 'text') || '').trim();
    const check = validateGroundedText(answer, facts, { strictNumbers });
    if (!check.ok) {
      groundingStatus = 'regen_pass';
      const repair = `${strictPrompt}\nYour previous response failed grounding check (${check.reason}). Regenerate exactly grounded response.`;
      answer = String(await geminiService.generateStructuredContent(repair, 'text') || '').trim();
      const check2 = validateGroundedText(answer, facts, { strictNumbers });
      if (!check2.ok) {
        groundingStatus = 'fallback_pass';
        answer = deterministicStudentReply({ question, facts });
      }
    }
  } catch {
    groundingStatus = 'fallback_pass';
    answer = deterministicStudentReply({ question, facts });
  }

  return {
    message: answer,
    facts,
    summary,
    autoGreeting,
    groundingStatus,
  };
}

