import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Video from '../models/Video.js';
import Assessment from '../models/Assessment.js';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';
import ExamResult from '../models/ExamResult.js';

// Get comprehensive AI analytics with detailed exam analysis
export const getDetailedAIAnalytics = async (req, res) => {
  try {
    // Fetch all data for comprehensive analysis
    const [admins, students, teachers, videos, assessments, exams, examResults, questions] = await Promise.all([
      User.find({ role: 'admin' }).select('-password'),
      User.find({ role: 'student' }).select('-password'),
      Teacher.find(),
      Video.find(),
      Assessment.find(),
      Exam.find(),
      ExamResult.find().populate('userId', 'fullName email').populate('examId', 'title subject'),
      Question.find()
    ]);

    // Detailed exam analysis per admin
    const adminExamAnalysis = await Promise.all(
      admins.map(async (admin) => {
        try {
          const adminExams = await Exam.find({ adminId: admin._id }).populate('questions');
          const adminResults = await ExamResult.find({ adminId: admin._id })
            .populate('userId', 'fullName email')
            .populate('examId', 'title subject');

          // Calculate exam difficulty for this admin
          const examDifficulty = calculateExamDifficulty(adminExams || [], adminResults || []);
          
          // Get top scorers for this admin
          const topScorers = getTopScorers(adminResults || [], 10);
          
          // Performance distribution analysis
          const performanceDistribution = getPerformanceDistribution(adminResults || []);
          
          // Question difficulty analysis
          const questionAnalysis = await analyzeQuestionDifficulty(adminExams || [], adminResults || []);
          
          // Student performance trends
          const performanceTrends = analyzePerformanceTrends(adminResults || []);
          
          // Subject-wise analysis
          const subjectAnalysis = analyzeSubjectPerformance(adminResults || []);

          const validResults = (adminResults || []).filter(r => r && typeof r.percentage === 'number');
          const averageScore = validResults.length > 0 
            ? validResults.reduce((sum, result) => sum + (result.percentage || 0), 0) / validResults.length 
            : 0;

          return {
            adminId: admin._id,
            adminName: admin.fullName || 'Unknown',
            adminEmail: admin.email || 'Unknown',
            examDifficulty,
            topScorers,
            performanceDistribution,
            questionAnalysis,
            performanceTrends,
            subjectAnalysis,
            totalStudents: (adminResults || []).length,
            totalExams: (adminExams || []).length,
            averageScore
          };
        } catch (error) {
          console.error(`Error processing admin ${admin._id}:`, error);
          return {
            adminId: admin._id,
            adminName: admin.fullName || 'Unknown',
            adminEmail: admin.email || 'Unknown',
            examDifficulty: { exams: [], overallDifficulty: 0, hardestExam: {}, easiestExam: {} },
            topScorers: [],
            performanceDistribution: {
              excellent: { range: '90-100%', count: 0, percentage: 0 },
              good: { range: '80-89%', count: 0, percentage: 0 },
              average: { range: '70-79%', count: 0, percentage: 0 },
              belowAverage: { range: '60-69%', count: 0, percentage: 0 },
              poor: { range: '50-59%', count: 0, percentage: 0 },
              veryPoor: { range: '0-49%', count: 0, percentage: 0 }
            },
            questionAnalysis: [],
            performanceTrends: [],
            subjectAnalysis: [],
            totalStudents: 0,
            totalExams: 0,
            averageScore: 0
          };
        }
      })
    );

    // Global analytics
    const validExamResults = (examResults || []).filter(r => r && typeof r.percentage === 'number');
    const overallAverageScore = validExamResults.length > 0 
      ? validExamResults.reduce((sum, result) => sum + (result.percentage || 0), 0) / validExamResults.length 
      : 0;

    const globalAnalytics = {
      totalAdmins: (admins || []).length,
      totalStudents: (students || []).length,
      totalExams: (exams || []).length,
      totalExamResults: (examResults || []).length,
      overallAverageScore,
      topPerformers: getTopScorers(examResults || [], 20),
      performanceDistribution: getPerformanceDistribution(examResults || []),
      subjectWiseAnalysis: analyzeSubjectPerformance(examResults || []),
      difficultyAnalysis: analyzeOverallDifficulty(exams || [], examResults || []),
      trendsAnalysis: analyzeOverallTrends(examResults || [])
    };

    // AI-powered insights
    const aiInsights = await generateAIInsights(adminExamAnalysis, globalAnalytics);

    res.json({
      success: true,
      data: {
        adminAnalytics: adminExamAnalysis,
        globalAnalytics,
        aiInsights,
        metadata: {
          analysisTimestamp: new Date().toISOString(),
          totalDataPoints: examResults.length,
          analysisVersion: '2.0'
        }
      }
    });
  } catch (error) {
    console.error('Detailed AI Analytics error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate detailed AI analytics',
      error: error.message 
    });
  }
};

