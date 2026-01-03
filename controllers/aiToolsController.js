import { generateContentFromCSV, getAvailableTopics } from '../services/csv-question-service.js';

// Generic Teacher Tool Generator - Uses CSV files instead of Gemini
export const createTeacherTool = async (req, res) => {
  try {
    const { toolType, classNumber, subject, topic, ...params } = req.body;
    const teacherId = req.teacherId;

    if (!toolType) {
      return res.status(400).json({
        success: false,
        message: 'Tool type is required'
      });
    }

    // Validate required fields for CSV-based tools
    if (!classNumber || !subject || !topic) {
      return res.status(400).json({
        success: false,
        message: 'Class number, subject, and topic are required. Topic should match the CSV filename.'
      });
    }

    // Validate class number (only 9 and 10 are supported)
    const classNum = parseInt(classNumber);
    if (classNum !== 9 && classNum !== 10) {
      return res.status(400).json({
        success: false,
        message: 'Only Class 9 and Class 10 are supported'
      });
    }

    // Generate content from CSV
    const content = generateContentFromCSV(classNum, subject, topic, toolType, params);

    res.json({
      success: true,
      data: {
        content,
        toolType,
        metadata: {
          classNumber: classNum,
          subject,
          topic,
          ...params,
          generatedAt: new Date(),
          teacherId
        }
      }
    });
  } catch (error) {
    console.error('Create teacher tool error:', error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to generate ${req.body.toolType || 'tool'}: ${error.message}`,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get available topics for a class and subject
export const getTopics = async (req, res) => {
  try {
    const { classNumber, subject } = req.query;
    
    console.log('📥 getTopics called with:', { classNumber, subject });

    if (!classNumber || !subject) {
      console.log('❌ Missing classNumber or subject');
      return res.status(400).json({
        success: false,
        message: 'Class number and subject are required'
      });
    }

    const classNum = parseInt(classNumber);
    if (classNum !== 9 && classNum !== 10) {
      console.log('❌ Invalid class number:', classNum);
      return res.status(400).json({
        success: false,
        message: 'Only Class 9 and Class 10 are supported'
      });
    }

    console.log('✅ Calling getAvailableTopics with:', { classNum, subject });
    const topics = getAvailableTopics(classNum, subject);
    console.log('✅ Topics returned:', topics.length, 'topics');

    res.json({
      success: true,
      data: topics
    });
  } catch (error) {
    console.error('❌ Get topics error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get topics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Legacy endpoints (kept for backward compatibility but will return error)
export const createLessonPlan = async (req, res) => {
  res.status(400).json({
    success: false,
    message: 'This endpoint is deprecated. Please use /api/teacher/ai/tool with toolType: lesson-planner'
  });
};

export const createTestQuestions = async (req, res) => {
  res.status(400).json({
    success: false,
    message: 'This endpoint is deprecated. Please use /api/teacher/ai/tool with toolType: exam-question-paper-generator'
  });
};

export const createClasswork = async (req, res) => {
  res.status(400).json({
    success: false,
    message: 'This endpoint is deprecated. Please use /api/teacher/ai/tool with toolType: homework-creator'
  });
};

export const createSchedule = async (req, res) => {
  res.status(400).json({
    success: false,
    message: 'This endpoint is deprecated. Please use /api/teacher/ai/tool with toolType: daily-class-plan-maker'
  });
};
