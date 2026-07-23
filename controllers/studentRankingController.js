import ExamResult from '../models/ExamResult.js';
import User from '../models/User.js';
import { resolveUserDisplayBoard } from '../constants/boards.js';

// Helper function to extract userId from request
const getUserId = (req) => {
  return req.userId || req.user?.id || req.user?._id;
};

/** Best attempt per student (highest percentage), then sort descending. */
function bestAttemptLeaderboard(results) {
  const bestByUser = new Map();
  for (const row of results) {
    const uid = String(row.userId?._id || row.userId || '');
    if (!uid) continue;
    const prev = bestByUser.get(uid);
    const pct = Number(row.percentage) || 0;
    if (!prev || pct > (Number(prev.percentage) || 0)) {
      bestByUser.set(uid, row);
    }
  }
  return [...bestByUser.values()].sort(
    (a, b) => (Number(b.percentage) || 0) - (Number(a.percentage) || 0)
  );
}

async function resolveRankingBoard(userId, fallbackBoard) {
  if (fallbackBoard) return String(fallbackBoard).trim().toUpperCase();
  const student = await User.findById(userId).populate(
    'assignedAdmin',
    'board curriculumBoard isAsliPrepExclusive'
  );
  if (!student) return '';
  const display = resolveUserDisplayBoard(student, student.assignedAdmin);
  return String(display || student.board || '')
    .trim()
    .toUpperCase();
}

// Get student's rank and percentile for an exam
export const getStudentExamRanking = async (req, res) => {
  try {
    const { examId } = req.params;
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Prefer best attempt for this student
    const studentResult = await ExamResult.findOne({ examId, userId }).sort({
      percentage: -1,
      completedAt: -1,
    });

    if (!studentResult) {
      return res.status(404).json({
        success: false,
        message: 'Student has not attempted this exam',
      });
    }

    // Rank using the same board stored on ExamResult (curriculum/display board).
    const rankBoard = await resolveRankingBoard(userId, studentResult.board);
    const rankQuery = rankBoard ? { examId, board: rankBoard } : { examId };
    const allResults = await ExamResult.find(rankQuery);
    const ranked = bestAttemptLeaderboard(allResults);

    const rank = ranked.findIndex((r) => String(r.userId) === String(userId)) + 1;
    const totalStudents = ranked.length;
    const studentsAbove = Math.max(0, rank - 1);
    const percentile =
      totalStudents > 0
        ? Math.round(((totalStudents - studentsAbove) / totalStudents) * 100)
        : 0;

    res.json({
      success: true,
      data: {
        examId,
        examTitle: studentResult.examTitle,
        rank,
        totalStudents,
        percentile,
        studentPercentage: studentResult.percentage,
        studentMarks: `${studentResult.obtainedMarks}/${studentResult.totalMarks}`,
        completedAt: studentResult.completedAt,
      },
    });
  } catch (error) {
    console.error('Get student exam ranking error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch ranking' });
  }
};

// Get all exam rankings for a student
export const getAllStudentRankings = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const studentResults = await ExamResult.find({ userId }).sort({ completedAt: -1 });
    const rankBoard = await resolveRankingBoard(userId, studentResults[0]?.board);

    const rankings = await Promise.all(
      studentResults.map(async (result) => {
        const boardForRank = String(result.board || rankBoard || '')
          .trim()
          .toUpperCase();
        const rankQuery = boardForRank
          ? { examId: result.examId, board: boardForRank }
          : { examId: result.examId };
        const allResults = await ExamResult.find(rankQuery);
        const ranked = bestAttemptLeaderboard(allResults);

        const rank = ranked.findIndex((r) => String(r.userId) === String(userId)) + 1;
        const totalStudents = ranked.length;
        const studentsAbove = Math.max(0, rank - 1);
        const percentile =
          totalStudents > 0
            ? Math.round(((totalStudents - studentsAbove) / totalStudents) * 100)
            : 0;

        const attemptNumber =
          Number(result.attemptNumber) >= 1 ? Number(result.attemptNumber) : 1;

        return {
          resultId: result._id,
          examId: result.examId,
          examTitle: result.examTitle,
          attemptNumber,
          rank,
          totalStudents,
          percentile,
          percentage: result.percentage,
          obtainedMarks: result.obtainedMarks,
          totalMarks: result.totalMarks,
          completedAt: result.completedAt,
        };
      })
    );

    res.json({
      success: true,
      data: rankings,
    });
  } catch (error) {
    console.error('Get all student rankings error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch rankings' });
  }
};
