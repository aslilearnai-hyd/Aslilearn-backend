import { 
  getChaptersForSubject,
  getAvailableContentForTopic,
  VALID_SUBJECTS
} from '../services/hardcoded-content-service.js';
import { generateTeacherTool } from '../services/gemini-service.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import { runHybridRagQuery } from '../services/pdf-rag-service.js';
import { fetchRotatingAiToolData } from '../services/ai-tool-rotation-service.js';

function teacherToolDisplayName(toolType) {
  const map = {
    'activity-project-generator': 'Activity & Project Generator',
    'worksheet-mcq-generator': 'Worksheet & MCQ Generator',
    'concept-mastery-helper': 'Concept Mastery Helper',
    'lesson-planner': 'Lesson Planner',
    'homework-creator': 'Homework Creator',
    'rubrics-evaluation-generator': 'Rubrics, Evaluation & Report Card',
    'story-passage-creator': 'Story & Passage Creator',
    'short-notes-summaries-maker': 'Short Notes & Summaries',
    'flashcard-generator': 'Flashcard Generator',
    'daily-class-plan-maker': 'Daily Class Plan',
    'exam-question-paper-generator': 'Exam Question Paper',
  };
  return map[toolType] || toolType.replace(/-/g, ' ');
}

function normalizeClassLabelFromInput(classInput) {
  if (classInput === 'IIT-6') return 'IIT-6';
  const raw = String(classInput || '').trim();
  const num = parseInt(raw.replace('Class ', ''), 10);
  if (Number.isFinite(num)) return `Class ${num}`;
  return raw;
}

/** Curriculum dropdowns use names like "Mathematics"; VALID_SUBJECTS uses "Maths". */
function normalizeTeacherSubjectForValidation(subject) {
  const s = String(subject || '').trim();
  if (!s) return s;
  const key = s.toLowerCase().replace(/\s+/g, ' ');
  const aliases = {
    mathematics: 'Maths',
    math: 'Maths',
    maths: 'Maths',
    'social studies': 'Social Science',
    sst: 'Social Science',
  };
  return aliases[key] ?? s;
}

/** Match older DB rows that stored "Mathematics" instead of "Maths". */
function subjectFilterForDb(subjectNormalized) {
  const s = String(subjectNormalized || '').trim();
  if (s === 'Maths') {
    return { $in: ['Maths', 'Mathematics'] };
  }
  if (s === 'Social Science') {
    return { $in: ['Social Science', 'Social Studies'] };
  }
  return s;
}

function normalizeTopicSub(val) {
  return String(val || '')
    .trim()
    .replace(/\s+/g, ' ');
}

const VALID_AI_TOOL_CONTENT_OR = [
  {
    generatedContent: {
      $exists: true,
      $nin: ['', null],
      $not: /no projects available/i,
    },
  },
  {
    content: {
      $exists: true,
      $nin: ['', null],
      $not: /no projects available/i,
    },
  },
];

/** Super-admin or imported bundle rows (metadata shape may vary). */
const SUPER_ADMIN_STORED_CONTENT = {
  $or: [
    { 'metadata.createdByRole': 'super-admin' },
    { 'metadata.source': 'super-admin' },
    { 'metadata.source': 'super-admin-import' },
    { 'metadata.source': 'super-admin-bundle' },
  ],
};

/**
 * Same match priority as GET /generated-content: exact → topic → subject, optional anyToolName.
 * @param {string} classLabel e.g. "Class 7"
 * @param {string} subjectNormalized validated subject (e.g. "Maths")
 */
function buildAiToolFallbackAttempts(classLabel, subjectNormalized, topic, subTopic, toolType) {
  const subjectDb = subjectFilterForDb(subjectNormalized);
  const baseFilter = {
    classLabel,
    subject: subjectDb,
    ...(toolType ? { toolName: toolType } : {}),
  };
  const validContentFilter = { $or: VALID_AI_TOOL_CONTENT_OR };

  const attempts = [];
  attempts.push({
    matchType: 'exact',
    filter: {
      ...baseFilter,
      topic: topic || '',
      subtopic: subTopic || '',
      ...validContentFilter,
    },
  });

  const userSpecifiedSubtopic = String(subTopic || '').length > 0;
  const userSpecifiedTopic = String(topic || '').length > 0;
  if (userSpecifiedSubtopic) {
    // exact only
  } else if (userSpecifiedTopic) {
    attempts.push({
      matchType: 'topic',
      filter: {
        ...baseFilter,
        topic,
        ...validContentFilter,
      },
    });
  } else {
    attempts.push({
      matchType: 'subject',
      filter: { ...baseFilter, ...validContentFilter },
    });
  }

  if (toolType) {
    const withAnyToolName = attempts.map((a) => {
      const filter = { ...a.filter };
      delete filter.toolName;
      return {
        matchType: `${a.matchType}-anyToolName`,
        filter,
      };
    });
    attempts.push(...withAnyToolName);
  }

  return attempts;
}

