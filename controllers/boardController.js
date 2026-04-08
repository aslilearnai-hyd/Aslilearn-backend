import mongoose from 'mongoose';
import Board from '../models/Board.js';
import Subject from '../models/Subject.js';
import Content from '../models/Content.js';
import Exam from '../models/Exam.js';
import ExamResult from '../models/ExamResult.js';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';

// Initialize boards if they don't exist
export const initializeBoards = async () => {
  try {
    const boards = [
      { code: 'ASLI_EXCLUSIVE_SCHOOLS', name: 'ASLI EXCLUSIVE SCHOOLS', description: 'ASLI Exclusive Schools - All Boards Content' }
    ];

    for (const boardData of boards) {
      await Board.findOneAndUpdate(
        { code: boardData.code },
        boardData,
        { upsert: true, new: true }
      );
    }

    console.log('Boards initialized successfully');
  } catch (error) {
    console.error('Error initializing boards:', error);
  }
};

// Seed Class 10 subjects for all boards
export const seedClass10Subjects = async () => {
  try {
    const boards = ['ASLI_EXCLUSIVE_SCHOOLS'];
    const class10Subjects = [
      {
        name: 'Mathematics',
        code: 'MATH10',
        description: 'Mathematics for Class 10 - Algebra, Geometry, Trigonometry, and Statistics',
        classNumber: '10'
      },
      {
        name: 'Science',
        code: 'SCI10',
        description: 'Science for Class 10 - Physics, Chemistry, and Biology',
        classNumber: '10'
      },
      {
        name: 'Physics',
        code: 'PHY10',
        description: 'Physics for Class 10 - Mechanics, Electricity, Magnetism, and Optics',
        classNumber: '10'
      },
      {
        name: 'Chemistry',
        code: 'CHEM10',
        description: 'Chemistry for Class 10 - Chemical Reactions, Acids, Bases, and Organic Chemistry',
        classNumber: '10'
      },
      {
        name: 'Biology',
        code: 'BIO10',
        description: 'Biology for Class 10 - Life Processes, Genetics, and Ecology',
        classNumber: '10'
      },
      {
        name: 'English',
        code: 'ENG10',
        description: 'English Language and Literature for Class 10',
        classNumber: '10'
      },
      {
        name: 'Social Studies',
        code: 'SOC10',
        description: 'Social Studies for Class 10 - History, Geography, Civics, and Economics',
        classNumber: '10'
      },
      {
        name: 'Hindi',
        code: 'HIN10',
        description: 'Hindi Language and Literature for Class 10',
        classNumber: '10'
      },
      {
        name: 'Telugu',
        code: 'TEL10',
        description: 'Telugu Language and Literature for Class 10',
        classNumber: '10'
      }
    ];

    let createdCount = 0;
    let skippedCount = 0;

    for (const board of boards) {
      for (const subjectData of class10Subjects) {
        try {
          // Check if subject already exists for this board
          const existingSubject = await Subject.findOne({
            name: subjectData.name,
            board: board
          });

          if (!existingSubject) {
            await Subject.create({
              ...subjectData,
              board: board,
              isActive: true,
              createdBy: 'super-admin'
            });
            createdCount++;
            console.log(`✅ Created ${subjectData.name} for ${board}`);
          } else {
            // Update existing subject to include classNumber if not set
            if (!existingSubject.classNumber && subjectData.classNumber) {
              existingSubject.classNumber = subjectData.classNumber;
              await existingSubject.save();
              console.log(`🔄 Updated ${subjectData.name} for ${board} with classNumber`);
            } else {
              skippedCount++;
            }
          }
        } catch (error) {
          // Handle unique constraint errors gracefully
          if (error.code === 11000) {
            skippedCount++;
            console.log(`⏭️  Skipped ${subjectData.name} for ${board} (already exists)`);
          } else {
            console.error(`❌ Error creating ${subjectData.name} for ${board}:`, error.message);
          }
        }
      }
    }

    console.log(`📚 Class 10 subjects seeding completed: ${createdCount} created, ${skippedCount} skipped`);
    return { created: createdCount, skipped: skippedCount };
  } catch (error) {
    console.error('Error seeding class 10 subjects:', error);
    throw error;
  }
};

