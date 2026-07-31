import AIService from '../services/ai-service.js';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Video from '../models/Video.js';
import Assessment from '../models/Assessment.js';
import Exam from '../models/Exam.js';
import ExamResult from '../models/ExamResult.js';

/** Ensure caller may access the given student (same tenant). Super-admin always allowed. */
async function assertStudentTenantAccess(req, studentId) {
  if (req.user?.role === 'super-admin') return { ok: true };
  const student = await User.findById(studentId).select('role assignedAdmin');
  if (!student || student.role !== 'student') {
    return { ok: false, status: 404, message: 'Student not found' };
  }
  if (req.user?.role === 'admin') {
    if (String(student.assignedAdmin) !== String(req.userId)) {
      return { ok: false, status: 403, message: 'Access denied for this student' };
    }
    return { ok: true };
  }
  return { ok: false, status: 403, message: 'Access denied' };
}

// Get comprehensive AI analytics
export const getAIAnalytics = async (req, res) => {
  try {
    // Fetch all data for AI analysis
    const [admins, students, teachers, videos, assessments, exams, examResults] = await Promise.all([
      User.find({ role: 'admin' }).select('-password'),
      User.find({ role: 'student' }).select('-password'),
      Teacher.find(),
      Video.find(),
      Assessment.find(),
      Exam.find(),
      ExamResult.find().populate('userId', 'fullName email').populate('examId', 'title subject')
    ]);

    const analysisData = {
      admins,
      students,
      teachers,
      videos,
      assessments,
      exams,
      examResults
    };

    // Run AI analysis
    const aiAnalysis = await AIService.analyzeEducationalData(analysisData);

    res.json({
      success: true,
      data: {
        ...aiAnalysis,
        metadata: {
          totalStudents: students.length,
          totalTeachers: teachers.length,
          totalAdmins: admins.length,
          totalContent: videos.length + assessments.length + exams.length,
          totalExamResults: examResults.length,
          analysisTimestamp: new Date().toISOString()
        }
      }
    });
  } catch (error) {
    console.error('AI Analytics error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate AI analytics',
      error: error.message 
    });
  }
};

// Get AI-powered student predictions
export const getStudentPredictions = async (req, res) => {
  try {
    const { adminId } = req.params;
    
    // Get students for specific admin
    const students = await User.find({ 
      role: 'student', 
      assignedAdmin: adminId 
    }).select('-password');

    // Get exam results for these students
    const examResults = await ExamResult.find({
      adminId: adminId
    }).populate('userId', 'fullName email');

    const analysisData = {
      admins: [{ _id: adminId }],
      students,
      teachers: await Teacher.find({ adminId }),
      videos: await Video.find({ adminId }),
      assessments: await Assessment.find({ adminId }),
      exams: await Exam.find({ adminId }),
      examResults
    };

    const aiAnalysis = await AIService.analyzeEducationalData(analysisData);

    res.json({
      success: true,
      data: {
        predictions: aiAnalysis.predictions,
        riskAssessments: aiAnalysis.riskAssessments,
        insights: aiAnalysis.insights.filter(insight => 
          insight.category === 'Performance' || insight.category === 'Risk'
        )
      }
    });
  } catch (error) {
    console.error('Student predictions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate student predictions' 
    });
  }
};

// Get AI content recommendations
export const getContentRecommendations = async (req, res) => {
  try {
    const { adminId } = req.params;
    
    // Get content and performance data
    const [videos, assessments, exams, examResults] = await Promise.all([
      Video.find({ adminId }),
      Assessment.find({ adminId }),
      Exam.find({ adminId }),
      ExamResult.find({ adminId })
    ]);

    const analysisData = {
      admins: [{ _id: adminId }],
      students: await User.find({ role: 'student', assignedAdmin: adminId }),
      teachers: await Teacher.find({ adminId }),
      videos,
      assessments,
      exams,
      examResults
    };

    const aiAnalysis = await AIService.analyzeEducationalData(analysisData);

    res.json({
      success: true,
      data: {
        recommendations: aiAnalysis.recommendations,
        patterns: aiAnalysis.patterns,
        insights: aiAnalysis.insights.filter(insight => 
          insight.category === 'Content' || insight.category === 'Engagement'
        )
      }
    });
  } catch (error) {
    console.error('Content recommendations error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate content recommendations' 
    });
  }
};

