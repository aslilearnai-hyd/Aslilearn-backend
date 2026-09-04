import mongoose from 'mongoose';
import Board, { BOARD_KINDS } from '../models/Board.js';
import Subject from '../models/Subject.js';
import Content from '../models/Content.js';
import Exam from '../models/Exam.js';
import ExamResult from '../models/ExamResult.js';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Class from '../models/Class.js';
import { normalizeClassNumberLabel } from '../utils/studentClassContent.js';
import {
  VALID_SCHOOL_BOARDS,
  CURRICULUM_BOARDS,
  isValidSchoolBoard,
  isValidCurriculumBoard,
  canonicalizeSchoolBoard,
  BUILTIN_BOARD_SEED,
  setDynamicBoardCache,
  getBoardDisplayName,
} from '../constants/boards.js';
import {
  formatIitCategoryLabel,
  normalizeIitCategoryLoose,
  inferProductCategoryFromPath,
  buildMaterialSlotTitle,
  PRODUCT_CATEGORY_NONE,
  PRODUCT_IIT,
} from '../constants/products.js';
import { subjectDisplayName, softDeleteSubject } from '../utils/subjectDelete.js';
import { isSoftDeletedSubjectName } from '../utils/activeCatalog.js';
import {
  BOARD_DISPLAY_NAMES,
  buildAdminBoardQuery,
  buildTeacherBoardQuery,
  buildExamBoardQuery,
  buildStudentCountsByBoard,
  getAdminIdsForBoard,
  computeBoardMetrics,
  computeAllBoardsMetrics,
  bucketExamResultsByEffectiveBoard,
  isUnifiedPlatformBoard,
  buildPlatformAdminQuery,
} from '../services/boardScope.js';
import { formatParticipationRate } from '../utils/analytics-metrics.js';

function isIitBoardCode(boardUpper) {
  return canonicalizeSchoolBoard(boardUpper) === 'IIT';
}

function classNumberFromSubjectName(name) {
  const base = subjectDisplayName(name);
  const match = base.match(/_(\d+)$/);
  return match ? match[1] : null;
}

function normalizedStateNameForBoard(boardUpper, rawStateName) {
  if (boardUpper === 'STATE') {
    return String(rawStateName || '').trim();
  }
  return '';
}

/** Active subject lookup: STATE rows match exact stateName; others match empty/missing stateName. */
function findActiveSubjectByIdentity(name, boardUpper, stateForDb, productCategory = PRODUCT_CATEGORY_NONE) {
  const cat = normalizeIitCategoryLoose(productCategory);
  const base = { name, board: boardUpper, isActive: true, productCategory: cat };
  if (stateForDb) {
    return Subject.findOne({ ...base, stateName: stateForDb });
  }
  return Subject.findOne({
    $and: [
      base,
      { $or: [{ stateName: '' }, { stateName: { $exists: false } }] },
    ],
  });
}

/** Plain title + class from stored keys like Chemistry_10 or MATHS_6. */
function parseSubjectNameParts(name, classNumberField) {
  const base = subjectDisplayName(name);
  const suffixMatch = base.match(/^(.+?)_(\d+)$/);
  const plain = suffixMatch ? suffixMatch[1] : base;
  const classNum =
    (classNumberField && String(classNumberField).trim()) ||
    (suffixMatch ? suffixMatch[2] : classNumberFromSubjectName(name)) ||
    '';
  return { plain, classNum: String(classNum).trim() };
}

/** Case-insensitive identity for duplicate detection (MATHS_6 vs Maths_6). */
function subjectCatalogIdentityKey(name, boardUpper, stateForDb, classNumberField, productCategory = PRODUCT_CATEGORY_NONE) {
  const { plain, classNum } = parseSubjectNameParts(name, classNumberField);
  const stateKey = stateForDb ? String(stateForDb).trim().toLowerCase() : '';
  const cat = normalizeIitCategoryLoose(productCategory) || '';
  return `${plain.trim().toLowerCase()}|${classNum}|${boardUpper}|${stateKey}|${cat}`;
}

async function findActiveSubjectsForBoardState(boardUpper, stateForDb, productCategory = null) {
  const base = {
    board: boardUpper,
    isActive: true,
    name: { $not: /__deleted__/ },
  };
  if (productCategory !== null && productCategory !== undefined) {
    base.productCategory = normalizeIitCategoryLoose(productCategory);
  }
  if (stateForDb) {
    return Subject.find({ ...base, stateName: stateForDb });
  }
  return Subject.find({
    $and: [
      base,
      { $or: [{ stateName: '' }, { stateName: { $exists: false } }] },
    ],
  });
}

function findActiveSubjectByCatalogIdentity(peers, identityKey, excludeId) {
  const exclude = excludeId ? String(excludeId) : '';
  return peers.find(
    (row) =>
      String(row._id) !== exclude &&
      subjectCatalogIdentityKey(
        row.name,
        String(row.board || '').toUpperCase(),
        row.stateName,
        row.classNumber,
        row.productCategory
      ) === identityKey
  );
}

async function refreshBoardCodeCache() {
  const boards = await Board.find({}).select('code name kind isActive').lean();
  setDynamicBoardCache(boards.filter((b) => b.isActive !== false));
}

// Initialize boards if they don't exist
export const initializeBoards = async () => {
  try {
    for (const boardData of BUILTIN_BOARD_SEED) {
      await Board.findOneAndUpdate(
        { code: boardData.code },
        {
          $set: {
            name: boardData.name,
            description: boardData.description,
            kind: boardData.kind,
            product:
              boardData.product !== undefined
                ? String(boardData.product || '').toUpperCase().trim()
                : boardData.kind === 'iit'
                  ? PRODUCT_IIT
                  : '',
          },
          $setOnInsert: { isActive: true },
        },
        { upsert: true, new: true }
      );
    }

    await refreshBoardCodeCache();
    console.log('Boards initialized successfully');
  } catch (error) {
    console.error('Error initializing boards:', error);
  }
};