/**
 * Prefer super-admin–tagged rows when requested, then any valid stored row (latest first).
 */
async function findStoredAiToolContent(classLabel, subjectNormalized, topic, subTopic, toolType, {
  preferSuperAdmin = true,
} = {}) {
  const attempts = buildAiToolFallbackAttempts(
    classLabel,
    subjectNormalized,
    topic,
    subTopic,
    toolType,
  );

  for (const attempt of attempts) {
    if (preferSuperAdmin) {
      const superDoc = await AiToolGeneration.findOne({
        $and: [attempt.filter, SUPER_ADMIN_STORED_CONTENT],
      })
        .sort({ createdAt: -1 })
        .lean();
      if (superDoc) {
        return { matchedDoc: superDoc, matchedBy: `${attempt.matchType}+super-admin` };
      }
    }
    const doc = await AiToolGeneration.findOne(attempt.filter).sort({ createdAt: -1 }).lean();
    if (doc) {
      return { matchedDoc: doc, matchedBy: attempt.matchType };
    }
  }
  return { matchedDoc: null, matchedBy: null };
}

// Teacher tools: local LLM generates content from class, subject, topic, and tool-specific params
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

    if (!classNumber || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Class number and subject are required.'
      });
    }
    
    // Rubrics uses assignmentType / report fields — no curriculum "topic" in the UI.
    const topicOptionalTools = new Set([
      'lesson-planner',
      'daily-class-plan-maker',
      'activity-project-generator',
      'story-passage-creator',
      'rubrics-evaluation-generator',
    ]);
    if (!topicOptionalTools.has(toolType) && !topic) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required for this tool type.',
      });
    }

    const rawSubTopic =
      params.subTopic != null && params.subTopic !== '' ? String(params.subTopic) : '';
    if (!normalizeTopicSub(rawSubTopic)) {
      return res.status(400).json({
        success: false,
        message: 'Sub topic is required.',
      });
    }

    const isIIT6 = classNumber === 'IIT-6';
    const validSubjectsList = isIIT6 ? ['Physics', 'Chemistry', 'Maths', 'Biology'] : VALID_SUBJECTS;

    const subjectForLookup = normalizeTeacherSubjectForValidation(subject);
    const normalizedSubject = validSubjectsList.find(
      (s) => s.toLowerCase() === subjectForLookup.toLowerCase(),
    );
    
    if (!normalizedSubject) {
      return res.status(400).json({
        success: false,
        message: `Invalid subject. Valid subjects are: ${validSubjectsList.join(', ')}`
      });
    }
    
    if (toolType === 'story-passage-creator' && normalizedSubject !== 'English' && normalizedSubject !== 'Hindi') {
      return res.status(400).json({
        success: false,
        message: 'Story & Passage Creator is only available for English and Hindi subjects.'
      });
    }
    
    const finalSubject = normalizedSubject;
    const classNum = isIIT6 ? classNumber : parseInt(classNumber, 10);
    const classDisplay = isIIT6 ? 'IIT-6' : `Class ${classNum}`;

    const topicForStore = normalizeTopicSub(
      topic !== undefined && topic !== null ? String(topic) : '',
    );
    const subtopicForStore = normalizeTopicSub(
      params.subTopic != null && params.subTopic !== '' ? String(params.subTopic) : '',
    );

    const llmParams = {
      ...params,
      subject: finalSubject,
      topic: topicForStore || (params.topic ?? ''),
      gradeLevel: classDisplay,
    };

    if (toolType === 'concept-mastery-helper') {
      llmParams.concept = topicForStore || params.concept || llmParams.topic;
    }

    const n = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : undefined;
    };
    if (params.questionCount != null) llmParams.questionCount = n(params.questionCount) ?? params.questionCount;
    if (params.duration != null) llmParams.duration = n(params.duration) ?? params.duration;
    if (params.cardCount != null) llmParams.cardCount = n(params.cardCount) ?? params.cardCount;

    console.log(
      `🤖 LLM teacher tool: ${toolType} — ${classDisplay}, ${finalSubject}, topic: ${topicForStore || '(optional)'}`,
    );

    const { doc: cachedDoc, matchType, totalCandidates, selectedIndex } = await fetchRotatingAiToolData({
      classLabel: classDisplay,
      subject: finalSubject,
      topic: topicForStore,
      subtopic: subtopicForStore,
      toolName: toolType,
    });
    if (cachedDoc) {
      const cachedContent = String(cachedDoc.generatedContent || cachedDoc.content || '').trim();
      if (cachedContent) {
        return res.json({
          success: true,
          data: {
            content: cachedContent,
            toolType,
            metadata: {
              classNumber: isIIT6 ? 'IIT-6' : classNum,
              subject: finalSubject,
              topic: topicForStore,
              ...params,
              generatedAt: new Date(),
              teacherId,
              source: 'cache',
              sourceLabel: 'Previously generated content',
              matchType,
              totalCandidates,
              selectedIndex,
            },
          },
        });
      }
    }

    let generatedContent;
    let ragMeta = null;
    let fromStoredFallback = false;
    let storedFallbackMatch = null;
    try {
      const ragInput = `${teacherToolDisplayName(toolType)} for ${classDisplay}, ${finalSubject}, ${topicForStore || ''}. ${JSON.stringify(params)}`;
      const ragResult = await runHybridRagQuery({
        query: ragInput,
        subject: finalSubject,
        classLabel: classDisplay,
        toolType,
        role: 'teacher',
        cacheKey: `${toolType}|${topicForStore}|${subtopicForStore}`,
        metadata: { teacherId },
      });

      if (ragResult?.source === 'rag' && ragResult?.content) {
        generatedContent = ragResult.content;
        ragMeta = {
          chunksUsed: ragResult.chunksUsed || 0,
          citations: ragResult.citations || [],
        };
      } else {
        generatedContent = await generateTeacherTool(toolType, llmParams);
      }
      if (
        generatedContent == null ||
        (typeof generatedContent === 'string' && generatedContent.trim().length === 0)
      ) {
        throw new Error('AI returned empty response');
      }
    } catch (err) {
      console.error('LLM teacher tool error:', err);
      const { matchedDoc, matchedBy } = await findStoredAiToolContent(
        classDisplay,
        finalSubject,
        topicForStore,
        subtopicForStore,
        toolType,
        { preferSuperAdmin: true },
      );
      if (matchedDoc) {
        const raw =
          (matchedDoc.generatedContent && String(matchedDoc.generatedContent).trim()) ||
          (matchedDoc.content && String(matchedDoc.content).trim()) ||
          '';
        if (raw.length > 0) {
          generatedContent = raw;
          fromStoredFallback = true;
          storedFallbackMatch = matchedBy;
          console.log(
            `📦 AI unavailable — serving stored content (${matchedBy}) id=${String(matchedDoc._id)}`,
          );
        }
      }
      if (!generatedContent) {
        return res.status(503).json({
          success: false,
          code: 'AI_UNAVAILABLE_NO_FALLBACK',
          fallbackAttempted: true,
          message:
            'AI service is unavailable and no previously generated content was found for this class, subject, and topic. Super Admin can add content in AI tool generations, or try again after fixing the API key / quota.',
        });
      }
    }

    const display = teacherToolDisplayName(toolType);
    const header = `## ${display}\n\n**Class:** ${isIIT6 ? 'IIT-6' : classNum}\n**Subject:** ${finalSubject}${topicForStore ? `\n**Topic:** ${topicForStore}` : ''}\n\n---\n\n`;

    const fullContent = fromStoredFallback
      ? String(generatedContent || '')
      : header + (generatedContent || '');
    const sectionValue =
      params.section != null && String(params.section).trim() !== ''
        ? String(params.section).trim()
        : params.className != null && String(params.className).trim() !== ''
          ? String(params.className).trim()
          : '';
    if (!fromStoredFallback) {
      try {
        await AiToolGeneration.create({
          toolName: toolType,
          toolDisplayName: display,
          classLabel: classDisplay,
          subject: finalSubject,
          topic: topicForStore,
          subtopic: subtopicForStore,
          section: sectionValue,
          content: fullContent,
          generatedContent: fullContent,
          teacherId: teacherId || undefined,
          metadata: {
            source: 'llm',
            classNumber: isIIT6 ? 'IIT-6' : classNum,
            section: sectionValue,
          },
        });
      } catch (persistErr) {
        console.error('AiToolGeneration persist error (non-fatal):', persistErr);
      }
    }

    return res.json({
      success: true,
      data: {
        content: fullContent,
        toolType,
        metadata: {
          classNumber: isIIT6 ? 'IIT-6' : classNum,
          subject: finalSubject,
          topic: topicForStore,
          ...params,
          generatedAt: new Date(),
          teacherId,
          source: fromStoredFallback ? 'fallback-db' : 'llm',
          sourceLabel: fromStoredFallback
            ? 'Previously generated content (AI unavailable)'
            : 'AI Generated',
          aiUnavailable: fromStoredFallback,
          fallbackMatch: storedFallbackMatch || undefined,
          ...(ragMeta || {}),
        },
      },
    });
  } catch (error) {
    console.error('Create teacher tool error:', error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to generate content for ${req.body.toolType || 'tool'}: ${error.message}`,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Alias endpoint requested by UI: POST /generate-content
export const generateContent = async (req, res) => createTeacherTool(req, res);

// GET /generated-content?class=&subject=&topic=&subTopic=&toolType=
// Fallback priority (latest by createdAt for each attempt):
// - subTopic set: exact (class+subject+topic+subTopic) only.
// - topic set, subTopic empty: exact, then same class+subject+topic (any subTopic in DB).
// - topic empty: exact, then class+subject only.
export const getGeneratedContent = async (req, res) => {
  try {
    const classInput = req.query.class ?? req.query.classLabel ?? req.query.classNumber;
    const subject = normalizeTeacherSubjectForValidation(String(req.query.subject || '').trim());
    const topic = normalizeTopicSub(req.query.topic);
    const subTopic = normalizeTopicSub(req.query.subTopic || req.query.subtopic);
    const toolType = String(req.query.toolType || '').trim();

    if (!classInput || !subject) {
      return res.status(400).json({
        success: false,
        message: 'class and subject are required',
      });
    }

    const classLabel = normalizeClassLabelFromInput(classInput);

    const userSpecifiedSubtopic = subTopic.length > 0;
    const userSpecifiedTopic = topic.length > 0;
    if (userSpecifiedSubtopic) {
      console.log(
        'Fallback: subTopic specified — using exact match only (no topic/subject fallbacks)',
      );
    } else if (userSpecifiedTopic) {
      console.log(
        'Fallback: topic specified without subTopic — using exact + topic match only (no subject-wide fallback)',
      );
    }

    const { doc: matchedDoc, matchType, totalCandidates, selectedIndex } = await fetchRotatingAiToolData({
      classLabel,
      subject,
      topic,
      subtopic: subTopic,
      toolName: toolType,
    });

    if (matchedDoc) {
      console.log('Fallback matched record id:', String(matchedDoc._id), 'by', matchType);
    }

    if (!matchedDoc) {
      console.log('Fallback: no valid previously generated content found');
      return res.json({
        success: true,
        data: null,
        message: 'No previously generated content available.',
      });
    }

    return res.json({
      success: true,
      data: {
        _id: matchedDoc._id,
        class: matchedDoc.classLabel,
        subject: matchedDoc.subject,
        topic: matchedDoc.topic || '',
        subTopic: matchedDoc.subtopic || '',
        section: matchedDoc.section || '',
        generatedContent: matchedDoc.generatedContent || matchedDoc.content || '',
        createdAt: matchedDoc.createdAt,
        matchType,
        totalCandidates,
        selectedIndex,
        source: 'fallback-db',
        sourceLabel: 'Previously generated content',
      },
    });
  } catch (error) {
    console.error('getGeneratedContent error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch previously generated content',
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
    
    // Map common variations to canonical names
    if (normalizedSubject === 'Mathematics') normalizedSubject = 'Maths';
    if (normalizedSubject === 'Social science') normalizedSubject = 'Social Science';
    if (normalizedSubject === 'Social studies') normalizedSubject = 'Social Science';
    if (normalizedSubject === 'Social') normalizedSubject = 'Social Science';
    
    // Get chapters from folder structure
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

// PDF upload and extraction removed - AI tools now use centralized LLM service
