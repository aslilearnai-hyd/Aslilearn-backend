import express from 'express';
import mongoose from 'mongoose';
import Teacher from '../../models/Teacher.js';
import User from '../../models/User.js';
import Exam from '../../models/Exam.js';
import ExamResult from '../../models/ExamResult.js';
import { examVisibleToSchool, examMatchesAdminBoard } from '../../utils/exam-visibility.js';
import {
  getExamAssignedClassNumbers,
  normalizeClassNumberLabel,
  classLabelsMatch,
} from '../../utils/studentClassContent.js';

const router = express.Router();

async function loadTeacherStudents(teacher, classNumberFilter) {
  if (!teacher?.assignedClassIds?.length) return [];

  const Class = (await import('../../models/Class.js')).default;
  const classDocs = await Class.find({
    $or: [
      { _id: { $in: teacher.assignedClassIds } },
      { classNumber: { $in: teacher.assignedClassIds } },
    ],
    isActive: true,
  }).select('_id classNumber section');

  const classObjectIds = classDocs.map((c) => c._id);
  if (!classObjectIds.length) return [];

  let students = await User.find({
    role: 'student',
    assignedClass: { $in: classObjectIds },
    assignedAdmin: teacher.adminId,
  })
    .populate('assignedClass', '_id classNumber section')
    .select('_id fullName email classNumber assignedClass')
    .lean();

  const want = normalizeClassNumberLabel(classNumberFilter);
  if (want && want !== 'all') {
    students = students.filter((s) => {
      const label = s.classNumber || s.assignedClass?.classNumber;
      return classLabelsMatch(label, want);
    });
  }

  return students;
}

function bestAttemptPerStudent(results) {
  const best = new Map();
  for (const r of results || []) {
    const id = String(r.userId?._id || r.userId || '').trim();
    if (!id) continue;
    const prev = best.get(id);
    if (!prev || Number(r.percentage) > Number(prev.percentage)) {
      best.set(id, r);
    }
  }
  return best;
}

function resolveQuestionStatus(row) {
  if (!row || typeof row !== 'object') return 'not_answered';
  const status = String(row.status || '').toLowerCase();
  if (status === 'correct' || row.isCorrect === true) return 'correct';
  if (status === 'wrong' || status === 'incorrect') return 'wrong';
  if (status === 'not_answered' || status === 'unattempted' || status === 'skipped') {
    return 'not_answered';
  }
  if (row.isAnswered === true) {
    return row.isCorrect === true ? 'correct' : 'wrong';
  }
  return 'not_answered';
}

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((o) => {
      if (o == null) return '';
      if (typeof o === 'string' || typeof o === 'number' || typeof o === 'boolean') {
        return String(o).trim();
      }
      if (typeof o === 'object') {
        return String(o.text ?? o.label ?? o.value ?? '').trim();
      }
      return String(o).trim();
    })
    .filter(Boolean);
}

function studentDisplayName(student) {
  return String(student?.fullName || student?.email || 'Student').trim() || 'Student';
}

