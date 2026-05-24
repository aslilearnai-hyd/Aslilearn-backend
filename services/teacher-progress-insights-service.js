/**
 * Rule-based progress insights for teacher track-progress (no LLM).
 * Plain, teacher-friendly language from exams, usage, progress, homework, and remarks.
 */

const EXAM_LOW = 50;
const EXAM_GOOD = 70;
const PROGRESS_LOW = 50;
const PROGRESS_GOOD = 70;
const USAGE_LOW_MIN = 15;
const USAGE_GOOD_MIN = 30;
const MAX_NAMES = 5;

function studentName(s) {
  return String(s?.name || s?.fullName || s?.email || 'Student').trim();
}

function formatNameList(names) {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length <= MAX_NAMES) return unique.join(', ');
  return `${unique.slice(0, MAX_NAMES).join(', ')} and ${unique.length - MAX_NAMES} more`;
}

function sentence(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return t.endsWith('.') ? t : `${t}.`;
}

/** One student — short, easy-to-read recommendation for the View dialog */
function buildSingleStudentInsight(student, remarksSample = []) {
  const name = studentName(student);
  const totalExams = Number(student.totalExams) || 0;
  const avgPct =
    student.averagePercentage != null && student.averagePercentage !== ''
      ? Number(student.averagePercentage)
      : null;
  const overall = Number(student.overallProgress) || 0;
  const learning = Number(student.learningProgress) || 0;
  const usage = Number(student.dailyAverageWatchTime) || 0;
  const hwAssigned = Number(student.homeworkAssigned) || 0;
  const hwSubmitted = Number(student.homeworkSubmitted) || 0;

  const studentRemarks = (remarksSample || []).filter(
    (r) => String(r.studentName || '').toLowerCase() === name.toLowerCase()
  );
  const hasCorrectiveRemark = studentRemarks.some((r) => r.isPositive === false);

  const concerns = [];
  const doingWell = [];

  if (usage <= 0) {
    concerns.push('is hardly using the learning platform (no daily study time recorded)');
  } else if (usage < USAGE_LOW_MIN) {
    concerns.push(
      `is only spending about ${usage.toFixed(0)} minutes per day on the platform, which is less than expected`
    );
  } else if (usage >= USAGE_GOOD_MIN) {
    doingWell.push('is logging in and studying on the platform regularly');
  }

  if (learning > 0 && learning < PROGRESS_LOW) {
    concerns.push(`has completed only about ${learning.toFixed(0)}% of the assigned lessons so far`);
  } else if (overall > 0 && overall < PROGRESS_LOW) {
    concerns.push(`overall progress is still low (around ${overall.toFixed(0)}%)`);
  } else if (overall === 0 && learning === 0 && usage <= 0) {
    concerns.push('has not started much of the online content yet');
  } else if (overall >= PROGRESS_GOOD || learning >= PROGRESS_GOOD) {
    doingWell.push('is moving forward well with course content');
  }

  if (totalExams === 0) {
    concerns.push('has not taken any exams yet');
  } else if (avgPct != null && avgPct < EXAM_LOW) {
    concerns.push(`is struggling in exams (about ${avgPct.toFixed(0)}% average)`);
  } else if (avgPct != null && avgPct < EXAM_GOOD) {
    concerns.push(`is doing okay in exams (${avgPct.toFixed(0)}%) but can improve with more practice`);
  } else if (avgPct != null && avgPct >= EXAM_GOOD) {
    doingWell.push('is scoring well in exams');
  }

  if (hwAssigned > 0 && hwSubmitted < hwAssigned) {
    const missing = hwAssigned - hwSubmitted;
    concerns.push(
      `still has ${missing} homework assignment${missing !== 1 ? 's' : ''} not submitted (${hwSubmitted} of ${hwAssigned} done)`
    );
  } else if (hwAssigned > 0 && hwSubmitted >= hwAssigned) {
    doingWell.push('has submitted the homework given so far');
  }

  const parts = [];

  if (concerns.length === 0 && doingWell.length >= 2) {
    return sentence(
      `${name} is on track: ${doingWell.slice(0, 2).join(', and ')}. Keep encouraging steady effort and timely exam practice.`
    );
  }

  if (concerns.length > 0) {
    const mainIssue =
      concerns.length === 1
        ? concerns[0]
        : `${concerns.slice(0, -1).join('; ')}; and ${concerns[concerns.length - 1]}`;
    parts.push(sentence(`${name} ${mainIssue}`));
  } else if (doingWell.length > 0) {
    parts.push(sentence(`${name} ${doingWell[0]}`));
  }

  // Simple, actionable advice (pick the most important need)
  if (usage <= 0 || (overall < PROGRESS_LOW && learning < PROGRESS_LOW)) {
    parts.push(
      sentence(
        'It would help to speak with the student, find out what is making it difficult to study online, and agree on small daily goals—such as logging in once and finishing one lesson or homework task'
      )
    );
  } else if (avgPct != null && avgPct < EXAM_LOW) {
    parts.push(
      sentence(
        'Extra revision, short practice tests, or a quick one-to-one on weak topics may raise their confidence and scores'
      )
    );
  } else if (hwAssigned > 0 && hwSubmitted < hwAssigned) {
    parts.push(
      sentence(
        'Remind them of pending homework deadlines and check whether they need help understanding the tasks'
      )
    );
  } else if (totalExams === 0) {
    parts.push(
      sentence(
        'Encourage them to attempt the next scheduled exam so you can see where they stand and support them early'
      )
    );
  }

  if (hasCorrectiveRemark && parts.length < 3) {
    parts.push(
      sentence(
        'You have already noted areas to improve in your remarks—please follow up in class so the student knows the next steps clearly'
      )
    );
  }

  if (parts.length === 0) {
    return sentence(
      `Keep an eye on ${name}'s exams, daily platform use, and homework. Check back after the next assessment for a clearer picture.`
    );
  }

  return parts.slice(0, 3).join(' ');
}

