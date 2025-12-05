import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';

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
    if (!title || !examType || !duration || !totalQuestions || !totalMarks || !board) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: title, examType, duration, totalQuestions, totalMarks, and board are required' 
      });
    }

    if (!['weekend', 'mains', 'advanced', 'practice'].includes(examType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid examType. Must be one of: weekend, mains, advanced, practice' 
      });
    }

    if (board.toUpperCase() !== 'ASLI_EXCLUSIVE_SCHOOLS') {
      return res.status(400).json({
        success: false,
        message: 'Invalid board. Must be ASLI_EXCLUSIVE_SCHOOLS' 
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
      duration: parseInt(duration),
      totalQuestions: parseInt(totalQuestions),
      totalMarks: parseInt(totalMarks),
      instructions: instructions?.trim() || '',
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      board: board.toUpperCase(),
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
    }

    const newExam = new Exam(examData);

    await newExam.save();

    console.log('✅ Exam created successfully:', newExam._id);

    res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: newExam
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
    const { board, schoolIds } = req.query;
    
    let query = { createdByRole: 'super-admin' };
    const conditions = [];
    
    // Filter by board if provided, but include all-boards exams too
    if (board && board === 'ASLI_EXCLUSIVE_SCHOOLS') {
      conditions.push({
        $or: [
          { isAllBoards: true }, // Include exams available to all boards
          { board: board } // Include exams specific to the selected board
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
    
    // Combine all conditions with $and
    if (conditions.length > 0) {
      query.$and = conditions;
    }
    
    console.log('🔍 Query:', JSON.stringify(query, null, 2));
    
    const exams = await Exam.find(query)
      .populate('questions')
      .populate('targetSchools', 'schoolName fullName email')
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${exams.length} exams`);
    if (schoolIds) {
      console.log(`📚 Filtering by schools: ${schoolIds}`);
      exams.forEach(exam => {
        console.log(`  - Exam: ${exam.title}, isSchoolSpecific: ${exam.isSchoolSpecific}, targetSchools: ${exam.targetSchools?.map(s => s._id || s).join(', ')}`);
      });
    }
    res.json({
      success: true,
      data: exams
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

    if (boardCode !== 'ASLI_EXCLUSIVE_SCHOOLS') {
      console.log('❌ Invalid board code:', boardCode);
      return res.status(400).json({ success: false, message: 'Invalid board code' });
    }

    const exams = await Exam.find({ 
      board: boardCode,
      createdByRole: 'super-admin' 
    })
      .populate('questions')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: exams
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
    const { 
      title, 
      description, 
      examType, 
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

    // Update fields
    if (title) exam.title = title.trim();
    if (description !== undefined) exam.description = description?.trim() || '';
    if (examType) exam.examType = examType;
    if (duration) exam.duration = parseInt(duration);
    if (totalQuestions) exam.totalQuestions = parseInt(totalQuestions);
    if (totalMarks) exam.totalMarks = parseInt(totalMarks);
    if (instructions !== undefined) exam.instructions = instructions?.trim() || '';
    if (startDate) exam.startDate = new Date(startDate);
    if (endDate) exam.endDate = new Date(endDate);
    if (board) exam.board = board.toUpperCase();
    if (isActive !== undefined) exam.isActive = Boolean(isActive);

    await exam.save();

    res.json({
      success: true,
      message: 'Exam updated successfully',
      data: exam
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
      board
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

    // Format options - ensure empty array for integer type
    const finalOptions = questionType === 'integer' ? [] : (options || []);

    const question = new Question({
      questionText: finalQuestionText || undefined,
      questionImage: finalQuestionImage || undefined,
      questionType,
      options: finalOptions,
      correctAnswer: formattedCorrectAnswer,
      marks: parseInt(marks) || 1,
      negativeMarks: parseFloat(negativeMarks) || 0,
      explanation: explanation?.trim() || undefined,
      subject: subject || 'maths',
      exam: examId,
      board: (board || exam.board).toUpperCase(),
      createdBy: createdById
    });

    console.log('📝 Question object created, attempting to save...');

    await question.save();
    console.log('✅ Question saved:', question._id);

    // Add question to exam
    await Exam.findByIdAndUpdate(examId, { $push: { questions: question._id } });
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

    // Convert buffer to string
    const csvData = req.file.buffer.toString('utf8');
    
    // Parse CSV data - handle both \n and \r\n line endings
    const lines = csvData.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'CSV file must have at least a header and one data row' 
      });
    }

    // Helper function to parse CSV line (handles quoted values)
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
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim()); // Add last field
      return result;
    };

    // Get header row
    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    
    // Validate required headers
    const requiredHeaders = ['title', 'examtype', 'board', 'duration', 'totalquestions', 'totalmarks', 'startdate', 'enddate'];
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
        if (!examData.title || !examData.examtype || !examData.board || !examData.duration || 
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
        const board = examData.board.toUpperCase();
        if (board !== 'ASLI_EXCLUSIVE_SCHOOLS') {
          errors.push(`Row ${i + 1}: Invalid board "${board}". Must be ASLI_EXCLUSIVE_SCHOOLS`);
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

