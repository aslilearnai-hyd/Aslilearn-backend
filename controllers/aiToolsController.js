import { generateTeacherTool } from '../services/gemini-service.js';

// Generic Teacher Tool Generator - Uses Gemini API directly
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

    // Validate required fields
    if (!classNumber || !subject || !topic) {
      return res.status(400).json({
        success: false,
        message: 'Class number, subject, and topic are required.'
      });
    }

    const classNum = parseInt(classNumber);
    
    console.log(`🤖 Generating ${toolType} using Gemini API for Class ${classNum}, ${subject}, ${topic}`);

    // Use Gemini API directly to generate content
    const content = await generateTeacherTool(toolType, {
      ...params,
      classNumber: classNum,
      subject,
      topic,
      gradeLevel: `Class ${classNum}`,
      className: `Class ${classNum}`
    });

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
          teacherId,
          source: 'gemini-ai',
          sourceLabel: 'AI Generated (Gemini)'
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
// Since we're using Gemini API, topics can be any topic name - return empty array to allow free-form input
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

    // With Gemini API, we don't need predefined topics - users can enter any topic
    // Return empty array to indicate free-form topic input is allowed
    // Frontend can still show PDF topics if available, but it's not required
    res.json({
      success: true,
      data: [],
      message: 'With AI generation, you can enter any topic name. The system will generate content based on your input.'
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

// PDF upload and extraction removed - AI tools now use Gemini API only
