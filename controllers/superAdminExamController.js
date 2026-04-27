import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';
import { cleanCsvCell } from '../utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from '../utils/spreadsheet-to-csv.js';
import { VALID_SCHOOL_BOARDS, isValidSchoolBoard } from '../constants/boards.js';

/**
 * Keeps classNumber and assignedClasses in sync for API clients.
 * Handles legacy documents, string/array quirks, and numeric IDs from JSON.
 */
export function normalizeExamClassFields(exam) {
  if (!exam) return exam;
  const e =
    typeof exam.toObject === 'function'
      ? exam.toObject()
      : typeof exam === 'object'
        ? { ...exam }
        : exam;

  let classes = [];
  const ac = e.assignedClasses;
  if (typeof ac === 'string' && ac.trim()) {
    const s = ac.trim();
    if (s.includes('|')) {
      classes = s.split('|').map((c) => c.trim()).filter(Boolean);
    } else if (s.includes(',')) {
      classes = s.split(',').map((c) => c.trim()).filter(Boolean);
    } else {
      classes = [s];
    }
  } else if (Array.isArray(ac) && ac.length > 0) {
    classes = ac.map((c) => String(c).trim()).filter(Boolean);
  } else if (ac != null && typeof ac === 'object' && !Array.isArray(ac)) {
    classes = Object.values(ac)
      .map((c) => String(c).trim())
      .filter(Boolean);
  }

  let cn =
    e.classNumber != null && String(e.classNumber).trim() !== ''
      ? String(e.classNumber).trim()
      : '';

  if (classes.length === 0 && cn) {
    classes = [cn];
  }
  if (classes.length > 0 && !cn) {
    cn = classes[0];
  }

  e.assignedClasses = classes;
  e.classNumber = cn;

  const normalizedSubjects = normalizeExamSubjects(e.subject, e.subjects)
    .filter((s) => ALLOWED_EXAM_SUBJECTS.includes(s));
  if (normalizedSubjects.length > 0) {
    e.subjects = normalizedSubjects;
    e.subject = normalizedSubjects[0];
  } else {
    const fallbackSubject = String(e.subject || 'maths').trim().toLowerCase();
    e.subject = ALLOWED_EXAM_SUBJECTS.includes(fallbackSubject) ? fallbackSubject : 'maths';
    e.subjects = [e.subject];
  }

  return e;
}

const ALLOWED_EXAM_SUBJECTS = ['maths', 'physics', 'chemistry', 'biology'];

const buildSafeAppendQuestionsPipeline = ({ questionIds = [], totalQuestionsDelta = 0, totalMarksDelta = 0 }) => {
  const ids = Array.isArray(questionIds) ? questionIds.filter(Boolean) : [];
  return [
    {
      $set: {
        questions: {
          $cond: [{ $isArray: '$questions' }, '$questions', []]
        },
      },
    },
    {
      $set: {
        questions: { $concatArrays: ['$questions', ids] },
        totalQuestions: { $add: [{ $ifNull: ['$totalQuestions', 0] }, totalQuestionsDelta] },
        totalMarks: { $add: [{ $ifNull: ['$totalMarks', 0] }, totalMarksDelta] },
      },
    },
  ];
};

const buildSafeRemoveQuestionPipeline = ({ questionId, totalQuestionsDelta = 0, totalMarksDelta = 0 }) => [
  {
    $set: {
      questions: {
        $cond: [{ $isArray: '$questions' }, '$questions', []]
      },
    },
  },
  {
    $set: {
      questions: {
        $filter: {
          input: '$questions',
          as: 'questionId',
          cond: { $ne: ['$$questionId', questionId] },
        },
      },
      totalQuestions: {
        $max: [0, { $add: [{ $ifNull: ['$totalQuestions', 0] }, totalQuestionsDelta] }]
      },
      totalMarks: {
        $max: [0, { $add: [{ $ifNull: ['$totalMarks', 0] }, totalMarksDelta] }]
      },
    },
  },
];

const syncExamQuestionTotals = async (examId) => {
  const [totals] = await Question.aggregate([
    { $match: { exam: new mongoose.Types.ObjectId(examId) } },
    {
      $group: {
        _id: '$exam',
        totalQuestions: { $sum: 1 },
        totalMarks: { $sum: { $ifNull: ['$marks', 0] } },
      },
    },
  ]);

  await Exam.updateOne(
    { _id: examId },
    {
      $set: {
        totalQuestions: Number(totals?.totalQuestions) || 0,
        totalMarks: Number(totals?.totalMarks) || 0,
      },
    }
  );
};

function buildQuestionDedupKey({
  examId,
  subject,
  questionType,
  questionText,
  questionImage,
}) {
  const textKey = String(questionText || '').trim().toLowerCase();
  const imageKey = String(questionImage || '').trim();
  const contentKey = textKey || imageKey;
  return [String(examId), String(subject || '').trim().toLowerCase(), String(questionType || '').trim().toLowerCase(), contentKey].join('::');
}