// Get all boards
export const getAllBoards = async (req, res) => {
  try {
    const boards = await Board.find({ isActive: true }).sort({ code: 1 });
    res.json({ success: true, data: boards });
  } catch (error) {
    console.error('Get boards error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch boards' });
  }
};

// Get board-specific dashboard data
export const getBoardDashboard = async (req, res) => {
  try {
    const { boardCode } = req.params;
    
    console.log('📊 Fetching board dashboard for:', boardCode);
    
    if (boardCode !== 'ASLI_EXCLUSIVE_SCHOOLS') {
      return res.status(400).json({ success: false, message: 'Invalid board code' });
    }

    // Keep top-level metrics in one parallel batch.
    const [
      board,
      students,
      teachers,
      admins,
      subjects,
      contents,
      exams,
      examResults
    ] = await Promise.all([
      Board.findOne({ code: boardCode }),
      User.countDocuments({ role: 'student' }),
      Teacher.countDocuments({}),
      User.countDocuments({ role: 'admin' }),
      Subject.countDocuments({ isActive: true }),
      Content.countDocuments({ isActive: true }),
      Exam.countDocuments({ isActive: true }),
      ExamResult.countDocuments({})
    ]);

    // Replace full-collection reads + per-admin queries with grouped aggregations.
    const [
      topPerformers,
      averageScoreAgg,
      adminsList,
      resultStatsByAdmin,
      studentStatsByAdmin,
      teacherStatsByAdmin,
      studentsForList
    ] = await Promise.all([
      ExamResult.find({})
        .populate('userId', 'fullName email')
        .sort({ percentage: -1 })
        .limit(10)
        .select('userId percentage obtainedMarks totalMarks examTitle completedAt')
        .lean(),
      ExamResult.aggregate([
        {
          $group: {
            _id: null,
            averageScore: { $avg: '$percentage' }
          }
        }
      ]),
      User.find({ role: 'admin' })
        .select('_id fullName email schoolName')
        .sort({ schoolName: 1, fullName: 1 })
        .lean(),
      ExamResult.aggregate([
        {
          $group: {
            _id: '$adminId',
            examAttempts: { $sum: 1 },
            averageScore: { $avg: '$percentage' }
          }
        }
      ]),
      User.aggregate([
        { $match: { role: 'student', assignedAdmin: { $ne: null } } },
        {
          $group: {
            _id: '$assignedAdmin',
            students: { $sum: 1 }
          }
        }
      ]),
      Teacher.aggregate([
        { $match: { adminId: { $ne: null } } },
        {
          $group: {
            _id: '$adminId',
            teachers: { $sum: 1 }
          }
        }
      ]),
      User.find({ role: 'student', assignedAdmin: { $ne: null } })
        .select('fullName email classNumber assignedAdmin')
        .sort({ fullName: 1 })
        .lean()
    ]);

    const averageScore = averageScoreAgg?.[0]?.averageScore || 0;

    const resultStatsByAdminMap = new Map(
      resultStatsByAdmin.map((item) => [item._id?.toString(), item])
    );
    const studentStatsByAdminMap = new Map(
      studentStatsByAdmin.map((item) => [item._id?.toString(), item.students || 0])
    );
    const teacherStatsByAdminMap = new Map(
      teacherStatsByAdmin.map((item) => [item._id?.toString(), item.teachers || 0])
    );

    // Build student lists once, then cap to first 50 per admin.
    const studentListByAdmin = new Map();
    for (const s of studentsForList) {
      const adminKey = s.assignedAdmin?.toString();
      if (!adminKey) continue;
      if (!studentListByAdmin.has(adminKey)) {
        studentListByAdmin.set(adminKey, []);
      }
      const current = studentListByAdmin.get(adminKey);
      if (current.length < 50) {
        current.push({
          name: s.fullName,
          email: s.email,
          classNumber: s.classNumber
        });
      }
    }

    const schoolParticipation = adminsList.map((admin) => {
      const adminKey = admin._id.toString();
      const resultStats = resultStatsByAdminMap.get(adminKey);
      const adminStudents = studentStatsByAdminMap.get(adminKey) || 0;
      const adminTeachers = teacherStatsByAdminMap.get(adminKey) || 0;
      const examAttempts = resultStats?.examAttempts || 0;
      const avgScore = resultStats?.averageScore || 0;

      return {
        schoolName: admin.schoolName || admin.fullName,
        adminName: admin.fullName,
        adminEmail: admin.email,
        adminId: adminKey,
        students: adminStudents,
        teachers: adminTeachers,
        examAttempts,
        participationRate: adminStudents > 0 ? ((examAttempts / adminStudents) * 100).toFixed(1) : '0.0',
        averageScore: Number(avgScore).toFixed(2),
        studentList: studentListByAdmin.get(adminKey) || []
      };
    });

    console.log('📊 Board Dashboard Stats:', {
      boardCode,
      students,
      teachers,
      admins,
      subjects,
      contents,
      exams,
      examResults,
      averageScore: averageScore.toFixed(2)
    });

    res.json({
      success: true,
      data: {
        board,
        stats: {
          students,
          teachers,
          admins,
          subjects,
          contents,
          exams,
          examResults,
          averageScore: averageScore.toFixed(2)
        },
        topPerformers: topPerformers.map(r => ({
          studentName: r.userId?.fullName || 'Unknown',
          studentEmail: r.userId?.email || '',
          percentage: r.percentage,
          marks: `${r.obtainedMarks}/${r.totalMarks}`,
          examTitle: r.examTitle,
          completedAt: r.completedAt
        })),
        schoolParticipation
      }
    });
  } catch (error) {
    console.error('Get board dashboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch board dashboard' });
  }
};