// Get learning pattern analysis
export const getLearningPatterns = async (req, res) => {
  try {
    const { adminId } = req.params;
    
    // Get comprehensive data for pattern analysis
    const examResults = await ExamResult.find({ adminId })
      .populate('userId', 'fullName email')
      .populate('examId', 'title subject')
      .sort({ completedAt: -1 });

    const analysisData = {
      admins: [{ _id: adminId }],
      students: await User.find({ role: 'student', assignedAdmin: adminId }),
      teachers: await Teacher.find({ adminId }),
      videos: await Video.find({ adminId }),
      assessments: await Assessment.find({ adminId }),
      exams: await Exam.find({ adminId }),
      examResults
    };

    const aiAnalysis = await AIService.analyzeEducationalData(analysisData);

    // Calculate additional pattern metrics
    const timePatterns = analyzeTimePatterns(examResults);
    const performancePatterns = analyzePerformancePatterns(examResults);
    const engagementPatterns = analyzeEngagementPatterns(examResults);

    res.json({
      success: true,
      data: {
        patterns: aiAnalysis.patterns,
        timePatterns,
        performancePatterns,
        engagementPatterns,
        insights: aiAnalysis.insights.filter(insight => 
          insight.category === 'Engagement'
        )
      }
    });
  } catch (error) {
    console.error('Learning patterns error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to analyze learning patterns' 
    });
  }
};

// Get AI-powered risk assessment
export const getRiskAssessment = async (req, res) => {
  try {
    const { adminId } = req.params;
    
    const students = await User.find({ 
      role: 'student', 
      assignedAdmin: adminId 
    }).select('-password');

    const examResults = await ExamResult.find({ adminId })
      .populate('userId', 'fullName email')
      .populate('examId', 'title subject');

    const analysisData = {
      admins: [{ _id: adminId }],
      students,
      teachers: await Teacher.find({ adminId }),
      videos: await Video.find({ adminId }),
      assessments: await Assessment.find({ adminId }),
      exams: await Exam.find({ adminId }),
      examResults
    };

    const aiAnalysis = await AIService.analyzeEducationalData(analysisData);

    // Enhanced risk assessment
    const riskMetrics = calculateRiskMetrics(examResults, students);

    res.json({
      success: true,
      data: {
        riskAssessments: aiAnalysis.riskAssessments,
        riskMetrics,
        insights: aiAnalysis.insights.filter(insight => 
          insight.type === 'alert' || insight.category === 'Risk'
        ),
        interventionRecommendations: generateInterventionRecommendations(aiAnalysis.riskAssessments)
      }
    });
  } catch (error) {
    console.error('Risk assessment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate risk assessment' 
    });
  }
};

// Generate personalized content recommendations
export const generatePersonalizedContent = async (req, res) => {
  try {
    const { studentId, subject } = req.body;
    const access = await assertStudentTenantAccess(req, studentId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }
    
    const personalizedContent = await AIService.generatePersonalizedContent(studentId, subject);
    
    res.json({
      success: true,
      data: personalizedContent
    });
  } catch (error) {
    console.error('Personalized content error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate personalized content' 
    });
  }
};

// Predict exam outcome
export const predictExamOutcome = async (req, res) => {
  try {
    const { examId, studentId } = req.params;
    const access = await assertStudentTenantAccess(req, studentId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }
    
    const prediction = await AIService.predictExamOutcome(examId, studentId);
    
    res.json({
      success: true,
      data: prediction
    });
  } catch (error) {
    console.error('Exam prediction error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to predict exam outcome' 
    });
  }
};