function normalizeExamSubjects(subject, subjects) {
  const listFromSubjects = Array.isArray(subjects)
    ? subjects
    : subjects !== undefined && subjects !== null
      ? [subjects]
      : [];
  const merged = [...listFromSubjects, subject];
  const normalized = Array.from(
    new Set(
      merged
        .map((s) => String(s || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
  return normalized;
}

// Create Exam (Super Admin only)
export const createExam = async (req, res) => {
  try {
    console.log('📝 createExam controller called');
    console.log('Request body:', req.body);
    console.log('Request user:', req.user);
    
    const { 
      title, 
      description, 
      examType, 
      classNumber,
      assignedClasses,
      subject,
      subjects,
      maxAttempts,
      duration, 
      totalQuestions, 
      totalMarks, 
      instructions, 
      startDate, 
      endDate,
      board,
      targetSchools,
      isSchoolSpecific,
      isBoardSpecific,
      isAllBoards
    } = req.body;

    console.log('📝 Creating exam by Super Admin:', { title, examType, board });

    // Validation
    const normalizedAssignedClasses = Array.isArray(assignedClasses)
      ? assignedClasses.map((c) => String(c).trim()).filter(Boolean)
      : (classNumber ? [String(classNumber).trim()] : []);

    const normalizedSubjects = normalizeExamSubjects(subject, subjects);

    if (!title || !examType || normalizedAssignedClasses.length === 0 || normalizedSubjects.length === 0 || !maxAttempts || !duration || !totalQuestions || !totalMarks || !board) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: title, examType, assignedClasses, subject(s), maxAttempts, duration, totalQuestions, totalMarks, and board are required' 
      });
    }

    if (!['weekend', 'mains', 'advanced', 'practice'].includes(examType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid examType. Must be one of: weekend, mains, advanced, practice' 
      });
    }

    const examBoardUpper = board.toUpperCase().trim();
    if (!isValidSchoolBoard(examBoardUpper)) {
      return res.status(400).json({
        success: false,
        message: `Invalid board. Must be one of: ${VALID_SCHOOL_BOARDS.join(', ')}`,
      });
    }

    const invalidSubjects = normalizedSubjects.filter((s) => !ALLOWED_EXAM_SUBJECTS.includes(s));
    if (invalidSubjects.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid subject(s): ${invalidSubjects.join(', ')}. Must be one of: ${ALLOWED_EXAM_SUBJECTS.join(', ')}`
      });
    }

    const parsedMaxAttempts = parseInt(maxAttempts, 10);
    if (Number.isNaN(parsedMaxAttempts) || parsedMaxAttempts < 1) {
      return res.status(400).json({
        success: false,
        message: 'maxAttempts must be a number greater than or equal to 1'
      });
    }

    // For Super Admin, we need a valid ObjectId for createdBy
    // Since Super Admin doesn't have a User document, we'll create a dummy ObjectId
    // or handle it differently. Let's use mongoose.Types.ObjectId to create a valid ID
    let createdById = req.userId;
    
    // If userId is not a valid ObjectId (e.g., 'super-admin-001'), create a new one
    if (!createdById || !mongoose.Types.ObjectId.isValid(createdById)) {
      // Create a consistent ObjectId for super admin
      // Using a fixed seed to ensure consistency
      createdById = new mongoose.Types.ObjectId();
      console.log('⚠️ Created new ObjectId for Super Admin:', createdById);
    }

    // Create exam
    const examData = {
      title: title.trim(),
      description: description?.trim() || '',
      examType,
      classNumber: normalizedAssignedClasses[0],
      assignedClasses: normalizedAssignedClasses,
      subject: normalizedSubjects[0],
      subjects: normalizedSubjects,
      maxAttempts: parsedMaxAttempts,
      duration: parseInt(duration),
      totalQuestions: parseInt(totalQuestions),
      totalMarks: parseInt(totalMarks),
      instructions: instructions?.trim() || '',
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      board: examBoardUpper,
      createdByRole: 'super-admin',
      createdBy: createdById,
      isActive: true,
      isSchoolSpecific: isSchoolSpecific || false,
      isBoardSpecific: isBoardSpecific || false,
      isAllBoards: isAllBoards || false
    };

    // Add target schools if provided
    if (isSchoolSpecific && targetSchools && Array.isArray(targetSchools) && targetSchools.length > 0) {
      examData.targetSchools = targetSchools.map((id) => {
        // Convert to ObjectId if valid
        if (mongoose.Types.ObjectId.isValid(id)) {
          return new mongoose.Types.ObjectId(id);
        }
        return id;
      });
      examData.schoolId = examData.targetSchools[0];
    }

    const newExam = new Exam(examData);

    await newExam.save();

    console.log('✅ Exam created successfully:', newExam._id);

    const persisted = await Exam.findById(newExam._id)
      .populate('questions')
      .populate('targetSchools', 'schoolName fullName email');

    res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: normalizeExamClassFields(persisted || newExam)
    });
  } catch (error) {
    console.error('❌ Create exam error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create exam',
      error: error.message 
    });
  }
};

// Get All Exams (Super Admin - all boards)
export const getAllExams = async (req, res) => {
  try {
    console.log('📋 getAllExams controller called');
    const { board, schoolIds, classNumbers } = req.query;
    
    let query = { createdByRole: 'super-admin' };
    const conditions = [];
    
    // Filter by board if provided, but include all-boards exams too
    if (board && isValidSchoolBoard(board)) {
      const bUpper = String(board).toUpperCase().trim();
      conditions.push({
        $or: [
          { isAllBoards: true }, // Include exams available to all boards
          { board: bUpper } // Include exams specific to the selected board
        ]
      });
    }
    
    // Filter by school IDs if provided
    if (schoolIds) {
      const schoolIdArray = Array.isArray(schoolIds) ? schoolIds : schoolIds.split(',');
      const schoolObjectIds = schoolIdArray.map((id) => {
        // Handle both string IDs and ObjectIds
        if (mongoose.Types.ObjectId.isValid(id)) {
          return new mongoose.Types.ObjectId(id);
        }
        return id;
      });
      
      conditions.push({
        $or: [
          { isSchoolSpecific: { $ne: true } }, // Include exams available to all schools
          { 
            isSchoolSpecific: true,
            targetSchools: { $in: schoolObjectIds }
          }
        ]
      });
    }

    // Filter by class numbers if provided (supports both new assignedClasses and legacy classNumber)
    if (classNumbers) {
      const classList = (Array.isArray(classNumbers) ? classNumbers : classNumbers.split(','))
        .map((c) => String(c).trim())
        .filter(Boolean);

      if (classList.length > 0) {
        conditions.push({
          $or: [
            { assignedClasses: { $in: classList } },
            { classNumber: { $in: classList } }
          ]
        });
      }
    }
    
    // Combine all conditions with $and
    if (conditions.length > 0) {
      query.$and = conditions;
    }
    
    console.log('🔍 Query:', JSON.stringify(query, null, 2));
    
    const exams = await Exam.find(query)
      .populate('questions')
      .populate('targetSchools', 'schoolName fullName email')
      .sort({ createdAt: -1 });

    const normalizedExams = exams.map((ex) => normalizeExamClassFields(ex));

    console.log(`✅ Found ${normalizedExams.length} exams`);
    if (schoolIds) {
      console.log(`📚 Filtering by schools: ${schoolIds}`);
      normalizedExams.forEach(exam => {
        console.log(`  - Exam: ${exam.title}, isSchoolSpecific: ${exam.isSchoolSpecific}, targetSchools: ${exam.targetSchools?.map(s => s._id || s).join(', ')}`);
      });
    }
    res.json({
      success: true,
      data: normalizedExams
    });
  } catch (error) {
    console.error('❌ Get all exams error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exams' });
  }
};

// Get Exams by Board (Super Admin)
export const getExamsByBoard = async (req, res) => {
  try {
    console.log('📋 getExamsByBoard controller called');
    console.log('Board code from params:', req.params.boardCode);
    const { boardCode } = req.params;

    const bc = String(boardCode || '').toUpperCase().trim();
    if (!isValidSchoolBoard(bc)) {
      console.log('❌ Invalid board code:', boardCode);
      return res.status(400).json({ success: false, message: 'Invalid board code' });
    }

    const exams = await Exam.find({ 
      board: bc,
      createdByRole: 'super-admin' 
    })
      .populate('questions')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: exams.map((ex) => normalizeExamClassFields(ex))
    });
  } catch (error) {
    console.error('Get exams by board error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exams' });
  }
};

// Update Exam (Super Admin)
export const updateExam = async (req, res) => {
  try {
    const { examId } = req.params;
    console.log('📝 updateExam controller called');
    console.log('Update examId:', examId);
    console.log('Update request body:', JSON.stringify(req.body, null, 2));
    const { 
      title, 
      description, 
      examType, 
      classNumber,
      assignedClasses,
      subject,
      subjects,
      maxAttempts,
      duration, 
      totalQuestions, 
      totalMarks, 
      instructions, 
      startDate, 
      endDate,
      board,
      isActive 
    } = req.body;

    const exam = await Exam.findById(examId);

    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const oldValues = {
      classNumber: exam.classNumber,
      assignedClasses: exam.assignedClasses,
      subject: exam.subject
    };

    // Update fields
    if (title) exam.title = title.trim();
    if (description !== undefined) exam.description = description?.trim() || '';
    if (examType) exam.examType = examType;
    if (assignedClasses !== undefined) {
      const normalizedAssignedClasses = (Array.isArray(assignedClasses) ? assignedClasses : [assignedClasses])
        .map((c) => String(c).trim())
        .filter(Boolean);

      if (normalizedAssignedClasses.length === 0) {
        return res.status(400).json({ success: false, message: 'assignedClasses must contain at least one class' });
      }

      exam.assignedClasses = normalizedAssignedClasses;
      exam.classNumber = normalizedAssignedClasses[0];
    } else if (classNumber !== undefined) {
      const normalizedClass = String(classNumber).trim();
      if (!normalizedClass) {
        return res.status(400).json({ success: false, message: 'classNumber cannot be empty' });
      }
      exam.classNumber = normalizedClass;
      exam.assignedClasses = [normalizedClass];
    }
    if (subject !== undefined || subjects !== undefined) {
      const normalizedSubjects = normalizeExamSubjects(subject, subjects);
      if (normalizedSubjects.length === 0) {
        return res.status(400).json({ success: false, message: 'subject(s) cannot be empty' });
      }
      const invalidSubjects = normalizedSubjects.filter((s) => !ALLOWED_EXAM_SUBJECTS.includes(s));
      if (invalidSubjects.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid subject(s): ${invalidSubjects.join(', ')}. Must be one of: ${ALLOWED_EXAM_SUBJECTS.join(', ')}`
        });
      }
      exam.subject = normalizedSubjects[0];
      exam.subjects = normalizedSubjects;
    }
    if (maxAttempts !== undefined) {
      const parsedMaxAttempts = parseInt(maxAttempts, 10);
      if (Number.isNaN(parsedMaxAttempts) || parsedMaxAttempts < 1) {
        return res.status(400).json({ success: false, message: 'maxAttempts must be a number greater than or equal to 1' });
      }
      exam.maxAttempts = parsedMaxAttempts;
    }
    if (duration) exam.duration = parseInt(duration);
    if (totalQuestions) exam.totalQuestions = parseInt(totalQuestions);
    if (totalMarks) exam.totalMarks = parseInt(totalMarks);
    if (instructions !== undefined) exam.instructions = instructions?.trim() || '';
    if (startDate) exam.startDate = new Date(startDate);
    if (endDate) exam.endDate = new Date(endDate);
    if (board !== undefined && board !== null && String(board).trim() !== '') {
      const bu = String(board).toUpperCase().trim();
      if (!isValidSchoolBoard(bu)) {
        return res.status(400).json({
          success: false,
          message: `Invalid board. Must be one of: ${VALID_SCHOOL_BOARDS.join(', ')}`,
        });
      }
      exam.board = bu;
    }
    if (isActive !== undefined) exam.isActive = Boolean(isActive);

    const { targetSchools: tsBody, isSchoolSpecific: issBody, isAllBoards: iabBody } = req.body;
    if (tsBody !== undefined && Array.isArray(tsBody)) {
      exam.targetSchools = tsBody
        .filter((id) => id != null && id !== '')
        .map((id) =>
          mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
        );
    }
    if (issBody !== undefined) exam.isSchoolSpecific = Boolean(issBody);
    if (iabBody !== undefined) exam.isAllBoards = Boolean(iabBody);
    if (exam.targetSchools?.length) {
      exam.schoolId = exam.targetSchools[0];
    } else if (!exam.isSchoolSpecific) {
      exam.schoolId = undefined;
    }

    // Backfill legacy exams so schema-required fields are always present.
    if (!exam.classNumber) exam.classNumber = '10';
    if (!Array.isArray(exam.assignedClasses) || exam.assignedClasses.length === 0) exam.assignedClasses = [exam.classNumber];
    if (!exam.subject) exam.subject = 'maths';
    if (!Array.isArray(exam.subjects) || exam.subjects.length === 0) exam.subjects = [exam.subject];
    if (!exam.maxAttempts || exam.maxAttempts < 1) exam.maxAttempts = 1;

    await exam.save();
    const refreshedExam = await Exam.findById(examId).lean();

    console.log('✅ Update exam class persistence check:', {
      before: oldValues,
      after: {
        classNumber: refreshedExam?.classNumber,
        assignedClasses: refreshedExam?.assignedClasses,
        subject: refreshedExam?.subject
      }
    });

    res.json({
      success: true,
      message: 'Exam updated successfully',
      data: normalizeExamClassFields(refreshedExam || exam)
    });
  } catch (error) {
    console.error('Update exam error:', error);
    res.status(500).json({ success: false, message: 'Failed to update exam' });
  }
};

