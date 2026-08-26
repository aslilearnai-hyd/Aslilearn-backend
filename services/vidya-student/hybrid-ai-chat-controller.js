import { buildStudentAiContext } from './student-ai-context-engine.js';
import { analyzeStudentPerformance } from './student-performance-analyzer.js';
import { detectWeakAndStrongTopics } from './weak-topic-detection-engine.js';
import { buildPersonalizedRecommendations } from './personalized-recommendation-engine.js';
import { buildStudyStreak, getLatestProactivePrompt } from './dashboard-sync-service.js';
import { analyzeMarks } from './marks-analysis-service.js';
import { buildAutoGreeting, buildPerformanceSummary } from './performance-summary-engine.js';
import { detectQueryIntent, buildGreetingReplyMessage, buildThanksReplyMessage } from './query-intent-detection-engine.js';
import { generateContextAwareAnswer } from './gemini-general-knowledge-service.js';
import { buildPlatformProgressFacts } from './platform-progress-facts.js';
import {
  buildStudentAppDeskFacts,
  matchSubjectFromQuestion,
} from './student-app-desk-facts.js';
import { answerByTopicAndShape } from './student-app-query-router.js';
import { classifyPlatformDataQuestion } from '../vidya-platform-data-firewall.js';

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

function omrSubjectMax(s) {
  if (!s) return 0;
  const attempted = (Number(s.r) || 0) + (Number(s.w) || 0) + (Number(s.l) || 0);
  if (attempted > 0) return attempted;
  return Number(s.marks) > 0 ? 20 : 0;
}

function formatOmrSubjectLine(label, s) {
  const max = omrSubjectMax(s);
  if (!max && !(Number(s?.marks) > 0)) return null;
  const marks = Number(s?.marks) || 0;
  const denom = max || 20;
  const pct = denom ? Math.round((marks / denom) * 100) : 0;
  return `• ${label}: **${marks}/${denom}** (${pct}%)`;
}

function formatOmrDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function buildOmrResultReply(omrList, { all = false } = {}) {
  const list = Array.isArray(omrList) ? omrList : [];
  if (!list.length) {
    return "I don't see any offline sheet results linked to your account yet. After your school uploads the offline score sheet and assigns your Candidate ID, ask me again — or open **Offline Results** in the sidebar.";
  }

  const rows = all ? list.slice(0, 40) : [list[0]];
  let reply = all
    ? `**Your Offline Exam Results** (${list.length} on record):\n\n`
    : `**Your Recent Offline Exam Result:**\n\n`;

  rows.forEach((row, idx) => {
    const title = row.testTitle || 'Offline test';
    const dateLabel = formatOmrDate(row.testDate);
    const rank = row.finalRank ?? row.testRank;
    if (all && rows.length > 1) reply += `**${idx + 1}. ${title}**\n`;
    else reply += `**${title}**\n`;
    if (dateLabel || row.testNo) {
      reply += `• ${dateLabel || 'Date N/A'}${row.testNo ? ` · Test #${row.testNo}` : ''}\n`;
    }
    reply += `• Overall: **${row.percentage ?? 'N/A'}%**`;
    if (row.totalMarks != null) reply += ` · **${row.totalMarks}** total marks`;
    reply += `\n`;
    if (rank != null && rank !== '') reply += `• Rank: **${rank}**\n`;
    if (row.correct != null || row.wrong != null) {
      reply += `• Correct / Wrong / Left: ${row.correct ?? 0} / ${row.wrong ?? 0} / ${row.left ?? 0}`;
      if (row.totalQuestions) reply += ` (of ${row.totalQuestions})`;
      reply += `\n`;
    }
    const subjects = [
      formatOmrSubjectLine('Physics', row.physics),
      formatOmrSubjectLine('Chemistry', row.chemistry),
      formatOmrSubjectLine('Mathematics', row.maths),
      formatOmrSubjectLine('Biology', row.biology),
    ].filter(Boolean);
    if (subjects.length) {
      reply += `\n**Subject-wise:**\n${subjects.join('\n')}\n`;
    }
    if (all && idx < rows.length - 1) reply += `\n`;
  });

  if (!all && list.length > 1) {
    const prev = list[1];
    const delta =
      Math.round(((Number(list[0].percentage) || 0) - (Number(prev.percentage) || 0)) * 10) / 10;
    reply += `\nVs previous Offline Result (**${prev.testTitle || 'previous'}**): ${delta >= 0 ? '+' : ''}${delta}%`;
    reply += `\nYou have **${list.length}** Offline tests — ask **"how many Offline exams do I have"** for the full list.`;
  }

  reply += `\n\nOpen **Offline Results** in the sidebar for the full subject breakdown.`;
  return reply.trim();
}

function buildOmrCountReply(omrList) {
  const list = Array.isArray(omrList) ? omrList : [];
  if (!list.length) {
    return "You don't have any Offline Exams linked yet. When your school uploads and assigns your Candidate ID, the count will show here.";
  }
  let reply = `You have **${list.length}** OMR exam${list.length === 1 ? '' : 's'} on record:\n\n`;
  list.slice(0, 20).forEach((row, i) => {
    const dateLabel = formatOmrDate(row.testDate);
    reply += `${i + 1}. **${row.testTitle || 'OMR test'}** — ${row.percentage ?? 'N/A'}%`;
    if (dateLabel) reply += ` · ${dateLabel}`;
    reply += `\n`;
  });
  if (list.length > 20) reply += `\n…and ${list.length - 20} more.`;
  reply += `\nAsk **"my recent OMR exam result"** for the full subject-wise breakdown of the latest one.`;
  return reply.trim();
}