function buildQuestionMeta(examDoc, sampleResults) {
  const byIndex = new Map();

  const pushMeta = (index, partial) => {
    const i = Number(index);
    if (!Number.isFinite(i) || i < 0) return;
    const prev = byIndex.get(i) || {};
    const nextOptions =
      Array.isArray(partial.options) && partial.options.length
        ? partial.options
        : prev.options || [];
    byIndex.set(i, {
      index: i,
      questionId: partial.questionId || prev.questionId || '',
      questionText: partial.questionText || prev.questionText || '',
      subject: partial.subject || prev.subject || '',
      chapter: partial.chapter || prev.chapter || '',
      difficulty: partial.difficulty || prev.difficulty || '',
      questionType: partial.questionType || prev.questionType || '',
      options: nextOptions,
      correctAnswer:
        partial.correctAnswer !== undefined && partial.correctAnswer !== null && partial.correctAnswer !== ''
          ? partial.correctAnswer
          : prev.correctAnswer ?? '',
      assertionText: partial.assertionText || prev.assertionText || '',
      reasonText: partial.reasonText || prev.reasonText || '',
    });
  };

  const examQuestions = Array.isArray(examDoc?.questions) ? examDoc.questions : [];
  examQuestions.forEach((q, index) => {
    if (!q || typeof q !== 'object') return;
    pushMeta(index, {
      questionId: String(q._id || `q-${index}`),
      questionText: stripHtml(q.questionText || q.assertionText || ''),
      assertionText: stripHtml(q.assertionText || ''),
      reasonText: stripHtml(q.reasonText || ''),
      subject: q.subject || examDoc?.subject || '',
      chapter: q.chapter || '',
      difficulty: q.difficulty || '',
      questionType: q.questionType || 'mcq',
      options: normalizeOptions(q.options),
      correctAnswer: q.correctAnswer ?? '',
    });
  });

  for (const result of sampleResults || []) {
    const snapshot = Array.isArray(result.questionSnapshot) ? result.questionSnapshot : [];
    snapshot.forEach((q, index) => {
      if (!q || typeof q !== 'object') return;
      pushMeta(index, {
        questionId: String(q._id || `q-${index}`),
        questionText: stripHtml(q.questionText || q.assertionText || ''),
        assertionText: stripHtml(q.assertionText || ''),
        reasonText: stripHtml(q.reasonText || ''),
        subject: q.subject || '',
        chapter: q.chapter || '',
        difficulty: q.difficulty || '',
        questionType: q.questionType || '',
        options: normalizeOptions(q.options),
        correctAnswer: q.correctAnswer ?? '',
      });
    });

    const qa = Array.isArray(result.questionAnalytics) ? result.questionAnalytics : [];
    qa.forEach((row, fallbackIndex) => {
      const index = Number.isFinite(Number(row?.index)) ? Number(row.index) : fallbackIndex;
      pushMeta(index, {
        questionId: String(row?.questionId || `q-${index}`),
        subject: row?.subject || '',
        chapter: row?.chapter || '',
        difficulty: row?.difficulty || '',
        questionType: row?.questionType || '',
      });
    });
  }

  if (byIndex.size === 0) {
    const total = Math.max(0, Number(examDoc?.totalQuestions) || 0);
    for (let i = 0; i < total; i += 1) {
      pushMeta(i, { questionId: `q-${i}`, questionText: '' });
    }
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function answersMapToObject(answers) {
  if (!answers) return {};
  if (answers instanceof Map) return Object.fromEntries(answers);
  if (typeof answers === 'object') return answers;
  return {};
}

function statusFromAnswersFallback(result, questionMeta) {
  const answers = answersMapToObject(result?.answers);
  const qid = String(questionMeta.questionId || '');
  const raw =
    answers[qid] ??
    answers[String(questionMeta.index)] ??
    answers[String(questionMeta.index + 1)];
  // Older rows without questionAnalytics: blank = unattempted; any answer = wrong
  // (correct counts require questionAnalytics from the submit path).
  if (raw === undefined || raw === null || raw === '') return 'not_answered';
  return 'wrong';
}

/**
 * GET /api/teacher/exams
 * Exams visible for the teacher's school/classes, with attempt counts from their students.
 */
router.get('/exams', async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const classFilter = req.query.classNumber ? String(req.query.classNumber) : 'all';
    const students = await loadTeacherStudents(teacher, classFilter);
    const studentIds = students.map((s) => s._id);

    const attemptAgg =
      studentIds.length > 0
        ? await ExamResult.aggregate([
            { $match: { userId: { $in: studentIds } } },
            {
              $group: {
                _id: '$examId',
                attempts: { $sum: 1 },
                students: { $addToSet: '$userId' },
                lastCompletedAt: { $max: '$completedAt' },
                title: { $last: '$examTitle' },
              },
            },
          ])
        : [];

    const attemptByExam = new Map(
      attemptAgg.map((row) => [
        String(row._id),
        {
          attempts: row.attempts,
          studentsAttempted: Array.isArray(row.students) ? row.students.length : 0,
          lastCompletedAt: row.lastCompletedAt,
          title: row.title,
        },
      ])
    );

    const schoolAdmin = teacher.adminId
      ? await User.findById(teacher.adminId)
          .select('board curriculumBoard isAsliPrepExclusive iitCategories')
          .lean()
      : null;
    const schoolOid =
      teacher.adminId && mongoose.Types.ObjectId.isValid(String(teacher.adminId))
        ? new mongoose.Types.ObjectId(teacher.adminId)
        : null;

    const teacherClassLabels = new Set();
    students.forEach((s) => {
      const label = normalizeClassNumberLabel(s.classNumber || s.assignedClass?.classNumber);
      if (label) teacherClassLabels.add(label);
    });
    if (classFilter && classFilter !== 'all') {
      const want = normalizeClassNumberLabel(classFilter);
      if (want) {
        teacherClassLabels.clear();
        teacherClassLabels.add(want);
      }
    }

    let examDocs = [];
    if (schoolOid) {
      examDocs = await Exam.find({ isActive: { $ne: false } })
        .select(
          'title subject classNumber assignedClasses startDate endDate totalQuestions totalMarks examType createdByRole board isAllBoards isBoardSpecific isSchoolSpecific schoolId targetSchools'
        )
        .sort({ startDate: -1 })
        .limit(200)
        .lean();

      examDocs = examDocs.filter((ex) => {
        if (!examVisibleToSchool(ex, schoolOid)) return false;
        if (!examMatchesAdminBoard(ex, schoolAdmin || '')) return false;
        if (teacherClassLabels.size === 0) return true;
        const examClasses = getExamAssignedClassNumbers(ex);
        if (!examClasses.length) return true;
        return examClasses.some((c) =>
          [...teacherClassLabels].some((tc) => classLabelsMatch(c, tc))
        );
      });
    }

    // Always include exams that already have attempts from this teacher's students
    const missingIds = [...attemptByExam.keys()].filter(
      (id) => !examDocs.some((ex) => String(ex._id) === id)
    );
    if (missingIds.length) {
      const extra = await Exam.find({
        _id: { $in: missingIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) },
      })
        .select(
          'title subject classNumber assignedClasses startDate endDate totalQuestions totalMarks examType createdByRole'
        )
        .lean();
      examDocs = [...examDocs, ...extra];
    }

    const data = examDocs.map((ex) => {
      const id = String(ex._id);
      const stats = attemptByExam.get(id) || {
        attempts: 0,
        studentsAttempted: 0,
        lastCompletedAt: null,
        title: ex.title,
      };
      return {
        _id: id,
        title: ex.title || stats.title || 'Exam',
        subject: ex.subject || '',
        classNumber: ex.classNumber || '',
        assignedClasses: ex.assignedClasses || [],
        startDate: ex.startDate,
        endDate: ex.endDate,
        totalQuestions: ex.totalQuestions || 0,
        totalMarks: ex.totalMarks || 0,
        examType: ex.examType || '',
        studentsAttempted: stats.studentsAttempted,
        totalAttempts: stats.attempts,
        lastCompletedAt: stats.lastCompletedAt,
      };
    });

    data.sort((a, b) => {
      if (b.studentsAttempted !== a.studentsAttempted) {
        return b.studentsAttempted - a.studentsAttempted;
      }
      return new Date(b.startDate || 0).getTime() - new Date(a.startDate || 0).getTime();
    });

    res.json({
      success: true,
      data: {
        exams: data,
        studentCount: students.length,
      },
    });
  } catch (error) {
    console.error('Teacher list exams error:', error);
    res.status(500).json({ success: false, message: 'Failed to list exams' });
  }
});