// Optimize learning path
export const optimizeLearningPath = async (req, res) => {
  try {
    const { studentId } = req.params;
    const access = await assertStudentTenantAccess(req, studentId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }
    
    const optimizedPath = await AIService.optimizeLearningPath(studentId);
    
    res.json({
      success: true,
      data: optimizedPath
    });
  } catch (error) {
    console.error('Learning path optimization error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to optimize learning path' 
    });
  }
};

// Helper functions for pattern analysis
function analyzeTimePatterns(examResults) {
  const hourlyPerformance = {};
  const dailyPerformance = {};
  
  examResults.forEach(result => {
    const hour = new Date(result.completedAt).getHours();
    const day = new Date(result.completedAt).getDay();
    
    if (!hourlyPerformance[hour]) {
      hourlyPerformance[hour] = { total: 0, count: 0 };
    }
    hourlyPerformance[hour].total += result.percentage;
    hourlyPerformance[hour].count += 1;
    
    if (!dailyPerformance[day]) {
      dailyPerformance[day] = { total: 0, count: 0 };
    }
    dailyPerformance[day].total += result.percentage;
    dailyPerformance[day].count += 1;
  });
  
  return {
    hourlyPerformance: Object.entries(hourlyPerformance).map(([hour, data]) => ({
      hour: parseInt(hour),
      averageScore: data.total / data.count,
      examCount: data.count
    })),
    dailyPerformance: Object.entries(dailyPerformance).map(([day, data]) => ({
      day: parseInt(day),
      averageScore: data.total / data.count,
      examCount: data.count
    }))
  };
}

function analyzePerformancePatterns(examResults) {
  const subjectPerformance = {};
  const difficultyPerformance = {};
  
  examResults.forEach(result => {
    const subject = result.examId?.subject || 'Unknown';
    if (!subjectPerformance[subject]) {
      subjectPerformance[subject] = { total: 0, count: 0 };
    }
    subjectPerformance[subject].total += result.percentage;
    subjectPerformance[subject].count += 1;
  });
  
  return {
    subjectPerformance: Object.entries(subjectPerformance).map(([subject, data]) => ({
      subject,
      averageScore: data.total / data.count,
      examCount: data.count
    }))
  };
}

function analyzeEngagementPatterns(examResults) {
  const recentResults = examResults.slice(0, 50); // Last 50 results
  const completionRates = {};
  const timeSpentPatterns = {};
  
  recentResults.forEach(result => {
    const subject = result.examId?.subject || 'Unknown';
    if (!completionRates[subject]) {
      completionRates[subject] = { completed: 0, total: 0 };
    }
    completionRates[subject].completed += 1;
    completionRates[subject].total += 1;
  });
  
  return {
    completionRates: Object.entries(completionRates).map(([subject, data]) => ({
      subject,
      completionRate: (data.completed / data.total) * 100,
      totalExams: data.total
    }))
  };
}

function calculateRiskMetrics(examResults, students) {
  const totalStudents = students.length;
  const totalExams = examResults.length;
  const avgScore = examResults.reduce((sum, result) => sum + result.percentage, 0) / totalExams;
  
  const lowPerformers = examResults.filter(result => result.percentage < 50).length;
  const highPerformers = examResults.filter(result => result.percentage > 80).length;
  
  return {
    totalStudents,
    totalExams,
    averageScore: avgScore,
    lowPerformers,
    highPerformers,
    riskPercentage: (lowPerformers / totalExams) * 100,
    successPercentage: (highPerformers / totalExams) * 100
  };
}

function generateInterventionRecommendations(riskAssessments) {
  const recommendations = [];
  
  riskAssessments.forEach(assessment => {
    if (assessment.riskLevel === 'high' || assessment.riskLevel === 'critical') {
      recommendations.push({
        studentId: assessment.studentId,
        priority: assessment.riskLevel,
        interventions: assessment.suggestedActions,
        timeline: assessment.timeline
      });
    }
  });
  
  return recommendations;
}