// Delete Exam (Super Admin)
export const deleteExam = async (req, res) => {
  try {
    const { examId } = req.params;

    const exam = await Exam.findById(examId);

    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    // Delete associated questions
    await Question.deleteMany({ exam: examId });

    // Delete exam
    await Exam.findByIdAndDelete(examId);

    res.json({
      success: true,
      message: 'Exam deleted successfully'
    });
  } catch (error) {
    console.error('Delete exam error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete exam' });
  }
};

// Add Question to Exam (Super Admin)
export const addQuestion = async (req, res) => {
  try {
    console.log('📝 addQuestion controller called');
    console.log('Exam ID:', req.params.examId);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request user:', req.user);
    
    const { examId } = req.params;
    const {
      questionText,
      questionImage,
      questionType,
      options,
      correctAnswer,
      marks,
      negativeMarks,
      explanation,
      subject,
      chapter,
      difficulty,
      questionCategory,
      conceptType,
      board,
      replaceDuplicate = false
    } = req.body;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      console.log('❌ Invalid exam ID format:', examId);
      return res.status(400).json({ success: false, message: 'Invalid exam ID format' });
    }

    const exam = await Exam.findById(examId);

    if (!exam) {
      console.log('❌ Exam not found:', examId);
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    if (exam.createdByRole !== 'super-admin') {
      console.log('❌ Exam not created by super-admin');
      return res.status(403).json({ success: false, message: 'Only super-admin created exams can be modified' });
    }

    console.log('✅ Exam found:', exam.title, 'Board:', exam.board);

    if (!questionText?.trim() && !questionImage) {
      return res.status(400).json({ success: false, message: 'Either question text or image is required' });
    }

    if ((questionType === 'mcq' || questionType === 'multiple') && (!options || options.length === 0)) {
      return res.status(400).json({ success: false, message: 'Options are required for MCQ and Multiple Choice questions' });
    }

    // Handle createdBy for Super Admin (same as exam creation)
    let createdById = req.userId;
    if (!createdById || !mongoose.Types.ObjectId.isValid(createdById)) {
      createdById = new mongoose.Types.ObjectId();
      console.log('⚠️ Created new ObjectId for Super Admin question:', createdById);
    }

    // Format correctAnswer based on question type
    let formattedCorrectAnswer = correctAnswer;
    
    if (questionType === 'integer') {
      // Integer type: correctAnswer should be a number
      formattedCorrectAnswer = typeof correctAnswer === 'number' ? correctAnswer : parseInt(correctAnswer);
      if (isNaN(formattedCorrectAnswer)) {
        return res.status(400).json({ success: false, message: 'Invalid integer answer' });
      }
    } else if (questionType === 'multiple' && Array.isArray(correctAnswer)) {
      // For multiple choice, map the indices to option texts
      formattedCorrectAnswer = correctAnswer.map((idx) => {
        const optionIndex = parseInt(idx);
        if (!isNaN(optionIndex) && options && options[optionIndex]) {
          return options[optionIndex].text || options[optionIndex];
        }
        return idx;
      });
      // If no valid options found, use the indices as-is
      if (formattedCorrectAnswer.length === 0) {
        formattedCorrectAnswer = correctAnswer;
      }
    } else if (questionType === 'mcq' && options && options.length > 0) {
      // For single MCQ, convert index to option text
      const optionIndex = parseInt(correctAnswer);
      if (!isNaN(optionIndex) && options[optionIndex]) {
        formattedCorrectAnswer = options[optionIndex].text || options[optionIndex];
      } else {
        // If conversion fails, use as-is (might already be text)
        formattedCorrectAnswer = correctAnswer;
      }
    }

    // Validate correctAnswer is not empty/null/undefined
    if (formattedCorrectAnswer === null || formattedCorrectAnswer === undefined || 
        (typeof formattedCorrectAnswer === 'string' && formattedCorrectAnswer.trim() === '') ||
        (Array.isArray(formattedCorrectAnswer) && formattedCorrectAnswer.length === 0)) {
      console.log('❌ Invalid correctAnswer:', formattedCorrectAnswer);
      return res.status(400).json({ success: false, message: 'Correct answer is required and cannot be empty' });
    }

    console.log('📝 Creating question:', {
      questionType,
      subject,
      marks,
      board: board || exam.board,
      correctAnswer: formattedCorrectAnswer,
      optionsCount: options?.length || 0
    });

    // Ensure questionText is not empty string if questionImage is not provided
    const finalQuestionText = questionText?.trim() || '';
    const finalQuestionImage = questionImage?.trim() || null;

    if (!finalQuestionText && !finalQuestionImage) {
      return res.status(400).json({ success: false, message: 'Either question text or image is required' });
    }

    // Format options - ensure empty array for integer type. Each option is
    // stored as `{ text, isCorrect }`; tag the isCorrect flag based on the
    // formatted correctAnswer so consumers that read options[].isCorrect (e.g.
    // preview / legacy content generators) stay in sync with correctAnswer.
    const finalOptions = questionType === 'integer'
      ? []
      : (options || []).map((opt) => {
          const text = typeof opt === 'string' ? opt : (opt?.text ?? '');
          return { text: String(text), isCorrect: false };
        });

    if (questionType === 'mcq') {
      const correctText = String(formattedCorrectAnswer || '').trim().toLowerCase();
      const idx = finalOptions.findIndex(
        (o) => String(o.text || '').trim().toLowerCase() === correctText
      );
      if (idx >= 0) finalOptions[idx].isCorrect = true;
    } else if (questionType === 'multiple' && Array.isArray(formattedCorrectAnswer)) {
      const correctSet = new Set(
        formattedCorrectAnswer.map((t) => String(t).trim().toLowerCase())
      );
      finalOptions.forEach((o) => {
        if (correctSet.has(String(o.text || '').trim().toLowerCase())) {
          o.isCorrect = true;
        }
      });
    }

    // Validate marks / negativeMarks strictly instead of silently defaulting.
    let marksValue = 1;
    if (marks !== undefined && marks !== null && String(marks).trim() !== '') {
      const parsed = Number(marks);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid marks (must be a positive number)' });
      }
      marksValue = parsed;
    }

    let negativeMarksValue = 0;
    if (negativeMarks !== undefined && negativeMarks !== null && String(negativeMarks).trim() !== '') {
      const parsed = Number(negativeMarks);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res.status(400).json({ success: false, message: 'Invalid negativeMarks (must be a non-negative number)' });
      }
      negativeMarksValue = parsed;
    }

    const examSubjects = normalizeExamSubjects(exam.subject, exam.subjects)
      .filter((s) => ALLOWED_EXAM_SUBJECTS.includes(s));
    const normalizedQuestionSubject = String(subject || '').trim().toLowerCase() || examSubjects[0] || 'maths';

    if (!ALLOWED_EXAM_SUBJECTS.includes(normalizedQuestionSubject)) {
      return res.status(400).json({
        success: false,
        message: `Invalid subject "${normalizedQuestionSubject}". Must be one of: ${ALLOWED_EXAM_SUBJECTS.join(', ')}`
      });
    }

    if (examSubjects.length > 0 && !examSubjects.includes(normalizedQuestionSubject)) {
      return res.status(400).json({
        success: false,
        message: `Question subject "${normalizedQuestionSubject}" is not allowed for this exam. Allowed subjects: ${examSubjects.join(', ')}`
      });
    }

    const duplicateKey = buildQuestionDedupKey({
      examId,
      subject: normalizedQuestionSubject,
      questionType,
      questionText: finalQuestionText,
      questionImage: finalQuestionImage,
    });
    const existingQuestions = await Question.find(
      { exam: examId, subject: normalizedQuestionSubject, questionType },
      { _id: 1, questionText: 1, questionImage: 1, marks: 1 }
    ).lean();
    const duplicateQuestion = existingQuestions.find((q) => {
      const key = buildQuestionDedupKey({
        examId,
        subject: normalizedQuestionSubject,
        questionType,
        questionText: q.questionText,
        questionImage: q.questionImage,
      });
      return key === duplicateKey;
    });
    if (duplicateQuestion && !replaceDuplicate) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate question already exists for this exam and subject',
        duplicateQuestionId: duplicateQuestion._id,
      });
    }

    if (duplicateQuestion && replaceDuplicate) {
      await Question.findByIdAndDelete(duplicateQuestion._id);
      const duplicateMarks = Number(duplicateQuestion.marks) || 0;
      await Exam.updateOne(
        { _id: examId },
        buildSafeRemoveQuestionPipeline({
          questionId: duplicateQuestion._id,
          totalQuestionsDelta: -1,
          totalMarksDelta: -duplicateMarks,
        })
      );
      console.log('♻️ Replacing duplicate question:', duplicateQuestion._id);
    }

    const question = new Question({
      questionText: finalQuestionText || undefined,
      questionImage: finalQuestionImage || undefined,
      questionType,
      options: finalOptions,
      correctAnswer: formattedCorrectAnswer,
      marks: marksValue,
      negativeMarks: negativeMarksValue,
      explanation: explanation?.trim() || undefined,
      subject: normalizedQuestionSubject,
      chapter: String(chapter || '').trim() || 'General',
      difficulty: ['easy', 'moderate', 'difficult', 'highly_difficult'].includes(String(difficulty || '').toLowerCase())
        ? String(difficulty).toLowerCase()
        : undefined,
      questionCategory: String(questionCategory || '').trim() || undefined,
      conceptType: (() => {
        const raw = String(conceptType || '').trim().toLowerCase();
        if (raw.includes('application') || raw.includes('problem')) return 'Application';
        if (raw.includes('concept') || raw.includes('theory')) return 'Concept';
        return undefined;
      })(),
      exam: examId,
      board: (board || exam.board).toUpperCase(),
      createdBy: createdById
    });

    console.log('📝 Question object created, attempting to save...');

    await question.save();
    console.log('✅ Question saved:', question._id);

    // Add question to exam + keep totals consistent.
    await Exam.updateOne(
      { _id: examId },
      buildSafeAppendQuestionsPipeline({
        questionIds: [question._id],
        totalQuestionsDelta: 1,
        totalMarksDelta: marksValue,
      })
    );
    await syncExamQuestionTotals(examId);
    console.log('✅ Question added to exam');

    res.status(201).json({
      success: true,
      message: 'Question added successfully',
      data: question
    });
  } catch (error) {
    console.error('❌ Add question error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to add question',
      error: error.message 
    });
  }
};