// Calculate exam difficulty based on actual performance
function calculateExamDifficulty(exams, results) {
  if (!exams || !Array.isArray(exams)) {
    return {
      exams: [],
      overallDifficulty: 0,
      hardestExam: {},
      easiestExam: {}
    };
  }

  const difficultyAnalysis = exams.map(exam => {
    if (!exam || !exam._id) {
      return {
        examId: null,
        examTitle: 'Unknown',
        difficulty: 'Unknown',
        difficultyScore: 0,
        totalAttempts: 0,
        averageScore: 0,
        passRate: 0
      };
    }

    const examResults = (results || []).filter(result => 
      result && result.examId && result.examId._id && exam._id &&
      result.examId._id.toString() === exam._id.toString()
    );
    
    if (examResults.length === 0) {
      return {
        examId: exam._id,
        examTitle: exam.title || 'Unknown',
        difficulty: 'Unknown',
        difficultyScore: 0,
        totalAttempts: 0,
        averageScore: 0,
        passRate: 0
      };
    }

    const validResults = examResults.filter(r => r && typeof r.percentage === 'number');
    if (validResults.length === 0) {
      return {
        examId: exam._id,
        examTitle: exam.title || 'Unknown',
        difficulty: 'Unknown',
        difficultyScore: 0,
        totalAttempts: 0,
        averageScore: 0,
        passRate: 0
      };
    }

    const averageScore = validResults.reduce((sum, result) => sum + (result.percentage || 0), 0) / validResults.length;
    const passRate = (validResults.filter(result => (result.percentage || 0) >= 50).length / validResults.length) * 100;
    
    let difficulty = 'Easy';
    let difficultyScore = 0;
    
    if (averageScore < 40) {
      difficulty = 'Very Hard';
      difficultyScore = 5;
    } else if (averageScore < 60) {
      difficulty = 'Hard';
      difficultyScore = 4;
    } else if (averageScore < 75) {
      difficulty = 'Medium';
      difficultyScore = 3;
    } else if (averageScore < 85) {
      difficulty = 'Easy';
      difficultyScore = 2;
    } else {
      difficulty = 'Very Easy';
      difficultyScore = 1;
    }

    const percentages = validResults.map(r => r.percentage || 0);
    return {
      examId: exam._id,
      examTitle: exam.title || 'Unknown',
      difficulty,
      difficultyScore,
      totalAttempts: validResults.length,
      averageScore: Math.round(averageScore * 100) / 100,
      passRate: Math.round(passRate * 100) / 100,
      highestScore: percentages.length > 0 ? Math.max(...percentages) : 0,
      lowestScore: percentages.length > 0 ? Math.min(...percentages) : 0,
      questionCount: (exam.questions && Array.isArray(exam.questions)) ? exam.questions.length : 0
    };
  });

  const validExams = difficultyAnalysis.filter(e => e.difficultyScore > 0);
  const overallDifficulty = validExams.length > 0 
    ? validExams.reduce((sum, exam) => sum + exam.difficultyScore, 0) / validExams.length 
    : 0;

  return {
    exams: difficultyAnalysis,
    overallDifficulty,
    hardestExam: validExams.length > 0 
      ? validExams.reduce((max, exam) => exam.difficultyScore > max.difficultyScore ? exam : max, validExams[0])
      : {},
    easiestExam: validExams.length > 0
      ? validExams.reduce((min, exam) => exam.difficultyScore < min.difficultyScore ? exam : min, validExams[0])
      : {}
  };
}