/** Multiple students — class-level summary */
function buildClassInsight(list, scopeLabel, remarksSample) {
  const count = list.length;
  const noExams = [];
  const lowExam = [];
  const noUsage = [];
  const lowUsage = [];
  const lowProgress = [];
  const homeworkGap = [];

  list.forEach((s) => {
    const name = studentName(s);
    const totalExams = Number(s.totalExams) || 0;
    const avgPct =
      s.averagePercentage != null && s.averagePercentage !== ''
        ? Number(s.averagePercentage)
        : null;
    const overall = Number(s.overallProgress) || 0;
    const learning = Number(s.learningProgress) || 0;
    const usage = Number(s.dailyAverageWatchTime) || 0;
    const hwAssigned = Number(s.homeworkAssigned) || 0;
    const hwSubmitted = Number(s.homeworkSubmitted) || 0;

    if (totalExams === 0) noExams.push(name);
    else if (avgPct != null && avgPct < EXAM_LOW) lowExam.push(name);

    if (usage <= 0) noUsage.push(name);
    else if (usage < USAGE_LOW_MIN) lowUsage.push(name);

    if (
      (overall > 0 && overall < PROGRESS_LOW) ||
      (learning > 0 && learning < PROGRESS_LOW) ||
      (overall === 0 && learning === 0 && usage <= 0)
    ) {
      lowProgress.push(name);
    }

    if (hwAssigned > 0 && hwSubmitted < hwAssigned) homeworkGap.push(name);
  });

  const negativeRemarks = (remarksSample || []).filter((r) => r.isPositive === false);
  const parts = [];

  if (lowExam.length > 0) {
    parts.push(
      sentence(
        `Some students need extra support in exams (below ${EXAM_LOW}%): ${formatNameList(lowExam)}. Plan revision or practice sessions for them.`
      )
    );
  } else if (noExams.length === count) {
    parts.push(
      sentence(
        `Most students in ${scopeLabel} have not taken any exams yet. Assign a short test soon so you can see who needs help.`
      )
    );
  } else if (noExams.length > 0) {
    parts.push(
      sentence(
        `These students have not attempted exams yet: ${formatNameList(noExams)}. Encourage them before the next assessment date.`
      )
    );
  }

  if (noUsage.length > 0) {
    parts.push(
      sentence(
        `These students are not using the platform regularly (no study time recorded): ${formatNameList(noUsage)}. A quick check-in may help you learn what is blocking them.`
      )
    );
  } else if (lowUsage.length > 0 && parts.length < 2) {
    parts.push(
      sentence(
        `These students spend very little time online each day: ${formatNameList(lowUsage)}. Remind them to log in and complete at least one lesson daily.`
      )
    );
  }

  if (lowProgress.length > 0 && parts.length < 3) {
    parts.push(
      sentence(
        `Course progress is still low for: ${formatNameList(lowProgress)}. Guide them to finish pending lessons and homework.`
      )
    );
  }

  if (homeworkGap.length > 0 && parts.length < 3) {
    parts.push(
      sentence(
        `Homework is still pending for: ${formatNameList(homeworkGap)}. Share deadlines again and offer help where needed.`
      )
    );
  }

  if (negativeRemarks.length > 0 && parts.length < 3) {
    const names = negativeRemarks.map((r) => r.studentName || 'Student');
    parts.push(
      sentence(
        `You left corrective remarks for ${formatNameList(names)}—please follow up so they know what to improve.`
      )
    );
  }

  if (parts.length === 0) {
    const withExams = list.filter((s) => (Number(s.totalExams) || 0) > 0);
    const avgExam =
      withExams.length > 0
        ? withExams.reduce((sum, s) => sum + (Number(s.averagePercentage) || 0), 0) / withExams.length
        : 0;
    const avgUsage = list.reduce((sum, s) => sum + (Number(s.dailyAverageWatchTime) || 0), 0) / count;
    const avgProgress = list.reduce((sum, s) => sum + (Number(s.overallProgress) || 0), 0) / count;

    if (avgExam >= EXAM_GOOD && avgProgress >= PROGRESS_GOOD && avgUsage >= USAGE_GOOD_MIN) {
      return sentence(
        `Overall, ${scopeLabel} is doing well in exams, online study time, and progress. Keep up the good work and stretch the stronger students when ready.`
      );
    }
    return sentence(
      `Continue watching exams, daily platform use, lessons, and homework for ${scopeLabel}. Use each student's View button for personal details.`
    );
  }

  return parts.slice(0, 3).join(' ');
}

/**
 * @param {object} input
 * @param {string} [input.scopeLabel]
 * @param {number} [input.studentCount]
 * @param {Array<object>} [input.students]
 * @param {Array<object>} [input.remarksSample]
 */
export function buildTeacherProgressInsights(input = {}) {
  const {
    scopeLabel = 'Selected students',
    studentCount = 0,
    students = [],
    remarksSample = [],
  } = input;

  const list = Array.isArray(students) ? students : [];
  const count = studentCount || list.length;

  if (count === 0) {
    return 'There are no students in this view to review right now.';
  }

  if (count === 1 && list.length >= 1) {
    return buildSingleStudentInsight(list[0], remarksSample);
  }

  return buildClassInsight(list, scopeLabel, remarksSample);
}

export default { buildTeacherProgressInsights };