// Bulk Upload Exams via CSV (Super Admin only)
export const bulkUploadExams = async (req, res) => {
  try {
    console.log('📝 bulkUploadExams controller called');
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No CSV file uploaded' 
      });
    }

    // Accept .xlsx / .xls natively (full Unicode) OR .csv (encoding auto-detected).
    // Uploading the real Excel file is strongly preferred: Excel's plain CSV
    // export is Windows-1252 and silently drops characters like θ, π, √, ≤, ≥, Δ.
    let csvData;
    try {
      ({ csv: csvData } = spreadsheetBufferToCsv(req.file.buffer, req.file.originalname));
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: `Failed to read uploaded file: ${err.message}`
      });
    }
    
    // Parse CSV data - handle both \n and \r\n line endings
    const lines = csvData.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'File must have at least a header row and one data row' 
      });
    }

    // Helper function to parse CSV line (handles quoted values); cleanCsvCell
    // trims whitespace and normalizes smart punctuation (−, –, —, ’, “, …) to
    // plain ASCII so downstream validation isn't thrown off by Excel quirks.
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++; // Skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(cleanCsvCell(current));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(cleanCsvCell(current)); // Add last field
      return result;
    };

    const toOptionIndex = (token, options) => {
      const normalizedToken = String(token || '').trim().toLowerCase();
      if (!normalizedToken || !Array.isArray(options) || options.length === 0) {
        return -1;
      }

      if (/^\d+$/.test(normalizedToken)) {
        const numeric = parseInt(normalizedToken, 10);
        // Support both 0-based and 1-based index values in CSV.
        if (numeric >= 0 && numeric < options.length) return numeric;
        if (numeric >= 1 && numeric <= options.length) return numeric - 1;
      }

      if (/^[a-z]$/.test(normalizedToken)) {
        const alphaIndex = normalizedToken.charCodeAt(0) - 97;
        if (alphaIndex >= 0 && alphaIndex < options.length) return alphaIndex;
      }

      const optionMatch = normalizedToken.match(/^option\s*([a-z0-9])$/);
      if (optionMatch) {
        const optionToken = optionMatch[1];
        if (/^\d$/.test(optionToken)) {
          const n = parseInt(optionToken, 10);
          if (n >= 1 && n <= options.length) return n - 1;
          if (n >= 0 && n < options.length) return n;
        }
        if (/^[a-z]$/.test(optionToken)) {
          const alphaIndex = optionToken.charCodeAt(0) - 97;
          if (alphaIndex >= 0 && alphaIndex < options.length) return alphaIndex;
        }
      }

      // Also support passing the exact option text as the answer.
      const textIndex = options.findIndex(
        (opt) => String(opt?.text || '').trim().toLowerCase() === normalizedToken
      );
      return textIndex;
    };

    const normalizeHeader = (header) =>
      String(header || '')
        .trim()
        .toLowerCase()
        .replace(/^"|"$/g, '')
        .replace(/[^a-z0-9]/g, '');

    // Get header row
    const headers = parseCSVLine(lines[0]).map((h) => normalizeHeader(h));
    
    // Validate required headers
    const requiredHeaders = ['title', 'examtype', 'classnumber', 'subject', 'maxattempts', 'board', 'duration', 'totalquestions', 'totalmarks', 'startdate', 'enddate'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    
    if (missingHeaders.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Missing required headers: ${missingHeaders.join(', ')}` 
      });
    }

    const createdExams = [];
    const errors = [];
    let createdById = req.userId;
    
    // If userId is not a valid ObjectId, create a new one
    if (!createdById || !mongoose.Types.ObjectId.isValid(createdById)) {
      createdById = new mongoose.Types.ObjectId();
    }

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);
        
        if (values.length !== headers.length) {
          errors.push(`Row ${i + 1}: Column count mismatch (expected ${headers.length}, got ${values.length})`);
          continue;
        }

        // Create exam object from CSV row
        const examData = {};
        headers.forEach((header, index) => {
          examData[header] = values[index]?.trim() || '';
        });

        // Validate required fields
        if (!examData.title || !examData.examtype || !examData.classnumber || !examData.subject || !examData.maxattempts || !examData.board || !examData.duration || 
            !examData.totalquestions || !examData.totalmarks || !examData.startdate || !examData.enddate) {
          errors.push(`Row ${i + 1}: Missing required fields`);
          continue;
        }

        // Validate examType
        const examType = examData.examtype.toLowerCase();
        if (!['weekend', 'mains', 'advanced', 'practice'].includes(examType)) {
          errors.push(`Row ${i + 1}: Invalid examType "${examType}". Must be one of: weekend, mains, advanced, practice`);
          continue;
        }

        // Validate board
        const board = examData.board.toUpperCase().trim();
        if (!isValidSchoolBoard(board)) {
          errors.push(
            `Row ${i + 1}: Invalid board "${board}". Must be one of: ${VALID_SCHOOL_BOARDS.join(', ')}`
          );
          continue;
        }

        const normalizedSubject = examData.subject.toLowerCase();
        if (!['maths', 'physics', 'chemistry', 'biology'].includes(normalizedSubject)) {
          errors.push(`Row ${i + 1}: Invalid subject "${normalizedSubject}". Must be one of: maths, physics, chemistry, biology`);
          continue;
        }

        const parsedMaxAttempts = parseInt(examData.maxattempts);
        if (isNaN(parsedMaxAttempts) || parsedMaxAttempts < 1) {
          errors.push(`Row ${i + 1}: Invalid maxAttempts. Must be >= 1`);
          continue;
        }

        // Parse filterType and targetSchools
        const filterType = (examData.filtertype || 'all-schools').toLowerCase();
        const isSchoolSpecific = filterType === 'specific-schools';
        const isAllBoards = filterType === 'all-schools';
        
        let targetSchools = [];
        if (isSchoolSpecific && examData.targetschools) {
          // Parse comma-separated school IDs
          targetSchools = examData.targetschools.split(',').map((id) => id.trim()).filter((id) => id);
        }

        // Create exam data object
        const newExamData = {
          title: examData.title,
          description: examData.description || '',
          examType,
          classNumber: examData.classnumber.toString().trim(),
          assignedClasses: examData.classnumber.split('|').map((c) => c.trim()).filter(Boolean),
          subject: normalizedSubject,
          maxAttempts: parsedMaxAttempts,
          duration: parseInt(examData.duration),
          totalQuestions: parseInt(examData.totalquestions),
          totalMarks: parseInt(examData.totalmarks),
          instructions: examData.instructions || '',
          startDate: new Date(examData.startdate),
          endDate: new Date(examData.enddate),
          board,
          createdByRole: 'super-admin',
          createdBy: createdById,
          isActive: true,
          isSchoolSpecific,
          isBoardSpecific: false,
          isAllBoards
        };

        // Add target schools if provided
        if (isSchoolSpecific && targetSchools.length > 0) {
          newExamData.targetSchools = targetSchools.map((id) => {
            if (mongoose.Types.ObjectId.isValid(id)) {
              return new mongoose.Types.ObjectId(id);
            }
            return id;
          });
          newExamData.schoolId = newExamData.targetSchools[0];
        }

        // Validate dates
        if (isNaN(newExamData.startDate.getTime()) || isNaN(newExamData.endDate.getTime())) {
          errors.push(`Row ${i + 1}: Invalid date format`);
          continue;
        }

        if (newExamData.endDate < newExamData.startDate) {
          errors.push(`Row ${i + 1}: End date must be after start date`);
          continue;
        }

        // Validate numeric fields
        if (isNaN(newExamData.duration) || newExamData.duration <= 0) {
          errors.push(`Row ${i + 1}: Invalid duration`);
          continue;
        }

        if (isNaN(newExamData.totalQuestions) || newExamData.totalQuestions <= 0) {
          errors.push(`Row ${i + 1}: Invalid totalQuestions`);
          continue;
        }

        if (isNaN(newExamData.totalMarks) || newExamData.totalMarks <= 0) {
          errors.push(`Row ${i + 1}: Invalid totalMarks`);
          continue;
        }

        // Create exam
        const newExam = new Exam(newExamData);
        await newExam.save();

        createdExams.push({
          id: newExam._id,
          title: newExam.title,
          examType: newExam.examType
        });

        console.log(`✅ Exam created from row ${i + 1}:`, newExam.title);
      } catch (error) {
        console.error(`❌ Error processing row ${i + 1}:`, error);
        errors.push(`Row ${i + 1}: ${error.message || 'Unknown error'}`);
      }
    }

    console.log(`✅ Bulk upload completed: ${createdExams.length} created, ${errors.length} errors`);

    res.json({
      success: true,
      message: `Successfully created ${createdExams.length} exam(s)${errors.length > 0 ? ` with ${errors.length} error(s)` : ''}`,
      created: createdExams.length,
      data: createdExams,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('❌ Bulk upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process CSV file',
      error: error.message 
    });
  }
};

// Bulk Upload Questions via CSV (Super Admin only)
export const bulkUploadQuestions = async (req, res) => {
  try {
    console.log('📝 bulkUploadQuestions controller called');
    const { examId } = req.params;
    // Default behavior: allow duplicates unless explicitly disabled.
    const allowDuplicatesRaw = String(req.body?.allowDuplicates || '').trim().toLowerCase();
    const allowDuplicates =
      allowDuplicatesRaw === ''
        ? true
        : ['true', '1', 'yes', 'on'].includes(allowDuplicatesRaw);
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No CSV file uploaded' 
      });
    }

    // Validate examId
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid exam ID format' 
      });
    }

    const exam = await Exam.findById(examId);
    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ 
        success: false, 
        message: 'Exam not found or not accessible' 
      });
    }
    const examAllowedSubjects = normalizeExamSubjects(exam.subject, exam.subjects)
      .filter((s) => ALLOWED_EXAM_SUBJECTS.includes(s));

    // Accept .xlsx / .xls natively (full Unicode) OR .csv (encoding auto-detected).
    // Uploading the real Excel file preserves x², x³, θ, π, √, Δ, ≤, ≥ — which
    // a plain Excel CSV export (Windows-1252) silently replaces with `?`.
    let csvData;
    try {
      ({ csv: csvData } = spreadsheetBufferToCsv(req.file.buffer, req.file.originalname));
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: `Failed to read uploaded file: ${err.message}`
      });
    }
    
    // Parse CSV data - handle both \n and \r\n line endings
    const lines = csvData.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'File must have at least a header row and one data row' 
      });
    }

    // Helper function to parse CSV line (handles quoted values); cleanCsvCell
    // trims whitespace and normalizes smart punctuation (−, –, —, ’, “, …).
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++; // Skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(cleanCsvCell(current));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(cleanCsvCell(current)); // Add last field
      return result;
    };

    const normalizeHeader = (header) =>
      String(header || '')
        .trim()
        .toLowerCase()
        .replace(/^"|"$/g, '')
        .replace(/[^a-z0-9]/g, '');

    // Resolve a single answer token to an option index.
    //   "a"/"A" .. "d"/"D"        → 0..3
    //   "1".."4"                  → 1-based (matches the downloadable template and
    //                               the letter convention). Falls back to 0-based
    //                               only when the token can't be 1-based (e.g. "0").
    //   "option a", "option 2"    → same as above
    //   Exact option text match   → that option's index
    const toOptionIndex = (token, options) => {
      const normalizedToken = String(token || '').trim().toLowerCase();
      if (!normalizedToken || !Array.isArray(options) || options.length === 0) {
        return -1;
      }

      if (/^\d+$/.test(normalizedToken)) {
        const numeric = parseInt(normalizedToken, 10);
        if (numeric >= 1 && numeric <= options.length) return numeric - 1; // prefer 1-based
        if (numeric >= 0 && numeric < options.length) return numeric; // fallback 0-based
      }

      if (/^[a-z]$/.test(normalizedToken)) {
        const alphaIndex = normalizedToken.charCodeAt(0) - 97;
        if (alphaIndex >= 0 && alphaIndex < options.length) return alphaIndex;
      }

      const optionMatch = normalizedToken.match(/^option\s*([a-z0-9])$/);
      if (optionMatch) {
        const optionToken = optionMatch[1];
        if (/^\d$/.test(optionToken)) {
          const n = parseInt(optionToken, 10);
          if (n >= 1 && n <= options.length) return n - 1;
          if (n >= 0 && n < options.length) return n;
        }
        if (/^[a-z]$/.test(optionToken)) {
          const idx = optionToken.charCodeAt(0) - 97;
          if (idx >= 0 && idx < options.length) return idx;
        }
      }

      const textIndex = options.findIndex(
        (opt) => String(opt?.text || '').trim().toLowerCase() === normalizedToken
      );
      return textIndex;
    };

    // Get header row
    const headers = parseCSVLine(lines[0]).map((h) => normalizeHeader(h));
    
    // Validate required headers
    const requiredHeaders = ['questiontext', 'questiontype', 'subject', 'marks'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    
    if (missingHeaders.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Missing required headers: ${missingHeaders.join(', ')}` 
      });
    }

    const createdQuestions = [];
    const errors = [];
    const seenQuestionKeys = new Set();
    let createdById = req.userId;
    
    // If userId is not a valid ObjectId, create a new one
    if (!createdById || !mongoose.Types.ObjectId.isValid(createdById)) {
      createdById = new mongoose.Types.ObjectId();
    }

    if (!allowDuplicates) {
      const existingQuestions = await Question.find(
        { exam: examId },
        { subject: 1, questionType: 1, questionText: 1, questionImage: 1 }
      ).lean();
      existingQuestions.forEach((q) => {
        seenQuestionKeys.add(buildQuestionDedupKey({
          examId,
          subject: q.subject,
          questionType: q.questionType,
          questionText: q.questionText,
          questionImage: q.questionImage,
        }));
      });
    }

    // Collect new question IDs so we can push them into the exam in one update
    // at the end (instead of one $push per question).
    const newQuestionIdsToPush = [];

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
      try {
        const rawValues = parseCSVLine(lines[i]);

        // Be lenient about column count: pad short rows with empty cells and
        // drop trailing extras. Most "column count mismatch" errors are caused
        // by Excel trimming trailing empty columns or by a stray comma.
        const values =
          rawValues.length === headers.length
            ? rawValues
            : rawValues.length < headers.length
              ? rawValues.concat(Array(headers.length - rawValues.length).fill(''))
              : rawValues.slice(0, headers.length);

        // Create question object from CSV row
        const questionData = {};
        headers.forEach((header, index) => {
          questionData[header] = values[index]?.trim() || '';
        });
        const getRowValue = (...keys) => {
          for (const key of keys) {
            const normalizedKey = normalizeHeader(key);
            const val = questionData[normalizedKey];
            if (val !== undefined && String(val).trim() !== '') {
              return String(val).trim();
            }
          }
          return '';
        };

        // Validate required fields
        if (!getRowValue('questiontext', 'question_text') && !getRowValue('questionimage', 'question_image')) {
          errors.push(`Row ${i + 1}: Either questionText or questionImage is required`);
          continue;
        }

        // Validate questionType
        const questionType = (getRowValue('questiontype', 'question_type', 'type') || 'mcq').toLowerCase();
        if (!['mcq', 'multiple', 'integer'].includes(questionType)) {
          errors.push(`Row ${i + 1}: Invalid questionType "${questionType}". Must be one of: mcq, multiple, integer`);
          continue;
        }

        // Validate subject
        const subject = String(getRowValue('subject') || '').trim().toLowerCase() || examAllowedSubjects[0] || 'maths';
        if (!ALLOWED_EXAM_SUBJECTS.includes(subject)) {
          errors.push(`Row ${i + 1}: Invalid subject "${subject}". Must be one of: ${ALLOWED_EXAM_SUBJECTS.join(', ')}`);
          continue;
        }
        if (examAllowedSubjects.length > 0 && !examAllowedSubjects.includes(subject)) {
          errors.push(`Row ${i + 1}: Subject "${subject}" is not allowed for this exam. Allowed subjects: ${examAllowedSubjects.join(', ')}`);
          continue;
        }

        // Parse options for MCQ/Multiple
        let options = [];
        if (questionType === 'mcq' || questionType === 'multiple') {
          for (let j = 1; j <= 4; j++) {
            const optionValue = getRowValue(
              `option${j}`,
              `option_${j}`,
              `option ${j}`,
            );
            if (optionValue) {
              options.push({ text: optionValue, isCorrect: false });
            }
          }
          if (options.length === 0) {
            errors.push(`Row ${i + 1}: At least one option is required for ${questionType} questions`);
            continue;
          }
        }

        // Parse correct answer based on question type
        let correctAnswer;
        if (questionType === 'integer') {
          const integerAns = getRowValue('integeranswer', 'integer_answer', 'correctanswer', 'correct_answer', 'answer');
          if (!integerAns) {
            errors.push(`Row ${i + 1}: integerAnswer is required for integer type questions`);
            continue;
          }
          const parsedInt = parseInt(integerAns);
          if (isNaN(parsedInt)) {
            errors.push(`Row ${i + 1}: Invalid integer answer`);
            continue;
          }
          correctAnswer = parsedInt;
        } else if (questionType === 'multiple') {
          const correctAnswersStr = getRowValue(
            'correctanswers',
            'correct_answers',
            'correctanswer',
            'correct_answer',
            'answer'
          );
          if (!correctAnswersStr) {
            errors.push(`Row ${i + 1}: correctAnswers is required for multiple choice questions`);
            continue;
          }
          // Parse comma/semicolon separated values: accepts 0/1-based indices, letters (a-d), optionN, or option text.
          const indices = correctAnswersStr
            .split(/[;,]/)
            .map((token) => toOptionIndex(token, options))
            .filter((idx) => idx >= 0 && idx < options.length);
          const uniqueIndices = [...new Set(indices)];
          if (uniqueIndices.length === 0) {
            errors.push(`Row ${i + 1}: Invalid correctAnswers format`);
            continue;
          }
          // Convert indices to option texts
          correctAnswer = uniqueIndices.map(idx => {
            if (options[idx]) {
              return options[idx].text;
            }
            return null;
          }).filter(text => text !== null);
          if (correctAnswer.length === 0) {
            errors.push(`Row ${i + 1}: No valid correct answers found`);
            continue;
          }
        } else {
          // MCQ - single answer
          const correctAnswerStr =
            getRowValue(
              'correctanswer',
              'correct_answer',
              'correctanswers',
              'correct_answers',
              'answer'
            );
          if (!correctAnswerStr) {
            errors.push(`Row ${i + 1}: correctAnswer is required for MCQ questions`);
            continue;
          }
          const answerIndex = toOptionIndex(correctAnswerStr, options);
          if (answerIndex < 0 || !options[answerIndex]) {
            errors.push(`Row ${i + 1}: Invalid correctAnswer "${correctAnswerStr}" (expected 1-4, a-d, or exact option text)`);
            continue;
          }
          correctAnswer = options[answerIndex].text;
          options[answerIndex].isCorrect = true;
        }

        // Mark the correct options for `multiple` so option.isCorrect stays in
        // sync with correctAnswer. (MCQ is handled in its branch above.)
        if (questionType === 'multiple' && Array.isArray(correctAnswer)) {
          const correctSet = new Set(correctAnswer.map((t) => String(t).trim().toLowerCase()));
          options.forEach((opt) => {
            if (opt && correctSet.has(String(opt.text || '').trim().toLowerCase())) {
              opt.isCorrect = true;
            }
          });
        }

        // Validate marks. Empty/missing defaults to 1; any other invalid value
        // (negative, zero, non-numeric) is a hard error so silent corruption is
        // caught at upload time rather than showing up as a weird score later.
        const marksRaw = getRowValue('marks');
        let marks = 1;
        if (marksRaw !== '') {
          const parsedMarks = Number(marksRaw);
          if (!Number.isFinite(parsedMarks) || parsedMarks <= 0) {
            errors.push(`Row ${i + 1}: Invalid marks "${marksRaw}" (must be a positive number)`);
            continue;
          }
          marks = parsedMarks;
        }

        const negativeMarksRaw = getRowValue('negativemarks', 'negative_marks', 'negativeMarks');
        let negativeMarks = 0;
        if (negativeMarksRaw !== '') {
          const parsedNeg = Number(negativeMarksRaw);
          if (!Number.isFinite(parsedNeg) || parsedNeg < 0) {
            errors.push(`Row ${i + 1}: Invalid negativeMarks "${negativeMarksRaw}" (must be a non-negative number)`);
            continue;
          }
          negativeMarks = parsedNeg;
        }

        // Create question data object
        const newQuestionData = {
          questionText: getRowValue('questiontext', 'question_text') || undefined,
          questionImage: getRowValue('questionimage', 'question_image') || undefined,
          questionType,
          options: questionType === 'integer' ? [] : options,
          correctAnswer,
          marks,
          negativeMarks,
          explanation: getRowValue('explanation') || undefined,
          subject,
          chapter: getRowValue('chapter', 'chaptername', 'chapter_name', 'topic', 'unit') || 'General',
          difficulty: (() => {
            const rawDifficulty = String(getRowValue('difficulty', 'difficultylevel', 'difficulty_level') || '').toLowerCase();
            if (['easy', 'moderate', 'difficult', 'highly_difficult'].includes(rawDifficulty)) {
              return rawDifficulty;
            }
            if (rawDifficulty === 'hard') return 'difficult';
            if (rawDifficulty === 'medium') return 'moderate';
            return 'moderate';
          })(),
          questionCategory: getRowValue(
            'questioncategory',
            'question_category',
            'analytics_type',
            'analytictype',
            'type_tag'
          ) || undefined,
          conceptType: (() => {
            const rawConcept = String(getRowValue('concepttype', 'concept_type', 'skilltype', 'skill_type') || '').toLowerCase();
            if (rawConcept.includes('application') || rawConcept.includes('problem')) return 'Application';
            return 'Concept';
          })(),
          exam: examId,
          board: exam.board,
          createdBy: createdById
        };

        const questionKey = buildQuestionDedupKey({
          examId,
          subject: newQuestionData.subject,
          questionType: newQuestionData.questionType,
          questionText: newQuestionData.questionText,
          questionImage: newQuestionData.questionImage,
        });
        if (!allowDuplicates && seenQuestionKeys.has(questionKey)) {
          // Duplicate skips are intentional in strict mode; do not treat them as errors.
          continue;
        }

        // Create question
        const newQuestion = new Question(newQuestionData);
        await newQuestion.save();
        if (!allowDuplicates) {
          seenQuestionKeys.add(questionKey);
        }
        newQuestionIdsToPush.push(newQuestion._id);

        createdQuestions.push({
          id: newQuestion._id,
          questionText: newQuestion.questionText || 'Image question',
          questionType: newQuestion.questionType
        });

        console.log(`✅ Question created from row ${i + 1}:`, newQuestion.questionText || 'Image question');
      } catch (error) {
        console.error(`❌ Error processing row ${i + 1}:`, error);
        errors.push(`Row ${i + 1}: ${error.message || 'Unknown error'}`);
      }
    }

    // Attach all newly-created questions to the exam in a single update (and
    // keep Exam.totalQuestions / Exam.totalMarks consistent).
    if (newQuestionIdsToPush.length > 0) {
      const addedMarks = createdQuestions.length
        ? (await Question.find(
            { _id: { $in: newQuestionIdsToPush } },
            { marks: 1 }
          ).lean()).reduce((sum, q) => sum + (Number(q?.marks) || 0), 0)
        : 0;

      await Exam.updateOne(
        { _id: examId },
        buildSafeAppendQuestionsPipeline({
          questionIds: newQuestionIdsToPush,
          totalQuestionsDelta: newQuestionIdsToPush.length,
          totalMarksDelta: addedMarks,
        })
      );
      await syncExamQuestionTotals(examId);
    }

    console.log(`✅ Bulk question upload completed: ${createdQuestions.length} created, ${errors.length} errors`);
    if (errors.length > 0) {
      console.log('⚠️ Bulk question upload row errors:', errors);
    }

    res.json({
      success: true,
      message: `Successfully created ${createdQuestions.length} question(s)${errors.length > 0 ? ` with ${errors.length} error(s)` : ''}`,
      created: createdQuestions.length,
      data: createdQuestions,
      allowDuplicates,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('❌ Bulk question upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process CSV file',
      error: error.message 
    });
  }
};