// Get top scorers with detailed analysis
function getTopScorers(results, limit = 10) {
  const studentPerformance = {};
  
  results.forEach(result => {
    // Skip if userId is not populated or missing
    if (!result.userId || !result.userId._id) return;
    
    const studentId = result.userId._id.toString();
    if (!studentPerformance[studentId]) {
      studentPerformance[studentId] = {
        studentId: studentId,
        studentName: result.userId.fullName || 'Unknown',
        studentEmail: result.userId.email || 'Unknown',
        totalExams: 0,
        totalScore: 0,
        highestScore: 0,
        averageScore: 0,
        examHistory: []
      };
    }
    
    studentPerformance[studentId].totalExams += 1;
    studentPerformance[studentId].totalScore += (result.percentage || 0);
    studentPerformance[studentId].highestScore = Math.max(
      studentPerformance[studentId].highestScore, 
      result.percentage || 0
    );
    studentPerformance[studentId].examHistory.push({
      examTitle: result.examTitle || 'Unknown Exam',
      score: result.percentage || 0,
      completedAt: result.completedAt || new Date()
    });
  });

  // Calculate average scores
  Object.values(studentPerformance).forEach(student => {
    student.averageScore = student.totalExams > 0 
      ? Math.round((student.totalScore / student.totalExams) * 100) / 100 
      : 0;
  });

  return Object.values(studentPerformance)
    .sort((a, b) => b.averageScore - a.averageScore)
    .slice(0, limit);
}

// Performance distribution analysis
function getPerformanceDistribution(results) {
  const distribution = {
    excellent: { range: '90-100%', count: 0, percentage: 0 },
    good: { range: '80-89%', count: 0, percentage: 0 },
    average: { range: '70-79%', count: 0, percentage: 0 },
    belowAverage: { range: '60-69%', count: 0, percentage: 0 },
    poor: { range: '50-59%', count: 0, percentage: 0 },
    veryPoor: { range: '0-49%', count: 0, percentage: 0 }
  };

  results.forEach(result => {
    const score = result.percentage;
    if (score >= 90) distribution.excellent.count++;
    else if (score >= 80) distribution.good.count++;
    else if (score >= 70) distribution.average.count++;
    else if (score >= 60) distribution.belowAverage.count++;
    else if (score >= 50) distribution.poor.count++;
    else distribution.veryPoor.count++;
  });

  const total = results.length;
  Object.values(distribution).forEach(category => {
    category.percentage = total > 0 ? Math.round((category.count / total) * 100 * 100) / 100 : 0;
  });

  return distribution;
}

// Analyze question difficulty
async function analyzeQuestionDifficulty(exams, results) {
  const questionAnalysis = [];
  
  for (const exam of exams) {
    if (!exam || !exam.questions || exam.questions.length === 0) continue;
    
    const examResults = results.filter(result => 
      result && result.examId && result.examId._id && exam._id &&
      result.examId._id.toString() === exam._id.toString()
    );
    
    for (const questionId of exam.questions) {
      if (!questionId) continue;
      
      const question = await Question.findById(questionId);
      if (!question || !question.questionText) continue;
      
      let correctAnswers = 0;
      let totalAttempts = 0;
      
      examResults.forEach(result => {
        if (!result || !result.answers) return;
        
        // Handle both Map and Object formats for answers
        let studentAnswer = null;
        const questionIdStr = questionId.toString();
        
        if (result.answers instanceof Map) {
          if (result.answers.has(questionIdStr)) {
            studentAnswer = result.answers.get(questionIdStr);
            totalAttempts++;
          }
        } else if (typeof result.answers === 'object' && result.answers !== null) {
          if (result.answers[questionIdStr] !== undefined) {
            studentAnswer = result.answers[questionIdStr];
            totalAttempts++;
          }
        }
        
        if (studentAnswer !== null && question.correctAnswer && 
            String(studentAnswer) === String(question.correctAnswer)) {
          correctAnswers++;
        }
      });
      
      const difficultyRate = totalAttempts > 0 ? (correctAnswers / totalAttempts) * 100 : 0;
      
      questionAnalysis.push({
        questionId: question._id,
        questionText: (question.questionText || '').substring(0, 100) + (question.questionText && question.questionText.length > 100 ? '...' : ''),
        questionType: question.questionType || 'Unknown',
        subject: question.subject || 'Unknown',
        difficultyRate: Math.round(difficultyRate * 100) / 100,
        correctAnswers,
        totalAttempts,
        examTitle: exam.title || 'Unknown Exam',
        marks: question.marks || 0
      });
    }
  }
  
  return questionAnalysis.sort((a, b) => a.difficultyRate - b.difficultyRate);
}