// Create Subject (Super Admin only)
export const createSubject = async (req, res) => {
  try {
    console.log('📚 Create subject request received');
    console.log('Request body:', req.body);
    console.log('User:', req.user);
    
    const { name, board, description, code, classNumber } = req.body;

    console.log('📚 Creating subject:', { name, board, description, code, classNumber });

    if (!name || !board) {
      return res.status(400).json({ success: false, message: 'Name and board are required' });
    }

    const boardUpper = board.toUpperCase();
    if (boardUpper !== 'ASLI_EXCLUSIVE_SCHOOLS') {
      return res.status(400).json({ success: false, message: `Invalid board code: ${board}. Must be ASLI_EXCLUSIVE_SCHOOLS` });
    }

    // Check if subject already exists for this board
    const existingSubject = await Subject.findOne({ 
      name: name.trim(), 
      board: boardUpper
    });
    if (existingSubject) {
      return res.status(400).json({ success: false, message: 'Subject already exists for this board' });
    }

    // The createdBy field in Subject model is a String with enum 'super-admin'
    // So we must use 'super-admin' as the value
    // Handle empty strings - convert to undefined
    const subjectData = {
      name: name.trim(),
      board: boardUpper,
      createdBy: 'super-admin' // Required by schema enum
    };

    // Only add optional fields if they have values
    // IMPORTANT: Don't set code if it's empty to avoid unique index conflicts with null values
    // The code field should be completely omitted from the document if not provided
    if (code && code.trim()) {
      subjectData.code = code.trim();
    }
    // Don't include code at all if it's empty - this prevents MongoDB from setting it to null
    
    if (description && description.trim()) {
      subjectData.description = description.trim();
    }
    if (classNumber && classNumber.trim()) {
      subjectData.classNumber = classNumber.trim();
    }

    const subject = new Subject(subjectData);

    try {
      await subject.save();
    } catch (saveError) {
      // Handle duplicate key error (unique constraint violation)
      if (saveError.code === 11000 || saveError.name === 'MongoServerError') {
        // Check if it's a duplicate code (including null values)
        if (saveError.keyPattern && (saveError.keyPattern.code || saveError.keyValue && saveError.keyValue.code === null)) {
          // This happens when there's a non-sparse unique index on code and multiple subjects have null code
          // The database needs the old index dropped - for now, provide a helpful error
          return res.status(400).json({ 
            success: false, 
            message: 'Database index conflict. Please provide a unique subject code or contact administrator to fix the database index.' 
          });
        }
        // Check if it's a duplicate name/board
        if (saveError.keyPattern && saveError.keyPattern.name) {
          return res.status(400).json({ 
            success: false, 
            message: 'Subject already exists for this board' 
          });
        }
        return res.status(400).json({ 
          success: false, 
          message: 'Subject already exists. Please check the subject name and board.' 
        });
      }
      throw saveError; // Re-throw if it's a different error
    }

    console.log('✅ Subject created successfully:', subject.name, 'for board', boardUpper);

    res.json({ success: true, data: subject, message: 'Subject created successfully' });
  } catch (error) {
    console.error('❌ Create subject error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create subject', 
      error: error.message 
    });
  }
};