function buildExamAttemptCountReply(examList, omrList) {
  const exams = Array.isArray(examList) ? examList : [];
  const omr = Array.isArray(omrList) ? omrList : [];
  const inApp = exams.length;
  const omrCount = omr.length;
  const total = inApp + omrCount;

  if (!total) {
    return "You haven't attempted any in-app exams or Offline Sheets yet. Take an exam from **Exams**, or wait for your school to upload Offline Results.";
  }

  let reply = `**Exams you've attempted so far:**\n\n`;
  reply += `• In-app exams: **${inApp}**\n`;
  reply += `• OMR sheet exams: **${omrCount}**\n`;
  reply += `• **Total: ${total}**\n`;

  if (inApp) {
    reply += `\n**Recent in-app exams:**\n`;
    exams.slice(0, 8).forEach((e, i) => {
      reply += `${i + 1}. ${e.examTitle || 'Exam'} — ${e.percentage ?? 'N/A'}%\n`;
    });
  }
  if (omrCount) {
    reply += `\n**OMR exams:**\n`;
    omr.slice(0, 8).forEach((e, i) => {
      reply += `${i + 1}. ${e.testTitle || 'OMR'} — ${e.percentage ?? 'N/A'}%\n`;
    });
  }
  return reply.trim();
}

function appOnlyReply(question, facts) {
  const q = String(question || '').toLowerCase();

  const weak = Array.isArray(facts?.weakTopics?.weakTopics) ? facts.weakTopics.weakTopics : [];
  const strong = Array.isArray(facts?.weakTopics?.strongTopics) ? facts.weakTopics.strongTopics : [];
  const subjectPerf = Array.isArray(facts?.performance?.subjectPerformance) ? facts.performance.subjectPerformance : [];
  const examList = Array.isArray(facts?.examList) ? facts.examList : [];
  const omrList = Array.isArray(facts?.omrList) ? facts.omrList : [];
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
  const desk = facts?.desk || {};
  const deskSubjects = Array.isArray(desk.subjects) ? desk.subjects : [];
  const deskHw = desk.homework || {};
  const deskTotals = desk.totals || {};
  const profileName = facts?.profile?.fullName || desk.profileName || 'there';

  // Shape-aware router first (count vs list vs latest vs detail for every topic)
  const shaped = answerByTopicAndShape(question, facts);
  if (typeof shaped === 'string' && shaped.trim()) {
    return shaped.trim();
  }
  if (shaped && shaped.__delegate === 'omr') {
    if (shaped.shape?.count) return buildOmrCountReply(omrList);
    const wantAll = Boolean(shaped.shape?.list);
    return buildOmrResultReply(omrList, { all: wantAll });
  }

  // ── STUDENT REPORT CARD ─────────────────────────────────────────────────────
  if (/\breport\b|report\s*card/.test(q) && !/omr|offline/.test(q)) {
    let reply = `**📋 ${profileName}'s Report Card**\n\n`;

    // Subject-wise performance
    if (subjectPerf.length) {
      reply += `**Subject-wise Performance:**\n`;
      subjectPerf.forEach((s) => {
        const grade = s.percentage >= 90 ? 'A+' : s.percentage >= 75 ? 'A' : s.percentage >= 60 ? 'B' : s.percentage >= 45 ? 'C' : 'D';
        reply += `• ${s.subject}: **${s.percentage}%** (Grade: ${grade}) — ${s.attempts} exam${s.attempts !== 1 ? 's' : ''}\n`;
      });
      reply += `\n`;
    }

    // Overall stats
    if (marks.averagePercentage != null) {
      reply += `**Overall Average:** ${marks.averagePercentage}%\n`;
    }
    if (marks.highestMark) {
      reply += `**Highest Score:** ${marks.highestMark.percentage}% in "${marks.highestMark.examTitle}"\n`;
    }
    if (examList.length) {
      reply += `**Exams Attempted:** ${examList.length}\n`;
    }

    // OMR results
    if (omrList.length) {
      reply += `\n**Offline Exam Results (${omrList.length}):**\n`;
      omrList.slice(0, 3).forEach((row) => {
        const rank = row.finalRank ?? row.testRank;
        reply += `• ${row.testTitle || 'Offline test'}: **${row.percentage ?? 'N/A'}%**`;
        if (rank != null) reply += ` · Rank: ${rank}`;
        reply += `\n`;
      });
    }

    // Trend
    if (perf.trendDirection && perf.trendDirection !== 'unknown') {
      reply += `\n**Performance Trend:** ${perf.trendDirection}`;
      if (perf.deltaVsPrevious != null) reply += ` (${perf.deltaVsPrevious > 0 ? '+' : ''}${perf.deltaVsPrevious}% vs previous)`;
      reply += `\n`;
    }

    // Weak/strong areas
    if (weak.length) {
      reply += `\n**Needs Improvement:** ${weak.slice(0, 3).map(w => w.chapter).join(', ')}\n`;
    }
    if (strong.length) {
      reply += `**Strong Areas:** ${strong.slice(0, 3).map(s => s.chapter).join(', ')}\n`;
    }

    // Streak / attendance
    if (streakDays > 0) {
      reply += `\n**Study Streak:** ${streakDays} day${streakDays !== 1 ? 's' : ''}\n`;
    }

    if (!subjectPerf.length && !examList.length && !omrList.length) {
      reply = `Hi ${profileName}, I don't have enough exam data to generate your report card yet. Complete exams or ask your school to upload Offline results — then ask me again for your full report.\n\nIn the meantime, ask: **"what should I do today"**, **"upcoming exams"**, or **"my subjects"**.`;
    }

    return reply.trim();
  }

  // ── HOW MANY EXAMS ATTEMPTED (in-app + OMR) ───────────────────────────────
  if (
    /how many exams?.{0,40}(attempt|taken|written|done|till|so far|have i)|exams? (have i|did i) (attempt|take|write)|attempted till now|total exams? (attempted|taken)/.test(
      q,
    ) &&
    !/\bomr\b/.test(q)
  ) {
    return buildExamAttemptCountReply(examList, omrList);
  }

  // ── OMR sheet results ─────────────────────────────────────────────────────
  if (/\bomr\b|optical\s*mark|sheet\s*result|omr\s*(exam|test|result|score|mark)/.test(q)) {
    if (/how many|count|number of|total/.test(q)) {
      return buildOmrCountReply(omrList);
    }
    const wantAll = /all|every|history|list|each|every omr/.test(q);
    return buildOmrResultReply(omrList, { all: wantAll });
  }

  // ── DAILY PLAN / WHAT SHOULD I DO TODAY ───────────────────────────────────
  if (
    /what should i do|today'?s?\s+(plan|focus|task|homework|work)|daily\s+(plan|task|focus)|for today|do today|plan for today|my day/.test(
      q,
    )
  ) {
    let reply = `**Today's plan for you, ${profileName}:**\n\n`;
    const actions = [];
    const todayHw = Array.isArray(deskHw.today) ? deskHw.today : [];
    const overdueHw = Array.isArray(deskHw.overdue) ? deskHw.overdue : [];
    const openExams = Array.isArray(desk.openExams) ? desk.openExams : [];
    const upcoming = Array.isArray(desk.upcomingExams) ? desk.upcomingExams : [];

    if (overdueHw.length) {
      actions.push(
        `Submit overdue homework: ${overdueHw
          .slice(0, 3)
          .map((h) => h.title)
          .join('; ')}`,
      );
    }
    if (todayHw.length) {
      actions.push(
        `Finish today's homework (${todayHw.length}): ${todayHw
          .slice(0, 3)
          .map((h) => `${h.title}${h.subject ? ` — ${h.subject}` : ''}`)
          .join('; ')}`,
      );
    }
    if (openExams.length) {
      actions.push(
        `You have **${openExams.length}** exam(s) open now: ${openExams
          .slice(0, 2)
          .map((e) => e.title)
          .join('; ')}`,
      );
    }
    if (upcoming[0]) {
      actions.push(
        `Prep for upcoming exam **${upcoming[0].title}**${
          upcoming[0].startLabel ? ` (${upcoming[0].startLabel})` : ''
        }`,
      );
    }
    if (videos.inProgress > 0) {
      actions.push(`Resume **${videos.inProgress}** video lesson(s) in progress`);
    }
    if (recs?.actionCard?.action) {
      actions.push(recs.actionCard.action);
    }
    if (weak[0]) {
      actions.push(`Practice weak area: **${weak[0].chapter}**`);
    }
    if (!actions.length) {
      actions.push('Watch 1–2 subject videos', 'Review last exam mistakes', 'Ask me a doubt from any subject');
    }
    actions.slice(0, 6).forEach((a, i) => {
      reply += `${i + 1}. ${a}\n`;
    });
    reply += `\nYou can also ask: **"upcoming exams"**, **"homework today"**, **"how many subjects"**, or **"videos in maths"**.`;
    return reply.trim();
  }

  // ── UPCOMING / OPEN EXAMS ─────────────────────────────────────────────────
  if (
    /upcoming\s+exam|coming\s+exam|next\s+exam|scheduled\s+exam|exams?\s+(this|next)\s+week|what exams? (do i have|are there|are upcoming)|open exams?/.test(
      q,
    ) ||
    (/upcoming|coming up|next week/.test(q) && /exam|test/.test(q))
  ) {
    const upcoming = Array.isArray(desk.upcomingExams) ? desk.upcomingExams : [];
    const openExams = Array.isArray(desk.openExams) ? desk.openExams : [];
    if (!upcoming.length && !openExams.length) {
      return "I don't see any upcoming or open exams for your class right now. Check **Exams** in the sidebar — new ones appear when your school schedules them.";
    }
    let reply = `**Your exams on Asli Learn:**\n\n`;
    if (openExams.length) {
      reply += `**Open now (${openExams.length}):**\n`;
      openExams.forEach((e, i) => {
        reply += `${i + 1}. **${e.title}**`;
        if (e.subject) reply += ` · ${e.subject}`;
        if (e.endLabel) reply += ` · closes ${e.endLabel}`;
        reply += `\n`;
      });
      reply += `\n`;
    }
    if (upcoming.length) {
      reply += `**Upcoming (${upcoming.length}):**\n`;
      upcoming.forEach((e, i) => {
        reply += `${i + 1}. **${e.title}**`;
        if (e.subject) reply += ` · ${e.subject}`;
        if (e.startLabel) reply += ` · starts ${e.startLabel}`;
        reply += `\n`;
      });
    }
    return reply.trim();
  }

  // ── SUBJECTS (how many / list) ────────────────────────────────────────────
  if (
    /how many subjects|number of subjects|my subjects|subjects (do i|have i|are there)|list (my )?subjects|what subjects/.test(
      q,
    ) ||
    (/^subjects\??$/.test(q.trim()) || /\bsubjects\b/.test(q) && /how many|count|list|have/.test(q))
  ) {
    if (!deskSubjects.length) {
      const profileSubjects = Array.isArray(facts?.profile?.subjects) ? facts.profile.subjects : [];
      if (profileSubjects.length) {
        return `You have **${profileSubjects.length}** subject(s):\n${profileSubjects
          .map((s, i) => `${i + 1}. ${s}`)
          .join('\n')}`;
      }
      return "I don't see subjects linked to your class yet. Ask your school admin to assign subjects — then I can list them and video counts.";
    }
    let reply = `You have **${deskSubjects.length}** subject(s) on Asli Learn:\n\n`;
    deskSubjects.forEach((s, i) => {
      reply += `${i + 1}. **${s.name}** — ${s.videoCount || 0} videos`;
      if (s.videoCount > 0) {
        reply += ` (completed **${s.videosCompleted || 0}**, left **${s.videosRemaining || 0}**)`;
      }
      if (s.assessmentCount > 0) reply += ` · ${s.assessmentCount} assessments`;
      reply += `\n`;
    });
    reply += `\nAsk **"how many videos in ${deskSubjects[0]?.name || 'Maths'}"** for one subject.`;
    return reply.trim();
  }

  // ── VIDEOS IN A SUBJECT / COMPLETION COUNTS ───────────────────────────────
  if (
    (/how many videos|videos? (in|for|of)|video count|completed videos|videos (have i|did i) (complete|watch)|videos (left|remaining)/.test(
      q,
    ) &&
      !/exam|test|quiz|mark|score/.test(q)) ||
    (/videos?/.test(q) && matchSubjectFromQuestion(deskSubjects, q))
  ) {
    const matched = matchSubjectFromQuestion(deskSubjects, q);
    if (matched) {
      let reply = `**${matched.name} — videos:**\n`;
      reply += `• Total videos: **${matched.videoCount || 0}**\n`;
      reply += `• Completed: **${matched.videosCompleted || 0}**\n`;
      reply += `• In progress: **${matched.videosInProgress || 0}**\n`;
      reply += `• Remaining: **${matched.videosRemaining || 0}**\n`;
      if (!(matched.videoCount > 0)) {
        reply += `\nNo published videos for this subject yet — check EduOTT / Video Lectures after your teachers upload lessons.`;
      }
      return reply.trim();
    }
    // Overall video stats
    if (deskTotals.videos > 0 || videos.tracked > 0) {
      let reply = `**Your video progress:**\n`;
      if (deskTotals.videos > 0) {
        reply += `• Across subjects: **${deskTotals.videosCompleted || 0}** completed of **${deskTotals.videos}** available\n`;
        reply += `• Remaining: **${deskTotals.videosRemaining || 0}**\n`;
      }
      reply += `• Tracked watch history: **${videos.completed || 0}** completed / **${videos.tracked || 0}** started`;
      if (videos.inProgress > 0) reply += ` (**${videos.inProgress}** in progress)`;
      reply += `\n`;
      if (deskSubjects.length) {
        reply += `\n**By subject:**\n`;
        deskSubjects
          .filter((s) => s.videoCount > 0)
          .slice(0, 8)
          .forEach((s) => {
            reply += `• ${s.name}: ${s.videosCompleted || 0}/${s.videoCount} done\n`;
          });
      }
      return reply.trim();
    }
    return "I don't see video lessons for your subjects yet. Open **EduOTT** or **Video Lectures** once teachers publish videos.";
  }

  // ── HOMEWORK TODAY / PENDING ──────────────────────────────────────────────
  if (/homework|assignment|home\s*work/.test(q)) {
    const todayHw = Array.isArray(deskHw.today) ? deskHw.today : [];
    const overdueHw = Array.isArray(deskHw.overdue) ? deskHw.overdue : [];
    const upcomingHw = Array.isArray(deskHw.upcoming) ? deskHw.upcoming : [];
    const pending = Array.isArray(deskHw.pending) ? deskHw.pending : [];

    if (/today|due today|for today/.test(q) || /what.*(homework|assignment)/.test(q)) {
      if (!todayHw.length && !overdueHw.length) {
        if (upcomingHw.length) {
          return `No homework due **today**. Next up:\n${upcomingHw
            .slice(0, 4)
            .map((h, i) => `${i + 1}. ${h.title}${h.deadlineLabel ? ` — due ${h.deadlineLabel}` : ''}`)
            .join('\n')}`;
        }
        if (pending.length) {
          return `Nothing marked due today, but you still have **${pending.length}** pending homework item(s). Open **Homework** on your dashboard to submit.`;
        }
        return "No homework due today. When teachers assign work with a deadline, I'll list it here.";
      }
      let reply = `**Homework for today:**\n`;
      if (overdueHw.length) {
        reply += `\n**Overdue — submit these first:**\n`;
        overdueHw.slice(0, 5).forEach((h, i) => {
          reply += `${i + 1}. **${h.title}**${h.subject ? ` (${h.subject})` : ''}${
            h.deadlineLabel ? ` — was due ${h.deadlineLabel}` : ''
          }\n`;
        });
      }
      if (todayHw.length) {
        reply += `\n**Due today:**\n`;
        todayHw.slice(0, 6).forEach((h, i) => {
          reply += `${i + 1}. **${h.title}**${h.subject ? ` (${h.subject})` : ''}${
            h.deadlineLabel ? ` — ${h.deadlineLabel}` : ''
          }\n`;
        });
      }
      return reply.trim();
    }

    let reply = `**Homework status:**\n`;
    reply += `• Assigned: **${deskHw.assignedCount ?? pending.length + (deskHw.submittedCount || 0)}**\n`;
    reply += `• Submitted: **${deskHw.submittedCount || homework.submitted || 0}**\n`;
    reply += `• Pending: **${pending.length}**\n`;
    if (overdueHw.length) reply += `• Overdue: **${overdueHw.length}**\n`;
    if (todayHw.length) reply += `• Due today: **${todayHw.length}**\n`;
    if (homework.graded > 0) reply += `• Graded: **${homework.graded}**\n`;
    if (pending.length) {
      reply += `\n**Still pending:**\n`;
      pending.slice(0, 5).forEach((h, i) => {
        reply += `${i + 1}. ${h.title}${h.deadlineLabel ? ` — due ${h.deadlineLabel}` : ''}\n`;
      });
    }
    if (!(deskHw.assignedCount > 0) && !(homework.submitted > 0) && !pending.length) {
      return "I don't have homework assigned to you yet. When teachers post homework, ask \"homework today\" and I'll list what's due.";
    }
    return reply.trim();
  }

  // ── QUIZZES / ASSESSMENTS ─────────────────────────────────────────────────
  if (/quiz|quizzes|assessment/.test(q) && !/exam|omr|mark|score|result/.test(q)) {
    const quizzes = Array.isArray(desk.quizzes) ? desk.quizzes : [];
    if (!quizzes.length) {
      return "No quizzes are assigned to your class yet. When teachers publish quizzes, they'll show up here and under Quizzes on your dashboard.";
    }
    let reply = `**Your quizzes (${quizzes.length}):**\n`;
    quizzes.forEach((qz, i) => {
      reply += `${i + 1}. **${qz.title}**`;
      if (qz.difficulty) reply += ` · ${qz.difficulty}`;
      if (qz.attempted) {
        reply += ` — attempted${qz.score != null ? ` · score ${qz.score}` : ''}${
          qz.completed ? ' · completed' : ''
        }`;
      } else {
        reply += ' — not attempted yet';
      }
      reply += `\n`;
    });
    reply += `\nAttempted **${deskTotals.quizzesAttempted || 0}** of **${deskTotals.quizzes || quizzes.length}**.`;
    return reply.trim();
  }

  // ── CALENDAR / TIMETABLE ──────────────────────────────────────────────────
  if (/calendar|timetable|schedule|what('?s| is) (on |my )?schedule|events? (today|this week)/.test(q)) {
    const events = Array.isArray(desk.calendar) ? desk.calendar : [];
    if (!events.length) {
      return "I don't see upcoming calendar events for your school yet. Check **Schedule / Calendar** in the sidebar when your school posts them.";
    }
    let reply = `**Upcoming on your school calendar (${events.length}):**\n`;
    events.forEach((ev, i) => {
      reply += `${i + 1}. **${ev.title}**`;
      if (ev.startLabel) reply += ` · ${ev.startLabel}`;
      if (ev.type) reply += ` · ${ev.type}`;
      reply += `\n`;
    });
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

  // ── RECENTLY WATCHED / EDUOTT HISTORY ─────────────────────────────────────
  if (
    /watched|watching|watch history|edu\s*ott|video lectures?|lecture/.test(q) &&
    !/exam|test|quiz|mark|score|how many/.test(q)
  ) {
    const recent = Array.isArray(videos.recent) ? videos.recent : [];
    const chaptersBySubject = Array.isArray(videos.chaptersBySubject) ? videos.chaptersBySubject : [];
    if (!recent.length && !(videos.chaptersCompleted > 0) && !(deskTotals.videos > 0)) {
      return "I don't see any video watch progress yet. Open EduOTT or Video Lectures, watch a lesson, and I'll track what you've completed.";
    }
    let reply = `**Your video activity:**\n`;
    reply += `• Started: **${videos.tracked || 0}** · completed **${videos.completed || 0}**`;
    if (videos.inProgress > 0) reply += ` · in progress **${videos.inProgress}**`;
    reply += `\n`;
    if (deskTotals.videos > 0) {
      reply += `• Catalog across your subjects: **${deskTotals.videosCompleted || 0}/${deskTotals.videos}** completed\n`;
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
  if (
    /mark|score|result|percentage|how (much|did)/.test(q) &&
    !/how many/.test(q)
  ) {
    const latest = examList[0];
    const latestOmr = omrList[0];
    if (!latest && !latestOmr) {
      return "I don't have any exam or Offline Results for you yet. Complete an exam or wait for your school to upload Offline Scores.";
    }
    if (!latest && latestOmr) {
      return buildOmrResultReply(omrList, { all: false });
    }
    let reply = `**Your most recent in-app exam:**\n• ${latest.examTitle || 'Exam'}: ${latest.percentage ?? 'N/A'}%`;
    if (marks.averagePercentage != null) {
      reply += `\n\n**Overall average:** ${marks.averagePercentage}%`;
    }
    if (marks.highestMark) {
      reply += `\n**Best exam:** ${marks.highestMark.examTitle} — ${marks.highestMark.percentage}%`;
    }
    if (perf.trendDirection && perf.trendDirection !== 'unknown') {
      reply += `\n**Trend:** Your scores are ${perf.trendDirection}.`;
    }
    if (latestOmr) {
      reply += `\n\nYou also have an **OMR sheet** result (**${latestOmr.testTitle || 'OMR'}** — ${latestOmr.percentage ?? 'N/A'}%). Ask **"my recent OMR exam result"** for subject-wise marks.`;
    }
    return reply;
  }

  // ── SUBJECT PERFORMANCE breakdown ─────────────────────────────────────────
  if (
    (/subject|performance|how (am i doing|doing)|overview|summary/.test(q) ||
      /subject[- ]wise/.test(q)) &&
    !/how many|list my|my subjects|videos? in|homework|upcoming/.test(q)
  ) {
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
  if (/rank|position|standing|topper|top student|leaderboard/.test(q)) {
    const latestOmr = omrList[0];
    const bestRank = desk?.ranking?.bestClassRank;
    let reply = '';
    if (bestRank != null) {
      reply += `Your best recorded class/exam rank is **${bestRank}**.\n`;
    }
    if (latestOmr && (latestOmr.finalRank != null || latestOmr.testRank != null)) {
      const rank = latestOmr.finalRank ?? latestOmr.testRank;
      reply += `On your latest Offline Result (**${latestOmr.testTitle || 'Offline test'}**) your rank is **${rank}** (${latestOmr.percentage ?? 'N/A'}%).\n`;
    }
    if (reply) {
      reply += `\nOpen **Rankings** / **Offline Results** in the sidebar for full leaderboards.`;
      return reply.trim();
    }
    return "I don't have a stored rank for you yet. After exams or Offline uploads, ranks appear here and on the Rankings / Offline Results screens.";
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
    const upcoming = Array.isArray(desk.upcomingExams) ? desk.upcomingExams : [];
    const openExams = Array.isArray(desk.openExams) ? desk.openExams : [];
    let reply = '';
    if (openExams.length || upcoming.length) {
      reply += `**Scheduled exams:**\n`;
      openExams.slice(0, 3).forEach((e) => {
        reply += `• OPEN: **${e.title}**${e.endLabel ? ` · closes ${e.endLabel}` : ''}\n`;
      });
      upcoming.slice(0, 4).forEach((e) => {
        reply += `• UPCOMING: **${e.title}**${e.startLabel ? ` · ${e.startLabel}` : ''}\n`;
      });
      reply += `\n`;
    }
    if (!examList.length) {
      return (
        reply.trim() ||
        "You haven't taken any exams yet. Check the Exams section in your dashboard for upcoming tests."
      );
    }
    reply += `**Your recent completed exams:**\n`;
    examList.slice(0, 5).forEach((e, i) => {
      reply += `${i + 1}. ${e.examTitle || 'Exam'} — ${e.percentage ?? 'N/A'}%\n`;
    });
    if (marks.averagePercentage != null) {
      reply += `\nAverage across completed exams: **${marks.averagePercentage}%**`;
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

  if (!examList.length && !platform.hasAnyActivity && !deskSubjects.length) {
    return "I can see your profile but there's little activity yet. Watch videos, take exams, or join a learning path — then ask me about your progress, videos, or exam status.";
  }

  let reply = `Hi ${profileName} — here's a quick app snapshot:\n\n`;
  if (deskTotals.subjects > 0) {
    reply += `• Subjects: **${deskTotals.subjects}**`;
    if (deskTotals.videos > 0) {
      reply += ` · videos **${deskTotals.videosCompleted || 0}/${deskTotals.videos}** done`;
    }
    reply += `\n`;
  }
  if (deskTotals.homeworkToday > 0 || deskTotals.homeworkOverdue > 0) {
    reply += `• Homework: **${deskTotals.homeworkToday || 0}** due today`;
    if (deskTotals.homeworkOverdue > 0) reply += `, **${deskTotals.homeworkOverdue}** overdue`;
    reply += `\n`;
  }
  if (deskTotals.upcomingExams > 0 || deskTotals.openExams > 0) {
    reply += `• Exams: **${deskTotals.openExams || 0}** open · **${deskTotals.upcomingExams || 0}** upcoming\n`;
  }
  if (latestEx) reply += `• Last exam: **${latestEx.examTitle}** — ${latestEx.percentage ?? 'N/A'}%\n`;
  if (avgPct != null) reply += `• Exam average: **${avgPct}%**\n`;
  if (topWeak) reply += `• Weakest area: **${topWeak.chapter}** (${topWeak.wrongRate}% mistake rate)\n`;
  if (omrList[0]) {
    reply += `• Latest OMR: **${omrList[0].testTitle || 'OMR'}** — ${omrList[0].percentage ?? 'N/A'}%\n`;
  }
  if (recs?.actionCard?.action) reply += `• Focus now: **${recs.actionCard.action}**\n`;
  reply += `\nAsk: **"what should I do today"**, **"homework today"**, **"upcoming exams"**, **"how many subjects"**, or **"videos in maths"**.`;
  return reply.trim();
}

export async function runHybridStudentVidyaChat({
  viewerRole,
  viewerUserId,
  studentId,
  question,
  history = [],
}) {
  const detectedIntent = detectQueryIntent(question);
  const firewall = classifyPlatformDataQuestion(question, 'student');
  const intent = firewall.protected && detectedIntent.type === 'general'
    ? { type: 'application', confidence: 0.99, reason: firewall.reason }
    : detectedIntent;

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
        ? String(ctx.profile?.fullName || ctx.profile?.name || ctx.profile?.studentName || '').trim()
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
  let desk = {
    subjects: [],
    upcomingExams: [],
    openExams: [],
    homework: { today: [], upcoming: [], overdue: [], pending: [], submittedCount: 0 },
    totals: {},
  };
  try {
    desk = await buildStudentAppDeskFacts(ctx.studentId, {
      progressRows: ctx.academics?.progressRows || [],
      homeworkRows: ctx.academics?.homeworkRows || [],
    });
  } catch (deskErr) {
    console.warn('Vidya desk facts:', deskErr?.message || deskErr);
  }
  const recommendations = buildPersonalizedRecommendations({
    ctx,
    performance,
    weakTopics,
    platform,
    desk,
  });
  const streak = await buildStudyStreak(ctx.studentId);
  const latestProactive = await getLatestProactivePrompt(ctx.studentId);
  const facts = {
    profile: ctx.profile,
    performance,
    weakTopics,
    marks,
    platform,
    desk,
    recommendations: { ...recommendations, streak },
    latestProactivePrompt: latestProactive?.promptText || '',
    examList: (ctx.exams?.recentResults || []).slice(0, 50),
    omrList: (ctx.omr?.recentResults || []).slice(0, 50),
  };
  const summary = buildPerformanceSummary({ ctx, performance, weakTopics, marks, recommendations });
  const autoGreeting = buildAutoGreeting(summary);

  // Private progress/account questions are answered deterministically from the
  // authenticated database snapshot. This is cheaper and cannot invent marks.
  if (firewall.protected || intent.type === 'application') {
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

  // ── Smart AI routing: send everything to Gemini WITH student data context ──
  const classLevel = String(ctx.profile?.classNumber || '').replace(/[^\d]/g, '');
  const studentDataSummary = buildStudentDataSummaryForAI(facts);

  try {
    const smartAnswer = await generateContextAwareAnswer({
      question,
      classLevel,
      board: ctx.profile?.board || '',
      enrolledSubjects: ctx.profile?.subjects || [],
      studentDataSummary,
      conversationHistory: history,
    });
    return {
      mode: intent.type === 'application' ? 'application' : intent.type === 'general' ? 'general' : 'hybrid',
      intent,
      message: smartAnswer,
      groundingStatus: 'ai_context_aware',
      facts,
      summary,
      autoGreeting,
    };
  } catch (err) {
    // Fallback to template-based reply if Gemini fails
    if (intent.type === 'general') {
      return {
        mode: 'general',
        intent,
        message: connectionFallbackMessage(),
        groundingStatus: 'ai_error',
        facts: { profile: ctx.profile, error: String(err?.message || err) },
        summary: null,
        autoGreeting: null,
      };
    }
    return {
      mode: 'application',
      intent,
      message: appOnlyReply(question, facts),
      groundingStatus: 'application_fallback',
      facts,
      summary,
      autoGreeting,
    };
  }
}

/**
 * Builds a concise text summary of the student's real data for the AI prompt.
 */
function buildStudentDataSummaryForAI(facts) {
  const lines = [];
  const profile = facts?.profile || {};
  const marks = facts?.marks || {};
  const perf = facts?.performance || {};
  const weak = Array.isArray(facts?.weakTopics?.weakTopics) ? facts.weakTopics.weakTopics : [];
  const strong = Array.isArray(facts?.weakTopics?.strongTopics) ? facts.weakTopics.strongTopics : [];
  const examList = Array.isArray(facts?.examList) ? facts.examList : [];
  const omrList = Array.isArray(facts?.omrList) ? facts.omrList : [];
  const platform = facts?.platform || {};
  const desk = facts?.desk || {};
  const recs = facts?.recommendations || {};
  const deskSubjects = Array.isArray(desk.subjects) ? desk.subjects : [];
  const deskTotals = desk.totals || {};

  // Profile
  lines.push(`Student: ${profile.fullName || profile.name || 'Unknown'}`);
  if (profile.classNumber) {
    lines.push(`Class: ${profile.classNumber}${profile.section ? ` ${profile.section}` : ''}`);
  }
  if (profile.board) lines.push(`Board: ${profile.board}`);
  if (profile.schoolName) lines.push(`School: ${profile.schoolName}`);
  if (Array.isArray(profile.subjects) && profile.subjects.length) {
    lines.push(`Enrolled subjects: ${profile.subjects.join(', ')}`);
  }

  // Subjects with video progress
  if (deskSubjects.length) {
    lines.push(`\nSubjects (${deskSubjects.length}):`);
    deskSubjects.forEach((s) => {
      lines.push(
        `  ${s.name}: ${s.videoCount || 0} videos (completed ${s.videosCompleted || 0}, remaining ${s.videosRemaining || 0})${s.assessmentCount ? `, ${s.assessmentCount} assessments` : ''}`,
      );
    });
  }

  // Videos (platform.videos uses tracked, not total)
  const videos = platform?.videos || {};
  const recentVideos = Array.isArray(videos.recent) ? videos.recent : [];
  if (videos.tracked > 0 || videos.completed > 0 || deskTotals.videos > 0 || recentVideos.length) {
    lines.push(
      `\nVideos: ${videos.completed || 0} completed, ${videos.inProgress || 0} in progress, ${videos.tracked || deskTotals.videos || 0} tracked`,
    );
    if (deskTotals.videos) {
      lines.push(`  Library videos available: ${deskTotals.videos} (completed ${deskTotals.videosCompleted || 0})`);
    }
    recentVideos.slice(0, 8).forEach((v) => {
      lines.push(
        `  - ${v.title}${v.subject ? ` (${v.subject})` : ''}: ${v.completed ? 'done' : `${v.progress || 0}%`}`,
      );
    });
  } else if (deskTotals.videos > 0) {
    lines.push(`\nVideos available: ${deskTotals.videos} (completed ${deskTotals.videosCompleted || 0})`);
  } else {
    lines.push(`\nVideos: none watched yet`);
  }

  // Exam performance
  if (examList.length) {
    lines.push(`\nOnline Exams (${examList.length} attempted):`);
    examList.slice(0, 8).forEach(e => {
      lines.push(`  - ${e.examTitle || e.title || 'Exam'}: ${e.percentage ?? 'N/A'}%`);
    });
    if (marks.averagePercentage != null) lines.push(`  Average: ${marks.averagePercentage}%`);
    if (marks.highestMark) lines.push(`  Highest: ${marks.highestMark.percentage}% in "${marks.highestMark.examTitle}"`);
  } else {
    lines.push(`\nOnline Exams: None attempted yet`);
  }

  // OMR results
  if (omrList.length) {
    lines.push(`\nOffline/OMR Results (${omrList.length}):`);
    omrList.slice(0, 5).forEach(row => {
      const rank = row.finalRank ?? row.testRank;
      const subjectParts = ['maths', 'physics', 'chemistry', 'biology']
        .map((key) => {
          const value = row?.[key];
          const pct = value?.percentage ?? value?.percent ?? value?.score;
          return pct != null ? `${key}: ${pct}${String(pct).includes('%') ? '' : '%'}` : '';
        })
        .filter(Boolean);
      lines.push(`  - ${row.testTitle || 'Test'}: ${row.percentage ?? 'N/A'}%${rank != null ? ` (Rank: ${rank})` : ''}${subjectParts.length ? `; ${subjectParts.join(', ')}` : ''}`);
    });
  }

  // Performance trend
  if (perf.trendDirection && perf.trendDirection !== 'unknown') {
    lines.push(`\nPerformance trend: ${perf.trendDirection}${perf.deltaVsPrevious != null ? ` (${perf.deltaVsPrevious > 0 ? '+' : ''}${perf.deltaVsPrevious}% vs previous)` : ''}`);
  }

  // Weak/strong
  if (weak.length) lines.push(`Weak areas: ${weak.slice(0, 5).map(w => `${w.chapter} (${w.wrongRate}% mistakes)`).join(', ')}`);
  if (strong.length) lines.push(`Strong areas: ${strong.slice(0, 5).map(s => s.chapter).join(', ')}`);

  // Videos already summarised above from platform.videos.tracked / recent

  // Homework
  const hw = desk.homework || {};
  const todayHw = Array.isArray(hw.today) ? hw.today : [];
  const upcomingHw = Array.isArray(hw.upcoming) ? hw.upcoming : [];
  const overdueHw = Array.isArray(hw.overdue) ? hw.overdue : [];
  if (todayHw.length || upcomingHw.length || overdueHw.length || Number(hw.submittedCount) > 0) {
    lines.push(`\nHomework: ${todayHw.length} due today, ${upcomingHw.length} upcoming, ${overdueHw.length} overdue, ${Number(hw.submittedCount) || 0} submitted`);
    todayHw.slice(0, 3).forEach(h => lines.push(`  Today: ${h.title}${h.subject ? ` (${h.subject})` : ''}`));
    upcomingHw.slice(0, 3).forEach(h => lines.push(`  Upcoming: ${h.title}${h.subject ? ` (${h.subject})` : ''}${h.dueLabel ? ` — ${h.dueLabel}` : ''}`));
    overdueHw.slice(0, 3).forEach(h => lines.push(`  Overdue: ${h.title}`));
  }

  // Upcoming exams
  const upcoming = Array.isArray(desk.upcomingExams) ? desk.upcomingExams : [];
  const openExams = Array.isArray(desk.openExams) ? desk.openExams : [];
  if (openExams.length || upcoming.length) {
    lines.push(`\nExam schedule:`);
    openExams.slice(0, 3).forEach(e => lines.push(`  OPEN NOW: ${e.title}${e.endLabel ? ` (closes ${e.endLabel})` : ''}`));
    upcoming.slice(0, 3).forEach(e => lines.push(`  Upcoming: ${e.title}${e.startLabel ? ` (${e.startLabel})` : ''}`));
  }

  const quizzes = Array.isArray(desk.quizzes) ? desk.quizzes : [];
  if (quizzes.length) {
    lines.push(`\nQuizzes/assessments (${quizzes.length} available):`);
    quizzes.slice(0, 8).forEach((quiz) => {
      lines.push(`  - ${quiz.title || 'Quiz'}${quiz.subject ? ` (${quiz.subject})` : ''}: ${quiz.attempted ? `attempted${quiz.score != null ? `, score ${quiz.score}` : ''}` : 'not attempted'}`);
    });
  }

  const calendar = Array.isArray(desk.calendar) ? desk.calendar : [];
  if (calendar.length) {
    lines.push(`\nUpcoming calendar/timetable events:`);
    calendar.slice(0, 8).forEach((event) => {
      lines.push(`  - ${event.title || 'Event'}${event.startLabel ? ` — ${event.startLabel}` : ''}${event.type ? ` (${event.type})` : ''}`);
    });
  }

  const sessions30d = Number(recs?.attendanceRate30d);
  if (Number.isFinite(sessions30d)) {
    lines.push(`\nStudy activity in the last 30 days: ${sessions30d}% of days active`);
  }

  // Streak
  const streak = recs?.streak || {};
  const streakDays = streak?.current ?? streak?.count ?? 0;
  if (streakDays > 0) lines.push(`\nStudy streak: ${streakDays} days`);

  // Learning paths
  const paths = Array.isArray(platform?.learningPaths) ? platform.learningPaths : [];
  if (paths.length) {
    lines.push(`\nLearning paths (${paths.length}):`);
    paths.slice(0, 3).forEach((p) =>
      lines.push(`  - ${p.title || p.name}: ${p.progressPct ?? p.completionPercent ?? 0}% complete`),
    );
  }

  // Recommendations
  if (recs?.actionCard?.action) {
    lines.push(`\nRecommended focus: ${recs.actionCard.action}`);
  }

  // Totals summary
  if (deskTotals.subjects > 0) {
    lines.push(`\nTotals: ${deskTotals.subjects} subjects, ${deskTotals.videos || 0} videos, ${deskTotals.videosCompleted || 0} videos done`);
  }

  return lines.join('\n');
}

