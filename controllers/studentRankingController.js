import ExamResult from '../models/ExamResult.js';
import User from '../models/User.js';

// Helper function to extract userId from request
const getUserId = (req) => {
  return req.userId || req.user?.id || req.user?._id;
};

// Get student's rank and percentile for an exam
export const getStudentExamRanking = async (req, res) => {
  try {
    const { examId } = req.params;
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Get student's result for this exam
    const studentResult = await ExamResult.findOne({
      examId,
      userId
    });

    if (!studentResult) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student has not attempted this exam' 
      });
    }

    // Get student profile for optional board-scoped ranking
    const student = await User.findById(userId);
    const studentBoard = student?.board;

    // Prefer board-scoped leaderboard when board exists, otherwise global by exam
    const rankQuery = studentBoard ? { examId, board: studentBoard } : { examId };
    const allResults = await ExamResult.find(rankQuery).sort({ percentage: -1 });

    // Calculate rank (1-indexed)
    const rank = allResults.findIndex(r => r.userId.toString() === userId.toString()) + 1;
    const totalStudents = allResults.length;

    // Calculate percentile
    const studentsAbove = rank - 1;
    const percentile = totalStudents > 0 
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
        completedAt: studentResult.completedAt
      }
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

    // Get student profile for optional board-scoped ranking
    const student = await User.findById(userId);
    const studentBoard = student?.board;

    // Match /api/student/exam-results: include every attempt (board filter was hiding rows).
    const studentResults = await ExamResult.find({ userId }).sort({ completedAt: -1 });

    const rankings = await Promise.all(
      studentResults.map(async (result) => {
        const rankQuery = studentBoard
          ? { examId: result.examId, board: studentBoard }
          : { examId: result.examId };
        const allResults = await ExamResult.find(rankQuery).sort({ percentage: -1 });

        const rank = allResults.findIndex((r) => r.userId.toString() === userId.toString()) + 1;
        const totalStudents = allResults.length;
        const studentsAbove = rank - 1;
        const percentile =
          totalStudents > 0
            ? Math.round(((totalStudents - studentsAbove) / totalStudents) * 100)
            : 0;

        const attemptNumber = Number(result.attemptNumber) >= 1 ? Number(result.attemptNumber) : 1;

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
      data: rankings
    });
  } catch (error) {
    console.error('Get all student rankings error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch rankings' });
  }
};