/** POST /api/super-admin/boards — create a curriculum / state / iit board */
export const createBoard = async (req, res) => {
  try {
    const code = String(req.body?.code || '')
      .toUpperCase()
      .trim()
      .replace(/\s+/g, '_');
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const kind = String(req.body?.kind || 'curriculum')
      .toLowerCase()
      .trim();
    const product = String(req.body?.product || '')
      .toUpperCase()
      .trim();

    if (!code || !/^[A-Z][A-Z0-9_/.-]{1,47}$/.test(code)) {
      return res.status(400).json({
        success: false,
        message:
          'Board code must start with a letter and use uppercase letters, numbers, or _ / . - (2–48 chars).',
      });
    }
    if (!name) {
      return res.status(400).json({ success: false, message: 'Display name is required.' });
    }
    if (!BOARD_KINDS.includes(kind)) {
      return res.status(400).json({
        success: false,
        message: `kind must be one of: ${BOARD_KINDS.join(', ')}`,
      });
    }

    const existing = await Board.findOne({ code });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Board code ${code} already exists.`,
      });
    }

    const board = await Board.create({
      code,
      name,
      description,
      kind,
      product: product || (kind === 'iit' ? PRODUCT_IIT : ''),
      isActive: true,
    });
    await refreshBoardCodeCache();

    return res.status(201).json({ success: true, data: board });
  } catch (error) {
    console.error('Create board error:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Board code already exists.' });
    }
    return res.status(500).json({ success: false, message: 'Failed to create board' });
  }
};

/** PUT /api/super-admin/boards/:code — update name / description / isActive (code immutable) */
export const updateBoard = async (req, res) => {
  try {
    const code = String(req.params.code || '')
      .toUpperCase()
      .trim();
    if (!code) {
      return res.status(400).json({ success: false, message: 'Board code is required.' });
    }

    const board = await Board.findOne({ code });
    if (!board) {
      return res.status(404).json({ success: false, message: 'Board not found.' });
    }

    if (req.body?.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) {
        return res.status(400).json({ success: false, message: 'Display name cannot be empty.' });
      }
      board.name = name;
    }
    if (req.body?.description !== undefined) {
      board.description = String(req.body.description || '').trim();
    }
    if (req.body?.product !== undefined) {
      board.product = String(req.body.product || '')
        .toUpperCase()
        .trim();
    }
    if (req.body?.isActive !== undefined) {
      if (code === 'ASLI_EXCLUSIVE_SCHOOLS' && Boolean(req.body.isActive) === false) {
        return res.status(403).json({
          success: false,
          message: 'The platform hub board cannot be deactivated.',
        });
      }
      board.isActive = Boolean(req.body.isActive);
    }
    if (req.body?.kind !== undefined) {
      const kind = String(req.body.kind || '')
        .toLowerCase()
        .trim();
      if (!BOARD_KINDS.includes(kind)) {
        return res.status(400).json({
          success: false,
          message: `kind must be one of: ${BOARD_KINDS.join(', ')}`,
        });
      }
      board.kind = kind;
      if (kind === 'iit' && !String(board.product || '').trim()) {
        board.product = PRODUCT_IIT;
      }
    }

    await board.save();
    await refreshBoardCodeCache();

    return res.json({ success: true, data: board });
  } catch (error) {
    console.error('Update board error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update board' });
  }
};

/** DELETE /api/super-admin/boards/:code — permanently remove a board */
export const deleteBoard = async (req, res) => {
  try {
    const code = String(req.params.code || '')
      .toUpperCase()
      .trim();
    if (!code) {
      return res.status(400).json({ success: false, message: 'Board code is required.' });
    }

    if (code === 'ASLI_EXCLUSIVE_SCHOOLS') {
      return res.status(403).json({
        success: false,
        message: 'The platform hub board cannot be deleted.',
      });
    }

    const board = await Board.findOne({ code });
    if (!board) {
      return res.status(404).json({ success: false, message: 'Board not found.' });
    }

    const [subjectCount, adminCount, contentCount, examCount] = await Promise.all([
      Subject.countDocuments({
        board: code,
        isActive: true,
        name: { $not: /__deleted__/ },
      }),
      User.countDocuments({
        role: 'admin',
        $or: [{ board: code }, { curriculumBoard: code }],
      }),
      Content.countDocuments({ board: code, isActive: { $ne: false } }),
      Exam.countDocuments({ board: code, isActive: { $ne: false } }),
    ]);

    if (subjectCount > 0 || adminCount > 0 || contentCount > 0 || examCount > 0) {
      const parts = [];
      if (subjectCount > 0) parts.push(`${subjectCount} subject(s)`);
      if (adminCount > 0) parts.push(`${adminCount} school(s)`);
      if (contentCount > 0) parts.push(`${contentCount} content item(s)`);
      if (examCount > 0) parts.push(`${examCount} exam(s)`);
      return res.status(409).json({
        success: false,
        message: `Cannot delete this board while it still has ${parts.join(', ')}. Remove or reassign them first.`,
      });
    }

    await Board.deleteOne({ code });
    await refreshBoardCodeCache();

    return res.json({ success: true, message: 'Board deleted permanently.' });
  } catch (error) {
    console.error('Delete board error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete board' });
  }
};

// Get all boards (active by default; ?all=1 includes inactive for management)
export const getAllBoards = async (req, res) => {
  try {
    const includeAll =
      req.query.all === '1' ||
      req.query.all === 'true' ||
      req.query.includeInactive === '1';
    const filter = includeAll ? {} : { isActive: true };
    const boards = await Board.find(filter).sort({ kind: 1, name: 1, code: 1 });
    res.json({ success: true, data: boards });
  } catch (error) {
    console.error('Get boards error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch boards' });
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

// Get board-specific dashboard data
export const getBoardDashboard = async (req, res) => {
  try {
    const { boardCode } = req.params;
    
    console.log('📊 Fetching board dashboard for:', boardCode);
    
    if (!isValidSchoolBoard(boardCode)) {
      return res.status(400).json({ success: false, message: 'Invalid board code' });
    }

    const boardUpper = String(boardCode).toUpperCase().trim();
    const unifiedPlatform = isUnifiedPlatformBoard(boardUpper);

    // Unified hub = all schools/students; curriculum boards = scoped slice only.
    const adminIds = unifiedPlatform
      ? (await User.find(buildPlatformAdminQuery()).select('_id').lean()).map((a) => a._id)
      : await getAdminIdsForBoard(boardUpper);

    const { counts: studentCountsByBoard, adminById } = await buildStudentCountsByBoard();
    const students = unifiedPlatform
      ? await User.countDocuments({ role: 'student' })
      : (studentCountsByBoard[boardUpper] ?? 0);

    const teacherQuery = unifiedPlatform ? {} : buildTeacherBoardQuery(boardUpper, adminIds);
    const examQuery = buildExamBoardQuery(boardUpper);
    const adminQuery = unifiedPlatform ? buildPlatformAdminQuery() : buildAdminBoardQuery(boardUpper);

    // Keep top-level metrics in one parallel batch.
    const [
      board,
      teachers,
      admins,
      subjects,
      contents,
      exams,
      examResults
    ] = await Promise.all([
      Board.findOne({ code: boardUpper }),
      Teacher.countDocuments(teacherQuery),
      User.countDocuments(adminQuery),
      Subject.countDocuments(
        unifiedPlatform ? { isActive: true } : { isActive: true, board: boardUpper }
      ),
      Content.countDocuments(
        unifiedPlatform ? { isActive: true } : { isActive: true, board: boardUpper }
      ),
      Exam.countDocuments(examQuery),
      ExamResult.countDocuments(unifiedPlatform ? {} : { adminId: { $in: adminIds } }),
    ]);

    const boardAdminIdSet = new Set(adminIds.map((id) => id.toString()));
    const resultBuckets = unifiedPlatform
      ? null
      : await bucketExamResultsByEffectiveBoard(ExamResult, adminById);

    // Replace full-collection reads + per-admin queries with grouped aggregations.
    // Top performers / averages for curriculum boards use adminId scope (effective school
    // membership), not raw ExamResult.board which is often the hub code.
    const [
      topPerformers,
      averageScoreAgg,
      adminsList,
      resultStatsByAdmin,
      studentStatsByAdmin,
      teacherStatsByAdmin,
      studentsForList
    ] = await Promise.all([
      ExamResult.find(unifiedPlatform ? {} : { adminId: { $in: adminIds } })
        .populate('userId', 'fullName email')
        .sort({ percentage: -1 })
        .limit(10)
        .select('userId percentage obtainedMarks totalMarks examTitle completedAt')
        .lean(),
      ExamResult.aggregate([
        ...(unifiedPlatform ? [] : [{ $match: { adminId: { $in: adminIds } } }]),
        {
          $group: {
            _id: null,
            averageScore: { $avg: '$percentage' }
          }
        }
      ]),
      User.find(adminQuery)
        .select('_id fullName email schoolName')
        .sort({ schoolName: 1, fullName: 1 })
        .lean(),
      ExamResult.aggregate([
        {
          $match: unifiedPlatform
            ? { adminId: { $ne: null } }
            : { adminId: { $in: adminIds } },
        },
        {
          $group: {
            _id: '$adminId',
            examAttempts: { $sum: 1 },
            averageScore: { $avg: '$percentage' },
            attempterIds: { $addToSet: '$userId' },
          }
        }
      ]),
      User.aggregate([
        {
          $match: unifiedPlatform
            ? { role: 'student', assignedAdmin: { $ne: null } }
            : { role: 'student', assignedAdmin: { $in: adminIds } },
        },
        {
          $group: {
            _id: '$assignedAdmin',
            students: { $sum: 1 }
          }
        }
      ]),
      Teacher.aggregate([
        { $match: { ...teacherQuery, adminId: { $ne: null } } },
        {
          $group: {
            _id: '$adminId',
            teachers: { $sum: 1 }
          }
        }
      ]),
      User.find(
        unifiedPlatform
          ? { role: 'student', assignedAdmin: { $ne: null } }
          : { role: 'student', assignedAdmin: { $in: adminIds } }
      )
        .select('fullName email classNumber assignedAdmin')
        .sort({ fullName: 1 })
        .lean()
    ]);

    const boardBucket = resultBuckets?.[boardUpper];
    let averageScore = averageScoreAgg?.[0]?.averageScore || 0;
    let participationRate = '0.0';

    if (boardBucket) {
      averageScore =
        boardBucket.results.length > 0
          ? boardBucket.results.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0) /
            boardBucket.results.length
          : 0;
      participationRate = formatParticipationRate(boardBucket.attempterIds.size, students);
    } else if (unifiedPlatform) {
      const distinctAttempters = await ExamResult.distinct('userId');
      participationRate = formatParticipationRate(distinctAttempters.length, students);
    }

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

    const schoolParticipation = adminsList
      .filter((admin) => boardAdminIdSet.has(admin._id.toString()))
      .map((admin) => {
      const adminKey = admin._id.toString();
      const resultStats = resultStatsByAdminMap.get(adminKey);
      const adminStudents = studentStatsByAdminMap.get(adminKey) || 0;
      const adminTeachers = teacherStatsByAdminMap.get(adminKey) || 0;
      const examAttempts = resultStats?.examAttempts || 0;
      const avgScore = resultStats?.averageScore || 0;
      const uniqueAttempters = (resultStats?.attempterIds || []).filter(Boolean).length;

      return {
        schoolName: admin.schoolName || admin.fullName,
        adminName: admin.fullName,
        adminEmail: admin.email,
        adminId: adminKey,
        students: adminStudents,
        teachers: adminTeachers,
        examAttempts,
        uniqueAttempters,
        participationRate: formatParticipationRate(uniqueAttempters, adminStudents),
        averageScore: Number(avgScore).toFixed(2),
        studentList: studentListByAdmin.get(adminKey) || []
      };
    });

    console.log('📊 Board Dashboard Stats:', {
      boardCode: boardUpper,
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
          examResults: boardBucket ? boardBucket.results.length : examResults,
          averageScore: averageScore.toFixed(2),
          participationRate,
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
    
    const { name, board, description, code, classNumber, stateName: rawStateName, productCategory: rawProductCategory } = req.body;

    console.log('📚 Creating subject:', { name, board, description, code, classNumber, stateName: rawStateName, productCategory: rawProductCategory });

    if (!name || !board) {
      return res.status(400).json({ success: false, message: 'Name and board are required' });
    }

    const boardUpper = canonicalizeSchoolBoard(board);
    if (!isValidSchoolBoard(boardUpper)) {
      return res.status(400).json({
        success: false,
        message: `Invalid board code: ${board}. Use Boards Management to create custom boards.`,
      });
    }

    const stateForDb = normalizedStateNameForBoard(boardUpper, rawStateName);
    if (boardUpper === 'STATE' && !stateForDb) {
      return res.status(400).json({
        success: false,
        message: 'State name is required for State syllabus subjects',
      });
    }

    const productCategory = normalizeIitCategoryLoose(rawProductCategory);
    if (isIitBoardCode(boardUpper) && !productCategory) {
      return res.status(400).json({
        success: false,
        message: 'Product category (Alpha / Beta / Gamma) is required for IIT subjects',
      });
    }
    const categoryLabel = productCategory
      ? ` and IIT ${formatIitCategoryLabel(productCategory)}`
      : '';

    // Active duplicate check only (soft-deleted subjects can be recreated/reused).
    const normalizedName = name.trim();
    const normalizedCode = code?.trim() || '';
    const existingActiveByName = await findActiveSubjectByIdentity(
      normalizedName,
      boardUpper,
      stateForDb,
      productCategory
    );
    if (existingActiveByName) {
      return res.status(400).json({
        success: false,
        message: `Subject already exists for this board and state${categoryLabel}`,
      });
    }

    const catalogPeers = await findActiveSubjectsForBoardState(
      boardUpper,
      stateForDb,
      productCategory
    );
    const newIdentity = subjectCatalogIdentityKey(
      normalizedName,
      boardUpper,
      stateForDb,
      classNumber,
      productCategory
    );
    const existingByCatalogIdentity = findActiveSubjectByCatalogIdentity(
      catalogPeers,
      newIdentity,
      null
    );
    if (existingByCatalogIdentity) {
      return res.status(400).json({
        success: false,
        message: `Subject already exists for this board and state${categoryLabel} (name may differ only by letter case)`,
      });
    }

    // If code is provided, ensure it is not already used by an active subject.
    // Deleted/inactive subjects are handled below via restore flow.
    if (normalizedCode) {
      const existingActiveByCode = await Subject.findOne({
        board: boardUpper,
        code: normalizedCode,
        isActive: true,
      });
      if (existingActiveByCode) {
        return res.status(400).json({
          success: false,
          message: 'Subject code already exists for this board',
        });
      }
    }

    // Reuse a soft-deleted subject row (name may be stored as Name__deleted__timestamp).
    const reviveNamePattern = new RegExp(
      `^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(__deleted__\\d+)?$`
    );
    let reviveQuery;
    if (normalizedCode) {
      reviveQuery = {
        board: boardUpper,
        isActive: false,
        $or: [{ name: reviveNamePattern }, { code: normalizedCode }],
      };
    } else if (stateForDb) {
      reviveQuery = {
        board: boardUpper,
        isActive: false,
        name: reviveNamePattern,
        stateName: stateForDb,
        productCategory,
      };
    } else {
      reviveQuery = {
        board: boardUpper,
        isActive: false,
        name: reviveNamePattern,
        productCategory,
        $or: [{ stateName: '' }, { stateName: { $exists: false } }],
      };
    }
    const existingInactive = await Subject.findOne(reviveQuery);
    if (existingInactive) {
      existingInactive.name = normalizedName;
      if (normalizedCode) existingInactive.code = normalizedCode;
      if (description !== undefined) existingInactive.description = description?.trim() || '';
      if (classNumber !== undefined) existingInactive.classNumber = classNumber?.trim() || undefined;
      existingInactive.stateName = stateForDb;
      existingInactive.productCategory = productCategory;
      existingInactive.isActive = true;
      await existingInactive.save();

      return res.json({
        success: true,
        data: existingInactive,
        message: 'Subject created successfully',
      });
    }

    // The createdBy field in Subject model is a String with enum 'super-admin'
    // So we must use 'super-admin' as the value
    // Handle empty strings - convert to undefined
    const subjectData = {
      name: normalizedName,
      board: boardUpper,
      stateName: stateForDb,
      productCategory,
      createdBy: 'super-admin' // Required by schema enum
    };

    // Only add optional fields if they have values
    // IMPORTANT: Don't set code if it's empty to avoid unique index conflicts with null values
    // The code field should be completely omitted from the document if not provided
    if (normalizedCode) {
      subjectData.code = normalizedCode;
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
            message: productCategory
              ? `Subject already exists for this board and IIT ${formatIitCategoryLabel(productCategory)}`
              : 'Subject already exists for this board',
          });
        }
        if (saveError.keyPattern && saveError.keyPattern.code) {
          return res.status(400).json({
            success: false,
            message: 'Subject code already exists for this board',
          });
        }
        return res.status(400).json({ 
          success: false, 
          message: 'Subject already exists. Please check the subject name, board, and product category.' 
        });
      }
      throw saveError; // Re-throw if it's a different error
    }

    console.log('✅ Subject created successfully:', subject.name, 'for board', boardUpper);

    res.json({ success: true, data: subject, message: 'Subject created successfully' });
  } catch (error) {
    console.error('❌ Create subject error:', error);
    console.error('Error stack:', error.stack);
    if (error?.name === 'ValidationError') {
      const details = Object.values(error.errors || {})
        .map((e) => e?.message)
        .filter(Boolean)
        .join('; ');
      return res.status(400).json({
        success: false,
        message: details || 'Subject validation failed',
        error: error.message,
      });
    }
    res.status(500).json({ 
      success: false, 
      message: error?.message ? `Failed to create subject: ${error.message}` : 'Failed to create subject', 
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

    const boardUpper = board.toUpperCase().trim();
    if (!isValidSchoolBoard(boardUpper)) {
      return res.status(400).json({
        success: false,
        message: `Invalid board code: ${board}. Use Boards Management to create custom boards.`,
      });
    }

    const subjects = await Subject.find({
      board: boardUpper,
      isActive: true,
      name: { $not: /__deleted__/ },
    }).sort({ name: 1 });

    console.log(`✅ Found ${subjects.length} subjects for board ${boardUpper}`);

    res.json({ success: true, data: subjects });
  } catch (error) {
    console.error('❌ Get subjects by board error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects', error: error.message });
  }
};

// Delete Subject (Super Admin only) — deletes ONLY the requested subject id.
export const deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    if (!subject.isActive) {
      return res.json({ success: true, message: 'Subject already deleted' });
    }

    await softDeleteSubject(subject);

    res.json({
      success: true,
      message: 'Subject deleted successfully',
      deletedCount: 1,
    });
  } catch (error) {
    console.error('Delete subject error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete subject', error: error.message });
  }
};

// Update Subject (Super Admin only)
export const updateSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { name, description, classNumber, board: rawBoard, stateName: rawStateName, productCategory: rawProductCategory } = req.body;

    if (!subjectId || !mongoose.Types.ObjectId.isValid(subjectId)) {
      return res.status(400).json({ success: false, message: 'Invalid subject ID' });
    }

    const subject = await Subject.findById(subjectId);
    if (!subject || !subject.isActive) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Subject name is required' });
    }

    const updatedName = String(name).trim();
    let boardUpper = canonicalizeSchoolBoard(subject.board);
    if (rawBoard !== undefined && rawBoard !== null && String(rawBoard).trim() !== '') {
      const nextBoard = canonicalizeSchoolBoard(rawBoard);
      if (!isValidSchoolBoard(nextBoard)) {
        return res.status(400).json({
          success: false,
          message: `Invalid board code: ${rawBoard}. Use Boards Management to create custom boards.`,
        });
      }
      boardUpper = nextBoard;
      subject.board = nextBoard;
    }

    const stateForDb = normalizedStateNameForBoard(boardUpper, rawStateName !== undefined ? rawStateName : subject.stateName);
    if (boardUpper === 'STATE' && !stateForDb) {
      return res.status(400).json({
        success: false,
        message: 'State name is required for State syllabus subjects',
      });
    }

    const productCategory =
      rawProductCategory !== undefined
        ? normalizeIitCategoryLoose(rawProductCategory)
        : normalizeIitCategoryLoose(subject.productCategory);
    if (isIitBoardCode(boardUpper) && !productCategory) {
      return res.status(400).json({
        success: false,
        message: 'Product category (Alpha / Beta / Gamma) is required for IIT subjects',
      });
    }
    const categoryLabel = productCategory
      ? ` and IIT ${formatIitCategoryLabel(productCategory)}`
      : '';

    const catalogPeers = await findActiveSubjectsForBoardState(
      boardUpper,
      stateForDb,
      productCategory
    );
    const targetIdentity = subjectCatalogIdentityKey(
      updatedName,
      boardUpper,
      stateForDb,
      classNumber !== undefined ? classNumber : subject.classNumber,
      productCategory
    );

    const exactDup = await findActiveSubjectByIdentity(
      updatedName,
      boardUpper,
      stateForDb,
      productCategory
    );
    const catalogDup = findActiveSubjectByCatalogIdentity(
      catalogPeers,
      targetIdentity,
      subjectId
    );
    const conflicting =
      exactDup && String(exactDup._id) !== String(subjectId)
        ? exactDup
        : catalogDup || null;

    if (conflicting) {
      const sameCatalogIdentity =
        subjectCatalogIdentityKey(
          conflicting.name,
          boardUpper,
          stateForDb,
          conflicting.classNumber,
          conflicting.productCategory
        ) === targetIdentity;

      if (!sameCatalogIdentity) {
        return res.status(400).json({
          success: false,
          message: `Another subject with this name already exists for this board and state${categoryLabel}`,
        });
      }

      // Merge duplicate rows (e.g. MATHS_6 + Maths_6) into the canonical record.
      await Content.updateMany(
        { subject: subject._id, isActive: true },
        { $set: { subject: conflicting._id } }
      );
      await Content.updateMany(
        { subject: subject._id, isActive: false },
        { $set: { subject: conflicting._id } }
      );
      await softDeleteSubject(subject);

      conflicting.name = updatedName;
      conflicting.stateName = stateForDb;
      conflicting.productCategory = productCategory;
      if (description !== undefined) {
        conflicting.description = description?.trim() || '';
      }
      if (classNumber !== undefined) {
        conflicting.classNumber = classNumber?.trim() || undefined;
      }
      await conflicting.save();

      return res.json({
        success: true,
        message: 'Subject updated successfully (merged duplicate catalog entry)',
        data: conflicting,
      });
    }

    subject.name = updatedName;
    subject.stateName = stateForDb;
    subject.productCategory = productCategory;
    if (description !== undefined) {
      subject.description = description?.trim() || '';
    }
    if (classNumber !== undefined) {
      subject.classNumber = classNumber?.trim() || undefined;
    }
    await subject.save();

    return res.json({
      success: true,
      message: 'Subject updated successfully',
      data: subject,
    });
  } catch (error) {
    console.error('Update subject error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update subject' });
  }
};

// Get All Classes (Super Admin only)
export const getAllClasses = async (req, res) => {
  try {
    const baseline = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    const collected = new Set(baseline);

    const addLabel = (raw) => {
      const normalized = normalizeClassNumberLabel(raw) || String(raw || '').trim();
      if (!normalized || /^unassigned$/i.test(normalized)) return;
      collected.add(normalized);
    };

    // School-dashboard Class documents (primary source for Super Admin exam targeting).
    const schoolClassNumbers = await Class.distinct('classNumber', {
      isActive: { $ne: false },
    });
    schoolClassNumbers.forEach(addLabel);

    // Student profile class numbers (covers legacy / unassigned-class edge cases).
    const studentClassNumbers = await User.distinct('classNumber', {
      role: 'student',
    });
    studentClassNumbers.forEach(addLabel);

    // Classes already used on Super Admin exams.
    const exams = await Exam.find({
      createdByRole: 'super-admin',
      isActive: { $ne: false },
    })
      .select('classNumber assignedClasses')
      .lean();
    for (const exam of exams) {
      addLabel(exam.classNumber);
      if (Array.isArray(exam.assignedClasses)) {
        exam.assignedClasses.forEach(addLabel);
      }
    }

    const sortedClasses = [...collected].sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      const aNum = !Number.isNaN(numA) && String(numA) === String(a);
      const bNum = !Number.isNaN(numB) && String(numB) === String(b);
      if (aNum && bNum) return numA - numB;
      if (aNum) return -1;
      if (bNum) return 1;
      return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
    });

    res.json({ success: true, data: sortedClasses });
  } catch (error) {
    console.error('Get all classes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch classes' });
  }
};

const CONTENT_TYPES = ['TextBook', 'Workbook', 'Material', 'Video', 'Audio'];

function normalizeContentType(raw) {
  const t = String(raw || '').trim();
  const match = CONTENT_TYPES.find((v) => v.toLowerCase() === t.toLowerCase());
  return match || t;
}

const VIDEO_NUMBER_PATTERN = /^[1-9]\d*$/;

function normalizeVideoNumber(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function isValidVideoNumber(raw) {
  return VIDEO_NUMBER_PATTERN.test(normalizeVideoNumber(raw));
}

function isStreamableContentType(contentType) {
  return /^(video|audio)$/i.test(String(contentType || '').trim());
}

function normalizeContentFileUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (trimmed.startsWith('uploads/')) return `/${trimmed}`;
  return trimmed;
}

function isAllowedContentFileUrl(url, contentType) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = normalizeContentFileUrl(url);
  if (!trimmed) return false;
  if (trimmed.startsWith('/uploads/')) return true;
  if (isStreamableContentType(contentType)) {
    if (/^https?:\/\//i.test(trimmed)) return true;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
  return false;
}

// Upload Content (Super Admin only - Asli Prep Exclusive)
export const uploadContent = async (req, res) => {
  try {
    const {
      title,
      description,
      type,
      board,
      subject,
      classNumber,
      topic,
      chapter,
      date,
      fileUrl,
      fileUrls,
      thumbnailUrl,
      duration,
      size,
      deadline,
      stateName: rawContentState,
      productCategory: rawProductCategory,
      relativePath,
    } = req.body;
    const moduleLabel = req.body.module ?? req.body.moduleName;
    const normalizedType = normalizeContentType(type);

    console.log('📦 Uploading content:', {
      title,
      type: normalizedType,
      board,
      subject,
      classNumber,
      date,
      fileUrl: fileUrl ? String(fileUrl).slice(0, 80) : undefined,
      deadline,
      stateName: rawContentState,
    });

    // Support both single fileUrl (backward compatibility) and multiple fileUrls
    const hasFileUrl = fileUrl && fileUrl.trim();
    const hasFileUrls = fileUrls && Array.isArray(fileUrls) && fileUrls.length > 0;
    
    if (!title || !type || !board || !subject || (!hasFileUrl && !hasFileUrls)) {
      return res.status(400).json({
        success: false,
        message:
          'Missing required fields: title, type, board, subject, and at least one fileUrl/fileUrls are required',
      });
    }

    const resolvedDate =
      date && String(date).trim() ? String(date).trim() : new Date().toISOString().slice(0, 10);

    const boardNorm = canonicalizeSchoolBoard(board);
    if (!isValidSchoolBoard(boardNorm)) {
      return res.status(400).json({
        success: false,
        message: `Invalid board code. Use Boards Management to create custom boards.`,
      });
    }

    // Super admin cannot upload Homework - only teachers can
    if (normalizedType === 'Homework') {
      return res.status(403).json({ success: false, message: 'Homework can only be uploaded by teachers. Please use the teacher dashboard to upload homework.' });
    }

    if (!CONTENT_TYPES.includes(normalizedType)) {
      return res.status(400).json({ success: false, message: 'Invalid content type' });
    }

    if (normalizedType === 'Video') {
      if (!isValidVideoNumber(chapter)) {
        return res.status(400).json({
          success: false,
          message: 'Chapter must be a number only (e.g. 1). Module is optional.',
        });
      }
      if (
        moduleLabel !== undefined &&
        String(moduleLabel).trim() !== '' &&
        !isValidVideoNumber(moduleLabel)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Module must be a number only (e.g. 1), or leave it blank.',
        });
      }
    }

    // Verify subject exists and belongs to the board
    const subjectDoc = await Subject.findById(subject);
    if (!subjectDoc) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    if (canonicalizeSchoolBoard(subjectDoc.board) !== boardNorm) {
      return res.status(400).json({ success: false, message: 'Subject does not belong to the selected board' });
    }

    const contentStateNorm = normalizedStateNameForBoard(boardNorm, rawContentState);
    if (boardNorm === 'STATE') {
      if (!contentStateNorm) {
        return res.status(400).json({
          success: false,
          message: 'State name is required for State syllabus content',
        });
      }
      const subjState = String(subjectDoc.stateName || '').trim();
      if (subjState && subjState !== contentStateNorm) {
        return res.status(400).json({
          success: false,
          message: 'State name must match the selected subject\'s state',
        });
      }
    }

    // Use fileUrls if provided, otherwise use fileUrl for backward compatibility
    const finalFileUrls = (hasFileUrls ? fileUrls : hasFileUrl ? [fileUrl] : []).map((u) =>
      normalizeContentFileUrl(u)
    );
    const primaryFileUrl = finalFileUrls[0] || '';

    if (
      finalFileUrls.length === 0 ||
      !finalFileUrls.every((u) => isAllowedContentFileUrl(u, normalizedType)) ||
      !isAllowedContentFileUrl(primaryFileUrl, normalizedType)
    ) {
      console.warn('Content file URL rejected:', {
        type: normalizedType,
        primaryFileUrl: primaryFileUrl.slice(0, 120),
      });
      return res.status(400).json({
        success: false,
        message: isStreamableContentType(normalizedType)
          ? 'Provide a valid https video/audio URL (YouTube, Vimeo, etc.) or an uploaded /uploads/... file.'
          : 'Only uploaded server files are allowed. Please upload files first and use /uploads/... URLs.',
      });
    }

    const contentProductCategory =
      (rawProductCategory !== undefined &&
      rawProductCategory !== null &&
      String(rawProductCategory).trim() !== ''
        ? normalizeIitCategoryLoose(rawProductCategory)
        : '') ||
      normalizeIitCategoryLoose(subjectDoc.productCategory) ||
      inferProductCategoryFromPath(relativePath || title) ||
      '';

    const materialTypes = new Set(['Textbook', 'Material', 'Workbook']);
    // Keep Super Admin's lesson/material title. Only invent a subject slot label when title is empty.
    const trimmedTitle = String(title || '').trim();
    const resolvedTitle =
      trimmedTitle ||
      (materialTypes.has(normalizedType)
        ? buildMaterialSlotTitle({
            subject: subjectDisplayName(subjectDoc?.name) || subjectDoc?.name,
            productCategory: contentProductCategory,
            fallbackTitle: '',
          })
        : '');

    const contentData = {
      title: resolvedTitle,
      description: description?.trim() || undefined,
      type: normalizedType,
      board: boardNorm,
      stateName: contentStateNorm || '',
      productCategory: contentProductCategory,
      subject,
      topic: topic?.trim() || undefined,
      chapter: normalizedType === 'Video' ? normalizeVideoNumber(chapter) : undefined,
      module:
        normalizedType === 'Video' && isValidVideoNumber(moduleLabel)
          ? normalizeVideoNumber(moduleLabel)
          : undefined,
      date: new Date(resolvedDate),
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

    // One Textbook/Material/Workbook per (board, class, subject, productCategory, type).
    if (materialTypes.has(normalizedType)) {
      const slotFilter = {
        subject,
        board: boardNorm,
        type: normalizedType,
        productCategory: contentProductCategory || '',
        isActive: { $ne: false },
      };
      if (classNumber && classNumber.trim()) {
        slotFilter.classNumber = classNumber.trim();
      }
      const existingSlot = await Content.findOne(slotFilter).sort({ updatedAt: -1 });
      if (existingSlot) {
        Object.assign(existingSlot, contentData);
        await existingSlot.save();
        console.log('✅ Content slot replaced:', {
          id: existingSlot._id,
          title: existingSlot.title,
          productCategory: existingSlot.productCategory,
          type: existingSlot.type,
        });
        const data = await contentResponsePayload(existingSlot);
        return res.json({
          success: true,
          data,
          message: 'Content updated in existing Alpha/Beta slot',
          replaced: true,
        });
      }
    }

    const content = new Content(contentData);

    await content.save();

    console.log('✅ Content uploaded successfully:', {
      id: content._id,
      title: content.title,
      board: content.board,
      type: content.type,
      productCategory: content.productCategory,
      subject: content.subject
    });

    const data = await contentResponsePayload(content);
    res.json({ success: true, data, message: 'Content uploaded successfully' });
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

/** When Subject was deleted, infer a label so super-admin UI can still group content. */
function inferSubjectDisplayNameFromContent(row) {
  const text = `${row.title || ''} ${row.description || ''} ${row.topic || ''}`.toLowerCase();
  if (/ganita|mathematics|maths|\bmath\b/.test(text)) return 'Mathematics';
  if (/\bphysics\b/.test(text)) return 'Physics';
  if (/\bchemistry\b/.test(text)) return 'Chemistry';
  if (/\bbiolog/.test(text)) return 'Biology';
  if (/science|curiosity/.test(text)) return 'Science';
  if (/english/.test(text)) return 'English';
  if (/social|history|geography/.test(text)) return 'Social Studies';
  if (/hindi/.test(text)) return 'Hindi';
  if (/telugu/.test(text)) return 'Telugu';
  // Never use raw video/chapter titles as subject names (e.g. "A Square and a Cube").
  return 'Unassigned';
}

async function contentResponsePayload(contentDoc) {
  const lean =
    contentDoc && typeof contentDoc.toObject === 'function'
      ? contentDoc.toObject()
      : { ...(contentDoc || {}) };
  const subjectId = lean.subject ? String(lean.subject._id || lean.subject) : null;
  let subjectPayload = null;
  if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) {
    const subjectDoc = await Subject.findById(subjectId)
      .select('name board classNumber stateName productCategory isActive')
      .lean();
    if (subjectDoc) {
      subjectPayload = {
        _id: subjectId,
        name: subjectDisplayName(subjectDoc.name),
        board: subjectDoc.board,
        classNumber: subjectDoc.classNumber,
        stateName: subjectDoc.stateName,
        productCategory: subjectDoc.productCategory,
        missingFromCatalog:
          subjectDoc.isActive === false || isSoftDeletedSubjectName(subjectDoc.name),
      };
    } else {
      subjectPayload = {
        _id: subjectId,
        name: inferSubjectDisplayNameFromContent(lean),
        board: lean.board,
        classNumber: lean.classNumber,
        missingFromCatalog: true,
      };
    }
  }
  return { ...lean, subject: subjectPayload || lean.subject };
}

// Get Content by Board (or all boards - board filtering removed for visibility)
export const getContentByBoard = async (req, res) => {
  try {
    const { board } = req.params;
    const { subject, type, topic, includeInactive } = req.query;
    const showInactive =
      includeInactive === 'true' && req.user?.role === 'super-admin';

    // Remove board restriction - show all content regardless of board
    // Board parameter is kept for backward compatibility but not used in filtering
    // Include legacy rows with no isActive field; exclude only explicit soft-deletes.
    const query = showInactive ? {} : { isActive: { $ne: false } };

    if (subject) query.subject = subject;
    if (type) query.type = type;
    if (topic) query.topic = { $regex: topic, $options: 'i' };

    const rows = await Content.find(query).sort({ createdAt: -1 }).lean();
    const subjectIds = [
      ...new Set(rows.map((r) => r.subject).filter(Boolean).map((id) => String(id))),
    ];
    const subjectDocs = subjectIds.length
      ? await Subject.find({ _id: { $in: subjectIds } })
          .select('name board classNumber stateName productCategory isActive')
          .lean()
      : [];
    const subjectById = new Map(subjectDocs.map((s) => [String(s._id), s]));

    const data = rows
      .map((row) => {
      const subjectId = row.subject ? String(row.subject) : null;
      const subjectDoc = subjectId ? subjectById.get(subjectId) : null;
      const catalogActive =
        subjectDoc &&
        subjectDoc.isActive !== false &&
        !isSoftDeletedSubjectName(subjectDoc.name);
      const displayName = catalogActive
        ? subjectDisplayName(subjectDoc.name)
        : subjectDoc?.name
          ? subjectDisplayName(subjectDoc.name)
          : inferSubjectDisplayNameFromContent(row);
      const resolvedClassNumber =
        (row.classNumber != null && String(row.classNumber).trim() !== ''
          ? String(row.classNumber).trim()
          : null) ||
        (subjectDoc?.classNumber != null && String(subjectDoc.classNumber).trim() !== ''
          ? String(subjectDoc.classNumber).trim()
          : null) ||
        classNumberFromSubjectName(subjectDoc?.name || '') ||
        null;

      return {
        ...row,
        subject: subjectId
          ? {
              _id: subjectId,
              name: displayName,
              board: subjectDoc?.board || row.board,
              classNumber: resolvedClassNumber || undefined,
              stateName: subjectDoc?.stateName,
              productCategory: subjectDoc?.productCategory || row.productCategory,
              missingFromCatalog: !catalogActive,
            }
          : {
              _id: `inferred-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
              name: displayName,
              classNumber: resolvedClassNumber || undefined,
              board: row.board,
              missingFromCatalog: true,
            },
      };
    })
      .filter(Boolean);

    res.json({ success: true, data });
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

    const content = await Content.findByIdAndDelete(contentId);
    if (!content) {
      return res.status(404).json({ success: false, message: 'Content not found' });
    }

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
    const {
      title,
      description,
      fileUrl,
      fileUrls,
      thumbnailUrl,
      isActive,
      topic,
      chapter,
      date,
      classNumber,
      board: rawBoard,
      stateName: rawStateName,
    } = req.body;
    const moduleLabel = req.body.module ?? req.body.moduleName;

    if (!contentId || !mongoose.Types.ObjectId.isValid(contentId)) {
      return res.status(400).json({ success: false, message: 'Invalid content ID' });
    }

    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ success: false, message: 'Content not found' });
    }

    const subjectDoc = await Subject.findById(content.subject);
    if (!subjectDoc) {
      return res.status(404).json({ success: false, message: 'Linked subject not found' });
    }

    // Update fields if provided
    if (title !== undefined) content.title = title.trim();
    if (description !== undefined) content.description = description?.trim() || undefined;
    if (topic !== undefined) content.topic = topic?.trim() || undefined;
    if (normalizeContentType(content.type) === 'Video') {
      // Title-only renames must not fail when legacy videos lack chapter/module.
      // Only validate/set when the client sends chapter/module keys.
      const chapterInBody = chapter !== undefined;
      const moduleInBody = moduleLabel !== undefined;
      const chapterProvided = chapterInBody && String(chapter).trim() !== '';
      const moduleProvided = moduleInBody && String(moduleLabel).trim() !== '';

      if (chapterInBody || moduleInBody) {
        const nextChapter = chapterProvided
          ? normalizeVideoNumber(chapter)
          : normalizeVideoNumber(content.chapter);
        if (chapterProvided && !isValidVideoNumber(nextChapter)) {
          return res.status(400).json({
            success: false,
            message: 'Chapter must be a number only (e.g. 1)',
          });
        }
        if (moduleProvided && !isValidVideoNumber(moduleLabel)) {
          return res.status(400).json({
            success: false,
            message: 'Module must be a number only (e.g. 1), or leave it blank.',
          });
        }
        const patch = {};
        if (chapterProvided) patch.chapter = nextChapter;
        if (moduleInBody) {
          patch.module = moduleProvided ? normalizeVideoNumber(moduleLabel) : '';
        }
        content.set(patch);
      }
    } else if (chapter !== undefined) {
      // PDFs and other library content can also be moved between chapters.
      content.chapter = String(chapter).trim() || undefined;
    }
    if (date !== undefined && String(date).trim() !== '') {
      const nextDate = new Date(date);
      if (!Number.isNaN(nextDate.getTime())) {
        content.date = nextDate;
      }
    }
    if (classNumber !== undefined) content.classNumber = classNumber?.trim() || undefined;

    if (rawBoard !== undefined && rawBoard !== null && String(rawBoard).trim() !== '') {
      const boardNorm = canonicalizeSchoolBoard(rawBoard);
      if (!isValidSchoolBoard(boardNorm)) {
        return res.status(400).json({
          success: false,
          message: `Invalid board code. Use Boards Management to create custom boards.`,
        });
      }
      const subjectBoard = canonicalizeSchoolBoard(subjectDoc.board);
      if (subjectBoard !== boardNorm) {
        return res.status(400).json({
          success: false,
          message: 'Content syllabus must match the linked subject\'s board',
        });
      }
      content.board = boardNorm;
      if (boardNorm !== 'STATE') {
        content.stateName = '';
      }
    }

    const boardForState = String(content.board || '').toUpperCase();
    if (rawStateName !== undefined) {
      const stateNorm = normalizedStateNameForBoard(boardForState, rawStateName);
      if (boardForState === 'STATE') {
        if (!stateNorm) {
          return res.status(400).json({
            success: false,
            message: 'State name is required for State syllabus content',
          });
        }
        const subjState = String(subjectDoc.stateName || '').trim();
        if (subjState && subjState !== stateNorm) {
          return res.status(400).json({
            success: false,
            message: 'State name must match the linked subject\'s state',
          });
        }
      }
      content.stateName = stateNorm;
    } else if (boardForState !== 'STATE') {
      content.stateName = '';
    }

    // Update file URLs
    if (fileUrls !== undefined && Array.isArray(fileUrls) && fileUrls.length > 0) {
      content.fileUrls = fileUrls;
      content.fileUrl = fileUrls[0]; // Keep first URL for backward compatibility
    } else if (fileUrl !== undefined) {
      content.fileUrl = fileUrl;
      content.fileUrls = [fileUrl];
    }

    if (thumbnailUrl !== undefined && String(thumbnailUrl).trim()) {
      content.thumbnailUrl = String(thumbnailUrl).trim();
    }

    if (isActive !== undefined) {
      content.isActive = isActive !== false && isActive !== 'false';
    }

    await content.save();

    const data = await contentResponsePayload(content);
    res.json({ 
      success: true, 
      message: 'Content updated successfully',
      data,
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
    if (board && board !== 'ALL_BOARDS') {
      const bu = String(board).toUpperCase().trim();
      if (isValidSchoolBoard(bu)) {
        filter.board = bu;
      }
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
    const { boardCode } = req.params;
    const boardsToFetch = boardCode
      ? [String(boardCode).toUpperCase().trim()].filter((c) => isValidSchoolBoard(c))
      : CURRICULUM_BOARDS;

    if (boardCode && boardsToFetch.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid board code' });
    }

    let analytics;
    if (!boardCode && boardsToFetch.length === CURRICULUM_BOARDS.length) {
      analytics = await computeAllBoardsMetrics({ Teacher, Exam, ExamResult });
    } else {
      analytics = await Promise.all(
        boardsToFetch.map(async (code) => {
          const metrics = await computeBoardMetrics(code, { User, Teacher, Exam, ExamResult });
          return {
            board: metrics.board,
            boardName: metrics.boardName || BOARD_DISPLAY_NAMES[code] || code,
            students: metrics.students,
            teachers: metrics.teachers,
            exams: metrics.exams,
            totalAttempts: metrics.totalAttempts,
            averageScore: metrics.averageScore,
            participationRate: metrics.participationRate,
          };
        })
      );
    }

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