// Get subjects by board
export const getSubjectsByBoard = async (req, res) => {
  try {
    const { board } = req.params;

    console.log('📚 Fetching subjects for board:', board);

    if (!board) {
      return res.status(400).json({ success: false, message: 'Board parameter is required' });
    }

    const boardUpper = board.toUpperCase();
    if (boardUpper !== 'ASLI_EXCLUSIVE_SCHOOLS') {
      return res.status(400).json({ success: false, message: `Invalid board code: ${board}. Must be ASLI_EXCLUSIVE_SCHOOLS` });
    }

    const subjects = await Subject.find({ board: boardUpper, isActive: true }).sort({ name: 1 });

    console.log(`✅ Found ${subjects.length} subjects for board ${boardUpper}`);

    res.json({ success: true, data: subjects });
  } catch (error) {
    console.error('❌ Get subjects by board error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects', error: error.message });
  }
};

// Delete Subject (Super Admin only)
export const deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    // Soft delete - set isActive to false instead of deleting
    subject.isActive = false;
    await subject.save();

    res.json({ success: true, message: 'Subject deleted successfully' });
  } catch (error) {
    console.error('Delete subject error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete subject' });
  }
};

// Get All Classes (Super Admin only)
export const getAllClasses = async (req, res) => {
  try {
    // Get all unique class numbers from students
    const classNumbers = await User.distinct('classNumber', {
      role: 'student',
      classNumber: { $exists: true, $ne: null, $ne: '', $ne: 'Unassigned' }
    });

    // Sort classes numerically if possible, otherwise alphabetically
    const sortedClasses = classNumbers
      .filter(c => c && c !== 'Unassigned')
      .sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB;
        }
        return a.localeCompare(b);
      });

    res.json({ success: true, data: sortedClasses });
  } catch (error) {
    console.error('Get all classes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch classes' });
  }
};