/**
 * GET /api/teacher/exams/:examId/question-analytics?classNumber=
 * Class-level correct / wrong / unattempted counts per question for one paper.
 */
router.get('/exams/:examId/question-analytics', async (req, res) => {
  try {
    const { examId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam id' });
    }

    const teacher = await Teacher.findById(req.teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const classFilter = req.query.classNumber ? String(req.query.classNumber) : 'all';
    const students = await loadTeacherStudents(teacher, classFilter);
    const studentIds = students.map((s) => s._id);
    const totalStudents = students.length;

    const examObjectId = new mongoose.Types.ObjectId(examId);
    const examDoc = await Exam.findById(examObjectId)
      .populate({
        path: 'questions',
        select:
          'questionText assertionText reasonText subject chapter difficulty questionType options correctAnswer',
      })
      .lean();

    if (!examDoc) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const results =
      studentIds.length > 0
        ? await ExamResult.find({
            examId: examObjectId,
            userId: { $in: studentIds },
          })
            .select(
              'userId percentage score totalMarks correctAnswers wrongAnswers unattempted totalQuestions questionAnalytics questionSnapshot answers completedAt attemptNumber timeTaken'
            )
            .lean()
        : [];

    const bestByStudent = bestAttemptPerStudent(results);
    const bestResults = [...bestByStudent.values()];
    const questionMeta = buildQuestionMeta(examDoc, bestResults);

    const questions = questionMeta.map((meta) => {
      const studentsCorrect = [];
      const studentsWrong = [];
      const studentsUnattempted = [];

      for (const student of students) {
        const sid = String(student._id);
        const entry = { id: sid, name: studentDisplayName(student) };
        const result = bestByStudent.get(sid);
        if (!result) {
          studentsUnattempted.push(entry);
          continue;
        }

        const qa = Array.isArray(result.questionAnalytics) ? result.questionAnalytics : [];
        const row =
          qa.find(
            (r) =>
              Number(r?.index) === meta.index ||
              String(r?.questionId || '') === String(meta.questionId || '')
          ) || qa[meta.index];

        let status;
        if (row) {
          status = resolveQuestionStatus(row);
        } else {
          status = statusFromAnswersFallback(result, meta);
        }

        if (status === 'correct') studentsCorrect.push(entry);
        else if (status === 'wrong') studentsWrong.push(entry);
        else studentsUnattempted.push(entry);
      }

      const correct = studentsCorrect.length;
      const wrong = studentsWrong.length;
      const unattempted = studentsUnattempted.length;
      const attempted = correct + wrong;
      const accuracyPct =
        attempted > 0 ? Math.round((correct / attempted) * 1000) / 10 : 0;
      const classCorrectPct =
        totalStudents > 0 ? Math.round((correct / totalStudents) * 1000) / 10 : 0;

      return {
        questionNumber: meta.index + 1,
        index: meta.index,
        questionId: meta.questionId,
        questionText: meta.questionText || `Question ${meta.index + 1}`,
        assertionText: meta.assertionText || '',
        reasonText: meta.reasonText || '',
        subject: meta.subject || examDoc.subject || '',
        chapter: meta.chapter || '',
        difficulty: meta.difficulty || '',
        questionType: meta.questionType || 'mcq',
        options: Array.isArray(meta.options) ? meta.options : [],
        correctAnswer: meta.correctAnswer ?? '',
        totalStudents,
        correct,
        wrong,
        unattempted,
        attempted,
        accuracyPct,
        classCorrectPct,
        studentsCorrect,
        studentsWrong,
        studentsUnattempted,
      };
    });

    const studentReports = students
      .map((student) => {
        const sid = String(student._id);
        const result = bestByStudent.get(sid);
        const name = studentDisplayName(student);
        if (!result) {
          return {
            studentId: sid,
            name,
            attempted: false,
            percentage: null,
            score: null,
            totalMarks: null,
            correctAnswers: 0,
            wrongAnswers: 0,
            unattempted: questions.length,
            totalQuestions: questions.length,
            completedAt: null,
            attemptNumber: null,
            resultId: null,
            questionBreakdown: questions.map((q) => ({
              questionNumber: q.questionNumber,
              index: q.index,
              questionId: q.questionId,
              questionText: q.questionText,
              subject: q.subject,
              status: 'not_answered',
            })),
          };
        }

        const qa = Array.isArray(result.questionAnalytics) ? result.questionAnalytics : [];
        const questionBreakdown = questions.map((q) => {
          const row =
            qa.find(
              (r) =>
                Number(r?.index) === q.index ||
                String(r?.questionId || '') === String(q.questionId || '')
            ) || qa[q.index];
          const status = row
            ? resolveQuestionStatus(row)
            : statusFromAnswersFallback(result, {
                questionId: q.questionId,
                index: q.index,
              });
          return {
            questionNumber: q.questionNumber,
            index: q.index,
            questionId: q.questionId,
            questionText: q.questionText,
            subject: q.subject,
            status: status === 'not_answered' ? 'not_answered' : status,
            timeTaken: Number(row?.timeTaken) > 0 ? Number(row.timeTaken) : undefined,
          };
        });

        return {
          studentId: sid,
          name,
          attempted: true,
          percentage: result.percentage ?? null,
          score: result.score ?? null,
          totalMarks: result.totalMarks ?? null,
          correctAnswers: Number(result.correctAnswers) || 0,
          wrongAnswers: Number(result.wrongAnswers) || 0,
          unattempted: Number(result.unattempted) || 0,
          totalQuestions:
            Number(result.totalQuestions) || questions.length || Number(examDoc.totalQuestions) || 0,
          completedAt: result.completedAt || null,
          attemptNumber: result.attemptNumber ?? null,
          resultId: String(result._id || ''),
          timeTaken: result.timeTaken ?? null,
          questionBreakdown,
        };
      })
      .sort((a, b) => {
        if (a.attempted !== b.attempted) return a.attempted ? -1 : 1;
        return Number(b.percentage || 0) - Number(a.percentage || 0);
      });

    res.json({
      success: true,
      data: {
        examId: String(examDoc._id),
        examTitle: examDoc.title || '',
        subject: examDoc.subject || '',
        classNumber: examDoc.classNumber || '',
        assignedClasses: examDoc.assignedClasses || [],
        totalQuestions: questions.length || examDoc.totalQuestions || 0,
        totalStudents,
        studentsAttempted: bestByStudent.size,
        studentsNotAttempted: Math.max(0, totalStudents - bestByStudent.size),
        questions,
        studentReports,
      },
    });
  } catch (error) {
    console.error('Teacher exam question analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to load question analytics' });
  }
});

export default router;
