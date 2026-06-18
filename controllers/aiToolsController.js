import { 
  getChaptersForSubject,
  getAvailableContentForTopic,
  VALID_SUBJECTS
} from '../services/hardcoded-content-service.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import TeacherToolUsage from '../models/TeacherToolUsage.js';
import { fetchRotatingAiToolData } from '../services/ai-tool-rotation-service.js';
import { extractRawTextFromPDF } from '../services/pdf-extractor-service.js';
import { buildPdfExtractEmptyMessage, extractAndGenerateAllItems, getLastPdfExtractionMeta } from '../services/gemini-service.js';

import {
  formatItemToContentFromTemplate,
  getToolDisplayTitle,
  getToolRegistryMeta,
  isValidAiToolSlug,
} from '../config/aiToolTemplates.js';
import { buildRawDataForTool } from '../utils/build-ai-tool-raw-data.js';
import {
  extractActivityTitleFromMarkdown,
  isCurriculumBreadcrumbTitle,
} from '../services/activity-title-utils.js';
import { canonicalizeActivityExtractedItem } from '../services/ai-content-engine-service.js';
import {
  normalizeCurriculumSubjectForValidation,
  resolveClassDisplay,
  resolveValidCurriculumSubject,
  subjectFilterForDb,
} from '../utils/curriculum-subject-validation.js';

function teacherToolDisplayName(toolType) {
  return getToolDisplayTitle(toolType) || String(toolType || '').replace(/-/g, ' ');
}

function normalizeClassLabelFromInput(classInput) {
  if (classInput === 'IIT-6') return 'IIT-6';
  const raw = String(classInput || '').trim();
  const num = parseInt(raw.replace('Class ', ''), 10);
  if (Number.isFinite(num)) return `Class ${num}`;
  return raw;
}

const normalizeTeacherSubjectForValidation = normalizeCurriculumSubjectForValidation;

function normalizeTopicSub(val) {
  return String(val || '')
    .trim()
    .replace(/\s+/g, ' ');
}

const TOOL_DISPLAY_NAMES = Object.fromEntries(
  Object.entries(getToolRegistryMeta()).map(([slug, meta]) => [slug, meta.title]),
);

/** Tools exposed on the teacher Vidya AI dashboard (must stay in sync with UI tool lists). */
export const TEACHER_DASHBOARD_TOOL_IDS = Object.freeze([
  'activity-project-generator',
  'worksheet-mcq-generator',
  'concept-mastery-helper',
  'lesson-planner',
  'exam-question-paper-generator',
  'daily-class-plan-maker',
  'homework-creator',
  'learning-outcomes-generator',
  'story-passage-creator',
  'short-notes-summaries-maker',
  'flashcard-generator',
  'report-card-generator',
  'student-skill-tracker',
]);

const MINUTES_SAVED_PER_RESOURCE = 20;
const WEEKLY_PREP_MINUTES = 600;

function logTeacherToolUsage({ teacherId, toolType, classDisplay, finalSubject, topicForStore, subtopicForStore }) {
  if (!teacherId || !toolType) return;
  TeacherToolUsage.create({
    teacherId,
    toolType,
    classLabel: classDisplay || '',
    subject: finalSubject || '',
    topic: topicForStore || '',
    subtopic: subtopicForStore || '',
  }).catch((err) => console.warn('[TeacherToolUsage] log failed:', err.message));
}

export function formatItemToContent(toolType, item, index = 0) {
  if (isValidAiToolSlug(toolType)) {
    return formatItemToContentFromTemplate(toolType, item, index);
  }
  const i = item || {};
  const n = i.sl_no || i.question_number || index + 1;
  return `## Item ${n}: ${i.title || 'Untitled'}\n\n${i.content || JSON.stringify(i, null, 2)}`.trim();
}

function parsePositiveInt(value) {
  const num = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function trimTextQuestions(content, maxQuestions) {
  if (!maxQuestions) return content;
  const lines = String(content || '').split(/\r?\n/);
  const questionStartRegex = /^\s*(?:Q(?:uestion)?\s*\d+[\).:\-]|(?:\d+)[\).]\s+)/i;
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (questionStartRegex.test(lines[i] || '')) starts.push(i);
  }
  if (starts.length <= maxQuestions) return content;
  const cutoffLine = starts[maxQuestions];
  return lines.slice(0, cutoffLine).join('\n').trim();
}

