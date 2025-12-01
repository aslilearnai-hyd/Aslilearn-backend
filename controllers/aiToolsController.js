import {
  generateLessonPlan,
  generateTestQuestions,
  generateClasswork,
  generateSchedule,
  generateTeacherTool
} from '../services/gemini-service.js';

// Generate Lesson Plan
export const createLessonPlan = async (req, res) => {
  try {
    const { subject, topic, gradeLevel, duration } = req.body;
    const teacherId = req.teacherId;

    if (!subject || !topic || !gradeLevel || !duration) {
      return res.status(400).json({
        success: false,
        message: 'Subject, topic, grade level, and duration are required'
      });
    }

    const lessonPlan = await generateLessonPlan(subject, topic, gradeLevel, duration);

    res.json({
      success: true,
      data: {
        lessonPlan,
        metadata: {
          subject,
          topic,
          gradeLevel,
          duration,
          generatedAt: new Date(),
          teacherId
        }
      }
    });
  } catch (error) {
    console.error('Create lesson plan error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate lesson plan' 
    });
  }
};

// Generate Test Questions
export const createTestQuestions = async (req, res) => {
  try {
    const { subject, topic, gradeLevel, questionCount, difficulty } = req.body;
    const teacherId = req.teacherId;

    if (!subject || !topic || !gradeLevel || !questionCount) {
      return res.status(400).json({
        success: false,
        message: 'Subject, topic, grade level, and question count are required'
      });
    }

    const testQuestions = await generateTestQuestions(
      subject, 
      topic, 
      gradeLevel, 
      questionCount, 
      difficulty || 'medium'
    );

    res.json({
      success: true,
      data: {
        testQuestions,
        metadata: {
          subject,
          topic,
          gradeLevel,
          questionCount,
          difficulty: difficulty || 'medium',
          generatedAt: new Date(),
          teacherId
        }
      }
    });
  } catch (error) {
    console.error('Create test questions error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to generate test questions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Generate Classwork
export const createClasswork = async (req, res) => {
  try {
    const { subject, topic, gradeLevel, assignmentType } = req.body;
    const teacherId = req.teacherId;

    if (!subject || !topic || !gradeLevel || !assignmentType) {
      return res.status(400).json({
        success: false,
        message: 'Subject, topic, grade level, and assignment type are required'
      });
    }

    const classwork = await generateClasswork(subject, topic, gradeLevel, assignmentType);

    res.json({
      success: true,
      data: {
        classwork,
        metadata: {
          subject,
          topic,
          gradeLevel,
          assignmentType,
          generatedAt: new Date(),
          teacherId
        }
      }
    });
  } catch (error) {
    console.error('Create classwork error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate classwork' 
    });
  }
};

// Generate Schedule
export const createSchedule = async (req, res) => {
  try {
    const { subjects, gradeLevels, timeSlots, preferences } = req.body;
    const teacherId = req.teacherId;

    if (!subjects || !gradeLevels || !timeSlots) {
      return res.status(400).json({
        success: false,
        message: 'Subjects, grade levels, and time slots are required'
      });
    }

    const schedule = await generateSchedule(subjects, gradeLevels, timeSlots, preferences || '');

    res.json({
      success: true,
      data: {
        schedule,
        metadata: {
          subjects,
          gradeLevels,
          timeSlots,
          preferences: preferences || '',
          generatedAt: new Date(),
          teacherId
        }
      }
    });
  } catch (error) {
    console.error('Create schedule error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate schedule' 
    });
  }
};

// Generic Teacher Tool Generator
export const createTeacherTool = async (req, res) => {
  try {
    const { toolType, ...params } = req.body;
    const teacherId = req.teacherId;

    if (!toolType) {
      return res.status(400).json({
        success: false,
        message: 'Tool type is required'
      });
    }

    const result = await generateTeacherTool(toolType, params);

    res.json({
      success: true,
      data: {
        content: result,
        toolType,
        metadata: {
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
      message: `Failed to generate ${req.body.toolType || 'tool'}`,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
