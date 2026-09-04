/**
 * Shape-aware routing for student Vidya app answers.
 * Count ≠ detail ≠ list — match the question form, not just the topic keyword.
 */

import { matchSubjectFromQuestion } from './student-app-desk-facts.js';

export function detectAppQueryShape(question) {
  const q = String(question || '').toLowerCase().trim();
  const count =
    /\bhow many\b|\bcount\b|\bnumber of\b|\btotal\b|\bhow much\b/.test(q) &&
    !/\bhow much (time|longer|does|do)\b/.test(q);
  const list = /\b(all|list|every|each|history|show all|give all)\b/.test(q);
  const latest = /\b(recent|latest|last|newest|just now)\b/.test(q);
  const detail =
    /\b(marks?|score|result|percentage|breakdown|subject[- ]wise|detail|report|rank)\b/.test(q) ||
    (!count && !list);
  return {
    count,
    list: list && !count,
    latest: latest && !count,
    detail: detail && !count,
  };
}

export function detectAppTopic(question) {
  const q = String(question || '').toLowerCase();
  if (/teachers?['’]?\s*(?:reports?|updates?)|teachers?\s+(?:daily|weekly)\s+(?:reports?|updates?)|work\s*diary/.test(q)) return 'teacher_reports';
  if (/\bomr\b|optical\s*mark/.test(q)) return 'omr';
  if (/homework|assignment|home\s*work/.test(q)) return 'homework';
  if (/learning\s*path|path\s+progress/.test(q)) return 'paths';
  if (/quiz|quizzes/.test(q) && !/exam/.test(q)) return 'quizzes';
  if (/calendar|timetable|schedule|events?\b/.test(q) && !/exam/.test(q)) return 'calendar';
  if (/subject/.test(q) && !/weak|strong|performance|video/.test(q)) return 'subjects';
  if (/video|lecture|edu\s*ott|watched|watching/.test(q)) return 'videos';
  if (/upcoming|open exam|next exam|scheduled exam/.test(q)) return 'upcoming_exams';
  if (
    /how many exams|exams? (have i|did i) (attempt|take|write)|attempted (till|so far)|total exams/.test(
      q,
    )
  ) {
    return 'exam_attempts';
  }
  if (/rank|leaderboard|standing|topper/.test(q)) return 'rank';
  if (/streak|attend|how many days|study days|consistent/.test(q) && !/exam|omr|video|homework/.test(q)) {
    return 'streak';
  }
  if (/library|content (item|progress)|digital library/.test(q)) return 'library';
  if (/what should i do|today'?s?\s+(plan|focus|task)|daily\s+plan|do today|my day/.test(q)) {
    return 'daily';
  }
  if (/weak|struggle|difficult|bad at/.test(q)) return 'weak';
  if (/strong|good at|best (subject|topic)/.test(q)) return 'strong';
  if (/progress|how am i doing|overview|summary|status/.test(q)) return 'progress';
  if (/mark|score|result|percentage|exam|test/.test(q)) return 'exam_marks';
  return null;
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

function listLines(items, mapFn, limit = 20) {
  const rows = (items || []).slice(0, limit);
  return rows.map((item, i) => `${i + 1}. ${mapFn(item, i)}`).join('\n');
}

/**
 * Returns a reply string when topic+shape can be answered, else null (fall through).
 */
export function answerByTopicAndShape(question, facts) {
  const q = String(question || '').toLowerCase();
  const shape = detectAppQueryShape(q);
  const topic = detectAppTopic(q);
  if (!topic) return null;

  const examList = Array.isArray(facts?.examList) ? facts.examList : [];
  const omrList = Array.isArray(facts?.omrList) ? facts.omrList : [];
  const desk = facts?.desk || {};
  if (desk.unavailable && ['subjects', 'videos', 'homework', 'quizzes', 'upcoming_exams', 'calendar', 'rank', 'teacher_reports'].includes(topic)) {
    return 'I couldn’t load that dashboard section right now. Please try again; this does not mean there are no records.';
  }
  const deskSubjects = Array.isArray(desk.subjects) ? desk.subjects : [];
  const deskHw = desk.homework || {};
  const deskTotals = desk.totals || {};
  const videos = facts?.platform?.videos || {};
  const paths = Array.isArray(facts?.platform?.learningPaths) ? facts.platform.learningPaths : [];
  const marks = facts?.marks || {};
  const perf = facts?.performance || {};

  if (topic === 'teacher_reports') {
    const reports = Array.isArray(desk.teacherReports) ? desk.teacherReports : [];
    const now = new Date();
    const startOfWeek = new Date(now);
    const day = (startOfWeek.getDay() + 6) % 7;
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - day);
    const thisWeek = /this\s+week|weekly/.test(q);
    const selected = thisWeek
      ? reports.filter((row) => row.forDate && new Date(row.forDate) >= startOfWeek)
      : reports;
    if (shape.count) {
      return `You have **${selected.length}** teacher update${selected.length === 1 ? '' : 's'}${thisWeek ? ' this week' : ''}.`;
    }
    if (!selected.length) {
      return thisWeek
        ? 'No teacher updates have been posted for your class this week yet.'
        : 'No teacher updates have been posted for your class yet.';
    }
    return (
      `**Teachers Report${thisWeek ? ' — this week' : ''}:**\n\n` +
      listLines(
        selected,
        (row) =>
          `**${row.title || 'Class update'}**${row.teacherName ? ` — ${row.teacherName}` : ''}` +
          `${row.classDisplay ? ` · ${row.classDisplay}` : ''}${row.dateLabel ? ` · ${row.dateLabel}` : ''}\n${row.content}`,
        20,
      )
    );
  }

  if (topic === 'exam_attempts') {
    const inApp = examList.length;
    const omrCount = omrList.length;
    const total = inApp + omrCount;
    if (!total) {
      return "You haven't attempted any in-app exams or OMR sheets yet.";
    }
    if (shape.count && !shape.list) {
      return (
        `**Exams you've attempted:**\n• In-app: **${inApp}**\n• OMR: **${omrCount}**\n• **Total: ${total}**\n\n` +
        `Ask **"list exams I attempted"** for titles and scores.`
      ).trim();
    }
    let reply = `**Exams you've attempted:**\n• In-app: **${inApp}**\n• OMR: **${omrCount}**\n• **Total: ${total}**\n`;
    if (inApp) {
      reply += `\n**In-app:**\n${listLines(examList, (e) => `${e.examTitle || 'Exam'} — ${e.percentage ?? 'N/A'}%`, 10)}\n`;
    }
    if (omrCount) {
      reply += `\n**OMR:**\n${listLines(omrList, (e) => `${e.testTitle || 'OMR'} — ${e.percentage ?? 'N/A'}%`, 10)}\n`;
    }
    return reply.trim();
  }

  if (topic === 'omr') {
    if (!omrList.length) {
      return "No offline exams are linked to your account yet. Open **Offline Results** after your school assigns your Candidate ID.";
    }
    if (shape.count) {
      let reply = `You have **${omrList.length}** OMR exam${omrList.length === 1 ? '' : 's'}.\n\n`;
      reply += listLines(
        omrList,
        (row) => {
          const d = formatOmrDate(row.testDate);
          return `**${row.testTitle || 'OMR'}** — ${row.percentage ?? 'N/A'}%${d ? ` · ${d}` : ''}`;
        },
        25,
      );
      reply += `\n\nAsk **"my recent OMR marks"** for the full subject-wise scorecard.`;
      return reply.trim();
    }
    // detail / latest / list handled by caller helpers — signal with special return
    return { __delegate: 'omr', shape };
  }

  if (topic === 'subjects') {
    if (!deskSubjects.length) {
      const profileSubjects = Array.isArray(facts?.profile?.subjects) ? facts.profile.subjects : [];
      if (!profileSubjects.length) return "No subjects are assigned to you yet.";
      return shape.count
        ? `You have **${profileSubjects.length}** subject(s).`
        : `You have **${profileSubjects.length}** subject(s):\n${listLines(profileSubjects, (s) => s)}`;
    }
    if (shape.count && !shape.list && !/video|complete/.test(q)) {
      return `You have **${deskSubjects.length}** subject(s). Ask **"list my subjects"** for names and video progress.`;
    }
    let reply = `You have **${deskSubjects.length}** subject(s):\n\n`;
    reply += listLines(
      deskSubjects,
      (s) =>
        `**${s.name}** — ${s.videosCompleted || 0}/${s.videoCount || 0} videos done` +
        (s.videosRemaining ? ` · ${s.videosRemaining} left` : ''),
      40,
    );
    return reply.trim();
  }

  if (topic === 'videos') {
    if (/\biit\b|\bneet\b|\b(alpha|beta|gamma|delta)\b/.test(q)) {
      const eduott = facts?.eduott;
      if (!eduott?.verified) return 'I couldn’t load your EduOTT video count right now. Please try again.';
      if (!eduott.enabled) return 'IIT/EduOTT is not enabled for your assigned school/class tracks yet.';
      return `You have **${eduott.total} IIT${eduott.track ? ` ${eduott.track}` : ''}${eduott.subject ? ` ${eduott.subject}` : ''} videos** available in EduOTT${eduott.classNumber ? ` for Class ${eduott.classNumber}` : ''}.`;
    }
    const matched = matchSubjectFromQuestion(deskSubjects, q);
    if (matched) {
      return (
        `**${matched.name} — videos**\n` +
        `• Total: **${matched.videoCount || 0}**\n` +
        `• Completed: **${matched.videosCompleted || 0}**\n` +
        `• In progress: **${matched.videosInProgress || 0}**\n` +
        `• Remaining: **${matched.videosRemaining || 0}**`
      );
    }
    if (shape.count) {
      const total = deskTotals.videos || videos.tracked || 0;
      const done = deskTotals.videosCompleted || videos.completed || 0;
      return `Across your subjects: **${done}** of **${total}** videos completed` +
        (videos.inProgress ? ` (**${videos.inProgress}** in progress)` : '') +
        `. Ask **"videos in maths"** for one subject.`;
    }
    return null; // fall through to recent-watched narrative
  }

  if (topic === 'homework') {
    const today = deskHw.today || [];
    const overdue = deskHw.overdue || [];
    const pending = deskHw.pending || [];
    const upcoming = deskHw.upcoming || [];
    if (shape.count) {
      return (
        `**Homework counts:** due today **${today.length}**, overdue **${overdue.length}**, ` +
        `pending **${pending.length}**, submitted **${deskHw.submittedCount || 0}**.`
      );
    }
    if (/today|due today/.test(q) || shape.latest) {
      if (!today.length && !overdue.length) {
        return upcoming.length
          ? `Nothing due today. Next homework:\n${listLines(upcoming, (h) => `${h.title}${h.deadlineLabel ? ` — ${h.deadlineLabel}` : ''}`, 8)}`
          : 'No homework due today.';
      }
      let reply = '**Homework for today:**\n';
      if (overdue.length) {
        reply += `\nOverdue:\n${listLines(overdue, (h) => `**${h.title}**${h.subject ? ` (${h.subject})` : ''}`, 10)}\n`;
      }
      if (today.length) {
        reply += `\nDue today:\n${listLines(today, (h) => `**${h.title}**${h.subject ? ` (${h.subject})` : ''}`, 10)}\n`;
      }
      return reply.trim();
    }
    let reply = `**Homework status:**\n`;
    reply += `• Due today: **${today.length}** · overdue **${overdue.length}** · pending **${pending.length}** · submitted **${deskHw.submittedCount || 0}**\n`;
    if (pending.length) {
      reply += `\n**Pending:**\n${listLines(pending, (h) => `${h.title}${h.deadlineLabel ? ` — due ${h.deadlineLabel}` : ''}`, 12)}`;
    } else if (upcoming.length) {
      reply += `\n**Upcoming:**\n${listLines(upcoming, (h) => `${h.title}${h.deadlineLabel ? ` — ${h.deadlineLabel}` : ''}`, 8)}`;
    } else if (!today.length && !overdue.length) {
      return "I don't have homework assigned to you yet. When teachers post work, ask **homework today**.";
    }
    return reply.trim();
  }

  if (topic === 'quizzes') {
    const quizzes = Array.isArray(desk.quizzes) ? desk.quizzes : [];
    if (shape.count) {
      const attempted = quizzes.filter((x) => x.attempted).length;
      return `You have **${quizzes.length}** quiz${quizzes.length === 1 ? '' : 'zes'} · attempted **${attempted}**.`;
    }
    if (!quizzes.length) return 'No quizzes assigned to your class yet.';
    return (
      `**Your quizzes (${quizzes.length}):**\n` +
      listLines(
        quizzes,
        (qz) =>
          `**${qz.title}**${qz.attempted ? ` — attempted${qz.score != null ? ` · ${qz.score}` : ''}` : ' — not attempted'}`,
        25,
      )
    );
  }

  if (topic === 'upcoming_exams') {
    const upcoming = desk.upcomingExams || [];
    const open = desk.openExams || [];
    if (shape.count) {
      return `Open exams: **${open.length}** · Upcoming: **${upcoming.length}**.`;
    }
    if (!upcoming.length && !open.length) {
      return "I don't see any upcoming or open exams for your class right now.";
    }
    let reply = '**Your exams on Asli Learn:**\n';
    if (open.length) {
      reply += `\n**Open now (${open.length}):**\n${listLines(
        open,
        (e) => `**${e.title}**${e.endLabel ? ` · closes ${e.endLabel}` : ''}`,
        15,
      )}\n`;
    }
    if (upcoming.length) {
      reply += `\n**Upcoming (${upcoming.length}):**\n${listLines(
        upcoming,
        (e) => `**${e.title}**${e.startLabel ? ` · ${e.startLabel}` : ''}`,
        15,
      )}`;
    }
    return reply.trim();
  }

  if (topic === 'calendar') {
    const events = desk.calendar || [];
    if (shape.count) return `You have **${events.length}** upcoming calendar event(s).`;
    if (!events.length) return "I don't see upcoming calendar events for your school yet.";
    return (
      `**Upcoming on your school calendar (${events.length}):**\n` +
      listLines(events, (ev) => `**${ev.title}**${ev.startLabel ? ` · ${ev.startLabel}` : ''}`, 20)
    );
  }

  if (topic === 'paths') {
    if (shape.count) return `You are enrolled in **${paths.length}** learning path(s).`;
    if (!paths.length) {
      return "You're not enrolled in any learning paths yet. Open Learning Paths to join one.";
    }
    return (
      `**Your learning paths (${paths.length}):**\n` +
      listLines(
        paths,
        (p) =>
          `${p.title} — ${p.progressPct != null ? `${p.progressPct}%` : 'enrolled'}` +
          (p.totalVideos ? ` (${p.completedItems || 0}/${p.totalVideos} videos)` : ''),
        20,
      )
    );
  }

  if (topic === 'exam_marks') {
    if (shape.count) {
      return answerByTopicAndShape('how many exams have i attempted', facts);
    }
    // latest / detail for in-app marks
    if (!examList.length && omrList.length) {
      return { __delegate: 'omr', shape: { ...shape, detail: true } };
    }
    if (!examList.length) {
      return "I don't have in-app exam results yet. Complete an exam, or ask about **OMR** if you mean sheet scores.";
    }
    if (shape.list) {
      let reply = `**All recent in-app exam results (${examList.length}):**\n`;
      reply += listLines(
        examList,
        (e) => `${e.examTitle || 'Exam'} — ${e.percentage ?? 'N/A'}%`,
        25,
      );
      if (marks.averagePercentage != null) {
        reply += `\n\nAverage: **${marks.averagePercentage}%**`;
      }
      if (omrList.length) {
        reply += `\n\nAlso **${omrList.length}** OMR exam(s) — ask **"how many OMR exams"**.`;
      }
      return reply.trim();
    }
    const latest = examList[0];
    let reply = `**Your most recent in-app exam:**\n• ${latest.examTitle || 'Exam'}: **${latest.percentage ?? 'N/A'}%**`;
    if (marks.averagePercentage != null) reply += `\n• Overall average: **${marks.averagePercentage}%**`;
    if (marks.highestMark) {
      reply += `\n• Best: **${marks.highestMark.examTitle}** — ${marks.highestMark.percentage}%`;
    }
    if (perf.trendDirection && perf.trendDirection !== 'unknown') {
      reply += `\n• Trend: **${perf.trendDirection}**`;
    }
    reply += `\n• In-app attempts on record: **${examList.length}**`;
    if (omrList.length) {
      reply += `\n\nYou also have **${omrList.length}** OMR result(s). Ask **"my OMR marks"** for sheet scores.`;
    }
    return reply.trim();
  }

  if (topic === 'rank') {
    const bestRank = desk?.ranking?.bestClassRank;
    const latestOmr = omrList[0];
    const omrRank = latestOmr?.finalRank ?? latestOmr?.testRank;
    if (shape.count && bestRank == null && omrRank == null) {
      return "I don't have a stored rank for you yet.";
    }
    if (bestRank == null && omrRank == null) {
      return "I don't have a stored rank for you yet. After exams or OMR uploads, ranks appear here.";
    }
    let reply = '**Your ranks:**\n';
    if (bestRank != null) reply += `• Best class/exam rank on record: **${bestRank}**\n`;
    if (omrRank != null) {
      reply += `• Latest OMR (**${latestOmr.testTitle || 'OMR'}**): rank **${omrRank}** (${latestOmr.percentage ?? 'N/A'}%)\n`;
    }
    return reply.trim();
  }

  if (topic === 'streak') {
    const streak = facts?.recommendations?.streak || {};
    const days = streak?.current ?? streak?.count ?? 0;
    const rate = facts?.recommendations?.attendanceRate30d;
    if (shape.count) {
      return days > 0
        ? `Your current study streak is **${days}** day${days === 1 ? '' : 's'}.`
        : "No active study streak yet — study today to start one.";
    }
    let reply = days > 0
      ? `**Study streak: ${days} day${days === 1 ? '' : 's'}** — keep going!\n`
      : 'No active study streak yet.\n';
    if (rate != null) reply += `Study activity (last 30 days): **${rate}%** of days active.`;
    return reply.trim();
  }

  if (topic === 'library') {
    const library = facts?.platform?.libraryContent || {};
    const tracked = library.tracked || 0;
    const done = library.completed || 0;
    if (shape.count) {
      return tracked
        ? `Library items: **${done}** completed of **${tracked}** tracked.`
        : 'No library content progress tracked yet.';
    }
    if (!tracked) return 'No library / digital content progress yet.';
    return `**Library / content:** completed **${done}** of **${tracked}** tracked items.`;
  }

  if (topic === 'daily' || topic === 'progress' || topic === 'weak' || topic === 'strong') {
    return null; // existing narrative handlers in hybrid controller
  }

  return null;
}