// Upload Content (Super Admin only - Asli Prep Exclusive)
export const uploadContent = async (req, res) => {
  try {
    const { title, description, type, board, subject, classNumber, topic, date, fileUrl, fileUrls, thumbnailUrl, duration, size, deadline } = req.body;

    console.log('📦 Uploading content:', { title, type, board, subject, classNumber, date, deadline });

    // Support both single fileUrl (backward compatibility) and multiple fileUrls
    const hasFileUrl = fileUrl && fileUrl.trim();
    const hasFileUrls = fileUrls && Array.isArray(fileUrls) && fileUrls.length > 0;
    
    if (!title || !type || !board || !subject || !date || (!hasFileUrl && !hasFileUrls)) {
      return res.status(400).json({ success: false, message: 'Missing required fields: title, type, board, subject, date, and at least one fileUrl/fileUrls are required' });
    }

    if (board !== 'ASLI_EXCLUSIVE_SCHOOLS') {
      return res.status(400).json({ success: false, message: 'Invalid board code. Must be ASLI_EXCLUSIVE_SCHOOLS' });
    }

    // Super admin cannot upload Homework - only teachers can
    if (type === 'Homework') {
      return res.status(403).json({ success: false, message: 'Homework can only be uploaded by teachers. Please use the teacher dashboard to upload homework.' });
    }

    if (!['TextBook', 'Workbook', 'Material', 'Video', 'Audio'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid content type' });
    }

    // Verify subject exists and belongs to the board
    const subjectDoc = await Subject.findById(subject);
    if (!subjectDoc) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    if (subjectDoc.board !== board.toUpperCase()) {
      return res.status(400).json({ success: false, message: 'Subject does not belong to the selected board' });
    }

    // Use fileUrls if provided, otherwise use fileUrl for backward compatibility
    const finalFileUrls = hasFileUrls ? fileUrls : (hasFileUrl ? [fileUrl] : []);
    const primaryFileUrl = hasFileUrls ? fileUrls[0] : fileUrl;

    // Enforce server-hosted files only (DigitalOcean uploads directory)
    const isServerHostedUrl = (url) => {
      if (!url || typeof url !== 'string') return false;
      const trimmed = url.trim();
      return trimmed.startsWith('/uploads/');
    };

    if (!finalFileUrls.every(isServerHostedUrl) || !isServerHostedUrl(primaryFileUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Only uploaded server files are allowed. Please upload files first and use /uploads/... URLs.'
      });
    }

    const contentData = {
      title: title.trim(),
      description: description?.trim() || undefined,
      type,
      board: board.toUpperCase(),
      subject,
      topic: topic?.trim() || undefined,
      date: new Date(date),
      fileUrl: primaryFileUrl, // Keep for backward compatibility
      fileUrls: finalFileUrls.length > 0 ? finalFileUrls : undefined, // Store multiple URLs
      thumbnailUrl: thumbnailUrl?.trim() || undefined,
      duration: duration || 0,
      size: size || 0,
      isExclusive: true,
      createdBy: 'super-admin'
    };

    // Only add classNumber if provided
    if (classNumber && classNumber.trim()) {
      contentData.classNumber = classNumber.trim();
    }


    const content = new Content(contentData);

    await content.save();

    console.log('✅ Content uploaded successfully:', {
      id: content._id,
      title: content.title,
      board: content.board,
      type: content.type,
      subject: content.subject
    });

    res.json({ success: true, data: content, message: 'Content uploaded successfully' });
  } catch (error) {
    console.error('Upload content error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Provide more specific error messages
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        success: false, 
        message: 'Validation error: ' + Object.values(error.errors).map((e) => e.message).join(', ')
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to upload content',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Content by Board (or all boards - board filtering removed for visibility)
export const getContentByBoard = async (req, res) => {
  try {
    const { board } = req.params;
    const { subject, type, topic } = req.query;

    // Remove board restriction - show all content regardless of board
    // Board parameter is kept for backward compatibility but not used in filtering
    const query = { isActive: true, isExclusive: true };

    if (subject) query.subject = subject;
    if (type) query.type = type;
    if (topic) query.topic = { $regex: topic, $options: 'i' };

    const contents = await Content.find(query)
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: contents });
  } catch (error) {
    console.error('Get content by board error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch content' });
  }
};

// Delete Content (Super Admin only)
export const deleteContent = async (req, res) => {
  try {
    const { contentId } = req.params;

    if (!contentId || !mongoose.Types.ObjectId.isValid(contentId)) {
      return res.status(400).json({ success: false, message: 'Invalid content ID' });
    }

    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ success: false, message: 'Content not found' });
    }

    content.isActive = false;
    await content.save();

    res.json({ success: true, message: 'Content deleted successfully' });
  } catch (error) {
    console.error('Delete content error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete content', error: error.message });
  }
};

// Update Content (Super Admin only)
export const updateContent = async (req, res) => {
  try {
    const { contentId } = req.params;
    const { title, description, fileUrl, fileUrls, topic, date, classNumber } = req.body;

    if (!contentId || !mongoose.Types.ObjectId.isValid(contentId)) {
      return res.status(400).json({ success: false, message: 'Invalid content ID' });
    }

    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ success: false, message: 'Content not found' });
    }

    // Update fields if provided
    if (title !== undefined) content.title = title.trim();
    if (description !== undefined) content.description = description?.trim() || undefined;
    if (topic !== undefined) content.topic = topic?.trim() || undefined;
    if (date !== undefined) content.date = new Date(date);
    if (classNumber !== undefined) content.classNumber = classNumber?.trim() || undefined;

    // Update file URLs
    if (fileUrls !== undefined && Array.isArray(fileUrls) && fileUrls.length > 0) {
      content.fileUrls = fileUrls;
      content.fileUrl = fileUrls[0]; // Keep first URL for backward compatibility
    } else if (fileUrl !== undefined) {
      content.fileUrl = fileUrl;
      content.fileUrls = [fileUrl];
    }

    await content.save();

    res.json({ 
      success: true, 
      message: 'Content updated successfully',
      data: content 
    });
  } catch (error) {
    console.error('Update content error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update content', 
      error: error.message 
    });
  }
};