function limitQuestionsInJson(parsed, maxQuestions) {
  if (!maxQuestions || parsed == null) return parsed;

  if (Array.isArray(parsed)) {
    return parsed.slice(0, maxQuestions);
  }

  if (Array.isArray(parsed.questions)) {
    return { ...parsed, questions: parsed.questions.slice(0, maxQuestions) };
  }

  if (Array.isArray(parsed.mcqs)) {
    return { ...parsed, mcqs: parsed.mcqs.slice(0, maxQuestions) };
  }

  if (Array.isArray(parsed.items)) {
    return { ...parsed, items: parsed.items.slice(0, maxQuestions) };
  }

  return parsed;
}

function limitWorksheetStructuredContent(structured, maxQuestions) {
  if (!maxQuestions || !structured || typeof structured !== 'object' || Array.isArray(structured)) {
    return structured;
  }
  const out = { ...structured };
  let remaining = maxQuestions;

  if (Array.isArray(structured.sections)) {
    out.sections = structured.sections.map((sec) => {
      if (!sec || typeof sec !== 'object') return sec;
      const qs = Array.isArray(sec.questions) ? sec.questions : [];
      if (remaining <= 0) return { ...sec, questions: [] };
      const take = qs.slice(0, remaining);
      remaining -= take.length;
      return { ...sec, questions: take };
    });
  }

  if (Array.isArray(structured.questions)) {
    out.questions = structured.questions.slice(0, maxQuestions);
  }

  for (const key of [
    'section_a_mcqs',
    'section_a',
    'section_b_fib',
    'section_b',
    'section_c_vsa',
    'section_c',
    'section_d_sa',
    'section_d',
    'section_e_competency',
    'section_e',
  ]) {
    if (!Array.isArray(structured[key])) continue;
    if (remaining <= 0) {
      out[key] = [];
      continue;
    }
    const take = structured[key].slice(0, remaining);
    remaining -= take.length;
    out[key] = take;
  }

  return out;
}

