import { 
  getHardcodedContent, 
  getChaptersForSubject,
  getAvailableContentForTopic,
  VALID_SUBJECTS
} from '../services/hardcoded-content-service.js';
import { formatHardcodedContent } from '../utils/hardcoded-formatter.js';

// Generic Teacher Tool Generator - Uses only hardcoded content
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
    // For lesson-planner and daily-class-plan-maker, topic is optional
    if (!classNumber || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Class number and subject are required.'
      });
    }
    
    // For lesson-planner, daily-class-plan-maker, activity-project-generator, and story-passage-creator, topic is optional
    if (toolType !== 'lesson-planner' && toolType !== 'daily-class-plan-maker' && toolType !== 'activity-project-generator' && toolType !== 'story-passage-creator' && !topic) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required for this tool type.'
      });
    }
    
    // For IIT-6, use IIT subjects (Physics, Chemistry, Maths, Biology)
    // For other classes, use standard VALID_SUBJECTS
    const isIIT6 = classNumber === 'IIT-6';
    const validSubjectsList = isIIT6 ? ['Physics', 'Chemistry', 'Maths', 'Biology'] : VALID_SUBJECTS;
    
    // Normalize subject name (handle case variations like "english" vs "English")
    const normalizedSubject = validSubjectsList.find(s => 
      s.toLowerCase() === subject.toLowerCase()
    );
    
    // Validate subject - only allow valid subjects
    if (!normalizedSubject) {
      return res.status(400).json({
        success: false,
        message: `Invalid subject. Valid subjects are: ${validSubjectsList.join(', ')}`
      });
    }
    
    // For story-passage-creator, only allow English and Hindi
    if (toolType === 'story-passage-creator' && normalizedSubject !== 'English' && normalizedSubject !== 'Hindi') {
      return res.status(400).json({
        success: false,
        message: 'Story & Passage Creator is only available for English and Hindi subjects.'
      });
    }
    
    // Use normalized subject for processing
    const finalSubject = normalizedSubject;

    // Handle IIT-6 as string, otherwise parse as number
    const classNum = isIIT6 ? classNumber : parseInt(classNumber);
    const classDisplay = isIIT6 ? 'IIT-6' : `Class ${classNum}`;
    
    // For lesson-planner, daily-class-plan-maker, activity-project-generator, and story-passage-creator, topic is optional
    const topicInfo = topic || (toolType === 'activity-project-generator' ? 'all projects' : toolType === 'story-passage-creator' ? 'all passages' : 'all lessons');
    console.log(`🔍 Fetching hardcoded content for ${toolType} - ${classDisplay}, ${finalSubject}, ${topicInfo}`);

    // For lesson-planner, daily-class-plan-maker, activity-project-generator, and story-passage-creator, pass empty string if topic not provided
    // For other tools, topic is required
    const topicForFetch = (toolType === 'lesson-planner' || toolType === 'daily-class-plan-maker' || toolType === 'activity-project-generator' || toolType === 'story-passage-creator') ? (topic || '') : topic;
    const hardcodedData = await getHardcodedContent(classNumber, finalSubject, topicForFetch, toolType, params);
    
    if (!hardcodedData) {
      const topicMsg = topic ? `Topic: ${topic}` : 'all lessons';
      console.log(`❌ No hardcoded content found for ${toolType} - ${classDisplay}, ${finalSubject}, ${topicMsg}`);
      return res.status(404).json({
        success: false,
        message: `No pre-generated content available for ${toolType} with ${classDisplay}, Subject: ${finalSubject}${topic ? `, ${topicMsg}` : ''}. Please check if the content exists in the hardcoded folder.`,
        hint: topic ? 'Make sure the topic/unit name matches the folder structure.' : 'Make sure planner.json exists for this subject.'
      });
    }

    console.log(`✅ Found hardcoded content for ${toolType}`);
    
    // Format hardcoded content to Markdown
    const formattedContent = formatHardcodedContent(hardcodedData, toolType, {
      subject: finalSubject,
      topic,
      classNumber: isIIT6 ? 'IIT-6' : classNum,
      ...params
    });

    // For Short Notes and Concept Mastery Helper, also include raw data for carousel parsing
    const responseData = {
      success: true,
      data: {
        content: formattedContent,
        toolType,
        metadata: {
          classNumber: isIIT6 ? 'IIT-6' : classNum,
          subject: finalSubject,
          topic,
          ...params,
          generatedAt: new Date(),
          teacherId,
          source: 'hardcoded',
          sourceLabel: 'Pre-generated Content'
        }
      }
    };
    
    // Add raw data for Short Notes & Summaries to enable carousel parsing
    if (toolType === 'short-notes-summaries-maker' && hardcodedData && hardcodedData.notes) {
      responseData.data.rawData = {
        notes: hardcodedData.notes
      };
    }
    
    // Add raw data for Concept Mastery Helper to enable carousel parsing
    if (toolType === 'concept-mastery-helper' && hardcodedData && hardcodedData.concepts) {
      responseData.data.rawData = {
        concepts: hardcodedData.concepts
      };
    }
    
    // Add raw data for Lesson Planner to enable viewer parsing
    if (toolType === 'lesson-planner' && hardcodedData) {
      responseData.data.rawData = {
        lessons: hardcodedData.lessons || hardcodedData.lesson_plans || [],
        book: hardcodedData.book || '',
        class: hardcodedData.class || classNum.toString()
      };
    }
    
    // Add raw data for Concept Mastery Helper to enable carousel parsing
    if (toolType === 'concept-mastery-helper' && hardcodedData && hardcodedData.concepts) {
      responseData.data.rawData = {
        concepts: hardcodedData.concepts
      };
    }
    
    return res.json(responseData);
  } catch (error) {
    console.error('Create teacher tool error:', error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to fetch content for ${req.body.toolType || 'tool'}: ${error.message}`,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get valid subjects for a class
export const getSubjects = async (req, res) => {
  try {
    const { classNumber } = req.query;
    
    console.log('📚 getSubjects called for Class:', classNumber);

    if (!classNumber) {
      return res.status(400).json({
        success: false,
        message: 'Class number is required'
      });
    }

    // Handle IIT-6 specially (before parsing as integer)
    if (classNumber === 'IIT-6') {
      const { getSubjectsForClass } = await import('../services/hardcoded-content-service.js');
      const subjects = await getSubjectsForClass('IIT-6');
      
      // If no subjects found in folder, use IIT default subjects
      const finalSubjects = subjects.length > 0 ? subjects : ['Physics', 'Chemistry', 'Maths', 'Biology'];

      return res.json({
        success: true,
        data: finalSubjects.map(subject => ({
          name: subject,
          displayName: subject
        })),
        message: `Found ${finalSubjects.length} subjects for IIT-6`
      });
    }

    const classNum = parseInt(classNumber);
    
    // Support classes 5-10
    if (isNaN(classNum) || classNum < 5 || classNum > 10) {
      return res.json({
        success: true,
        data: [],
        message: `Only classes 5-10 and IIT-6 are currently supported. Class ${classNumber} content is not available.`
      });
    }

    // Get subjects for the class (from folder structure or default)
    const { getSubjectsForClass } = await import('../services/hardcoded-content-service.js');
    const subjects = await getSubjectsForClass(classNum);
    
    // If no subjects found in folder, use default valid subjects
    const finalSubjects = subjects.length > 0 ? subjects : VALID_SUBJECTS;

    res.json({
      success: true,
      data: finalSubjects.map(subject => ({
        name: subject,
        displayName: subject
      })),
      message: `Found ${finalSubjects.length} subjects for Class ${classNum}`
    });
  } catch (error) {
    console.error('❌ Get subjects error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get subjects',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get available chapters/topics for a class and subject from planner.json
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

    // Normalize subject name (handle case variations like "maths" vs "Maths")
    let normalizedSubject = subject.charAt(0).toUpperCase() + subject.slice(1).toLowerCase();
    
    // Map "Mathematics" to "Maths" to match VALID_SUBJECTS
    if (normalizedSubject === 'Mathematics') {
      normalizedSubject = 'Maths';
    }
    
    // Get chapters from planner.json and folder structure
    const chapters = await getChaptersForSubject(classNumber, normalizedSubject);
    
    console.log(`✅ Found ${chapters.length} chapters for ${subject} (normalized: ${normalizedSubject})`);

    res.json({
      success: true,
      data: chapters,
      message: `Found ${chapters.length} chapters for ${subject}`
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

// Get all available content types for a specific chapter/topic
export const getAvailableContent = async (req, res) => {
  try {
    const { classNumber, subject, topic } = req.query;
    
    console.log('📋 getAvailableContent called with:', { classNumber, subject, topic });

    if (!classNumber || !subject || !topic) {
      return res.status(400).json({
        success: false,
        message: 'Class number, subject, and topic are required'
      });
    }

    // Get all available content types for this topic
    const availableContent = await getAvailableContentForTopic(classNumber, subject, topic);
    
    console.log(`✅ Found ${availableContent.length} content types for ${subject}/${topic}`);

    res.json({
      success: true,
      data: availableContent,
      message: `Found ${availableContent.length} content types available for this chapter`
    });
  } catch (error) {
    console.error('❌ Get available content error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get available content',
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