// Analyze performance trends over time
function analyzePerformanceTrends(results) {
  const monthlyData = {};
  
  results.forEach(result => {
    if (!result || !result.completedAt) return;
    
    try {
      const month = new Date(result.completedAt).toISOString().substring(0, 7); // YYYY-MM
      if (!monthlyData[month]) {
        monthlyData[month] = {
          month,
          totalExams: 0,
          totalScore: 0,
          averageScore: 0,
          examCount: 0
        };
      }
      
      monthlyData[month].totalExams += 1;
      monthlyData[month].totalScore += (result.percentage || 0);
      monthlyData[month].examCount += 1;
    } catch (error) {
      console.error('Error processing result for trends:', error);
    }
  });
  
  Object.values(monthlyData).forEach(month => {
    month.averageScore = month.totalExams > 0 
      ? Math.round((month.totalScore / month.totalExams) * 100) / 100 
      : 0;
  });
  
  return Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));
}

// Analyze subject-wise performance
function analyzeSubjectPerformance(results) {
  const subjectData = {};
  
  results.forEach(result => {
    if (!result) return;
    
    const subject = (result.examId && result.examId.subject) ? result.examId.subject : 'Unknown';
    if (!subjectData[subject]) {
      subjectData[subject] = {
        subject,
        totalExams: 0,
        totalScore: 0,
        averageScore: 0,
        highestScore: 0,
        lowestScore: 100,
        examCount: 0
      };
    }
    
    const percentage = result.percentage || 0;
    subjectData[subject].totalExams += 1;
    subjectData[subject].totalScore += percentage;
    subjectData[subject].highestScore = Math.max(subjectData[subject].highestScore, percentage);
    subjectData[subject].lowestScore = Math.min(subjectData[subject].lowestScore, percentage);
    subjectData[subject].examCount += 1;
  });
  
  Object.values(subjectData).forEach(subject => {
    subject.averageScore = subject.totalExams > 0 
      ? Math.round((subject.totalScore / subject.totalExams) * 100) / 100 
      : 0;
  });
  
  return Object.values(subjectData).sort((a, b) => b.averageScore - a.averageScore);
}

// Analyze overall difficulty
function analyzeOverallDifficulty(exams, results) {
  const difficultyStats = {
    veryHard: 0,
    hard: 0,
    medium: 0,
    easy: 0,
    veryEasy: 0
  };
  
  if (!exams || !Array.isArray(exams) || !results || !Array.isArray(results)) {
    return difficultyStats;
  }
  
  exams.forEach(exam => {
    if (!exam || !exam._id) return;
    
    const examResults = results.filter(result => 
      result && result.examId && result.examId._id && exam._id &&
      result.examId._id.toString() === exam._id.toString()
    );
    
    if (examResults.length > 0) {
      const validResults = examResults.filter(r => r && typeof r.percentage === 'number');
      if (validResults.length > 0) {
        const averageScore = validResults.reduce((sum, result) => sum + (result.percentage || 0), 0) / validResults.length;
        
        if (averageScore < 40) difficultyStats.veryHard++;
        else if (averageScore < 60) difficultyStats.hard++;
        else if (averageScore < 75) difficultyStats.medium++;
        else if (averageScore < 85) difficultyStats.easy++;
        else difficultyStats.veryEasy++;
      }
    }
  });
  
  return difficultyStats;
}