function applyQuestionLimitToContent(toolType, content, requestedCount) {
  const limitedToolTypes = new Set([
    'mock-test-builder',
    'exam-question-paper-generator',
    'worksheet-mcq-generator',
  ]);
  if (!limitedToolTypes.has(String(toolType || ''))) return String(content || '');

  const maxQuestions = parsePositiveInt(requestedCount);
  if (!maxQuestions) return String(content || '');

  const text = String(content || '').trim();
  if (!text) return text;

  try {
    const parsed = JSON.parse(text);
    const trimmed = limitQuestionsInJson(parsed, maxQuestions);
    return JSON.stringify(trimmed, null, 2);
  } catch {
    return trimTextQuestions(text, maxQuestions);
  }
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
    const { toolType, classNumber, subject, topic, board, ...params } = req.body;
    const teacherId = req.teacherId;

    const { getTeacherSchoolProgramContext, validateAiToolBoardAccess } =
      await import('../utils/schoolProgram.js');
    const programCtx = await getTeacherSchoolProgramContext(teacherId);
    const boardCheck = validateAiToolBoardAccess(programCtx.isAsliPrepExclusive, {
      board,
      classNumber,
    });
    if (!boardCheck.ok) {
      return res.status(403).json({ success: false, message: boardCheck.message });
    }

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
    
    // Some tools can generate without explicit curriculum topic in the UI.
    const topicOptionalTools = new Set([
      'lesson-planner',
      'study-schedule-maker',
      'daily-class-plan-maker',
      'activity-project-generator',
      'project-idea-lab',
      'reading-practice-room',
      'story-passage-creator',
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

    const { normalizedSubject, validSubjectsList } = resolveValidCurriculumSubject(subject, {
      classNumber,
    });

    if (!normalizedSubject) {
      return res.status(400).json({
        success: false,
        message: `Invalid subject. Valid subjects are: ${validSubjectsList.join(', ')}`
      });
    }
    
    if (toolType === 'story-passage-creator' || toolType === 'reading-practice-room') {
      const { canonicalStoryPassageSubject, STORY_PASSAGE_SUBJECT_ERROR } = await import(
        '../utils/story-passage-subject.js'
      );
      const storySubject = canonicalStoryPassageSubject(normalizedSubject || subject);
      if (!storySubject) {
        return res.status(400).json({
          success: false,
          message: STORY_PASSAGE_SUBJECT_ERROR,
        });
      }
    }
    
    const finalSubject = normalizedSubject;
    const { isIIT6, classNum, classDisplay } = resolveClassDisplay(classNumber);

    const topicForStore = normalizeTopicSub(
      topic !== undefined && topic !== null ? String(topic) : '',
    );
    const subtopicForStore = normalizeTopicSub(
      params.subTopic != null && params.subTopic !== '' ? String(params.subTopic) : '',
    );

    console.log(
      `📦 AI Tool Data lookup: ${toolType} — ${classDisplay}, ${finalSubject}, topic: ${topicForStore || '(optional)'}`,
    );

    const {
      validateDashboardAiToolDoc,
      DASHBOARD_INCOMPLETE_CODE,
      DASHBOARD_INCOMPLETE_USER_MESSAGE,
      DASHBOARD_WRONG_TOOL_CODE,
      DASHBOARD_WRONG_TOOL_USER_MESSAGE,
    } = await import('../services/ai-tool-dashboard-validation.js');

    const { doc: cachedDoc, matchType, totalCandidates, selectedIndex } = await fetchRotatingAiToolData({
      classLabel: classDisplay,
      subject: finalSubject,
      topic: topicForStore,
      subtopic: subtopicForStore,
      toolName: toolType,
      board:
        String(req.body.board || '').trim() ||
        (isIIT6 ? 'IIT' : programCtx.curriculumBoard || programCtx.displayBoard || 'CBSE'),
      preferLatest: false,
      strictToolMatch: true,
      cursorScope: String(teacherId || ''),
      validator: async (doc) => validateDashboardAiToolDoc(toolType, doc).valid,
    });
    if (cachedDoc) {
      const cachedContent = String(cachedDoc.generatedContent || cachedDoc.content || '').trim();
      if (cachedContent) {
        const contentGate = validateDashboardAiToolDoc(toolType, cachedDoc);
        const isWrongTool = contentGate.code === DASHBOARD_WRONG_TOOL_CODE;
        if (!contentGate.valid) {
          return res.status(404).json({
            success: false,
            code: contentGate.code || (isWrongTool ? DASHBOARD_WRONG_TOOL_CODE : DASHBOARD_INCOMPLETE_CODE),
            message:
              contentGate.message ||
              (isWrongTool ? DASHBOARD_WRONG_TOOL_USER_MESSAGE : DASHBOARD_INCOMPLETE_USER_MESSAGE),
            missingSections: contentGate.missingSections || [],
          });
        }

        const maxQuestions = parsePositiveInt(params.questionCount ?? req.body?.questionCount);
        const limitedContent = applyQuestionLimitToContent(
          toolType,
          cachedContent,
          maxQuestions,
        );
        const metadataForRaw = { ...(cachedDoc.metadata || {}) };
        if (
          maxQuestions &&
          toolType === 'worksheet-mcq-generator' &&
          metadataForRaw.structuredContent &&
          typeof metadataForRaw.structuredContent === 'object'
        ) {
          metadataForRaw.structuredContent = limitWorksheetStructuredContent(
            metadataForRaw.structuredContent,
            maxQuestions,
          );
        }
        const rawData = buildRawDataForTool(toolType, limitedContent, metadataForRaw);
        logTeacherToolUsage({
          teacherId,
          toolType,
          classDisplay,
          finalSubject,
          topicForStore,
          subtopicForStore,
        });
        return res.json({
          success: true,
          data: {
            content: limitedContent,
            ...(rawData ? { rawData } : {}),
            toolType,
            metadata: {
              classNumber: isIIT6 ? 'IIT-6' : classNum,
              subject: finalSubject,
              topic: topicForStore,
              ...params,
              generatedAt: new Date(),
              teacherId,
              source: 'ai-tool-data',
              sourceLabel: 'AI Tool Data',
              matchType,
              totalCandidates,
              selectedIndex,
            },
          },
        });
      }
    }
    return res.status(404).json({
      success: false,
      code: 'AI_TOOL_DATA_NOT_FOUND',
      message:
        'No matching AI Tool Data found for the selected class, subject, topic, and sub topic. Please ask Super Admin to add this mapping in AI Tool Generations.',
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

    const {
      validateDashboardAiToolDoc,
      DASHBOARD_INCOMPLETE_CODE,
      DASHBOARD_INCOMPLETE_USER_MESSAGE,
      DASHBOARD_WRONG_TOOL_CODE,
      DASHBOARD_WRONG_TOOL_USER_MESSAGE,
    } = await import('../services/ai-tool-dashboard-validation.js');

    const { doc: matchedDoc, matchType, totalCandidates, selectedIndex } = await fetchRotatingAiToolData({
      classLabel,
      subject,
      topic,
      subtopic: subTopic,
      toolName: toolType,
      board: String(req.query.board || '').trim() || (classLabel === 'IIT-6' ? 'IIT' : ''),
      preferLatest: false,
      strictToolMatch: true,
      cursorScope: String(req.userId || req.teacherId || ''),
      validator: toolType
        ? async (doc) => validateDashboardAiToolDoc(toolType, doc).valid
        : null,
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

    if (toolType) {
      const contentGate = validateDashboardAiToolDoc(toolType, matchedDoc);
      if (!contentGate.valid) {
        const isWrongTool = contentGate.code === DASHBOARD_WRONG_TOOL_CODE;
        return res.json({
          success: true,
          data: null,
          message:
            contentGate.message ||
            (isWrongTool ? DASHBOARD_WRONG_TOOL_USER_MESSAGE : DASHBOARD_INCOMPLETE_USER_MESSAGE),
          code: contentGate.code || DASHBOARD_INCOMPLETE_CODE,
          missingSections: contentGate.missingSections || [],
        });
      }
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

export const uploadAndParsePdf = async (req, res) => {
  try {
    const { toolType, classNumber, subject, topic, subTopic, board = 'CBSE' } = req.body;
    const pdfFile = req.file;
    if (!pdfFile) {
      return res.status(400).json({ success: false, message: 'No PDF file uploaded.' });
    }
    if (!toolType || !classNumber || !subject) {
      return res.status(400).json({ success: false, message: 'toolType, classNumber, and subject are required.' });
    }

    const { isIIT6, classNum, classDisplay } = resolveClassDisplay(classNumber);
    const finalSubject = normalizeTeacherSubjectForValidation(subject);
    const topicForStore = normalizeTopicSub(topic || '');
    const subtopicForStore = normalizeTopicSub(subTopic || '');

    const rawText = await extractRawTextFromPDF(pdfFile.buffer);
    if (!rawText || rawText.length < 50) {
      return res.status(422).json({
        success: false,
        message: 'PDF appears to be empty or image-only (no extractable text).',
      });
    }

    const allItems = await extractAndGenerateAllItems(toolType, rawText, {
      classLabel: classDisplay,
      subject: finalSubject,
      topic: topicForStore,
      subtopic: subtopicForStore,
    });
    if (!Array.isArray(allItems) || allItems.length === 0) {
      return res.status(422).json({
        success: false,
        code: 'PDF_PARSE_FAILED',
        message: buildPdfExtractEmptyMessage(toolType),
      });
    }

    const extractionMeta = getLastPdfExtractionMeta();
    const now = new Date();
    const recordsToInsert = allItems.map((item, index) => {
      let structured =
        toolType === 'activity-project-generator' || toolType === 'project-idea-lab'
          ? canonicalizeActivityExtractedItem(item, toolType)
          : item;
      let contentStr = formatItemToContent(toolType, structured, index);
      if (toolType === 'activity-project-generator' || toolType === 'project-idea-lab') {
        const fromMd = extractActivityTitleFromMarkdown(contentStr);
        const titleBad =
          !structured?.title ||
          isCurriculumBreadcrumbTitle(structured.title) ||
          /^Untitled Activity\b/i.test(String(structured.title || ''));
        if (fromMd && titleBad) {
          structured = { ...structured, title: fromMd, name: fromMd };
          contentStr = formatItemToContent(toolType, structured, index);
        }
      }
      return {
        toolName: toolType,
        toolDisplayName: TOOL_DISPLAY_NAMES[toolType] || toolType,
        sourceType: 'ai_pdf',
        classLabel: classDisplay,
        subject: finalSubject,
        topic: topicForStore,
        subtopic: subtopicForStore,
        board: String(board || 'CBSE').trim() || 'CBSE',
        content: contentStr,
        generatedContent: contentStr,
        pdfFileName: pdfFile.originalname,
        status: 'active',
        metadata: {
          source: 'pdf-upload',
          sourceLabel: 'PDF Upload (Extracted)',
          generatedByAI: false,
          uploadedPdfName: pdfFile.originalname,
          itemIndex: index,
          totalItems: allItems.length,
          createdByRole: 'super-admin',
          structuredContent: structured,
          renderContent: structured,
          contentType: 'Generated Content',
          processingStatus: 'processed',
          approvalStatus: 'approved',
          board: String(board || 'CBSE').trim() || 'CBSE',
          extractionStatus: extractionMeta.extractionStatus || 'complete',
          validationPassed: Boolean(extractionMeta.validationPassed),
          retryCount: Number(extractionMeta.retryCount || 0),
          extractedItemCount: Number(extractionMeta.extractedItemCount || allItems.length),
        },
        createdAt: now,
        updatedAt: now,
      };
    });

    await AiToolGeneration.insertMany(recordsToInsert, { ordered: false });
    return res.json({
      success: true,
      message: `Saved ${recordsToInsert.length} record(s) extracted from the PDF (extract-only; nothing generated).`,
      data: {
        totalSaved: recordsToInsert.length,
        extractedFromPdf: recordsToInsert.length,
        generatedByAI: 0,
        toolType,
        toolDisplayName: TOOL_DISPLAY_NAMES[toolType] || toolType,
        classLabel: classDisplay,
        subject: finalSubject,
        topic: topicForStore,
        subtopic: subtopicForStore,
        pdfName: pdfFile.originalname,
        extraction: {
          extractionStatus: extractionMeta.extractionStatus || 'complete',
          validationPassed: Boolean(extractionMeta.validationPassed),
          retryCount: Number(extractionMeta.retryCount || 0),
          extractedItemCount: Number(extractionMeta.extractedItemCount || recordsToInsert.length),
          expectedItemCount: Number(extractionMeta.expectedItemCount || 0),
          validationErrors: extractionMeta.validationErrors || [],
        },
      },
    });
  } catch (error) {
    console.error('PDF upload error:', error);
    return res.status(500).json({
      success: false,
      message: `PDF processing failed: ${error.message}`,
    });
  }
};

export const getTeacherToolStats = async (req, res) => {
  try {
    const teacherId = req.teacherId;
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const teacherOid = teacherId;

    const [resourcesCreatedThisMonth, weeklyUsageCount, distinctToolsUsed] = await Promise.all([
      TeacherToolUsage.countDocuments({
        teacherId: teacherOid,
        createdAt: { $gte: monthStart },
      }),
      TeacherToolUsage.countDocuments({
        teacherId: teacherOid,
        createdAt: { $gte: weekStart },
      }),
      TeacherToolUsage.distinct('toolType', {
        teacherId: teacherOid,
        createdAt: { $gte: monthStart },
      }),
    ]);

    const timeSavedPercent = weeklyUsageCount
      ? Math.min(
          100,
          Math.round((weeklyUsageCount * MINUTES_SAVED_PER_RESOURCE * 100) / WEEKLY_PREP_MINUTES),
        )
      : 0;

    return res.json({
      success: true,
      data: {
        totalTools: TEACHER_DASHBOARD_TOOL_IDS.length,
        timeSavedPercent,
        resourcesCreatedThisMonth,
        toolsUsedThisMonth: distinctToolsUsed.length,
        weeklyGenerations: weeklyUsageCount,
      },
    });
  } catch (error) {
    console.error('getTeacherToolStats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch teacher tool stats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