// Delete All Content (Bulk delete - Super Admin only)
export const deleteAllContent = async (req, res) => {
  try {
    const { board } = req.query; // Optional: filter by board
    
    // Match the same filter used in getContentByBoard to delete what's actually displayed
    const filter = { isActive: true, isExclusive: true };
    
    // Board filtering is optional since we're showing all content now
    // But keep it for backward compatibility if needed
    if (board && board !== 'ALL_BOARDS' && board !== 'ASLI_EXCLUSIVE_SCHOOLS') {
      filter.board = board;
    }

    console.log('🗑️ Deleting all content with filter:', JSON.stringify(filter, null, 2));

    const result = await Content.updateMany(
      filter,
      { $set: { isActive: false } }
    );

    console.log(`✅ Deleted ${result.modifiedCount} content items`);

    res.json({ 
      success: true, 
      message: `Deleted ${result.modifiedCount} content item${result.modifiedCount !== 1 ? 's' : ''} successfully`,
      deletedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Delete all content error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete all content', error: error.message });
  }
};

// Initialize boards on server start (call this in index.js)
// Note: initializeBoards is already exported above

// Get Board Analytics (for comparison charts) - All boards comparison
export const getBoardAnalytics = async (req, res) => {
  try {
    const boards = ['ASLI_EXCLUSIVE_SCHOOLS'];

    const analytics = await Promise.all(
      boards.map(async (boardCode) => {
        // Since everything is now ASLI_EXCLUSIVE_SCHOOLS, get all data
        const results = await ExamResult.find({});
        const students = await User.countDocuments({ role: 'student' });
        const exams = await Exam.countDocuments({ isActive: true });

        const averageScore = results.length > 0
          ? results.reduce((sum, r) => sum + r.percentage, 0) / results.length
          : 0;

        const participationRate = students > 0 && exams > 0
          ? ((results.length / (students * exams)) * 100).toFixed(1)
          : '0.0';

        return {
          board: boardCode,
          boardName: 'ASLI EXCLUSIVE SCHOOLS',
          students,
          exams,
          totalAttempts: results.length,
          averageScore: averageScore.toFixed(2),
          participationRate
        };
      })
    );

    res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('Get board analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
};

// Get detailed export data for board analytics
export const getBoardExportData = async (req, res) => {
  try {
    const { dataType } = req.query; // 'students', 'attempts', 'scores', 'participation'
    
    // Since everything is now ASLI_EXCLUSIVE_SCHOOLS, get all data
    let exportData = [];

    if (dataType === 'students' || !dataType) {
      // Export all students with their details
      const students = await User.find({ role: 'student' })
        .populate('assignedAdmin', 'fullName schoolName email')
        .select('fullName email classNumber phoneNumber createdAt')
        .sort({ fullName: 1 });

      exportData = students.map(student => ({
        'Student Name': student.fullName || 'N/A',
        'Email': student.email || 'N/A',
        'Class': student.classNumber || 'N/A',
        'Phone': student.phoneNumber || 'N/A',
        'School': student.assignedAdmin?.schoolName || student.assignedAdmin?.fullName || 'N/A',
        'Admin Email': student.assignedAdmin?.email || 'N/A',
        'Registered Date': student.createdAt ? new Date(student.createdAt).toLocaleDateString() : 'N/A'
      }));
    } else if (dataType === 'attempts') {
      // Export all exam attempts with student and exam details
      const attempts = await ExamResult.find({})
        .populate('userId', 'fullName email classNumber')
        .populate('examId', 'title examType duration totalMarks')
        .populate('adminId', 'schoolName fullName')
        .sort({ completedAt: -1 });

      exportData = attempts.map(attempt => ({
        'Student Name': attempt.userId?.fullName || 'N/A',
        'Student Email': attempt.userId?.email || 'N/A',
        'Class': attempt.userId?.classNumber || 'N/A',
        'Exam Title': attempt.examTitle || attempt.examId?.title || 'N/A',
        'Exam Type': attempt.examId?.examType || 'N/A',
        'School': attempt.adminId?.schoolName || attempt.adminId?.fullName || 'N/A',
        'Marks Obtained': attempt.obtainedMarks || 0,
        'Total Marks': attempt.totalMarks || attempt.examId?.totalMarks || 0,
        'Percentage': `${attempt.percentage?.toFixed(2) || '0.00'}%`,
        'Attempt Date': attempt.completedAt ? new Date(attempt.completedAt).toLocaleString() : 'N/A',
        'Time Taken (minutes)': attempt.timeTaken || 'N/A'
      }));
    } else if (dataType === 'scores') {
      // Export score summary by student
      const attempts = await ExamResult.find({})
        .populate('userId', 'fullName email classNumber')
        .populate('examId', 'title examType')
        .populate('adminId', 'schoolName')
        .sort({ 'userId.fullName': 1, completedAt: -1 });

      // Group by student
      const studentScores = {};
      attempts.forEach(attempt => {
        const studentId = attempt.userId?._id?.toString() || 'unknown';
        if (!studentScores[studentId]) {
          studentScores[studentId] = {
            'Student Name': attempt.userId?.fullName || 'N/A',
            'Email': attempt.userId?.email || 'N/A',
            'Class': attempt.userId?.classNumber || 'N/A',
            'School': attempt.adminId?.schoolName || 'N/A',
            'Total Attempts': 0,
            'Average Score': 0,
            'Highest Score': 0,
            'Lowest Score': 100,
            'Total Exams': new Set()
          };
        }
        studentScores[studentId]['Total Attempts']++;
        studentScores[studentId]['Total Exams'].add(attempt.examId?._id?.toString() || '');
        const score = attempt.percentage || 0;
        studentScores[studentId]['Average Score'] += score;
        if (score > studentScores[studentId]['Highest Score']) {
          studentScores[studentId]['Highest Score'] = score;
        }
        if (score < studentScores[studentId]['Lowest Score']) {
          studentScores[studentId]['Lowest Score'] = score;
        }
      });

      exportData = Object.values(studentScores).map(score => ({
        'Student Name': score['Student Name'],
        'Email': score['Email'],
        'Class': score['Class'],
        'School': score['School'],
        'Total Attempts': score['Total Attempts'],
        'Unique Exams': score['Total Exams'].size,
        'Average Score': `${(score['Average Score'] / score['Total Attempts']).toFixed(2)}%`,
        'Highest Score': `${score['Highest Score'].toFixed(2)}%`,
        'Lowest Score': `${score['Lowest Score'].toFixed(2)}%`
      }));
    } else if (dataType === 'participation') {
      // Export participation rates by school/class
      const students = await User.find({ role: 'student' })
        .populate('assignedAdmin', 'schoolName fullName')
        .select('fullName email classNumber assignedAdmin');
      
      const attempts = await ExamResult.find({})
        .populate('userId', 'fullName classNumber')
        .populate('adminId', 'schoolName');

      // Group by school
      const schoolParticipation = {};
      students.forEach(student => {
        const schoolName = student.assignedAdmin?.schoolName || student.assignedAdmin?.fullName || 'Unassigned';
        if (!schoolParticipation[schoolName]) {
          schoolParticipation[schoolName] = {
            'School Name': schoolName,
            'Total Students': 0,
            'Students Attempted': new Set(),
            'Total Attempts': 0
          };
        }
        schoolParticipation[schoolName]['Total Students']++;
      });

      attempts.forEach(attempt => {
        const schoolName = attempt.adminId?.schoolName || 'Unassigned';
        if (schoolParticipation[schoolName]) {
          schoolParticipation[schoolName]['Students Attempted'].add(attempt.userId?._id?.toString() || '');
          schoolParticipation[schoolName]['Total Attempts']++;
        }
      });

      exportData = Object.values(schoolParticipation).map(part => ({
        'School Name': part['School Name'],
        'Total Students': part['Total Students'],
        'Students Who Attempted': part['Students Attempted'].size,
        'Participation Rate': `${((part['Students Attempted'].size / part['Total Students']) * 100).toFixed(2)}%`,
        'Total Exam Attempts': part['Total Attempts'],
        'Average Attempts per Student': part['Total Students'] > 0 
          ? (part['Total Attempts'] / part['Total Students']).toFixed(2)
          : '0.00'
      }));
    }

    res.json({ success: true, data: exportData });
  } catch (error) {
    console.error('Get board export data error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch export data', error: error.message });
  }
};