// Analyze overall trends
function analyzeOverallTrends(results) {
  const trends = {
    improving: 0,
    declining: 0,
    stable: 0,
    totalStudents: 0
  };
  
  const studentTrends = {};
  
  results.forEach(result => {
    if (!result || !result.userId || !result.userId._id) return;
    
    const studentId = result.userId._id.toString();
    if (!studentTrends[studentId]) {
      studentTrends[studentId] = [];
    }
    
    try {
      studentTrends[studentId].push({
        score: result.percentage || 0,
        date: result.completedAt ? new Date(result.completedAt) : new Date()
      });
    } catch (error) {
      console.error('Error processing result for trends:', error);
    }
  });
  
  Object.values(studentTrends).forEach(studentScores => {
    if (studentScores.length >= 2) {
      studentScores.sort((a, b) => a.date - b.date);
      const firstHalf = studentScores.slice(0, Math.ceil(studentScores.length / 2));
      const secondHalf = studentScores.slice(Math.ceil(studentScores.length / 2));
      
      const firstAvg = firstHalf.length > 0 
        ? firstHalf.reduce((sum, score) => sum + (score.score || 0), 0) / firstHalf.length 
        : 0;
      const secondAvg = secondHalf.length > 0 
        ? secondHalf.reduce((sum, score) => sum + (score.score || 0), 0) / secondHalf.length 
        : 0;
      
      const difference = secondAvg - firstAvg;
      if (difference > 5) trends.improving++;
      else if (difference < -5) trends.declining++;
      else trends.stable++;
      
      trends.totalStudents++;
    }
  });
  
  return trends;
}

// Generate AI-powered insights
async function generateAIInsights(adminAnalytics, globalAnalytics) {
  try {
    const insights = [];
    
    // Admin performance insights
    if (adminAnalytics && Array.isArray(adminAnalytics)) {
      adminAnalytics.forEach(admin => {
        if (!admin) return;
        
        const avgScore = admin.averageScore || 0;
        if (avgScore < 60) {
          insights.push({
            type: 'alert',
            title: 'Low Performance Alert',
            description: `${admin.adminName || 'Admin'}'s students are performing below average (${avgScore.toFixed(1)}%)`,
            confidence: 95,
            impact: 'high',
            category: 'Performance',
            data: { adminId: admin.adminId, averageScore: avgScore }
          });
        }
        
        const overallDifficulty = (admin.examDifficulty && admin.examDifficulty.overallDifficulty) 
          ? admin.examDifficulty.overallDifficulty 
          : 0;
        if (overallDifficulty > 4) {
          insights.push({
            type: 'recommendation',
            title: 'Exam Difficulty Adjustment',
            description: `${admin.adminName || 'Admin'}'s exams are too difficult. Consider reducing difficulty.`,
            confidence: 88,
            impact: 'medium',
            category: 'Content',
            data: { adminId: admin.adminId, difficulty: overallDifficulty }
          });
        }
      });
    }
    
    // Global insights
    const overallScore = globalAnalytics?.overallAverageScore || 0;
    if (overallScore < 70) {
      insights.push({
        type: 'alert',
        title: 'Platform Performance Concern',
        description: `Overall platform average score is ${overallScore.toFixed(1)}%. Consider reviewing content quality.`,
        confidence: 92,
        impact: 'high',
        category: 'Performance',
        data: { overallScore }
      });
    }
    
    return insights;
  } catch (error) {
    console.error('Error generating AI insights:', error);
    return [];
  }
}

// Get admin-specific detailed analytics
export const getAdminDetailedAnalytics = async (req, res) => {
  try {
    const { adminId } = req.params;
    
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    
    const [exams, results, questions] = await Promise.all([
      Exam.find({ adminId }).populate('questions'),
      ExamResult.find({ adminId })
        .populate('userId', 'fullName email')
        .populate('examId', 'title subject'),
      Question.find({ adminId })
    ]);
    
    const detailedAnalysis = {
      admin: {
        id: admin._id,
        name: admin.fullName,
        email: admin.email
      },
      examDifficulty: calculateExamDifficulty(exams, results),
      topScorers: getTopScorers(results, 15),
      performanceDistribution: getPerformanceDistribution(results),
      questionAnalysis: await analyzeQuestionDifficulty(exams, results),
      performanceTrends: analyzePerformanceTrends(results),
      subjectAnalysis: analyzeSubjectPerformance(results),
      summary: {
        totalStudents: results.length,
        totalExams: exams.length,
        totalQuestions: questions.length,
        averageScore: results.length > 0 ? 
          results.reduce((sum, result) => sum + result.percentage, 0) / results.length : 0,
        passRate: results.length > 0 ? 
          (results.filter(r => r.percentage >= 50).length / results.length) * 100 : 0
      }
    };
    
    res.json({
      success: true,
      data: detailedAnalysis
    });
  } catch (error) {
    console.error('Admin detailed analytics error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate admin detailed analytics' 
    });
  }
};

export default {
  getDetailedAIAnalytics,
  getAdminDetailedAnalytics
};






