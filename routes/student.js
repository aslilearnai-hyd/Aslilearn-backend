import express from 'express';
import http from 'http';
import https from 'https';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Video from '../models/Video.js';
import Assessment from '../models/Assessment.js';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';
import Teacher from '../models/Teacher.js';
import Subject from '../models/Subject.js';
import Content from '../models/Content.js';
import StudentRemark from '../models/StudentRemark.js';
import TeacherWorkDiary from '../models/TeacherWorkDiary.js';
import RiskAnalysisReport from '../models/RiskAnalysisReport.js';
import GeminiPerformanceReport from '../models/GeminiPerformanceReport.js';
import { verifyToken } from '../middleware/auth.js';
import {
  getStudentExamRanking,
  getAllStudentRankings
} from '../controllers/studentRankingController.js';
import geminiService, { generateStudentTool } from '../services/gemini-service.js';
import { fetchRotatingAiToolData } from '../services/ai-tool-rotation-service.js';
import {
  advancedAnalyticsMockData,
  buildPerQuestionAttemptAnalytics,
  enrichQuestionAnalyticsFromExamQuestions,
  generateAdvancedAnalytics,
} from '../utils/advancedExamAnalytics.js';
import { normalizeSchoolBoard, resolveUserDisplayBoard } from '../constants/boards.js';
import { dedupeExamResultRows } from '../utils/dedupe-exam-results.js';
import { buildAdaptiveLearningPayload } from '../services/student-adaptive-learning-service.js';
import {
  resolveSubjectContentIds,
  resolveSubjectContentIdsMany,
  subjectIdAllowedWithSiblings,
} from '../utils/resolveSubjectContentIds.js';

const router = express.Router();

// iframe / window.open GETs cannot send Authorization. Allow JWT via ?token= for proxy routes only.
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const pathOnly = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '') || '';
  const isProxyRoute =
    pathOnly.endsWith('/content-preview') || pathOnly.endsWith('/content-download');
  if (!isProxyRoute) return next();
  const hdr = req.headers.authorization || req.get('Authorization');
  const raw = req.query.token;
  const tokenFromQuery =
    typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '';
  if (!hdr && tokenFromQuery) {
    req.headers.authorization = `Bearer ${tokenFromQuery}`;
  }
  next();
});

// Apply authentication middleware to all routes
router.use(verifyToken);

// Middleware to validate userId is a valid ObjectId and user is a student
router.use((req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      message: 'User ID not found. Please log in again.'
    });
  }
  
  // Check if userId is a valid MongoDB ObjectId
  if (!mongoose.Types.ObjectId.isValid(req.userId)) {
    console.error('❌ Invalid userId format:', req.userId, 'Type:', typeof req.userId);
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID format. Please log in again.'
    });
  }
  
  // Verify user is a student
  if (req.user && req.user.role !== 'student') {
    console.error('❌ Non-student trying to access student routes:', req.user.role);
    return res.status(403).json({
      success: false,
      message: 'Access denied. Student privileges required.'
    });
  }
  
  next();
});

function escapeRegexClassSuffix(classNum) {
  return String(classNum).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function plainSubjectName(name) {
  if (!name || typeof name !== 'string') return '';
  const m = name.match(/^(.+?)_\d+$/);
  return m ? m[1] : name;
}

function normalizeTopicLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function subjectSlugMatches(docSubjectPlain, rowSubject) {
  const plain = plainSubjectName(docSubjectPlain || '').toLowerCase().trim();
  const row = String(rowSubject || '').toLowerCase().trim();
  if (!row) return true;
  if (!plain) return false;
  const aliases = {
    maths: ['maths', 'math', 'mathematics'],
    physics: ['physics'],
    chemistry: ['chemistry', 'chem'],
    biology: ['biology', 'bio'],
  };
  const rowAliases = aliases[row] || [row];
  return rowAliases.some((a) => plain.includes(a) || a.includes(plain));
}

function topicFuzzyMatch(haystack, needle) {
  const h = normalizeTopicLabel(haystack);
  const n = normalizeTopicLabel(needle);
  if (!h || !n) return false;
  if (h.includes(n) || n.includes(h)) return true;
  const hTokens = h.split(' ').filter((t) => t.length > 2);
  const nTokens = n.split(' ').filter((t) => t.length > 2);
  if (nTokens.length === 0) return false;
  let hits = 0;
  for (const t of nTokens) {
    if (hTokens.some((ht) => ht === t || ht.includes(t) || t.includes(ht))) hits += 1;
  }
  const need = nTokens.length >= 3 ? 2 : 1;
  return hits >= need;
}

/** topicRows query: "maths|Probability,physics|Motion and Kinematics" */
function parseWeakTopicRowsFromQuery(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((part) => {
      const piece = String(part || '').trim();
      if (!piece) return null;
      if (piece.includes('|')) {
        const pipe = piece.indexOf('|');
        return {
          subject: String(piece.slice(0, pipe)).toLowerCase().trim(),
          topic: String(piece.slice(pipe + 1)).trim(),
        };
      }
      return { subject: '', topic: piece };
    })
    .filter((r) => r && r.topic);
}

/** Populated Class with assignedSubjects, or lookup by student.classNumber + admin. */
async function resolveStudentClassDoc(student) {
  const Class = (await import('../models/Class.js')).default;
  if (student.assignedClass) {
    if (typeof student.assignedClass === 'object' && student.assignedClass._id) {
      if (student.assignedClass.assignedSubjects !== undefined) {
        return student.assignedClass;
      }
      return await Class.findById(student.assignedClass._id).populate('assignedSubjects');
    }
    return await Class.findById(student.assignedClass).populate('assignedSubjects');
  }
  const aid = student.assignedAdmin?._id || student.assignedAdmin;
  if (student.classNumber && student.classNumber !== 'Unassigned' && aid) {
    return await Class.findOne({
      classNumber: student.classNumber,
      assignedAdmin: aid,
      isActive: true,
    }).populate('assignedSubjects');
  }
  return null;
}

/**
 * Subject IDs for student: class.assignedSubjects, subject.classIds, student.assignedSubjects.
 * Does not match subject names with class number suffixes.
 */
async function resolveStudentSubjectIdsForLibrary(student, adminBoardRaw, studentClassDoc) {
  const idStrToOid = new Map();
  const addId = (id) => {
    if (!id) return;
    const oid =
      id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));
    idStrToOid.set(oid.toString(), oid);
  };

  if (student.assignedSubjects?.length) {
    for (const subj of student.assignedSubjects) {
      addId(subj._id ? subj._id : subj);
    }
  }

  if (studentClassDoc?.assignedSubjects?.length) {
    for (const subj of studentClassDoc.assignedSubjects) {
      addId(subj._id ? subj._id : subj);
    }
  }

  if (studentClassDoc?._id) {
    const linked = await Subject.find({
      isActive: true,
      name: { $not: /__deleted__/ },
      classIds: studentClassDoc._id,
    })
      .select('_id')
      .lean();
    for (const row of linked) addId(row._id);
  }

  return Array.from(idStrToOid.values());
}

/** Active catalog subjects assigned to the student's class (not whole board). */
async function resolveStudentClassSubjects(student) {
  const studentClassDoc = await resolveStudentClassDoc(student);
  const adminBoard =
    student.assignedAdmin?.board ||
    (await User.findById(student.assignedAdmin).select('board').lean())?.board ||
    student.board;

  let librarySubjectIds = await resolveStudentSubjectIdsForLibrary(
    student,
    adminBoard,
    studentClassDoc
  );
  const { filterToActiveCatalogSubjectIds } = await import('../utils/activeCatalog.js');
  librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);

  const subjects =
    librarySubjectIds.length === 0
      ? []
      : await Subject.find({
          _id: { $in: librarySubjectIds },
          isActive: true,
          name: { $not: /__deleted__/ },
        })
          .sort({ name: 1 })
          .lean();

  const { resolveStudentClassNumber, filterContentsForStudentClass } = await import(
    '../utils/studentClassContent.js'
  );

  return {
    subjects,
    librarySubjectIds,
    studentClassDoc,
    studentClassNumber: resolveStudentClassNumber(student, studentClassDoc),
    adminBoard,
    filterContentsForStudentClass,
  };
}

/** Curriculum board for sibling subject/content lookup (not ASLI_EXCLUSIVE_SCHOOLS hub code). */
function resolveStudentContentBoard(student, adminBoard) {
  const display = resolveUserDisplayBoard(student, student?.assignedAdmin);
  if (display && String(display).toUpperCase() !== 'ASLI_EXCLUSIVE_SCHOOLS') {
    return String(display).toUpperCase();
  }
  const raw = adminBoard ? String(adminBoard).toUpperCase() : '';
  if (raw && raw !== 'ASLI_EXCLUSIVE_SCHOOLS') return raw;
  return 'CBSE';
}

// Get student's assigned admin and filter content accordingly
const getStudentAdminId = async (req, res, next) => {
  try {
    const student = await User.findById(req.userId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    if (!student.assignedAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Student not assigned to any admin' 
      });
    }
    
    req.studentAdminId = student.assignedAdmin;
    next();
  } catch (error) {
    console.error('Error getting student admin:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get student's videos - filtered by assigned subjects and teachers teaching those subjects
router.get('/videos', async (req, res) => {
  try {
    const { subject } = req.query;
    
    
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board')
      .populate('assignedClass', 'classNumber section assignedSubjects');

    console.log('📚 Student videos request - Student:', {
      id: student?._id?.toString(),
      email: student?.email,
      role: student?.role,
      board: student?.board || (student?.assignedAdmin?.board),
      classNumber: student?.assignedClass?.classNumber || student?.classNumber,
      requestedSubject: subject || 'none',
    });

    if (!student) {
      console.log('Student not found');
      return res.json({
        success: true,
        data: [],
        videos: [],
      });
    }

    const studentBoard = resolveStudentContentBoard(
      student,
      student.board || student.assignedAdmin?.board
    );

    if (!studentBoard) {
      return res.json({
        success: true,
        data: [],
        videos: [],
        message: 'No board assigned. Please contact your admin.',
      });
    }

    const {
      subjects: boardSubjects,
      librarySubjectIds,
      studentClassNumber,
      filterContentsForStudentClass,
    } = await resolveStudentClassSubjects(student);

    if (!studentClassNumber) {
      return res.json({
        success: true,
        data: [],
        videos: [],
        message:
          'No class assigned. Videos will appear once your administrator assigns you to a class.',
      });
    }

    if (boardSubjects.length === 0) {
      console.log('No subjects found for student class');
      return res.json({
        success: true,
        data: [],
        videos: [],
        message: 'No subjects available for your class yet. Ask your administrator to assign subjects.',
      });
    }

    const boardSubjectIds = boardSubjects.map((s) => s._id?.toString() || s._id.toString());

    // Find teachers assigned to the same admin who teach this class's subjects
    const teachers = await Teacher.find({
      adminId: student.assignedAdmin,
      subjects: { $in: boardSubjects.map(s => s._id) },
      isActive: true
    }).select('_id subjects').lean();
    
    const teacherIds = teachers.map(t => t._id);
    
    // Build a map of which teacher teaches which subject
    const teacherSubjectMap = new Map();
    teachers.forEach(teacher => {
      if (teacher.subjects && Array.isArray(teacher.subjects)) {
        teacher.subjects.forEach(subjId => {
          const subjIdStr = subjId.toString();
          if (boardSubjectIds.includes(subjIdStr)) {
            if (!teacherSubjectMap.has(subjIdStr)) {
              teacherSubjectMap.set(subjIdStr, []);
            }
            teacherSubjectMap.get(subjIdStr).push(teacher._id.toString());
          }
        });
      }
    });
    
    console.log(`Found ${teachers.length} teachers teaching ${boardSubjects.length} board subjects`);
    
    // Build query - show videos from teachers teaching board subjects
    // Note: Video.subjectId is a String, so we need to match it as a string
    let query = { 
      isPublished: true,
      isActive: true,
      createdBy: { $in: teacherIds },
      adminId: student.assignedAdmin
    };
    
    // Add subject filter if provided
    if (subject) {
      // Validate subject belongs to student's board
      const subjectObj = boardSubjects.find(s => 
        (s._id?.toString() === subject.toString()) || 
        (s._id.toString() === subject.toString())
      );
      
      if (!subjectObj) {
        return res.json({
          success: true,
          data: [],
          videos: [],
          message: 'This subject is not available for your board.'
        });
      }
      
      // Get teachers specifically assigned to this subject
      const subjectTeachers = teacherSubjectMap.get(subject.toString()) || [];
      if (subjectTeachers.length === 0) {
        console.log(`No teachers assigned to subject ${subject}`);
        return res.json({
          success: true,
          data: [],
          videos: [],
          message: 'No teacher assigned to this subject yet.'
        });
      }
      
      try {
        const boardUpper = studentBoard ? String(studentBoard).toUpperCase() : undefined;
        const resolvedSubjectIds = await resolveSubjectContentIds(subject, { board: boardUpper });
        const resolvedDocs = await Subject.find({ _id: { $in: resolvedSubjectIds } })
          .select('name')
          .lean();

        const subjectConditions = [];
        for (const oid of resolvedSubjectIds) {
          const idStr = oid.toString();
          subjectConditions.push({ subjectId: idStr });
          subjectConditions.push({ subjectId: oid });
        }
        for (const doc of resolvedDocs) {
          if (doc?.name) {
            subjectConditions.push({ subjectId: doc.name });
          }
        }

        console.log('Subject lookup for videos (sibling ids):', {
          subject,
          resolvedCount: resolvedSubjectIds.length,
        });
        
        // Add subject filter to query - only from teachers assigned to this subject
        query = {
          $and: [
            { isPublished: true },
            { isActive: true },
            { createdBy: { $in: subjectTeachers } },
            { adminId: student.assignedAdmin },
            { $or: subjectConditions }
          ]
        };
      } catch (err) {
        console.error('Error in video subject filter:', err);
        // Continue with basic query if subject filter fails
      }
    } else {
      // No subject filter - show all videos from teachers teaching board subjects
      // Only show content for subjects that have assigned teachers
      const subjectConditions = [];
      const validTeacherIds = [];
      
      boardSubjects.forEach(subj => {
        const subjIdStr = subj._id?.toString() || subj._id.toString();
        const teachersForSubject = teacherSubjectMap.get(subjIdStr);
        
        if (teachersForSubject && teachersForSubject.length > 0) {
          // This subject has assigned teachers, include it
          const conditions = [
            { subjectId: subjIdStr },
            { subjectId: subj._id.toString() }
          ];
          if (mongoose.Types.ObjectId.isValid(subjIdStr)) {
            const subjectObjId = new mongoose.Types.ObjectId(subjIdStr);
            conditions.push({ subjectId: subjectObjId.toString() });
          }
          subjectConditions.push(...conditions);
          validTeacherIds.push(...teachersForSubject);
        }
      });
      
      if (subjectConditions.length > 0 && validTeacherIds.length > 0) {
        query = {
          $and: [
            { isPublished: true },
            { isActive: true },
            { createdBy: { $in: [...new Set(validTeacherIds)] } },
            { adminId: student.assignedAdmin },
            { $or: subjectConditions }
          ]
        };
      } else {
        // No content available - subjects exist but no teachers assigned
        return res.json({
          success: true,
          data: [],
          videos: [],
          message: 'Subjects are available but no teachers are assigned to them yet.'
        });
      }
      
      console.log(`📋 Showing videos from ${validTeacherIds.length} teachers for ${boardSubjects.length} board subjects`);
    }
    
    // Safe query logging (handle ObjectId serialization)
    try {
      const queryForLog = JSON.stringify(query, (key, value) => {
        if (value && typeof value === 'object' && value.toString) {
          return value.toString();
        }
        return value;
      }, 2);
      console.log('Video query:', queryForLog);
    } catch (logError) {
      console.log('Video query (could not stringify):', query);
    }
    
    // Get Super Admin exclusive content for this student's board
    let exclusiveVideos = [];
    if (student.board) {
      try {
        // Build query for exclusive content
        let exclusiveQuery = {
          board: student.board,
          isActive: true,
          isExclusive: true
        };
        
        // Add subject filter to exclusive content query if provided
        if (subject) {
          // Subject is stored as ObjectId reference in Content model
          if (mongoose.Types.ObjectId.isValid(subject)) {
            exclusiveQuery.subject = subject;
          }
        }
        
        let exclusiveContent = await Content.find(exclusiveQuery)
        .populate('subject', '_id name')
        .lean();

        if (studentClassNumber) {
          exclusiveContent = filterContentsForStudentClass(
            exclusiveContent,
            studentClassNumber,
            librarySubjectIds
          );
        }

        console.log(`Found ${exclusiveContent.length} exclusive videos for board ${student.board}${subject ? ` with subject ${subject}` : ''}`);

        // Convert Content to video format
        exclusiveVideos = exclusiveContent.map(content => {
          const subjectId = content.subject 
            ? (content.subject._id?.toString() || content.subject.toString()) 
            : (content.subject?.toString() || '');
          
          console.log('📹 Exclusive video:', {
            title: content.title,
            subjectId,
            subjectObject: content.subject
          });
          
          return {
            _id: content._id.toString(),
            title: content.title,
            description: content.description || '',
            videoUrl: content.fileUrl,
            thumbnailUrl: content.thumbnailUrl || '',
            duration: (content.duration || 0) * 60, // Convert minutes to seconds
            subjectId: subjectId,
            subjectName: content.subject?.name || '',
            isYouTubeVideo: content.fileUrl?.includes('youtube.com') || content.fileUrl?.includes('youtu.be'),
            youtubeUrl: (content.fileUrl?.includes('youtube.com') || content.fileUrl?.includes('youtu.be')) ? content.fileUrl : undefined,
            isPublished: true,
            isActive: true,
            difficulty: 'Medium', // Default for exclusive content
            language: 'English',
            source: 'asli-prep-exclusive',
            createdAt: content.createdAt,
            topic: content.topic || ''
          };
        });
      } catch (exclusiveError) {
        console.error('Error fetching exclusive content:', exclusiveError);
        // Continue without exclusive videos if there's an error
      }
    }

    // Try to find videos - handle populate errors gracefully
    let videos = [];
    try {
      console.log('🔍 Querying teacher videos with query:', JSON.stringify(query, (key, value) => {
        if (value && typeof value === 'object' && value.toString) {
          return value.toString();
        }
        return value;
      }, 2));
      
      videos = await Video.find(query)
        .populate('createdBy', 'fullName email')
        .sort({ createdAt: -1 });
        
      console.log('✅ Found teacher videos:', videos.length);
      
      // Log video details for debugging
      if (videos.length > 0) {
        videos.forEach(video => {
          console.log('📹 Teacher video:', {
            title: video.title,
            subjectId: video.subjectId,
            subjectIdType: typeof video.subjectId,
            createdBy: video.createdBy?.toString() || video.createdBy,
            isPublished: video.isPublished,
            isActive: video.isActive
          });
        });
      } else {
        console.log('⚠️ No teacher videos found. Checking if videos exist without filters...');
        // Check if videos exist for these teachers at all
        const allTeacherVideos = await Video.find({ createdBy: { $in: teacherIds } }).limit(5);
        console.log(`Found ${allTeacherVideos.length} total videos for teachers:`, teacherIds);
        allTeacherVideos.forEach(v => {
          console.log('  -', v.title, 'subjectId:', v.subjectId, 'isPublished:', v.isPublished);
        });
      }
    } catch (populateError) {
      console.error('Error populating video createdBy:', populateError);
      console.error('Populate error stack:', populateError.stack);
      // Try without populate if populate fails
      try {
        videos = await Video.find(query).sort({ createdAt: -1 });
        console.log('✅ Found teacher videos (without populate):', videos.length);
      } catch (findError) {
        console.error('Error finding videos:', findError);
        console.error('Find error stack:', findError.stack);
        throw findError; // Re-throw to be caught by outer catch
      }
    }
    
    console.log('📊 Summary - Found teacher videos:', videos.length);
    console.log('📊 Summary - Found exclusive videos:', exclusiveVideos.length);

    // Format teacher videos to match expected structure
    const formattedTeacherVideos = videos.map(video => {
      // Handle subjectId - it's stored as a String in Video model
      const subjectIdStr = video.subjectId ? video.subjectId.toString() : '';
      
      console.log('📹 Formatting teacher video:', {
        title: video.title,
        rawSubjectId: video.subjectId,
        subjectIdStr,
        subjectIdType: typeof video.subjectId
      });
      
      return {
        _id: video._id.toString(),
        title: video.title || 'Untitled Video',
        description: video.description || '',
        videoUrl: video.videoUrl || '',
        thumbnailUrl: video.thumbnailUrl || '',
        duration: video.duration || 0,
        subjectId: subjectIdStr,
        subjectName: '', // Will be populated if subjectId is a reference, but Video model uses String
        isYouTubeVideo: video.isYouTubeVideo || false,
        youtubeUrl: video.youtubeUrl || '',
        isPublished: video.isPublished !== false,
        isActive: video.isActive !== false,
        difficulty: video.difficulty || 'Medium',
        language: video.language || 'English',
        source: 'teacher',
        createdAt: video.createdAt
      };
    });

    // Combine teacher videos and exclusive videos
    let allVideos = [...formattedTeacherVideos, ...exclusiveVideos];

    // Filter by subject if provided
    if (subject) {
      const subjectIdStr = subject.toString();
      console.log('🔍 Filtering videos by subject:', {
        requestedSubject: subject,
        requestedSubjectStr: subjectIdStr,
        totalVideosBeforeFilter: allVideos.length,
        teacherVideos: formattedTeacherVideos.length,
        exclusiveVideos: exclusiveVideos.length
      });
      
      // Log all video subjectIds before filtering for debugging
      console.log('📋 All videos before subject filter:');
      allVideos.forEach((v, idx) => {
        console.log(`  ${idx + 1}. "${v.title}" - subjectId: "${v.subjectId}" (type: ${typeof v.subjectId})`);
      });
      
      allVideos = allVideos.filter(v => {
        const vidSubjectId = v.subjectId?.toString() || v.subjectId || '';
        const vidSubjectIdStr = vidSubjectId.toString();
        
        // Try multiple comparison strategies
        const matches = vidSubjectId === subject || 
                       vidSubjectIdStr === subject || 
                       vidSubjectId === subjectIdStr ||
                       vidSubjectIdStr === subjectIdStr ||
                       vidSubjectId === subjectIdStr.toLowerCase() ||
                       vidSubjectIdStr === subjectIdStr.toLowerCase();
        
        if (matches) {
          console.log('✅ Video matches subject filter:', {
            videoTitle: v.title,
            videoSubjectId: vidSubjectId,
            requestedSubject: subject,
            requestedSubjectStr: subjectIdStr,
            source: v.source || 'unknown'
          });
        } else {
          console.log('❌ Video does NOT match subject filter:', {
            videoTitle: v.title,
            videoSubjectId: vidSubjectId,
            requestedSubject: subject,
            requestedSubjectStr: subjectIdStr,
            comparison: {
              exact: vidSubjectId === subject,
              stringMatch: vidSubjectIdStr === subject,
              strExact: vidSubjectId === subjectIdStr,
              strStringMatch: vidSubjectIdStr === subjectIdStr
            }
          });
        }
        
        return matches;
      });
      
      console.log(`📊 Filtered videos: ${allVideos.length} videos match subject ${subject}`);
      if (allVideos.length === 0 && formattedTeacherVideos.length > 0) {
        console.log('⚠️ WARNING: Subject filter removed all teacher videos!');
        console.log('This might indicate a subjectId mismatch. Check the video subjectId format vs requested subject format.');
      }
    }

    // Sort by creation date (newest first)
    allVideos.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    console.log(`Returning ${allVideos.length} total videos (${formattedTeacherVideos.length} from teacher, ${exclusiveVideos.length} exclusive)`);
    
    res.json({
      success: true,
      data: allVideos,
      videos: allVideos
    });
  } catch (error) {
    console.error('Error fetching student videos:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch videos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get student's assessments - filtered by assigned subjects and teachers teaching those subjects
router.get('/assessments', async (req, res) => {
  try {
    const { subject } = req.query;
    
    // Check if userId is set
    if (!req.userId) {
      console.error('req.userId is not set in assessments endpoint');
      return res.status(401).json({ 
        success: false, 
        message: 'User not authenticated',
        data: [],
        assessments: [],
        quizzes: []
      });
    }
    
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board')
      .populate('assignedClass', 'classNumber section assignedSubjects');

    console.log('Student assessments request - Student:', {
      id: student?._id,
      board: student?.board || (student?.assignedAdmin?.board),
      classNumber: student?.assignedClass?.classNumber || student?.classNumber,
      email: student?.email,
      role: student?.role,
    });

    if (!student) {
      console.log('Student not found');
      return res.json({
        success: true,
        data: [],
        assessments: [],
        quizzes: [],
      });
    }

    const studentBoard = resolveStudentContentBoard(
      student,
      student.board || student.assignedAdmin?.board
    );

    if (!studentBoard) {
      return res.json({
        success: true,
        data: [],
        assessments: [],
        quizzes: [],
        message: 'No board assigned. Please contact your admin.',
      });
    }

    const { subjects: boardSubjects } = await resolveStudentClassSubjects(student);

    if (boardSubjects.length === 0) {
      console.log('No subjects found for student class');
      return res.json({
        success: true,
        data: [],
        assessments: [],
        quizzes: [],
        message: 'No subjects available for your class yet. Ask your administrator to assign subjects.',
      });
    }

    const boardSubjectIds = boardSubjects.map((s) => s._id?.toString() || s._id.toString());
    
    // Find teachers assigned to the same admin who teach any of these board subjects
    const teachers = await Teacher.find({
      adminId: student.assignedAdmin,
      subjects: { $in: boardSubjects.map(s => s._id) },
      isActive: true
    }).select('_id subjects').lean();
    
    const teacherIds = teachers.map(t => t._id);
    
    // Build a map of which teacher teaches which subject
    const teacherSubjectMap = new Map();
    teachers.forEach(teacher => {
      if (teacher.subjects && Array.isArray(teacher.subjects)) {
        teacher.subjects.forEach(subjId => {
          const subjIdStr = subjId.toString();
          if (boardSubjectIds.includes(subjIdStr)) {
            if (!teacherSubjectMap.has(subjIdStr)) {
              teacherSubjectMap.set(subjIdStr, []);
            }
            teacherSubjectMap.get(subjIdStr).push(teacher._id.toString());
          }
        });
      }
    });
    
    console.log(`Found ${teachers.length} teachers teaching ${boardSubjects.length} board subjects`);
    
    // Build query - show assessments from teachers teaching board subjects
    let query = { 
      isPublished: true,
      createdBy: { $in: teacherIds }
    };
    
    // Add subject filter if provided
    if (subject) {
      // Validate subject belongs to student's board
      const subjectObj = boardSubjects.find(s => 
        (s._id?.toString() === subject.toString()) || 
        (s._id.toString() === subject.toString())
      );
      
      if (!subjectObj) {
        return res.json({
          success: true,
          data: [],
          assessments: [],
          quizzes: [],
          message: 'This subject is not available for your board.'
        });
      }
      
      // Get teachers specifically assigned to this subject
      const subjectTeachers = teacherSubjectMap.get(subject.toString()) || [];
      if (subjectTeachers.length === 0) {
        console.log(`No teachers assigned to subject ${subject}`);
        return res.json({
          success: true,
          data: [],
          assessments: [],
          quizzes: [],
          message: 'No teacher assigned to this subject yet.'
        });
      }
      
      try {
        const subjectDoc = await Subject.findById(subject);
        const subjectName = subjectDoc ? subjectDoc.name : null;
        const subjectIdStr = subject.toString();
        
        console.log('Subject lookup:', { subject, subjectName, subjectIdStr });
        
        // Try ObjectId conversion if valid
        let subjectObjectId = null;
        if (mongoose.Types.ObjectId.isValid(subject)) {
          try {
            subjectObjectId = new mongoose.Types.ObjectId(subject);
          } catch (e) {
            // ignore
          }
        }
        
        // Build subject matching conditions
        const subjectConditions = [];
        
        // Try multiple matching strategies
        subjectConditions.push({ subjectIds: { $in: [subject] } });
        subjectConditions.push({ subjectIds: { $in: [subjectIdStr] } });
        
        if (subjectObjectId) {
          subjectConditions.push({ subjectIds: { $in: [subjectObjectId] } });
        }
        
        if (subjectName) {
          subjectConditions.push({ subjectIds: { $in: [subjectName] } });
        }
        
        // Apply subject filter to query - only from teachers assigned to this subject
        query = {
          $and: [
            { isPublished: true },
            { createdBy: { $in: subjectTeachers } },
            { $or: subjectConditions }
          ]
        };
      } catch (err) {
        console.error('Error in subject filter:', err);
        // Fallback - filter by board subjects
        const subjectConditions = boardSubjectIds.map(subjId => ({
          subjectIds: { $in: [subjId, subjId.toString()] }
        }));
        
        query = {
          $and: [
            { isPublished: true },
            { createdBy: { $in: teacherIds } },
            { $or: subjectConditions }
          ]
        };
      }
    } else {
      // No subject filter - show assessments from board subjects only
      // Only show content for subjects that have assigned teachers
      const subjectConditions = [];
      const validTeacherIds = [];
      
      boardSubjects.forEach(subj => {
        const subjIdStr = subj._id?.toString() || subj._id.toString();
        const teachersForSubject = teacherSubjectMap.get(subjIdStr);
        
        if (teachersForSubject && teachersForSubject.length > 0) {
          // This subject has assigned teachers, include it
          subjectConditions.push({
            subjectIds: { $in: [subjIdStr, subj._id.toString()] }
          });
          validTeacherIds.push(...teachersForSubject);
        }
      });
      
      if (subjectConditions.length > 0 && validTeacherIds.length > 0) {
        query = {
          $and: [
            { isPublished: true },
            { createdBy: { $in: [...new Set(validTeacherIds)] } },
            { $or: subjectConditions }
          ]
        };
      } else {
        // No content available - subjects exist but no teachers assigned
        return res.json({
          success: true,
          data: [],
          assessments: [],
          quizzes: [],
          message: 'Subjects are available but no teachers are assigned to them yet.'
        });
      }
    }
    
    // Try to find assessments - handle populate errors gracefully
    let assessments = [];
    try {
      assessments = await Assessment.find(query)
        .populate('createdBy', 'fullName email')
        .sort({ createdAt: -1 });
    } catch (populateError) {
      console.error('Error populating assessment createdBy:', populateError);
      // Try without populate if populate fails
      assessments = await Assessment.find(query).sort({ createdAt: -1 });
    }
    
    console.log('Found assessments after filter:', assessments.length);
    
    // If subject filter applied but no results, try without subject filter (for debugging)
    if (subject && assessments.length === 0) {
      // Check if there are any assessments at all for these teachers
      const allAssessments = await Assessment.find({
        isPublished: true,
        createdBy: { $in: teacherIds }
      }).limit(1);
      
      if (allAssessments.length > 0) {
        console.log('WARNING: Subject filter returned 0 results but assessments exist');
        console.log('Returning all assessments without subject filter for debugging');
        
        assessments = await Assessment.find({
          isPublished: true,
          createdBy: { $in: teacherIds }
        })
        .populate('createdBy', 'fullName email')
        .sort({ createdAt: -1 });
        console.log('All assessments (no subject filter):', assessments.length);
      }
    }
    
    if (assessments.length > 0) {
      console.log('Sample assessment:', {
        title: assessments[0].title,
        subjectIds: assessments[0].subjectIds,
        subjectIdsType: Array.isArray(assessments[0].subjectIds) ? 'array' : typeof assessments[0].subjectIds,
        subjectIdsValues: Array.isArray(assessments[0].subjectIds) ? assessments[0].subjectIds.map((id) => id?.toString()) : assessments[0].subjectIds?.toString()
      });
    }
    
    res.json({
      success: true,
      data: assessments,
      assessments: assessments,
      quizzes: assessments
    });
  } catch (error) {
    console.error('Error fetching student assessments:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch assessments',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

async function hydrateExamQuestions(examDoc, { hideAnswers = false } = {}) {
  const examId = examDoc?._id;
  if (!examId) return examDoc;

  // Source of truth is Question.exam; fallback to Exam.questions to preserve legacy behavior
  let linkedQuestions = await Question.find({ exam: examId, isActive: { $ne: false } })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  if (!linkedQuestions.length && Array.isArray(examDoc.questions) && examDoc.questions.length > 0) {
    linkedQuestions = await Question.find({
      _id: { $in: examDoc.questions.map((q) => q?._id || q).filter(Boolean) },
      isActive: { $ne: false }
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
  }

  // Legacy fallback: some exams may have embedded question objects stored
  // directly in Exam.questions instead of Question documents.
  if (!linkedQuestions.length && Array.isArray(examDoc.questions) && examDoc.questions.length > 0) {
    const embeddedQuestions = examDoc.questions
      .filter((q) => q && typeof q === 'object')
      .filter((q) => q.questionText || q.questionImage || q.questionType || q.options)
      .map((q, index) => ({
        _id: q._id || `embedded-${examId}-${index}`,
        questionText: q.questionText || '',
        questionImage: q.questionImage || undefined,
        questionType: q.questionType || 'mcq',
        options: Array.isArray(q.options) ? q.options : [],
        correctAnswer: q.correctAnswer,
        marks: Number(q.marks) || 1,
        negativeMarks: Number(q.negativeMarks) || 0,
        explanation: q.explanation || undefined,
        subject: String(q.subject || 'maths').toLowerCase(),
        exam: examId,
      }));
    if (embeddedQuestions.length > 0) {
      linkedQuestions = embeddedQuestions;
    }
  }

  let normalizedQuestions = Array.isArray(linkedQuestions) ? linkedQuestions : [];
  const normalizedTotalMarks = normalizedQuestions.reduce((sum, q) => sum + (Number(q?.marks) || 0), 0);

  // When a student is about to take the exam, never ship the answer key to the
  // browser. The server re-grades submissions in POST /exam-results, so the
  // correct answers / explanations / per-option isCorrect flags are stripped
  // here. They are returned again after submission via the graded result.
  if (hideAnswers) {
    normalizedQuestions = normalizedQuestions.map((q) => {
      const { correctAnswer, explanation, ...rest } = q || {};
      const safeOptions = Array.isArray(rest.options)
        ? rest.options.map((opt) => {
            if (opt && typeof opt === 'object') {
              const { isCorrect, ...optRest } = opt;
              return optRest;
            }
            return opt;
          })
        : rest.options;
      return { ...rest, options: safeOptions };
    });
  }

  return {
    ...examDoc,
    questions: normalizedQuestions,
    totalQuestions:
      normalizedQuestions.length > 0
        ? normalizedQuestions.length
        : Number(examDoc.totalQuestions) || 0,
    totalMarks:
      normalizedQuestions.length > 0
        ? normalizedTotalMarks
        : Number(examDoc.totalMarks) || 0
  };
}

/**
 * Resolve the full question bank for an exam (Question collection + legacy refs + embedded).
 * Must match GET /exam-results/:examId/review so AI analysis and review stay aligned.
 */
async function loadExamQuestionBankForResults(examId) {
  const id = examId ? String(examId) : '';
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return [];
  }
  const examDoc = await Exam.findById(id).lean();
  let questions = await Question.find({ exam: id, isActive: { $ne: false } })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  if (!questions.length) {
    questions = await Question.find({ exam: id })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
  }

  if (!questions.length && Array.isArray(examDoc?.questions) && examDoc.questions.length > 0) {
    questions = await Question.find({
      _id: { $in: examDoc.questions.map((q) => q?._id || q).filter(Boolean) },
      isActive: { $ne: false },
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
  }

  if (!questions.length && Array.isArray(examDoc?.questions) && examDoc.questions.length > 0) {
    questions = await Question.find({
      _id: { $in: examDoc.questions.map((q) => q?._id || q).filter(Boolean) },
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
  }

  if (!questions.length && Array.isArray(examDoc?.questions) && examDoc.questions.length > 0) {
    questions = examDoc.questions
      .filter((q) => q && typeof q === 'object')
      .filter((q) => q.questionText || q.questionImage || q.questionType || q.options)
      .map((q, index) => ({
        _id: q._id || `embedded-${id}-${index}`,
        questionText: q.questionText || '',
        questionImage: q.questionImage || undefined,
        questionType: q.questionType || 'mcq',
        options: Array.isArray(q.options) ? q.options : [],
        correctAnswer: q.correctAnswer,
        marks: Number(q.marks) || 1,
        negativeMarks: Number(q.negativeMarks) || 0,
        explanation: q.explanation || undefined,
        subject: String(q.subject || 'maths').toLowerCase(),
        exam: id,
      }));
  }

  return questions;
}

/** Ensure exam result JSON includes plain-object answers (Mongoose Map / lean quirks). */
function toPlainExamResultForApi(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  const a = out.answers;
  if (a instanceof Map) {
    out.answers = Object.fromEntries(a);
  } else if (a && typeof a === 'object' && typeof a.get === 'function' && typeof a.set === 'function') {
    try {
      out.answers = Object.fromEntries(a);
    } catch (_e) {
      out.answers = { ...a };
    }
  }
  return out;
}

const canStudentAccessExam = (exam, studentAdminId) => {
  if (!exam) return false;
  if (!studentAdminId) return !exam.isSchoolSpecific;

  const toIdString = (value) => {
    if (!value) return '';
    if (typeof value === 'object' && value._id) return String(value._id);
    return String(value);
  };

  const studentAdminIdStr = String(studentAdminId);
  const examSchoolIdStr = toIdString(exam.schoolId);
  const targetSchoolIds = Array.isArray(exam.targetSchools)
    ? exam.targetSchools.map((id) => toIdString(id)).filter(Boolean)
    : [];

  // Non-school-specific exams are visible to everyone on the board.
  if (!exam.isSchoolSpecific) return true;

  // School-specific exam: allow only if student's assigned admin/school matches.
  if (examSchoolIdStr && examSchoolIdStr === studentAdminIdStr) return true;
  if (targetSchoolIds.includes(studentAdminIdStr)) return true;

  return false;
};

// Get student's exams (respect school targeting)
router.get('/exams', async (req, res) => {
  try {
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board');
    
    if (!student) {
      return res.json({
        success: true,
        data: []
      });
    }

    const studentAdminId = student.assignedAdmin?._id || student.assignedAdmin;

    // Keep exam discovery broad at DB level, then enforce school targeting in-memory.
    const query = {
      createdByRole: 'super-admin',
      isActive: true
    };

    console.log('📋 Student exams base query:', JSON.stringify(query, null, 2));

    // Get all exams created by Super Admin - no board restrictions
    const exams = await Exam.find(query)
      .populate('createdBy', 'fullName email')
      .populate('targetSchools', 'schoolName fullName email')
      .sort({ createdAt: -1 })
      .lean();

    const hydratedExams = await Promise.all(
      exams.map((exam) => hydrateExamQuestions(exam, { hideAnswers: true }))
    );

    // Only show exams that:
    // 1) student is allowed to access by school targeting
    // 2) have uploaded questions (avoid empty exam cards)
    const publishedExams = hydratedExams.filter((exam) => {
      if (!canStudentAccessExam(exam, studentAdminId)) return false;
      return Array.isArray(exam?.questions) && exam.questions.length > 0;
    });

    console.log(
      `✅ Found ${publishedExams.length} accessible exams with questions for student (from ${hydratedExams.length} total)`
    );
    
    res.json({
      success: true,
      data: publishedExams
    });
  } catch (error) {
    console.error('Error fetching student exams:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exams' });
  }
});

// Get student's teachers (filtered by assigned admin)
router.get('/teachers', getStudentAdminId, async (req, res) => {
  try {
    const teachers = await Teacher.find({ 
      adminId: req.studentAdminId,
      isActive: true 
    }).populate('createdBy', 'fullName email');
    
    res.json({
      success: true,
      data: teachers
    });
  } catch (error) {
    console.error('Error fetching student teachers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teachers' });
  }
});

// Get specific exam with questions (respect school targeting)
router.get('/exams/:examId', async (req, res) => {
  try {
    const { examId } = req.params;
    
    const student = await User.findById(req.userId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }
    
    const exam = await Exam.findOne({ 
      _id: examId,
      createdByRole: 'super-admin',
      isActive: true 
    }).lean();
    
    if (!exam) {
      return res.status(404).json({ 
        success: false, 
        message: 'Exam not found or access denied' 
      });
    }

    const studentAdminId = student.assignedAdmin?._id || student.assignedAdmin;
    if (!canStudentAccessExam(exam, studentAdminId)) {
      return res.status(403).json({
        success: false,
        message: 'This exam is not assigned to your school.'
      });
    }

    const hydratedExam = await hydrateExamQuestions(exam, { hideAnswers: true });

    if (!Array.isArray(hydratedExam?.questions) || hydratedExam.questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Exam is not available yet. Questions have not been uploaded.'
      });
    }

    res.json({
      success: true,
      data: hydratedExam
    });
  } catch (error) {
    console.error('Error fetching exam:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam' });
  }
});

// Get Asli Prep Exclusive Content (filtered by board and class assigned subjects)
router.get('/asli-prep-content', async (req, res) => {
  try {
    const { subject, type, topic, class: classParam } = req.query;
    
    console.log('📚 Fetching Asli Prep content for student:', req.userId);
    console.log('Query params:', { subject, type, topic });

    const { getStudentSchoolProgramContext, applySchoolProgramContentFilters, isAllowedContentType } =
      await import('../utils/schoolProgram.js');
    const programCtx = await getStudentSchoolProgramContext(req.userId);

    if (type && type !== 'all' && !isAllowedContentType(type, programCtx.isAsliPrepExclusive)) {
      return res.json({ success: true, data: [] });
    }
    
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive')
      .populate('assignedClass', 'classNumber section assignedSubjects');
    
    if (!student) {
      console.log('❌ Student not found');
      return res.json({
        success: true,
        data: []
      });
    }
    
    console.log('📚 Resolving subjects: class assignedSubjects ∪ board+class matches (incl. ASLI exclusive)');

    const studentClassDoc = await resolveStudentClassDoc(student);
    const adminBoard =
      student.assignedAdmin?.board ||
      (await User.findById(student.assignedAdmin).select('board').lean())?.board ||
      student.board;

    let librarySubjectIds = await resolveStudentSubjectIdsForLibrary(
      student,
      adminBoard,
      studentClassDoc
    );

    const { filterToActiveCatalogSubjectIds, buildActiveSubjectIdSet, filterContentRowsForActiveCatalog } =
      await import('../utils/activeCatalog.js');
    librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);

    if (librarySubjectIds.length === 0) {
      console.log('❌ No subjects resolved for student class');
      return res.json({
        success: true,
        data: [],
        message:
          'No subjects available for your class yet. Ask your administrator to assign subjects or confirm your class.',
      });
    }

    const boardUpper = resolveStudentContentBoard(student, adminBoard);
    const contentSubjectIds = await resolveSubjectContentIdsMany(librarySubjectIds, {
      board: boardUpper,
    });
    const activeIdSet = buildActiveSubjectIdSet(contentSubjectIds);

    console.log(
      `📚 Library subjects: ${librarySubjectIds.length}, content query ids (incl. siblings): ${contentSubjectIds.length}, board: ${boardUpper}`
    );

    // Build query — include content on MATHS_6 when student has clean MATHS assigned.
    const query = {
      subject: { $in: contentSubjectIds },
      isActive: true,
    };

    if (subject && subject !== 'all' && mongoose.Types.ObjectId.isValid(subject)) {
      const allowed = await subjectIdAllowedWithSiblings(subject, librarySubjectIds, {
        board: boardUpper,
      });
      if (allowed) {
        const resolved = await resolveSubjectContentIds(subject, { board: boardUpper });
        query.subject = { $in: resolved };
      } else {
        console.log('⚠️ Requested subject not in class assigned subjects');
        return res.json({ success: true, data: [] });
      }
    }
    
    if (type && type !== 'all') {
      query.type = type;
    }
    
    if (topic && topic.trim()) {
      query.topic = { $regex: topic.trim(), $options: 'i' };
    }

    console.log('📋 Content query:', JSON.stringify(query, null, 2));

    let contents = await Content.find(query)
      .populate('subject', 'name isActive board')
      .sort({ createdAt: -1 })
      .lean();

    contents = filterContentRowsForActiveCatalog(contents, activeIdSet);

    contents = applySchoolProgramContentFilters(contents, programCtx);

    const {
      normalizeClassNumberLabel,
      resolveStudentClassNumber,
      filterContentsForStudentClass,
    } = await import('../utils/studentClassContent.js');
    const studentClassNumber = resolveStudentClassNumber(student, studentClassDoc);

    if (!studentClassNumber) {
      return res.json({
        success: true,
        data: [],
        message:
          'No class assigned. Content will appear once your administrator assigns you to a class.',
      });
    }

    contents = filterContentsForStudentClass(
      contents,
      studentClassNumber,
      librarySubjectIds
    );

    if (classParam && classParam !== 'all' && String(classParam).trim() !== '') {
      const want = normalizeClassNumberLabel(classParam);
      if (want && want !== studentClassNumber) {
        contents = [];
      }
    }

    const subjectPlain = subject;
    if (
      subjectPlain &&
      subjectPlain !== 'all' &&
      String(subjectPlain).trim() !== '' &&
      !mongoose.Types.ObjectId.isValid(subjectPlain)
    ) {
      const want = String(subjectPlain).trim().toLowerCase();
      contents = contents.filter(
        (c) => plainSubjectName(c.subject?.name || '').toLowerCase() === want
      );
    }

    console.log(`✅ Found ${contents.length} contents for student's class subjects (after class/subject filters)`);

    const { enrichContentDurations } = await import('../utils/enrichContentDurations.js');
    contents = await enrichContentDurations(contents);

    res.json({
      success: true,
      data: contents
    });
  } catch (error) {
    console.error('❌ Error fetching Asli Prep content:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch content', error: error.message });
  }
});

// AI-style adaptive learning: weak topics from performance + real DB content only
router.get('/adaptive-learning', async (req, res) => {
  try {
    const data = await buildAdaptiveLearningPayload(req.userId);
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('❌ adaptive-learning error:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to build adaptive learning recommendations',
    });
  }
});

// Platform library content for subjects the student struggled with (exam report)
router.get('/weak-subject-content', async (req, res) => {
  try {
    const subjectsRaw = req.query.subjects;
    const weakQueryNames =
      typeof subjectsRaw === 'string'
        ? subjectsRaw
            .split(',')
            .map((s) => String(s).trim().toLowerCase())
            .filter(Boolean)
        : [];

    const topicsRaw = req.query.topics;
    const weakQueryTopics =
      typeof topicsRaw === 'string'
        ? topicsRaw
            .split(',')
            .map((s) => String(s).trim().toLowerCase())
            .filter(Boolean)
        : [];

    const topicRowsRaw = req.query.topicRows;
    let weakTopicRows = parseWeakTopicRowsFromQuery(
      typeof topicRowsRaw === 'string' ? topicRowsRaw : '',
    );
    if (weakTopicRows.length === 0 && weakQueryTopics.length > 0) {
      weakTopicRows = weakQueryTopics.map((topic) => ({ subject: '', topic }));
    }

    const emptyPayload = () => ({
      success: true,
      data: {
        Video: [],
        TextBook: [],
        Workbook: [],
        Material: [],
      },
      weakSubjects: weakQueryNames.map((n) =>
        n ? `${n.charAt(0).toUpperCase()}${n.slice(1)}` : ''
      ),
    });

    if (weakQueryNames.length === 0) {
      return res.json({
        ...emptyPayload(),
        weakSubjects: [],
      });
    }

    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board')
      .populate('assignedClass', 'classNumber section assignedSubjects');

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const studentClassDoc = await resolveStudentClassDoc(student);
    const adminBoard =
      student.assignedAdmin?.board ||
      (await User.findById(student.assignedAdmin).select('board').lean())?.board ||
      student.board;

    const librarySubjectIds = await resolveStudentSubjectIdsForLibrary(
      student,
      adminBoard,
      studentClassDoc
    );

    if (!librarySubjectIds.length) {
      return res.json(emptyPayload());
    }

    const boardUpper = resolveStudentContentBoard(student, adminBoard);
    const contentSubjectIds = await resolveSubjectContentIdsMany(librarySubjectIds, {
      board: boardUpper,
    });

    const CONTENT_TYPES = ['Video', 'TextBook', 'Workbook', 'Material'];

    let contents = await Content.find({
      subject: { $in: contentSubjectIds },
      isActive: true,
      type: { $in: CONTENT_TYPES },
    })
      .populate('subject', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const matchesWeakSubject = (doc) => {
      const plain = plainSubjectName(doc.subject?.name || '').toLowerCase().trim();
      if (!plain) return false;
      return weakQueryNames.some((w) => {
        if (!w) return false;
        return plain.includes(w) || w.includes(plain);
      });
    };

    const matchesWeakTopicForDoc = (doc) => {
      const plain = plainSubjectName(doc.subject?.name || '').toLowerCase().trim();
      const searchable = [doc.topic, doc.title, doc.description].filter(Boolean).join(' ');
      return weakTopicRows.some((row) => {
        if (row.subject && !subjectSlugMatches(plain, row.subject)) return false;
        return topicFuzzyMatch(searchable, row.topic);
      });
    };

    const strictTopicFilter = weakTopicRows.length > 0;
    let filtered = contents.filter((doc) => {
      if (!matchesWeakSubject(doc)) return false;
      if (!strictTopicFilter) {
        doc._topicMatch = false;
        return true;
      }
      const topicOk = matchesWeakTopicForDoc(doc);
      doc._topicMatch = topicOk;
      return topicOk;
    });

    const { resolveStudentClassNumber, filterContentsForStudentClass } = await import(
      '../utils/studentClassContent.js'
    );
    const weakStudentClassNumber = resolveStudentClassNumber(student, studentClassDoc);
    filtered = filterContentsForStudentClass(
      filtered,
      weakStudentClassNumber,
      librarySubjectIds
    );

    filtered.sort((a, b) => {
      const aMatch = a._topicMatch ? 1 : 0;
      const bMatch = b._topicMatch ? 1 : 0;
      return bMatch - aMatch;
    });

    const mapRow = (c) => ({
      _id: String(c._id),
      title: c.title || '',
      description: c.description || '',
      fileUrl:
        c.fileUrl || (Array.isArray(c.fileUrls) && c.fileUrls.length ? c.fileUrls[0] : '') || '',
      thumbnailUrl: c.thumbnailUrl || '',
      topic: c.topic || '',
      subject: {
        _id: String(c.subject?._id || ''),
        name: c.subject?.name || '',
      },
    });

    const data = {
      Video: [],
      TextBook: [],
      Workbook: [],
      Material: [],
    };

    for (const t of CONTENT_TYPES) {
      const forType = filtered.filter((c) => c.type === t).slice(0, 3);
      data[t] = forType.map(mapRow);
    }

    res.json({
      success: true,
      data,
      weakSubjects: weakQueryNames.map((n) =>
        n ? `${n.charAt(0).toUpperCase()}${n.slice(1)}` : ''
      ),
    });
  } catch (error) {
    console.error('❌ Error fetching weak-subject content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch weak-subject content',
      error: error.message,
    });
  }
});

// Get IQ/Rank Boost questions for student (filtered by class)
router.get('/iq-rank-questions', async (req, res) => {
  try {
    const { classNumber, subject, difficulty } = req.query;
    
    const student = await User.findById(req.userId)
      .populate('assignedClass', 'classNumber');
    if (!student) {
      return res.json({ success: true, data: [] });
    }

    // Get student's class number - check assignedClass first, then classNumber field
    let studentClassNumber = classNumber;
    if (!studentClassNumber) {
      if (student.assignedClass && student.assignedClass.classNumber) {
        studentClassNumber = student.assignedClass.classNumber;
      } else if (student.classNumber) {
        studentClassNumber = student.classNumber;
      }
    }
    
    if (!studentClassNumber || studentClassNumber === 'Unassigned') {
      return res.json({
        success: true,
        data: [],
        message: 'No class assigned. Please contact your administrator.'
      });
    }

    const IQRankQuestion = (await import('../models/IQRankQuestion.js')).default;

    // Build query - filter by student's class
    const query = {
      classNumber: studentClassNumber.toString(),
      isActive: true
    };

    // Optional filters
    if (subject && subject !== 'all') {
      query.subject = subject;
    }
    if (difficulty && difficulty !== 'all') {
      query.difficulty = difficulty;
    }

    const questions = await IQRankQuestion.find(query)
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: questions,
      questions: questions,
      classNumber: studentClassNumber.toString()
    });
  } catch (error) {
    console.error('Error fetching IQ/Rank questions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch questions'
    });
  }
});

// Save IQ/Rank Boost quiz result
router.post('/iq-rank-quiz-result', async (req, res) => {
  try {
    const { subjectId, totalQuestions, correctAnswers, incorrectAnswers, unattempted, score, answers } = req.body;
    
    if (!subjectId || totalQuestions === undefined || score === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const student = await User.findById(req.userId)
      .populate('assignedClass', 'classNumber');
    
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Get student's class number
    let studentClassNumber = null;
    if (student.assignedClass && student.assignedClass.classNumber) {
      studentClassNumber = student.assignedClass.classNumber;
    } else if (student.classNumber) {
      studentClassNumber = student.classNumber;
    }

    if (!studentClassNumber || studentClassNumber === 'Unassigned') {
      return res.status(400).json({
        success: false,
        message: 'No class assigned. Please contact your administrator.'
      });
    }

    const IQRankQuizResult = (await import('../models/IQRankQuizResult.js')).default;

    // Check if result already exists for this user and subject
    const existingResult = await IQRankQuizResult.findOne({
      userId: req.userId,
      subject: subjectId
    });

    const resultData = {
      userId: req.userId,
      subject: subjectId,
      classNumber: studentClassNumber.toString(),
      totalQuestions,
      correctAnswers: correctAnswers || 0,
      incorrectAnswers: incorrectAnswers || 0,
      unattempted: unattempted || 0,
      score,
      answers: answers || {},
      completedAt: new Date()
    };

    let quizResult;
    if (existingResult) {
      // Update existing result
      quizResult = await IQRankQuizResult.findByIdAndUpdate(
        existingResult._id,
        resultData,
        { new: true }
      ).populate('subject', 'name');
    } else {
      // Create new result
      quizResult = new IQRankQuizResult(resultData);
      await quizResult.save();
      await quizResult.populate('subject', 'name');
    }

    res.json({
      success: true,
      message: 'Quiz result saved successfully',
      data: quizResult
    });
  } catch (error) {
    console.error('Error saving quiz result:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save quiz result'
    });
  }
});

// Get IQ/Rank Boost quiz results for student (grouped by subject)
router.get('/iq-rank-quiz-results', async (req, res) => {
  try {
    const IQRankQuizResult = (await import('../models/IQRankQuizResult.js')).default;

    const results = await IQRankQuizResult.find({
      userId: req.userId
    })
      .populate('subject', 'name')
      .sort({ completedAt: -1 });

    // Group results by subject (get latest result per subject)
    const subjectResults = new Map();
    results.forEach((result) => {
      const subjectId = result.subject._id.toString();
      if (!subjectResults.has(subjectId)) {
        subjectResults.set(subjectId, {
          subjectId: subjectId,
          subjectName: result.subject.name,
          score: result.score,
          totalQuestions: result.totalQuestions,
          correctAnswers: result.correctAnswers,
          completedAt: result.completedAt
        });
      }
    });

    res.json({
      success: true,
      data: Array.from(subjectResults.values())
    });
  } catch (error) {
    console.error('Error fetching quiz results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quiz results'
    });
  }
});

// Submit homework
router.post('/homework-submission', async (req, res) => {
  try {
    const { homeworkId, submissionLink, description } = req.body;
    
    if (!homeworkId || !submissionLink) {
      return res.status(400).json({
        success: false,
        message: 'Homework ID and submission link are required'
      });
    }

    // Validate URL format
    try {
      new URL(submissionLink);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format for submission link'
      });
    }

    // Get homework content to verify it exists and get subject
    const Content = (await import('../models/Content.js')).default;
    const homework = await Content.findById(homeworkId)
      .populate('subject', 'name');
    
    if (!homework) {
      return res.status(404).json({
        success: false,
        message: 'Homework not found'
      });
    }

    if (homework.type !== 'Homework') {
      return res.status(400).json({
        success: false,
        message: 'Content is not a homework assignment'
      });
    }

    const HomeworkSubmission = (await import('../models/HomeworkSubmission.js')).default;

    // Check if submission already exists
    const existingSubmission = await HomeworkSubmission.findOne({
      homeworkId: homeworkId,
      studentId: req.userId
    });

    const submissionData = {
      homeworkId: homeworkId,
      studentId: req.userId,
      subjectId: homework.subject._id || homework.subject,
      submissionLink: submissionLink.trim(),
      description: description ? description.trim() : '',
      isMarkedAsDone: true,
      submittedAt: new Date()
    };

    let submission;
    if (existingSubmission) {
      // Update existing submission
      submission = await HomeworkSubmission.findByIdAndUpdate(
        existingSubmission._id,
        submissionData,
        { new: true }
      )
        .populate('homeworkId', 'title fileUrl deadline')
        .populate('subjectId', 'name');
    } else {
      // Create new submission
      submission = new HomeworkSubmission(submissionData);
      await submission.save();
      await submission.populate('homeworkId', 'title fileUrl deadline');
      await submission.populate('subjectId', 'name');
    }

    res.json({
      success: true,
      message: 'Homework submitted successfully',
      data: submission
    });
  } catch (error) {
    console.error('Error submitting homework:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit homework'
    });
  }
});

// Get homework submission for a specific homework
router.get('/homework-submission/:homeworkId', async (req, res) => {
  try {
    const { homeworkId } = req.params;

    const HomeworkSubmission = (await import('../models/HomeworkSubmission.js')).default;

    const submission = await HomeworkSubmission.findOne({
      homeworkId: homeworkId,
      studentId: req.userId
    })
      .populate('homeworkId', 'title fileUrl deadline')
      .populate('subjectId', 'name');

    if (!submission) {
      return res.json({
        success: true,
        data: null,
        message: 'No submission found'
      });
    }

    res.json({
      success: true,
      data: submission
    });
  } catch (error) {
    console.error('Error fetching homework submission:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch homework submission'
    });
  }
});

// Get all homework submissions for student
router.get('/homework-submissions', async (req, res) => {
  try {
    const HomeworkSubmission = (await import('../models/HomeworkSubmission.js')).default;

    const submissions = await HomeworkSubmission.find({
      studentId: req.userId
    })
      .populate('homeworkId', 'title fileUrl deadline type')
      .populate('subjectId', 'name')
      .sort({ submittedAt: -1 });

    res.json({
      success: true,
      data: submissions
    });
  } catch (error) {
    console.error('Error fetching homework submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch homework submissions'
    });
  }
});

// Get student's exam results
router.get('/exam-results', async (req, res) => {
  try {
    console.log('📋 Fetching exam results for student:', req.userId);
    console.log('📋 Request user:', req.user);
    
    if (!req.userId) {
      console.error('❌ req.userId is not set');
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Convert userId to ObjectId to ensure proper matching
    const mongoose = (await import('mongoose')).default;
    const userId = mongoose.Types.ObjectId.isValid(req.userId) 
      ? new mongoose.Types.ObjectId(req.userId) 
      : req.userId;

    const ExamResult = (await import('../models/ExamResult.js')).default;

    // Do NOT populate examId: if the Exam doc was removed, populate() sets examId to null
    // and the client loses the id (breaks Attempted Exams / rankings). examTitle is on the row.
    const results = await ExamResult.find({ userId: userId }).sort({ completedAt: -1 });

    const normalizedResults = results.map((row) => {
      const correct = Number(row?.correctAnswers || 0);
      const wrong = Number(row?.wrongAnswers || 0);
      const unattempted = Number(row?.unattempted || 0);
      const total = Number(row?.totalQuestions || 0) || (correct + wrong + unattempted);
      const derivedPercentage = total > 0
        ? Math.round((correct / total) * 10000) / 100
        : 0;

      const plain = typeof row?.toObject === 'function'
        ? row.toObject({ flattenMaps: true })
        : row;

      const rawExamId = plain.examId;
      const examIdStr =
        rawExamId != null
          ? typeof rawExamId === 'object' && rawExamId._id != null
            ? String(rawExamId._id)
            : String(rawExamId)
          : null;

      return {
        ...plain,
        examId: examIdStr,
        attemptNumber: Number(plain.attemptNumber) >= 1 ? Number(plain.attemptNumber) : 1,
        percentage: derivedPercentage,
      };
    });

    const normalizedResultsDeduped = dedupeExamResultRows(normalizedResults);
    if (normalizedResultsDeduped.length !== normalizedResults.length) {
      console.log(
        `📋 Deduped exam results: ${normalizedResults.length} → ${normalizedResultsDeduped.length} rows for student ${req.userId}`
      );
    }

    console.log(`✅ Found ${results.length} exam results for student ${req.userId}`);
    console.log(`📋 Returning ${normalizedResultsDeduped.length} result rows (after dedupe)`);
    console.log(`📋 Query filter used: { userId: ${userId} }`);

    // Normalize userId on each row for logging only. Do NOT drop rows here: `find({ userId })`
    // already scopes data; comparing with String(userId) vs populated refs produced false
    // mismatches (e.g. "[object Object]") and returned an empty list to the client.
    const expectedUserIdStr = String(userId);
    const toResultUserIdStr = (r) => {
      const v = r?.userId;
      if (v == null || v === '') return '';
      if (typeof v === 'string' || typeof v === 'number') return String(v);
      if (typeof v === 'object') {
        if (v._id != null) return String(v._id);
        if (v.$oid != null) return String(v.$oid);
        if (typeof v.toHexString === 'function') return v.toHexString();
      }
      try {
        const s = v?.toString?.() ?? String(v);
        return s === '[object Object]' ? '' : s;
      } catch {
        return '';
      }
    };
    const mismatched = normalizedResultsDeduped.filter(
      (r) => toResultUserIdStr(r) !== expectedUserIdStr
    );
    if (mismatched.length > 0) {
      console.error(
        `⚠️ WARNING: ${mismatched.length} exam result row(s) have unexpected userId shape vs query; still returning all rows from find({ userId }). Sample:`,
        mismatched.slice(0, 2).map((r) => ({ stored: toResultUserIdStr(r), expected: expectedUserIdStr }))
      );
    }

    // Log first result structure for debugging
    if (normalizedResultsDeduped.length > 0) {
      console.log('📋 Sample result structure:', {
        examId: normalizedResultsDeduped[0].examId,
        userId: normalizedResultsDeduped[0].userId?.toString?.() || String(normalizedResultsDeduped[0].userId),
        examTitle: normalizedResultsDeduped[0].examTitle,
        percentage: normalizedResultsDeduped[0].percentage,
      });
    }
    
    res.json({
      success: true,
      data: normalizedResultsDeduped
    });
  } catch (error) {
    console.error('❌ Error fetching exam results:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch exam results',
      error: error.message 
    });
  }
});

// AI-powered detailed exam analysis for a student's result
router.post('/exam-results/ai-analysis', async (req, res) => {
  try {
    const { result, examTitle } = req.body || {};
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    if (!result || typeof result !== 'object') {
      return res.status(400).json({ success: false, message: 'result payload is required' });
    }

    const examIdRaw = result.examId;
    const examIdStr =
      examIdRaw && typeof examIdRaw === 'object' && examIdRaw._id
        ? String(examIdRaw._id)
        : String(examIdRaw || '');
    if (!examIdStr || !mongoose.Types.ObjectId.isValid(examIdStr)) {
      return res.status(400).json({
        success: false,
        message: 'A valid result.examId is required for the Gemini Performance Report.',
      });
    }
    const examObjectId = new mongoose.Types.ObjectId(examIdStr);

    const ExamResultModel = (await import('../models/ExamResult.js')).default;
    let savedExamResult = null;
    const resultDocId = result._id || result.resultId;
    if (resultDocId && mongoose.Types.ObjectId.isValid(String(resultDocId))) {
      savedExamResult = await ExamResultModel.findOne({
        _id: resultDocId,
        userId: req.userId,
      }).lean();
    }
    if (!savedExamResult && examIdStr) {
      const attemptNum = Number(result.attemptNumber);
      const baseQuery = { userId: req.userId, examId: examIdStr };
      if (Number.isFinite(attemptNum) && attemptNum >= 1) {
        savedExamResult = await ExamResultModel.findOne({
          ...baseQuery,
          attemptNumber: attemptNum,
        }).lean();
      }
      if (!savedExamResult) {
        savedExamResult = await ExamResultModel.findOne(baseQuery)
          .sort({ completedAt: -1 })
          .lean();
      }
    }
    const scoreSource = savedExamResult
      ? {
          correctAnswers: Number(savedExamResult.correctAnswers ?? 0),
          wrongAnswers: Number(savedExamResult.wrongAnswers ?? 0),
          unattempted: Number(savedExamResult.unattempted ?? 0),
          obtainedMarks: Number(savedExamResult.obtainedMarks ?? 0),
          percentage: Number(savedExamResult.percentage ?? 0),
          totalQuestions: Number(savedExamResult.totalQuestions ?? 0),
        }
      : result;

    const cachedReport = await GeminiPerformanceReport.findOne({
      studentId: req.userId,
      examId: examObjectId,
    }).lean();

    if (cachedReport?.fullAnalysis && typeof cachedReport.fullAnalysis === 'object') {
      const cachedAnalysis = { ...cachedReport.fullAnalysis };
      const cachedSummary = String(cachedAnalysis.summary || '');
      let cacheLooksInvalid = false;
      if (
        /live ai could not finish \((expected|unexpected|json|syntaxerror)/i.test(cachedSummary) ||
        /line \d+ column \d+/i.test(cachedSummary)
      ) {
        cachedAnalysis.summary = cachedSummary.replace(
          /Live AI could not finish \([\s\S]*?\)\.\s*/i,
          'Live AI returned an invalid response format, so this report was rebuilt from your attempt data only. '
        );
        cacheLooksInvalid = true;
      }
      const cachedInsights = Array.isArray(cachedAnalysis.questionInsights)
        ? cachedAnalysis.questionInsights
        : [];
      const storedMetaForCache =
        cachedReport.meta && typeof cachedReport.meta === 'object' ? cachedReport.meta : {};
      const cachedSnap = storedMetaForCache.scoreSnapshot;
      const expectedCorrect = Number(scoreSource?.correctAnswers ?? NaN);
      const expectedWrong = Number(scoreSource?.wrongAnswers ?? NaN);
      const expectedUnattempted = Number(scoreSource?.unattempted ?? NaN);
      const expectedMarks = Number(scoreSource?.obtainedMarks ?? NaN);
      const expectedPct = Number(scoreSource?.percentage ?? NaN);

      if (!cachedSnap || typeof cachedSnap !== 'object') {
        cacheLooksInvalid = true;
      } else if (
        Number.isFinite(expectedCorrect) &&
        Number.isFinite(expectedWrong) &&
        Number.isFinite(expectedUnattempted) &&
        (Number(cachedSnap.correctAnswers) !== expectedCorrect ||
          Number(cachedSnap.wrongAnswers) !== expectedWrong ||
          Number(cachedSnap.unattempted) !== expectedUnattempted ||
          (Number.isFinite(expectedMarks) && Number(cachedSnap.obtainedMarks) !== expectedMarks) ||
          (Number.isFinite(expectedPct) && Number(cachedSnap.percentage) !== expectedPct))
      ) {
        cacheLooksInvalid = true;
      }
      if (!Array.isArray(storedMetaForCache.weakTopics) || storedMetaForCache.weakTopics.length === 0) {
        cacheLooksInvalid = true;
      }

      if (cachedInsights.length > 0) {
        const statusCounts = { correct: 0, wrong: 0, unattempted: 0 };
        cachedInsights.forEach((q) => {
          const st = String(q?.status || '').toLowerCase();
          if (st === 'correct') statusCounts.correct += 1;
          else if (st === 'wrong') statusCounts.wrong += 1;
          else statusCounts.unattempted += 1;
        });
        if (
          Number.isFinite(expectedCorrect) &&
          Number.isFinite(expectedWrong) &&
          Number.isFinite(expectedUnattempted) &&
          (statusCounts.correct !== expectedCorrect ||
            statusCounts.wrong !== expectedWrong ||
            statusCounts.unattempted !== expectedUnattempted)
        ) {
          cacheLooksInvalid = true;
        }
      } else if (Number(scoreSource?.totalQuestions ?? result?.totalQuestions) > 0) {
        cacheLooksInvalid = true;
      }
      if (cacheLooksInvalid) {
        console.warn('[exam-results/ai-analysis] Invalid cached analysis detected; regenerating.', {
          studentId: String(req.userId),
          examId: String(examObjectId),
        });
        await GeminiPerformanceReport.deleteOne({ _id: cachedReport._id }).catch((e) => {
          console.warn('[exam-results/ai-analysis] Failed to remove invalid cache:', e?.message || e);
        });
      } else {
      const storedMeta =
        cachedReport.meta && typeof cachedReport.meta === 'object' ? cachedReport.meta : {};
      return res.json({
        success: true,
        data: {
          analysis: cachedAnalysis,
          meta: {
            weakSubjects: Array.isArray(storedMeta.weakSubjects) ? storedMeta.weakSubjects : [],
            weakTopics: Array.isArray(storedMeta.weakTopics) ? storedMeta.weakTopics : [],
            classNumber: String(storedMeta.classNumber || ''),
            board: String(storedMeta.board || ''),
            generatedAt: (cachedReport.createdAt || cachedReport.updatedAt || new Date()).toISOString(),
            cached: true,
          },
        },
      });
      }
    }

    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board')
      .populate('assignedClass', 'classNumber section');
    const studentClassDoc = await resolveStudentClassDoc(student);
    const { subjects: _recSubjects, librarySubjectIds: recLibrarySubjectIds, studentClassNumber: studentClassNumberForRecs, filterContentsForStudentClass } =
      await resolveStudentClassSubjects(student);
    const resolvedBoard = String(student?.board || student?.assignedAdmin?.board || 'ASLI_EXCLUSIVE_SCHOOLS')
      .trim()
      .toUpperCase();
    const classNumber = String(
      studentClassNumberForRecs || student?.classNumber || student?.assignedClass?.classNumber || ''
    ).trim();
    const studentDisplayNameRaw = String(student?.fullName || student?.name || '').trim().split(/\s+/)[0] || '';
    const studentDisplayName =
      studentDisplayNameRaw.length >= 2 && studentDisplayNameRaw.length <= 40 ? studentDisplayNameRaw : '';

    const subjectScore = result.subjectWiseScore && typeof result.subjectWiseScore === 'object'
      ? result.subjectWiseScore
      : {};
    let subjectEntries = Object.entries(subjectScore)
      .map(([subject, score]) => {
        const total = Number(score?.total || 0);
        const correct = Number(score?.correct || 0);
        const marks = Number(score?.marks || 0);
        const percentage = total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;
        return { subject: String(subject).toLowerCase(), total, correct, marks, percentage };
      })
      .filter((x) => x.total > 0);

    let weakSubjects = subjectEntries
      .filter((x) => x.percentage < 70)
      .sort((a, b) => a.percentage - b.percentage)
      .map((x) => x.subject);

    const subjectAliases = {
      maths: ['maths', 'math', 'mathematics'],
      physics: ['physics'],
      chemistry: ['chemistry'],
      biology: ['biology', 'bio'],
    };

    const recommendationSubjects = weakSubjects.length > 0
      ? weakSubjects
      : subjectEntries.slice(0, 2).map((x) => x.subject);

    const weakPatterns = recommendationSubjects.flatMap((subject) =>
      (subjectAliases[subject] || [subject]).map((alias) => ({ name: new RegExp(`^${alias}$`, 'i') }))
    );

    let videoRecommendations = [];
    if (weakPatterns.length > 0) {
      const subjectDocs = await Subject.find({
        isActive: true,
        $and: [
          { $or: weakPatterns },
          { $or: [{ board: resolvedBoard }, { board: { $exists: false } }, { board: null }] },
        ],
      }).select('_id name').lean();

      const subjectIds = subjectDocs.map((s) => s._id).filter(Boolean);
      const subjectNames = subjectDocs.map((s) => String(s.name || '').trim()).filter(Boolean);
      const subjectNameRegex = subjectNames.length > 0
        ? new RegExp(subjectNames.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
        : null;
      const studentAdminId = student?.assignedAdmin?._id || student?.assignedAdmin || null;

      const contentConditions = [];
      if (subjectIds.length > 0) {
        contentConditions.push({ subject: { $in: subjectIds } });
      }
      if (subjectNameRegex) {
        contentConditions.push({ title: { $regex: subjectNameRegex } });
        contentConditions.push({ topic: { $regex: subjectNameRegex } });
      }

      let contentVideos = await Content.find({
        isActive: true,
        type: 'Video',
        ...(contentConditions.length > 0 ? { $or: contentConditions } : {}),
      })
        .populate('subject', 'name')
        .sort({ createdAt: -1 })
        .limit(14)
        .lean();

      if (studentClassNumberForRecs) {
        contentVideos = filterContentsForStudentClass(
          contentVideos,
          studentClassNumberForRecs,
          recLibrarySubjectIds
        );
      }

      const teacherVideoConditions = [];
      if (subjectIds.length > 0) {
        teacherVideoConditions.push({ subjectId: { $in: subjectIds.map((id) => String(id)) } });
      }
      if (subjectNames.length > 0) {
        teacherVideoConditions.push({ subjectId: { $in: subjectNames } });
      }
      if (subjectNameRegex) {
        teacherVideoConditions.push({ title: { $regex: subjectNameRegex } });
        teacherVideoConditions.push({ topic: { $regex: subjectNameRegex } });
      }

      const teacherVideos = await Video.find({
        isPublished: true,
        isActive: true,
        ...(studentAdminId ? { adminId: studentAdminId } : {}),
        ...(teacherVideoConditions.length > 0 ? { $or: teacherVideoConditions } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(14)
        .lean();

      const merged = [
        ...contentVideos.map((v) => ({
          title: v.title || 'Video',
          subject: String(v.subject?.name || ''),
          topic: String(v.topic || ''),
          url: v.fileUrl || (Array.isArray(v.fileUrls) ? v.fileUrls[0] : ''),
          type: 'video',
        })),
        ...teacherVideos.map((v) => ({
          title: v.title || 'Video',
          subject: String(v.subjectId || ''),
          topic: String(v.topic || ''),
          url: v.youtubeUrl || v.videoUrl || '',
          type: 'video',
        })),
      ].filter((v) => !!v.url);

      const dedup = new Map();
      merged.forEach((v) => {
        const key = `${String(v.url).trim()}::${String(v.title).trim()}`;
        if (!dedup.has(key)) dedup.set(key, v);
      });
      videoRecommendations = Array.from(dedup.values()).slice(0, 10);
    }

    const safeResult = {
      examId: examIdStr,
      examTitle: String(examTitle || result.examTitle || ''),
      totalQuestions: Number(result.totalQuestions || 0),
      correctAnswers: Number(result.correctAnswers || 0),
      wrongAnswers: Number(result.wrongAnswers || 0),
      unattempted: Number(result.unattempted || 0),
      totalMarks: Number(result.totalMarks || 0),
      obtainedMarks: Number(result.obtainedMarks || 0),
      percentage: Number(result.percentage || 0),
      timeTaken: Number(result.timeTaken || 0),
      subjectScore: subjectEntries,
      weakSubjects,
      classNumber: classNumber || 'unknown',
      board: resolvedBoard,
    };

    // Prefer saved ExamResult (authoritative grading) over client payload.
    let answerMap = normalizeAnswersMap(result.answers);
    if (savedExamResult) {
      const savedAnswers = normalizeAnswersMap(savedExamResult.answers);
      if (Object.keys(savedAnswers).length > 0) {
        answerMap = savedAnswers;
      }
      safeResult.correctAnswers = Number(savedExamResult.correctAnswers ?? safeResult.correctAnswers);
      safeResult.wrongAnswers = Number(savedExamResult.wrongAnswers ?? safeResult.wrongAnswers);
      safeResult.unattempted = Number(savedExamResult.unattempted ?? safeResult.unattempted);
      safeResult.totalMarks = Number(savedExamResult.totalMarks ?? safeResult.totalMarks);
      safeResult.obtainedMarks = Number(savedExamResult.obtainedMarks ?? safeResult.obtainedMarks);
      safeResult.percentage = Number(savedExamResult.percentage ?? safeResult.percentage);
      safeResult.totalQuestions = Number(savedExamResult.totalQuestions ?? safeResult.totalQuestions);
      safeResult.timeTaken = Number(savedExamResult.timeTaken ?? safeResult.timeTaken);
      const savedSubject =
        savedExamResult.subjectWiseScore instanceof Map
          ? Object.fromEntries(savedExamResult.subjectWiseScore)
          : savedExamResult.subjectWiseScore;
      if (savedSubject && typeof savedSubject === 'object') {
        subjectEntries = subjectEntriesFromWiseScore(savedSubject);
        weakSubjects = subjectEntries
          .filter((x) => x.percentage < 70)
          .sort((a, b) => a.percentage - b.percentage)
          .map((x) => x.subject);
        safeResult.subjectScore = subjectEntries;
        safeResult.weakSubjects = weakSubjects;
      }
    }

    const examQuestions = safeResult.examId ? await loadExamQuestionBankForResults(safeResult.examId) : [];

    const shorten = (value, max = 280) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      return text.length > max ? `${text.slice(0, max - 3)}...` : text;
    };

    const meaningfulChapterLabel = (raw) => {
      const s = String(raw || '').trim();
      if (!s) return '';
      const lower = s.toLowerCase();
      const meaningless = new Set([
        'general',
        'unknown',
        'n/a',
        'na',
        'misc',
        'miscellaneous',
        'chapter',
        'unit',
        'default',
        'other',
        'none',
      ]);
      if (meaningless.has(lower)) return '';
      return s;
    };

    const analyticsByQuestionId = buildAnalyticsByQuestionId(savedExamResult);

    const questionAttemptDetails = examQuestions.map((q, index) => {
      const questionId = String(q._id);
      const userAnswer = lookupUserAnswerFromMap(answerMap, q, index);
      const analyticsRow =
        analyticsByQuestionId.get(questionId) ||
        analyticsByQuestionId.get(`q-${index}`);
      const normalizedCorrect = Array.isArray(q.correctAnswer)
        ? q.correctAnswer.map((item) => extractAnswerText(item))
        : extractAnswerText(q.correctAnswer);
      const normalizedUser = Array.isArray(userAnswer)
        ? userAnswer.map((item) => extractAnswerText(item))
        : extractAnswerText(userAnswer);
      const hasAnswer = !(
        userAnswer === undefined ||
        userAnswer === null ||
        userAnswer === '' ||
        (Array.isArray(userAnswer) && userAnswer.length === 0)
      );
      const isCorrect = analyticsRow
        ? String(analyticsRow.status || '').toLowerCase() === 'correct'
        : isAnswerCorrect(q, userAnswer);
      return {
        index: index + 1,
        questionId,
        subject: String(q.subject || 'general').toLowerCase(),
        chapter: meaningfulChapterLabel(
          String(
            analyticsRow?.chapter ||
              q.chapter ||
              q.topic ||
              q.unit ||
              ''
          ).trim()
        ),
        questionType: q.questionType,
        questionText: shorten(q.questionText || ''),
        hasImage: Boolean(q.questionImage),
        marks: Number(q.marks || 0),
        negativeMarks: Number(q.negativeMarks || 0),
        userAnswer: normalizedUser,
        correctAnswer: normalizedCorrect,
        hasAnswer,
        isCorrect,
        explanation: shorten(q.explanation || '', 180),
      };
    });

    const formatAnswer = (value) => {
      if (Array.isArray(value)) {
        const items = value.map((v) => String(v || '').trim()).filter(Boolean);
        return items.length ? items.join(', ') : 'not answered';
      }
      const text = String(value || '').trim();
      return text || 'not answered';
    };

    const shortConcept = (value) => {
      const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
      if (!cleaned) return 'this concept';
      const words = cleaned.split(' ').slice(0, 8).join(' ');
      return words.length > 70 ? `${words.slice(0, 67)}...` : words;
    };

    const inferTopicFromQuestion = (q) => {
      const chapterOk = meaningfulChapterLabel(q?.chapter);
      if (chapterOk) return chapterOk;

      const text = String(q?.questionText || '')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (!text) return `${q.subject || 'subject'} fundamentals`;

      const topicPatterns = [
        { topic: 'Arithmetic Progression', regex: /\barithmetic progression\b|\ba\.?p\.?\b/ },
        { topic: 'Quadrilateral Properties', regex: /\bquadrilateral\b|\bparallelogram\b|\brhombus\b|\btrapez/ },
        { topic: 'Polygon Angles', regex: /\bpolygon\b|\binterior angles?\b|\bexterior angles?\b/ },
        { topic: 'Ratio and Proportion', regex: /\bratio\b|\bproportion\b/ },
        { topic: 'Linear Equations', regex: /\blinear equation\b|\bsolve for\b|\bequation\b/ },
        { topic: 'Probability', regex: /\bprobability\b|\bchance\b|\boutcome\b/ },
        { topic: 'Motion and Kinematics', regex: /\bmotion\b|\bvelocity\b|\bacceleration\b|\bdisplacement\b/ },
        { topic: 'Electricity and Circuits', regex: /\bohm\b|\bcurrent\b|\bvoltage\b|\bresistance\b|\bcircuit\b/ },
        { topic: 'Hybridization', regex: /\bhybridization\b|\bhybrid orbital\b|\bsp\s*3\b|\bsp\s*2\b|\bsp\s*hybrid\b|\bdsp\s*[23]\b/ },
        { topic: 'Oxidation States', regex: /\boxidation state\b|\boxidation number\b/ },
        {
          topic: 'Molar Mass and Stoichiometry',
          regex: /\bmolar mass\b|\bmolecular mass\b|\bmolarity\b|\bstoichiometry\b|\bmoles?\b|\bmol\b/,
        },
        { topic: 'Acids, Bases and Salts', regex: /\bacid\b|\bbase\b|\bsalt\b|\bph\b/ },
        { topic: 'Carbon Compounds', regex: /\bcarbon\b|\bhydrocarbon\b|\borganic\b/ },
      ];

      const matched = topicPatterns.find((item) => item.regex.test(text));
      if (matched) return matched.topic;

      const stop = new Set([
        'the', 'and', 'that', 'this', 'with', 'from', 'into', 'your', 'which', 'what', 'when', 'where', 'while',
        'likely', 'consequence', 'value', 'find', 'calculate', 'question', 'term', 'first', 'second', 'third',
        'fourth', 'fifth', 'will', 'then', 'than', 'have', 'has', 'for', 'are', 'is', 'was', 'were', 'been',
      ]);
      const keywords = text
        .split(' ')
        .map((x) => x.trim())
        .filter((x) => x.length > 2 && !stop.has(x));
      const compact = keywords.slice(0, 4).join(' ');
      return compact ? compact.replace(/\b\w/g, (c) => c.toUpperCase()) : `${q.subject || 'subject'} fundamentals`;
    };

    const insightStemLead = (q) => {
      const s = shorten(q?.questionText || '', 96);
      return s ? `This item starts: “${s}”. ` : '';
    };

    const insightUnitLead = (q) => {
      const ch = meaningfulChapterLabel(q?.chapter);
      return ch ? `Syllabus unit “${ch}”: ` : '';
    };

    const buildPersonalizedPracticeTask = (q, status) => {
      const topic = inferTopicFromQuestion(q);
      const subject = String(q.subject || 'subject').toLowerCase();
      const type = String(q.questionType || 'mcq').toUpperCase();
      const greet = studentDisplayName ? `${studentDisplayName}, ` : '';

      if (status === 'correct') {
        return `${greet}After this paper, take 2 harder ${subject} ${type}s on “${topic}” (not from memory of Q${q.index}) and write one “rule I used” line per solution.`;
      }
      if (status === 'unattempted') {
        return `${greet}Timed set: four ${subject} ${type}s on “${topic}” (75–90s each), Q${q.index}-style stems first, then mixed; no solutions until all four are attempted.`;
      }
      return `${greet}Redo the reasoning for Q${q.index} on paper, then five ${subject} ${type}s on “${topic}” split 3+2 with a short note after each wrong turn on what fooled you.`;
    };

    const buildGapLine = (q, status) => {
      const topic = inferTopicFromQuestion(q);
      const subject = String(q.subject || 'subject').toLowerCase();
      const type = String(q.questionType || 'mcq').toLowerCase();
      const greet = studentDisplayName ? `${studentDisplayName}, ` : '';
      const stemFrag = insightStemLead(q);
      const unitFrag = insightUnitLead(q);

      if (status === 'correct') {
        return `${greet}${stemFrag}${unitFrag}You got Q${q.index} right—a clean ${subject} ${type} execution on “${topic}” under this exam’s conditions.`;
      }
      if (status === 'unattempted') {
        if (type === 'integer') {
          return `${greet}${stemFrag}${unitFrag}Q${q.index} stayed blank: a numeric “${topic}” ${subject} item—often a formula or setup confidence gap before the first attempt.`;
        }
        if (type === 'multiple') {
          return `${greet}${stemFrag}${unitFrag}Q${q.index} stayed blank on a multi-select “${topic}” ${subject} item—often option-filtering hesitation.`;
        }
        return `${greet}${stemFrag}${unitFrag}Q${q.index} stayed blank on “${topic}” (${subject} ${type})—likely time boxing or first-attempt avoidance.`;
      }
      return `${greet}${stemFrag}${unitFrag}Q${q.index} (“${topic}”, ${subject} ${type})—your working did not match the keyed ${type} path for this stem.`;
    };

    const buildFixStrategyLine = (q, status, explanationLine) => {
      const topic = inferTopicFromQuestion(q);
      const subject = String(q.subject || 'subject').toLowerCase();
      const type = String(q.questionType || 'mcq').toLowerCase();
      const ch = meaningfulChapterLabel(q?.chapter);
      const unitFrag = ch ? `Open notes for “${ch}” plus ` : '';

      if (status === 'correct') {
        return `${unitFrag}stretch with one unseen ${subject} ${type} on “${topic}”: solve cold, then compare your steps to the official method. ${explanationLine}`;
      }
      if (status === 'unattempted') {
        if (type === 'integer') {
          return `${unitFrag}for “${topic}”, use three lines only—given → formula → one calculation—in 75–90s before allowing yourself to skip. ${explanationLine}`;
        }
        if (type === 'multiple') {
          return `${unitFrag}for “${topic}”, eliminate obviously wrong ${subject} options first, then verify the last two against the stem wording. ${explanationLine}`;
        }
        return `${unitFrag}for “${topic}”, force a first-pass commit on Q${q.index}-style stems in 60–90s (keyword → method → option), then review. ${explanationLine}`;
      }
      return `${unitFrag}rewrite Q${q.index} as a numbered step flow (${subject}, ${type}), add one checkpoint where you usually mis-read the stem, then re-check units/signs. ${explanationLine}`;
    };

    const buildDerivedFocusAreas = (attempts) => {
      const grouped = new Map();
      attempts.forEach((q) => {
        if (q.isCorrect) return;
        const subject = String(q.subject || 'general').toLowerCase();
        const topic = inferTopicFromQuestion(q);
        const key = `${subject}::${topic}`;
        if (!grouped.has(key)) {
          grouped.set(key, { subject, topic, count: 0, unattempted: 0, wrong: 0 });
        }
        const row = grouped.get(key);
        row.count += 1;
        if (q.hasAnswer) row.wrong += 1;
        else row.unattempted += 1;
      });

      return Array.from(grouped.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 4)
        .map((x) => ({
          subject: x.subject,
          issue: `Low accuracy/confidence in ${x.topic}${x.unattempted > 0 ? ' (skips detected)' : ''}.`,
          whatToDo: `Run one focused ${x.subject} drill on "${x.topic}" daily and review every wrong/skipped attempt.`,
          priority: x.count >= 2 ? 'high' : 'medium',
        }));
    };

    const buildQuestionInsight = (q) => {
      const status = q.isCorrect
        ? 'correct'
        : q.hasAnswer
          ? 'wrong'
          : 'unattempted';
      const userAnswerText = formatAnswer(q.userAnswer);
      const correctAnswerText = formatAnswer(q.correctAnswer);
      const concept = shortConcept(q.questionText);
      const explanationHint = String(q.explanation || '').trim();
      const explanationLine = explanationHint
        ? `Review explanation hint: "${explanationHint}".`
        : 'Use the provided solution/explanation to build your correction notes.';

      if (status === 'correct') {
        return {
          index: q.index,
          questionId: q.questionId,
          subject: q.subject || 'general',
          questionType: q.questionType || 'mcq',
          status,
          conceptGap: buildGapLine(q, status),
          fixStrategy: buildFixStrategyLine(q, status, explanationLine),
          practiceTask: buildPersonalizedPracticeTask(q, status),
          priority: 'low',
        };
      }

      if (status === 'unattempted') {
        return {
          index: q.index,
          questionId: q.questionId,
          subject: q.subject || 'general',
          questionType: q.questionType || 'mcq',
          status,
          conceptGap: buildGapLine(q, status),
          fixStrategy: buildFixStrategyLine(q, status, explanationLine),
          practiceTask: buildPersonalizedPracticeTask(q, status),
          priority: 'medium',
        };
      }

      return {
        index: q.index,
        questionId: q.questionId,
        subject: q.subject || 'general',
        questionType: q.questionType || 'mcq',
        status,
        conceptGap: `${buildGapLine(q, status)} Selected "${userAnswerText}" but expected "${correctAnswerText}".`,
        fixStrategy: buildFixStrategyLine(q, status, explanationLine),
        practiceTask: buildPersonalizedPracticeTask(q, status),
        priority: 'high',
      };
    };

    const fallbackQuestionInsights = questionAttemptDetails.map(buildQuestionInsight);

    // Only re-grade when there is no saved ExamResult — saved rows are authoritative.
    if (examQuestions.length > 0 && !savedExamResult) {
      const graded = gradeExamAttemptFromBank(examQuestions, answerMap);
      safeResult.correctAnswers = graded.correctAnswers;
      safeResult.wrongAnswers = graded.wrongAnswers;
      safeResult.unattempted = graded.unattempted;
      safeResult.totalMarks = graded.totalMarks;
      safeResult.obtainedMarks = graded.obtainedMarks;
      safeResult.totalQuestions = graded.totalQuestions;
      safeResult.percentage = graded.percentage;
      subjectEntries = subjectEntriesFromWiseScore(graded.subjectWiseScore);
      weakSubjects = subjectEntries
        .filter((x) => x.percentage < 70)
        .sort((a, b) => a.percentage - b.percentage)
        .map((x) => x.subject);
      safeResult.subjectScore = subjectEntries;
      safeResult.weakSubjects = weakSubjects;
    }

    const weakTopicsList = (() => {
      const grouped = new Map();
      questionAttemptDetails.forEach((q) => {
        if (q.isCorrect) return;
        const subject = String(q.subject || 'general').toLowerCase();
        const topic =
          meaningfulChapterLabel(String(q.chapter || '').trim()) ||
          inferTopicFromQuestion(q);
        const topicNorm = normalizeTopicLabel(topic);
        if (!topicNorm) return;
        const key = `${subject}::${topicNorm}`;
        if (!grouped.has(key)) {
          grouped.set(key, { subject, topic, count: 0 });
        }
        grouped.get(key).count += 1;
      });
      return Array.from(grouped.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map(({ subject, topic }) => ({ subject, topic }));
    })();

    const formatExamClock = (seconds) => {
      const s = Number(seconds) || 0;
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const r = s % 60;
      return h > 0 ? `${h}h ${m}m ${r}s` : `${m}m ${r}s`;
    };

    /** Rich analysis without LLM — uses scores, subject split, skips vs wrongs, time, topic clusters */
    const buildDeepOfflineExamAnalysis = (reasonNote = '') => {
      const attempted = (safeResult.correctAnswers || 0) + (safeResult.wrongAnswers || 0);
      const totalQ =
        Number(safeResult.totalQuestions) || attempted + (safeResult.unattempted || 0) || 1;
      const pct = Number(safeResult.percentage || 0);
      const skipRate = totalQ > 0 ? ((safeResult.unattempted || 0) / totalQ) * 100 : 0;
      const wrongRate = totalQ > 0 ? ((safeResult.wrongAnswers || 0) / totalQ) * 100 : 0;
      const completionPct = totalQ > 0 ? (attempted / totalQ) * 100 : 0;
      const acc = attempted > 0 ? ((safeResult.correctAnswers || 0) / attempted) * 100 : 0;
      const avgSecPerPaperQ = totalQ > 0 ? Math.round((safeResult.timeTaken || 0) / totalQ) : 0;
      const avgSecPerAttempted =
        attempted > 0 ? Math.round((safeResult.timeTaken || 0) / attempted) : 0;
      const paceSec =
        avgSecPerAttempted > 0 ? avgSecPerAttempted : avgSecPerPaperQ > 0 ? avgSecPerPaperQ : 0;

      const topicBuckets = new Map();
      questionAttemptDetails.forEach((q) => {
        if (q.isCorrect) return;
        const topic = inferTopicFromQuestion(q);
        const key = `${String(q.subject || 'general').toLowerCase()} — ${topic}`;
        topicBuckets.set(key, (topicBuckets.get(key) || 0) + 1);
      });
      const topGaps = [...topicBuckets.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

      const subjectBreakdown = subjectEntries.length
        ? subjectEntries
            .map((s) => {
              const label = String(s.subject || '').charAt(0).toUpperCase() + String(s.subject || '').slice(1);
              return `${label}: ${s.correct}/${s.total} correct (${s.percentage}%), ${s.marks} marks`;
            })
            .join(' · ')
        : 'Subject split not available for this result payload.';

      const pacingHint =
        paceSec <= 0
          ? ''
          : paceSec < 40
            ? 'Time per question you actually attempted looks quite low—check for rushing; use a minimum thinking budget (about 60–90s) before locking an option on similar stems.'
            : paceSec > 150
              ? 'Time per attempted question looks high—practice marking rough items and returning, and cap first-pass time so you touch more items.'
              : 'Pacing on attempted questions looks moderate—pair it with fewer skips to lift overall score.';

      const skipInsight =
        skipRate >= 25
          ? `Skipping ${skipRate.toFixed(1)}% of the paper is a major score cap. Treat every skip like a wrong answer: schedule a 20‑minute block to solve only skipped topics before the next mock.`
          : skipRate >= 12
            ? `Skip rate is ${skipRate.toFixed(1)}%—not extreme, but each skip is lost opportunity; aim to attempt first, then mark for review.`
            : `Skip rate is ${skipRate.toFixed(1)}%—good attempt coverage; focus accuracy on wrong answers.`;

      const wrongInsight =
        wrongRate >= 35
          ? `Wrong answers account for ${wrongRate.toFixed(1)}% of the paper—prioritize error log: for each wrong, write one line on the concept trap and one correct rule.`
          : `Wrong answers: ${safeResult.wrongAnswers}—pair each with its explanation and redo without looking, then one variation question.`;

      const gapLines =
        topGaps.length > 0
          ? `Concept pressure points (wrong or skipped, grouped): ${topGaps.map(([k, c]) => `${k} (${c})`).join('; ')}.`
          : 'No per-question detail was available to cluster topics—use subject cards and the question list below.';

      const introNote = reasonNote ? `${String(reasonNote).trim()}\n\n` : '';

      const greetLead = studentDisplayName ? `${studentDisplayName}, ` : '';
      const scoreYou = studentDisplayName ? 'you' : 'You';
      const timeLineExtra =
        attempted < totalQ && paceSec > 0 && avgSecPerPaperQ > 0
          ? ` (~${paceSec}s average on ${attempted} questions you attempted; ~${avgSecPerPaperQ}s if time is spread across all ${totalQ})`
          : paceSec > 0
            ? ` (~${paceSec}s per question on average)`
            : '';
      const marksPct =
        (safeResult.totalMarks || 0) > 0
          ? ((safeResult.obtainedMarks || 0) / (safeResult.totalMarks || 1)) * 100
          : pct;
      const summary = [
        `${introNote}${greetLead}${scoreYou} scored ${safeResult.obtainedMarks} / ${safeResult.totalMarks} marks on this attempt (${marksPct.toFixed(1)}% of total marks).`,
        `Attempt pattern: ${attempted} of ${totalQ} questions touched (${completionPct.toFixed(1)}% completion): ${safeResult.correctAnswers} correct, ${safeResult.wrongAnswers} wrong, ${safeResult.unattempted} skipped.`,
        `When you did attempt a question, accuracy was ${acc.toFixed(1)}% (${safeResult.correctAnswers} correct out of ${attempted} attempted). That means ${
          acc < 50
            ? 'most of your losses are conceptual or reading errors—slow down on stems and verify units/conditions.'
            : acc < 75
              ? 'you have a workable hit rate but inconsistent reasoning—drill mixed sets on weak chapters.'
              : 'your reasoning is often sound—reduce skips and careless slips to convert attempts into marks.'
        }`,
        `Subject snapshot: ${subjectBreakdown}`,
        skipInsight,
        wrongInsight,
        gapLines,
        `Time: ${formatExamClock(safeResult.timeTaken || 0)} total${timeLineExtra}. ${pacingHint}`,
        'Use the per-question cards below for gap/fix/practice lines. Repeat this exam blueprint weekly: revise → short drill → timed mixed set.',
      ]
        .filter(Boolean)
        .join('\n\n');

      const strongSubs = subjectEntries.filter((s) => s.percentage >= 72);
      const strengths =
        strongSubs.length > 0
          ? strongSubs.map(
              (s) =>
                `${String(s.subject).charAt(0).toUpperCase() + String(s.subject).slice(1)} at ${s.percentage}% accuracy (${s.correct}/${s.total})—use as confidence anchor while fixing weaker areas.`,
            )
          : pct >= 55
            ? ['Solid overall percentage—tighten weak topics and completion to move into the next band.']
            : [
                'You generated a full attempt record—treat this as a precise diagnostic: every number below is actionable.',
                attempted > 0
                  ? `You still converted ${safeResult.correctAnswers} items correctly—protect that habit while expanding coverage.`
                  : null,
              ].filter(Boolean);

      const rootCauses = [
        skipRate >= 18 &&
          `High incomplete rate (${skipRate.toFixed(1)}% skipped)—often topic gaps, time boxing, or exam anxiety.`,
        safeResult.wrongAnswers > 0 &&
          `${safeResult.wrongAnswers} incorrect responses—review whether errors are conceptual, calculation, or option-reading.`,
        weakSubjects.length > 0 &&
          `Relative weakness in: ${weakSubjects.join(', ')}—needs targeted revision plus spaced repetition.`,
        acc < 60 && attempted > 0 && `Low accuracy (${acc.toFixed(1)}%) on attempted items—quality of attempts needs focus over speed.`,
        completionPct < 85 && `Completion at ${completionPct.toFixed(1)}%—leaving items blank caps score before accuracy can help.`,
      ].filter(Boolean);

      const riskScore = Math.min(
        0.95,
        Math.max(
          0.12,
          (weakSubjects.length >= 2 ? 0.32 : weakSubjects.length === 1 ? 0.2 : 0.1) +
            (skipRate / 100) * 0.38 +
            (wrongRate / 100) * 0.22 +
            (pct < 35 ? 0.18 : pct < 50 ? 0.08 : 0),
        ),
      );
      const riskLevel = riskScore >= 0.62 ? 'high' : riskScore >= 0.38 ? 'medium' : 'low';

      const nextPred = Math.max(28, Math.min(92, Math.round(pct + (100 - completionPct) * 0.12 + (72 - acc) * 0.08)));

      const derivedFocus = buildDerivedFocusAreas(questionAttemptDetails);

      return {
        riskLevel,
        riskScore,
        riskScoreMethod: 'rule-based',
        riskScoreMethodLabel: 'Calculated from your weak subjects, skip-rate and accuracy on this attempt — not a predicted future grade.',
        summary,
        strengths,
        rootCauses: rootCauses.length ? rootCauses : ['Mixed performance across the paper—use question-level insights to prioritize.'],
        predictions: {
          nextExamPrediction: nextPred,
          confidence: 0.55,
          confidenceMethod: 'rule-based',
          confidenceMethodLabel: 'A rule-based estimate from your last attempt, not a model-trained prediction.',
          trend: pct >= 60 ? 'stable' : 'improving',
        },
        interventions: [
          {
            priority: 'high',
            action: 'Error log + redo loop',
            reasoning: `You have ${safeResult.wrongAnswers} wrong and ${safeResult.unattempted} skipped—each needs a written fix and one redo.`,
            expectedImpact: 'Students who run a daily error-log + redo loop on AsliLearn typically report 8–18% score lifts in 2–3 weeks. Your result will depend on consistency.',
            impactSource: 'observed-trend',
          },
          {
            priority: 'high',
            action: 'Topic cluster drill',
            reasoning:
              topGaps.length > 0
                ? `Focus first on: ${topGaps.slice(0, 2).map(([k]) => k).join('; ')}.`
                : 'Use subject weak areas from the breakdown above.',
            expectedImpact: 'Tends to clear recurring wrong patterns before the next mock when done over 2 weeks.',
            impactSource: 'qualitative',
          },
          {
            priority: 'medium',
            action: 'Timed mixed mini-mock',
            reasoning: `Rebuild stamina at ~${paceSec > 0 ? Math.min(120, Math.max(45, paceSec)) : 75}s per attempted question with ${Math.min(15, totalQ)} mixed items.`,
            expectedImpact: 'Helps lift completion without collapsing accuracy.',
            impactSource: 'qualitative',
          },
          {
            priority: 'medium',
            action: 'Video + practice pairing',
            reasoning: 'Watch one short concept video, then solve 8–12 questions on the same idea the same day.',
            expectedImpact: 'Pairing typically transfers concepts faster than passive revision.',
            impactSource: 'qualitative',
          },
        ],
        methodologyNote:
          'Risk Score and Next Score are estimates from your last exam attempt only, using a rule-based formula. They are not predictions trained on millions of students. Use them as a guide, not a guarantee.',
        focusAreas: derivedFocus.length ? derivedFocus : weakSubjects.map((subject) => ({
          subject,
          issue: 'Lower performance in this subject block',
          whatToDo: 'Revise core theory, then 20 mixed questions with review of every mistake.',
          priority: 'high',
        })),
        actionPlan: {
          today: [
            `List top ${Math.min(5, topGaps.length || 3)} gap topics from wrong/skipped questions and watch one refresher each.`,
            `Redo ${Math.min(5, safeResult.wrongAnswers || 3)} wrong questions without notes, then check answers.`,
            'Note time taken per question on redos to calibrate pacing.',
          ],
          thisWeek: [
            `Three sessions × 30–40 min: mixed questions with ≥${Math.min(20, totalQ)} items focusing on weak subjects.`,
            'One full timed section at exam pace; mark uncertain items and return only if time permits.',
            'Maintain a one-page formula / concept sheet for weakest subject only.',
          ],
          beforeNextExam: [
            'One full mock under exam rules; score and rebuild a 1-page “mistake themes” list.',
            'Sleep and light review only on the last day—no new heavy topics.',
            'Revisit only the top 10 error themes from this attempt.',
          ],
        },
        recommendedAiTools: [
          {
            toolType: 'smart-qa-practice-generator',
            why: 'Targets weak topics with fresh questions.',
            howToUse: 'Pick your weakest subject and generate 15–20 items after each revision block.',
          },
          {
            toolType: 'concept-breakdown-explainer',
            why: 'Rebuild theory where wrong/skipped clusters appear.',
            howToUse: 'Run it on each top gap topic from the list above.',
          },
          {
            toolType: 'personalized-revision-planner',
            why: 'Spreads revision across days instead of cramming.',
            howToUse: 'Set plan for 7 days leading to next test.',
          },
        ],
        videoRecommendations,
        questionInsights: fallbackQuestionInsights,
        motivation:
          'Deep, consistent practice beats intensity spikes—small daily wins compound into a much stronger next attempt.',
      };
    };

    // Always use offline analysis — no external AI call
    let aiParsed = buildDeepOfflineExamAnalysis('');
    const geminiRawResponse = '';

    if (!aiParsed || typeof aiParsed !== 'object') {
      aiParsed = {};
    }
    if (!['high', 'medium', 'low'].includes(String(aiParsed.riskLevel || '').toLowerCase())) {
      aiParsed.riskLevel = weakSubjects.length >= 2 ? 'high' : weakSubjects.length === 1 ? 'medium' : 'low';
    }
    if (!Number.isFinite(Number(aiParsed.riskScore))) {
      aiParsed.riskScore = weakSubjects.length >= 2 ? 0.72 : weakSubjects.length === 1 ? 0.5 : 0.28;
    } else {
      aiParsed.riskScore = Math.max(0, Math.min(1, Number(aiParsed.riskScore)));
    }
    if (!aiParsed.predictions || typeof aiParsed.predictions !== 'object') {
      aiParsed.predictions = {
        nextExamPrediction: Math.max(25, Math.min(95, Math.round(Number(safeResult.percentage || 0) + 8))),
        confidence: 0.62,
        confidenceMethod: 'rule-based',
        confidenceMethodLabel: 'A rule-based estimate from your last attempt, not a model-trained prediction.',
        trend: 'stable',
      };
    } else if (!aiParsed.predictions.confidenceMethod) {
      aiParsed.predictions.confidenceMethod = 'model-based';
      aiParsed.predictions.confidenceMethodLabel = 'AI-generated estimate based on your performance patterns; not trained on a large student dataset.';
    }
    if (!aiParsed.riskScoreMethod) {
      aiParsed.riskScoreMethod = 'model-based';
      aiParsed.riskScoreMethodLabel = 'AI-generated estimate based on your performance patterns; intended as a guide, not a guarantee.';
    }
    if (!aiParsed.methodologyNote) {
      aiParsed.methodologyNote =
        'Risk Score, Next Score and impact figures are estimates from your last exam attempt and AI analysis. They are guides, not guarantees, and will improve as more attempts are recorded.';
    }
    if (!Array.isArray(aiParsed.rootCauses)) {
      aiParsed.rootCauses = [
        'Inconsistent subject performance across this exam',
        'Concept-level mistakes in weak questions',
        'Time/decision pressure on hard questions',
      ];
    }
    if (!Array.isArray(aiParsed.interventions)) {
      aiParsed.interventions = [
        {
          priority: 'high',
          action: 'Daily weak-topic correction loop',
          reasoning: 'Addresses repeated mistakes and improves consistency.',
          expectedImpact: 'Improved exam score trajectory over upcoming attempts.',
        },
      ];
    }
    if (!aiParsed.actionPlan || typeof aiParsed.actionPlan !== 'object') {
      aiParsed.actionPlan = {
        today: ['Review your top 3 mistakes and rewrite the correct method.'],
        thisWeek: ['Practice weak-topic questions daily and revise key formulas.'],
        beforeNextExam: ['Take one timed mock and analyze every incorrect question.'],
      };
    }

    const derivedFocusAreas = buildDerivedFocusAreas(questionAttemptDetails);
    if (!Array.isArray(aiParsed.focusAreas) || aiParsed.focusAreas.length === 0) {
      aiParsed.focusAreas = derivedFocusAreas;
    } else {
      const cleanedFocusAreas = aiParsed.focusAreas
        .map((item) => ({
          subject: String(item?.subject || '').toLowerCase() || 'general',
          issue: String(item?.issue || '').trim(),
          whatToDo: String(item?.whatToDo || '').trim(),
          priority: ['high', 'medium', 'low'].includes(String(item?.priority || '').toLowerCase())
            ? String(item.priority).toLowerCase()
            : 'medium',
        }))
        .filter((item) => item.issue || item.whatToDo);

      const mostlyGeneric =
        cleanedFocusAreas.length === 0 ||
        cleanedFocusAreas.every((item) => {
          const blob = `${item.subject} ${item.issue} ${item.whatToDo}`.toLowerCase();
          return item.subject === 'general' || blob.includes('general') || blob.includes('this topic');
        });

      aiParsed.focusAreas = mostlyGeneric ? derivedFocusAreas : cleanedFocusAreas;
    }

    if (!Array.isArray(aiParsed.videoRecommendations) || aiParsed.videoRecommendations.length === 0) {
      aiParsed.videoRecommendations = videoRecommendations.slice(0, 8).map((v) => ({
        ...v,
        why: `Recommended to improve ${v.subject || 'this'} understanding.`,
      }));
    }
    const genericPatterns = [
      /concept application or option selection error/i,
      /question skipped due to low confidence or time pressure/i,
      /solved correctly; preserve this approach/i,
      /re-solve step by step and note the concept trigger/i,
      /practice 5 targeted questions from this concept/i,
      /practice 2 similar questions/i,
    ];
    const isTooGeneric = (item = {}) => {
      const combined = `${item.conceptGap || ''} ${item.fixStrategy || ''} ${item.practiceTask || ''}`.trim();
      if (!combined) return true;
      if (/chapter\s*['"]general['"]|for chapter\s*['"]general['"]|syllabus unit\s*['"]general['"]/i.test(combined)) {
        return true;
      }
      return genericPatterns.some((pattern) => pattern.test(combined));
    };

    const aiInsights = Array.isArray(aiParsed.questionInsights) ? aiParsed.questionInsights : [];
    if (aiInsights.length === 0) {
      aiParsed.questionInsights = fallbackQuestionInsights;
    } else {
      const aiByKey = new Map();
      aiInsights.forEach((item, idx) => {
        const key = item?.questionId ? `id:${String(item.questionId)}` : `idx:${Number(item?.index || idx + 1)}`;
        aiByKey.set(key, item || {});
      });

      aiParsed.questionInsights = questionAttemptDetails.map((q) => {
        const fallback = buildQuestionInsight(q);
        const aiItem =
          aiByKey.get(`id:${q.questionId}`) ||
          aiByKey.get(`idx:${q.index}`) ||
          {};

        if (isTooGeneric(aiItem)) {
          return fallback;
        }

        return {
          ...fallback,
          ...aiItem,
          index: q.index,
          questionId: q.questionId,
          subject: q.subject || aiItem.subject || 'general',
          questionType: q.questionType || aiItem.questionType || 'mcq',
          // Keep factual status from saved result (avoid model status hallucinations).
          status: fallback.status,
          conceptGap: String(aiItem.conceptGap || fallback.conceptGap),
          fixStrategy: String(aiItem.fixStrategy || fallback.fixStrategy),
          practiceTask: String(aiItem.practiceTask || fallback.practiceTask),
          priority: ['high', 'medium', 'low'].includes(String(aiItem.priority || '').toLowerCase())
            ? String(aiItem.priority).toLowerCase()
            : fallback.priority,
        };
      });
    }

    const persistMeta = {
      weakSubjects,
      weakTopics: weakTopicsList,
      classNumber: classNumber || 'unknown',
      board: resolvedBoard,
      scoreSnapshot: {
        correctAnswers: safeResult.correctAnswers,
        wrongAnswers: safeResult.wrongAnswers,
        unattempted: safeResult.unattempted,
        obtainedMarks: safeResult.obtainedMarks,
        percentage: safeResult.percentage,
      },
    };
    const attemptedQs = (safeResult.correctAnswers || 0) + (safeResult.wrongAnswers || 0);
    const totalQForPace = Number(safeResult.totalQuestions) || 0;
    const avgSecPerPaperQPersist =
      totalQForPace > 0 ? Math.round((safeResult.timeTaken || 0) / totalQForPace) : 0;
    const avgSecPerAttemptedPersist =
      attemptedQs > 0 ? Math.round((safeResult.timeTaken || 0) / attemptedQs) : 0;
    const paceSecPersist =
      avgSecPerAttemptedPersist > 0 ? avgSecPerAttemptedPersist : avgSecPerPaperQPersist;
    const paceNote =
      paceSecPersist <= 0
        ? 'Pacing could not be inferred from timing data.'
        : attemptedQs > 0 && attemptedQs < totalQForPace && avgSecPerPaperQPersist > 0
          ? paceSecPersist < 40
            ? `Very fast pace on questions you attempted (~${paceSecPersist}s each); ~${avgSecPerPaperQPersist}s if clock time is averaged across all ${totalQForPace} items—watch for rushing on attempts.`
            : paceSecPersist > 150
              ? `Slow pace on attempted items (~${paceSecPersist}s each); paper-wide average ~${avgSecPerPaperQPersist}s—practice time-boxing and touching more items first.`
              : `Moderate pace on attempts (~${paceSecPersist}s each); paper-wide ~${avgSecPerPaperQPersist}s—balance speed with fewer skips.`
          : paceSecPersist < 40
            ? 'Very fast average pace on attempts—check for rushing versus intentional speed.'
            : paceSecPersist > 150
              ? 'Slow average pace—practice time-boxing and attempt-more-first strategy.'
              : 'Moderate average pace—balance with accuracy goals.';

    const reportPayload = {
      studentId: req.userId,
      examId: examObjectId,
      examName: String(examTitle || safeResult.examTitle || '').trim(),
      totalQuestions: safeResult.totalQuestions,
      attemptedQuestions: attemptedQs,
      correctAnswers: safeResult.correctAnswers,
      wrongAnswers: safeResult.wrongAnswers,
      unattempted: safeResult.unattempted,
      totalMarks: safeResult.totalMarks,
      obtainedMarks: safeResult.obtainedMarks,
      percentage: safeResult.percentage,
      overallSummary: String(aiParsed.summary || ''),
      subjectAnalysis: {
        breakdown: safeResult.subjectScore,
        videoRecommendations: aiParsed.videoRecommendations,
      },
      weakAreas: Array.isArray(aiParsed.focusAreas) ? aiParsed.focusAreas : [],
      strongAreas: Array.isArray(aiParsed.strengths) ? aiParsed.strengths : [],
      conceptualGaps: {
        rootCauses: aiParsed.rootCauses,
        focusAreas: aiParsed.focusAreas,
      },
      recommendations: Array.isArray(aiParsed.interventions) ? aiParsed.interventions : [],
      timeManagementInsights: {
        totalTimeSeconds: safeResult.timeTaken || 0,
        avgSecondsPerQuestion: paceSecPersist,
        note: paceNote,
      },
      nextExamStrategy: {
        predictions: aiParsed.predictions,
        actionPlan: aiParsed.actionPlan,
        recommendedAiTools: aiParsed.recommendedAiTools,
      },
      finalSummary: String(aiParsed.motivation || ''),
      geminiRawResponse: geminiRawResponse.slice(0, 500000),
      fullAnalysis: aiParsed,
      meta: persistMeta,
      generatedBy: 'offline',
    };

    const concurrent = await GeminiPerformanceReport.findOne({
      studentId: req.userId,
      examId: examObjectId,
    }).lean();
    if (concurrent?.fullAnalysis && typeof concurrent.fullAnalysis === 'object') {
      const sm = concurrent.meta && typeof concurrent.meta === 'object' ? concurrent.meta : {};
      return res.json({
        success: true,
        data: {
          analysis: concurrent.fullAnalysis,
          meta: {
            weakSubjects: Array.isArray(sm.weakSubjects) ? sm.weakSubjects : [],
            weakTopics: Array.isArray(sm.weakTopics) ? sm.weakTopics : [],
            classNumber: String(sm.classNumber || ''),
            board: String(sm.board || ''),
            generatedAt: (concurrent.createdAt || concurrent.updatedAt || new Date()).toISOString(),
            cached: true,
          },
        },
      });
    }

    try {
      await GeminiPerformanceReport.create(reportPayload);
    } catch (persistErr) {
      if (persistErr?.code === 11000) {
        const winner = await GeminiPerformanceReport.findOne({
          studentId: req.userId,
          examId: examObjectId,
        }).lean();
        if (winner?.fullAnalysis) {
          const wm = winner.meta && typeof winner.meta === 'object' ? winner.meta : {};
          return res.json({
            success: true,
            data: {
              analysis: winner.fullAnalysis,
              meta: {
                weakSubjects: Array.isArray(wm.weakSubjects) ? wm.weakSubjects : [],
                weakTopics: Array.isArray(wm.weakTopics) ? wm.weakTopics : [],
                classNumber: String(wm.classNumber || ''),
                board: String(wm.board || ''),
                generatedAt: (winner.createdAt || winner.updatedAt || new Date()).toISOString(),
                cached: true,
              },
            },
          });
        }
      }
      console.error('[exam-results/ai-analysis] Failed to persist report:', persistErr);
    }

    res.json({
      success: true,
      data: {
        analysis: aiParsed,
        meta: {
          generatedAt: new Date().toISOString(),
          weakSubjects,
          weakTopics: weakTopicsList,
          classNumber,
          board: resolvedBoard,
          cached: false,
        },
      },
    });
  } catch (error) {
    console.error('AI exam analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate AI exam analysis',
      error: error.message,
    });
  }
});

// Get full review payload for an attempted exam (includes correct answers).
router.get('/exam-results/:examId/review', async (req, res) => {
  try {
    const { examId } = req.params;
    const resultId = req.query?.resultId ? String(req.query.resultId).trim() : '';
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    if (!examId) {
      return res.status(400).json({ success: false, message: 'examId is required' });
    }

    const mongooseLib = (await import('mongoose')).default;
    const ExamResult = (await import('../models/ExamResult.js')).default;
    let latestResult = null;

    if (resultId && mongooseLib.Types.ObjectId.isValid(resultId)) {
      latestResult = await ExamResult.findOne({
        _id: resultId,
        userId: req.userId,
        examId,
      }).lean();
    }
    if (!latestResult) {
      latestResult = await ExamResult.findOne({
        userId: req.userId,
        examId,
      })
        .sort({ completedAt: -1, updatedAt: -1, createdAt: -1 })
        .lean();
    }

    if (!latestResult) {
      return res.status(404).json({ success: false, message: 'No attempted result found for this exam' });
    }

    const examDoc = await Exam.findById(examId).lean();
    const questions = await loadExamQuestionBankForResults(examId);

    return res.json({
      success: true,
      data: {
        result: toPlainExamResultForApi(latestResult),
        exam: examDoc
          ? {
              _id: examDoc._id,
              title: examDoc.title,
              totalQuestions: examDoc.totalQuestions,
              totalMarks: examDoc.totalMarks,
            }
          : null,
        questions,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching exam review payload:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch exam review payload',
      error: error.message,
    });
  }
});

// Extract the comparable text of a stored correctAnswer value, handling the
// legacy shapes we've seen in the DB: plain string, number, option-object
// `{ text }`, or `{ label }`.
function extractAnswerText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    return String(value.text ?? value.label ?? value._id ?? '');
  }
  return String(value);
}

function buildOptionMeta(question) {
  const options = Array.isArray(question?.options) ? question.options : [];
  return options.map((opt, index) => {
    const text = extractAnswerText(opt).trim();
    const textNorm = text.toLowerCase();
    const id = String(opt?._id || '').trim();
    return {
      index,
      letter: String.fromCharCode(65 + index),
      text,
      textNorm,
      id,
    };
  });
}

function resolveAnswerToken(question, value) {
  const raw = extractAnswerText(value).trim();
  if (!raw) return '';
  const rawNorm = raw.toLowerCase();

  if (question?.questionType === 'integer') {
    return rawNorm;
  }

  const optionMeta = buildOptionMeta(question);
  if (!optionMeta.length) return rawNorm;

  // Numeric answer token: support both 0-based and 1-based legacy formats.
  if (/^-?\d+$/.test(rawNorm)) {
    const n = parseInt(rawNorm, 10);
    if (n >= 0 && n < optionMeta.length) return optionMeta[n].textNorm;
    if (n >= 1 && n <= optionMeta.length) return optionMeta[n - 1].textNorm;
  }

  // Letter token: A/B/C/D.
  if (/^[a-z]$/i.test(rawNorm)) {
    const byLetter = optionMeta.find((o) => o.letter.toLowerCase() === rawNorm);
    if (byLetter) return byLetter.textNorm;
  }

  // Option-A / option1 style token.
  const optionMatch = rawNorm.match(/^option\s*([a-z0-9])$/);
  if (optionMatch) {
    const token = optionMatch[1];
    if (/^\d$/.test(token)) {
      const n = parseInt(token, 10);
      if (n >= 1 && n <= optionMeta.length) return optionMeta[n - 1].textNorm;
      if (n >= 0 && n < optionMeta.length) return optionMeta[n].textNorm;
    }
    if (/^[a-z]$/.test(token)) {
      const byLetter = optionMeta.find((o) => o.letter.toLowerCase() === token);
      if (byLetter) return byLetter.textNorm;
    }
  }

  // Match by option id.
  const byId = optionMeta.find((o) => o.id && o.id === raw);
  if (byId) return byId.textNorm;

  // Match by normalized option text.
  const byText = optionMeta.find((o) => o.textNorm && o.textNorm === rawNorm);
  if (byText) return byText.textNorm;

  return rawNorm;
}

function resolveAnswerList(question, value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => resolveAnswerToken(question, item))
    .filter(Boolean);
}

function normalizeAnswersMap(answers) {
  if (!answers) return {};
  if (answers instanceof Map) {
    return Object.fromEntries(Array.from(answers.entries()).map(([k, v]) => [String(k), v]));
  }
  if (typeof answers === 'object' && !Array.isArray(answers)) {
    return Object.fromEntries(Object.entries(answers).map(([k, v]) => [String(k), v]));
  }
  return {};
}

/** Resolve stored answer for a question (handles _id / index / legacy key shapes). */
function lookupUserAnswerFromMap(answerMap, question, index) {
  const map = answerMap && typeof answerMap === 'object' ? answerMap : {};
  const id = String(question?._id ?? '').trim();
  const candidates = [
    id,
    id ? id.toLowerCase() : '',
    `q-${index}`,
    String(index),
    String(index + 1),
    question?.id != null ? String(question.id) : '',
  ].filter(Boolean);
  for (const key of candidates) {
    if (map[key] !== undefined && map[key] !== null && map[key] !== '') {
      return map[key];
    }
  }
  return undefined;
}

function buildAnalyticsByQuestionId(savedExamResult) {
  const byId = new Map();
  if (!savedExamResult || !Array.isArray(savedExamResult.questionAnalytics)) {
    return byId;
  }
  savedExamResult.questionAnalytics.forEach((row, idx) => {
    const qid = String(row?.questionId || `q-${idx}`).trim();
    if (qid) byId.set(qid, row);
    byId.set(`q-${idx}`, row);
    if (Number.isFinite(Number(row?.index))) {
      byId.set(`q-${Number(row.index)}`, row);
    }
  });
  return byId;
}

function subjectEntriesFromWiseScore(subjectWiseScore) {
  return Object.entries(subjectWiseScore || {})
    .map(([subject, score]) => {
      const total = Number(score?.total || 0);
      const correct = Number(score?.correct || 0);
      const marks = Number(score?.marks || 0);
      const percentage = total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;
      return { subject: String(subject).toLowerCase(), total, correct, marks, percentage };
    })
    .filter((x) => x.total > 0);
}

/** Server-side grading for analysis — matches POST /exam-results logic. */
function gradeExamAttemptFromBank(questions, answerMap) {
  const subjectWiseScore = {
    maths: { correct: 0, total: 0, marks: 0 },
    physics: { correct: 0, total: 0, marks: 0 },
    chemistry: { correct: 0, total: 0, marks: 0 },
    biology: { correct: 0, total: 0, marks: 0 },
  };
  let correctAnswers = 0;
  let wrongAnswers = 0;
  let obtainedMarks = 0;
  let totalMarks = 0;

  (questions || []).forEach((q, index) => {
    const userAnswer = lookupUserAnswerFromMap(answerMap, q, index);
    const marks = Number(q.marks) || 0;
    const negativeMarks = Number(q.negativeMarks) || 0;
    totalMarks += marks;
    const subjectKey = String(q.subject || 'maths').toLowerCase();
    if (!subjectWiseScore[subjectKey]) {
      subjectWiseScore[subjectKey] = { correct: 0, total: 0, marks: 0 };
    }
    subjectWiseScore[subjectKey].total += 1;

    if (isAnswerCorrect(q, userAnswer)) {
      correctAnswers += 1;
      obtainedMarks += marks;
      subjectWiseScore[subjectKey].correct += 1;
      subjectWiseScore[subjectKey].marks += marks;
    } else if (userAnswer !== undefined && userAnswer !== null && userAnswer !== '') {
      wrongAnswers += 1;
      obtainedMarks -= negativeMarks;
    }
  });

  const totalQuestions = (questions || []).length;
  const unattempted = Math.max(0, totalQuestions - correctAnswers - wrongAnswers);
  const percentage =
    totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 10000) / 100 : 0;

  return {
    correctAnswers,
    wrongAnswers,
    unattempted,
    obtainedMarks,
    totalMarks,
    totalQuestions,
    percentage,
    subjectWiseScore,
  };
}

// Single source of truth for "is this user answer correct for this question".
// Mirrors the client's previous checkAnswer so existing exams grade identically.
function isAnswerCorrect(question, userAnswer) {
  if (userAnswer === undefined || userAnswer === null || userAnswer === '') {
    return false;
  }

  if (question.questionType === 'integer') {
    const userResolved = resolveAnswerToken(question, userAnswer);
    const correctResolved = resolveAnswerToken(question, question.correctAnswer);
    const userNum = Number(userResolved);
    const correctNum = Number(correctResolved);
    if (Number.isFinite(userNum) && Number.isFinite(correctNum)) {
      return userNum === correctNum;
    }
    return userResolved === correctResolved;
  }

  if (question.questionType === 'mcq') {
    const correctText = resolveAnswerToken(question, question.correctAnswer);
    const userText = resolveAnswerToken(question, userAnswer);
    return !!correctText && userText === correctText;
  }

  if (question.questionType === 'multiple') {
    const correctList = resolveAnswerList(question, question.correctAnswer);
    const userList = resolveAnswerList(question, userAnswer);
    if (correctList.length !== userList.length) return false;
    const userSet = new Set(userList);
    return correctList.every((a) => userSet.has(a));
  }

  return false;
}

// Save exam results (server-authoritative grading).
router.post('/exam-results', async (req, res) => {
  try {
    const { examId, examTitle, timeTaken, answers, questionTimings } = req.body || {};

    console.log('📋 Saving exam result for student:', req.userId);
    console.log('📋 Exam ID:', examId);

    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    if (!examId) {
      return res.status(400).json({ success: false, message: 'examId is required' });
    }

    // Get student's assigned admin and board
    const student = await User.findById(req.userId).populate('assignedAdmin', 'board');
    if (!student) {
      return res.status(400).json({ success: false, message: 'Student not found' });
    }

    // Production data can have missing student.board; resolve from assigned admin and safe default.
    const resolvedBoard = String(
      student.board || student.assignedAdmin?.board || 'ASLI_EXCLUSIVE_SCHOOLS'
    )
      .trim()
      .toUpperCase();

    // Load the real questions from the DB and grade against THEM — never trust
    // client-supplied correctAnswers / obtainedMarks / percentage. The student
    // could have crafted the request in DevTools.
    const examDoc = await Exam.findById(examId).lean();
    const questions = await Question.find({ exam: examId, isActive: { $ne: false } })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    let effectiveQuestions = Array.isArray(questions) ? questions : [];

    if (!effectiveQuestions.length && Array.isArray(examDoc?.questions) && examDoc.questions.length > 0) {
      effectiveQuestions = await Question.find({
        _id: { $in: examDoc.questions.map((q) => q?._id || q).filter(Boolean) },
        isActive: { $ne: false }
      })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
    }

    if (!effectiveQuestions.length && Array.isArray(examDoc?.questions) && examDoc.questions.length > 0) {
      effectiveQuestions = examDoc.questions
        .filter((q) => q && typeof q === 'object')
        .filter((q) => q.questionText || q.questionImage || q.questionType || q.options)
        .map((q, index) => ({
          _id: q._id || `embedded-${examId}-${index}`,
          questionText: q.questionText || '',
          questionImage: q.questionImage || undefined,
          questionType: q.questionType || 'mcq',
          options: Array.isArray(q.options) ? q.options : [],
          correctAnswer: q.correctAnswer,
          marks: Number(q.marks) || 1,
          negativeMarks: Number(q.negativeMarks) || 0,
          explanation: q.explanation || undefined,
          subject: String(q.subject || 'maths').toLowerCase(),
          exam: examId,
        }));
    }

    const answerMap = (answers && typeof answers === 'object') ? answers : {};

    let correctAnswers = 0;
    let wrongAnswers = 0;
    let obtainedMarks = 0;
    let totalMarks = 0;
    const subjectWiseScore = {
      maths: { correct: 0, total: 0, marks: 0 },
      physics: { correct: 0, total: 0, marks: 0 },
      chemistry: { correct: 0, total: 0, marks: 0 },
      biology: { correct: 0, total: 0, marks: 0 },
    };

    effectiveQuestions.forEach((q) => {
      const qId = String(q._id);
      const userAnswer = answerMap[qId];
      const marks = Number(q.marks) || 0;
      const negativeMarks = Number(q.negativeMarks) || 0;
      totalMarks += marks;
      const subjectBucket = subjectWiseScore[q.subject] || (subjectWiseScore[q.subject] = { correct: 0, total: 0, marks: 0 });
      subjectBucket.total += 1;

      if (isAnswerCorrect(q, userAnswer)) {
        correctAnswers += 1;
        obtainedMarks += marks;
        subjectBucket.correct += 1;
        subjectBucket.marks += marks;
      } else if (userAnswer !== undefined && userAnswer !== null && userAnswer !== '') {
        wrongAnswers += 1;
        obtainedMarks -= negativeMarks;
      }
    });

    const totalQuestions = effectiveQuestions.length;
    const unattempted = Math.max(0, totalQuestions - correctAnswers - wrongAnswers);
    // Student-facing percentage should be based on all questions:
    // correct answers out of total questions (including unattempted).
    const percentage = totalQuestions > 0
      ? Math.round((correctAnswers / totalQuestions) * 10000) / 100
      : 0;
    const perQuestionAnalytics = buildPerQuestionAttemptAnalytics({
      questions: effectiveQuestions,
      answers: answerMap,
      questionTimings,
      isAnswerCorrect,
    });

    const ExamResult = (await import('../models/ExamResult.js')).default;
    const maxAttempts = Math.max(1, Number(examDoc?.maxAttempts) || 1);
    const priorCount = await ExamResult.countDocuments({
      userId: req.userId,
      examId,
    });
    if (priorCount >= maxAttempts) {
      return res.status(403).json({
        success: false,
        message: `Maximum attempts (${maxAttempts}) reached for this exam.`,
      });
    }
    const attemptNumber = priorCount + 1;

    const resultData = {
      examId,
      userId: req.userId,
      adminId: student.assignedAdmin || null,
      board: normalizeSchoolBoard(resolvedBoard),
      examTitle: examTitle || examDoc?.title || '',
      totalQuestions,
      correctAnswers,
      wrongAnswers,
      unattempted,
      totalMarks,
      obtainedMarks,
      percentage,
      timeTaken: Number(timeTaken) || 0,
      subjectWiseScore,
      answers: answerMap,
      questionAnalytics: perQuestionAnalytics,
      completedAt: new Date(),
      attemptNumber,
    };

    const examResult = await ExamResult.create(resultData);

    try {
      const { createPostExamPrompt } = await import('../services/vidya-student/post-exam-trigger-service.js');
      const weakTopics = perQuestionAnalytics
        .filter((q) => q.status === 'wrong' || q.status === 'not_answered')
        .map((q) => ({ chapter: q.chapter || 'General' }));
      await createPostExamPrompt({
        studentId: req.userId,
        examId,
        examResultId: examResult._id,
        examTitle: examTitle || examDoc?.title || 'Exam',
        obtainedMarks,
        totalMarks,
        weakTopics,
      });
    } catch (proactiveErr) {
      console.warn('Post-exam Vidya proactive trigger failed (non-fatal):', proactiveErr.message);
    }

    console.log('✅ Exam result saved (server-graded)');
    console.log('📋 Scored:', {
      examId: examResult.examId?.toString(),
      userId: examResult.userId?.toString(),
      correct: correctAnswers,
      wrong: wrongAnswers,
      obtainedMarks,
      totalMarks,
      percentage,
    });

    // Return the full result AND the graded questions (with correctAnswer /
    // explanation) so the client can render the post-submission review UI
    // without needing a separate request.
    res.status(201).json({
      success: true,
      message: 'Result saved successfully',
      data: {
        ...examResult.toObject({ flattenMaps: true }),
        questions: effectiveQuestions,
      },
    });
  } catch (error) {
    console.error('❌ Failed to save exam result:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to save result',
      error: error.message,
    });
  }
});

router.get('/exam/:examId/advanced-analytics', async (req, res) => {
  try {
    const { examId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam id' });
    }

    const ExamResult = (await import('../models/ExamResult.js')).default;
    const latestResult = await ExamResult.findOne({
      userId: req.userId,
      examId,
    })
      .sort({ completedAt: -1 })
      .lean();

    if (!latestResult) {
      return res.status(404).json({
        success: false,
        message: 'No completed result found for this exam.',
      });
    }

    const examQuestions = await Question.find({
      exam: examId,
      isActive: { $ne: false },
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    const questionAnalytics =
      Array.isArray(latestResult.questionAnalytics) && latestResult.questionAnalytics.length > 0
        ? enrichQuestionAnalyticsFromExamQuestions(
            latestResult.questionAnalytics.map((item, index) => ({
              ...item,
              questionId: String(item.questionId || ''),
              index: Number(item.index ?? index),
              subject: String(item.subject || 'unknown').toLowerCase(),
              chapter: String(item.chapter || 'General'),
            })),
            examQuestions
          )
        : buildPerQuestionAttemptAnalytics({
            questions: examQuestions,
            answers: latestResult.answers || {},
            questionTimings: latestResult.questionTimings || {},
            isAnswerCorrect,
          });

    const advanced = generateAdvancedAnalytics({
      examResult: latestResult,
      questionAnalytics,
    });

    res.json({
      success: true,
      data: advanced,
      sampleMockData: req.query.includeMock === 'true' ? advancedAnalyticsMockData : undefined,
    });
  } catch (error) {
    console.error('Advanced analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate advanced analytics',
      error: error.message,
    });
  }
});

// Student Ranking Routes
router.get('/rankings', getAllStudentRankings);
router.get('/exams/:examId/ranking', getStudentExamRanking);

// Get student's remarks from teachers
router.get('/remarks', async (req, res) => {
  try {
    const studentId = req.userId;
    
    if (!studentId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Get all remarks for this student
    const remarks = await StudentRemark.find({ studentId })
      .populate('teacherId', 'fullName email')
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: remarks
    });
  } catch (error) {
    console.error('Get student remarks error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch remarks',
      error: error.message 
    });
  }
});

// Get student's subjects via class → subject links (no name-suffix matching)
async function getStudentSubjectsHandler(req, res) {
  try {
    // Get student with assigned admin and assignedClass
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board')
      .populate('assignedClass', 'classNumber section assignedSubjects')
      .select('-password');
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    if (!student.assignedAdmin) {
      return res.json({
        success: true,
        subjects: [],
        data: [],
        message: 'No admin assigned. Please contact your administrator.'
      });
    }
    
    // Get admin's board to filter subjects
    const admin = await User.findById(student.assignedAdmin);
    if (!admin) {
      console.error('Admin not found for student:', student.email);
      return res.json({
        success: true,
        subjects: [],
        data: [],
        message: 'Admin not found. Please contact your administrator.'
      });
    }
    
    const adminBoard = admin.board || student.board;
    
    if (!adminBoard) {
      console.error('No board assigned to admin:', admin.email);
      return res.json({
        success: true,
        subjects: [],
        data: [],
        message: 'No board assigned to admin. Please contact your administrator.'
      });
    }
    
    const studentClassDoc = await resolveStudentClassDoc(student);
    const subjectIdList = await resolveStudentSubjectIdsForLibrary(
      student,
      adminBoard,
      studentClassDoc
    );

    if (subjectIdList.length === 0) {
      console.log('📚 No subjects resolved for student class/browse.');
      return res.json({
        success: true,
        subjects: [],
        data: [],
        message:
          'No subjects available for your class yet. Ask your administrator to assign subjects or confirm your class.',
      });
    }

    const { filterToActiveCatalogSubjectIds } = await import('../utils/activeCatalog.js');
    const activeSubjectIdList = await filterToActiveCatalogSubjectIds(subjectIdList);

    const subjects = await Subject.find({
      _id: { $in: activeSubjectIdList },
      isActive: true,
      name: { $not: /__deleted__/ },
    })
      .sort({ name: 1 })
      .lean();

    const boardUpper = resolveStudentContentBoard(student, adminBoard);

    console.log(`📚 Returning ${subjects.length} active catalog subjects after class + board merge`);
    
    // Get teachers assigned to this admin who teach these subjects
    const Teacher = (await import('../models/Teacher.js')).default;
    const teachers = await Teacher.find({
      adminId: student.assignedAdmin,
      subjects: { $in: subjects.map(s => s._id) },
      isActive: true
    })
    .select('_id subjects fullName email phone department qualifications')
    .lean();
    
    console.log(`Found ${teachers.length} teachers teaching subjects for admin ${student.assignedAdmin}`);
    
    // Build map of subject to teachers
    const subjectTeachersMap = new Map();
    teachers.forEach(teacher => {
      if (teacher.subjects && Array.isArray(teacher.subjects)) {
        teacher.subjects.forEach((subjId) => {
          const subjIdStr = subjId.toString();
          if (!subjectTeachersMap.has(subjIdStr)) {
            subjectTeachersMap.set(subjIdStr, []);
          }
          subjectTeachersMap.get(subjIdStr).push({
            _id: teacher._id,
            name: teacher.fullName || 'Unknown Teacher',
            email: teacher.email || '',
            phone: teacher.phone || '',
            department: teacher.department || '',
            qualifications: teacher.qualifications || ''
          });
        });
      }
    });
    
    console.log('Subject-Teacher mapping:', Array.from(subjectTeachersMap.entries()).map(([subjId, teachers]) => ({
      subjectId: subjId,
      teachers: teachers.map((t) => t.name)
    })));
    
    // Format subjects with teacher information + content counts (sibling subject ids)
    const formattedSubjects = await Promise.all(
      subjects.map(async (subject) => {
        const subjectIdStr = subject._id.toString();
        const assignedTeachers = subjectTeachersMap.get(subjectIdStr) || [];
        const contentSubjectIds = await resolveSubjectContentIds(subject._id, {
          board: boardUpper,
        });
        const contentCount = await Content.countDocuments({
          subject: { $in: contentSubjectIds },
          isActive: true,
        });

        return {
          _id: subject._id,
          id: subjectIdStr,
          name: subject.name,
          description: subject.description || '',
          board: subject.board,
          code: subject.code || '',
          teachers: assignedTeachers,
          teacherCount: assignedTeachers.length,
          contentCount,
        };
      })
    );
    
    console.log(`✅ Returning ${formattedSubjects.length} subjects with teacher info`);
    console.log('Sample subject with teachers:', formattedSubjects[0] ? {
      name: formattedSubjects[0].name,
      teacherCount: formattedSubjects[0].teacherCount,
      teachers: formattedSubjects[0].teachers
    } : 'none');
    
    res.json({
      success: true,
      subjects: formattedSubjects,
      data: formattedSubjects
    });
  } catch (error) {
    console.error('Error fetching student subjects:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects' });
  }
}

router.get('/subjects', getStudentSubjectsHandler);
router.get('/my-subjects', getStudentSubjectsHandler);

// Get assigned quizzes for student
router.get('/quizzes', async (req, res) => {
  try {
    const userId = req.userId;
    
    // Get student with assigned class
    const student = await User.findById(userId)
      .populate('assignedClass', '_id classNumber section')
      .select('-password');
    
    if (!student || student.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    if (!student.assignedClass) {
      return res.json({
        success: true,
        data: [],
        message: 'No class assigned. Quizzes will appear here once you are assigned to a class.'
      });
    }
    
    // Find quizzes assigned to student's class
    const quizzes = await Assessment.find({
      assignedClasses: student.assignedClass._id,
      isPublished: true
    })
    .populate('subjectIds', 'name')
    .populate('createdBy', 'fullName email')
    .populate('assignedClasses', 'classNumber section')
    .sort({ createdAt: -1 });
    
    // Format quizzes with attempt information
    const formattedQuizzes = await Promise.all(quizzes.map(async (quiz) => {
      const attempt = quiz.attempts?.find((a) => 
        a.user && a.user.toString() === userId
      );
      
      return {
        _id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        subject: quiz.subjectIds?.[0]?.name || 'Unknown',
        difficulty: quiz.difficulty,
        duration: quiz.duration,
        totalPoints: quiz.totalPoints,
        questionCount: quiz.questions?.length || 0,
        createdAt: quiz.createdAt,
        createdBy: quiz.createdBy,
        hasAttempted: !!attempt,
        bestScore: attempt?.score || null,
        completedAt: attempt?.completedAt || null
      };
    }));
    
    res.json({
      success: true,
      data: formattedQuizzes
    });
  } catch (error) {
    console.error('Get student quizzes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch quizzes', error: error.message });
  }
});

// Get specific quiz by ID for student
router.get('/quizzes/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const userId = req.userId;
    
    // Get student with assigned class
    const student = await User.findById(userId)
      .populate('assignedClass', '_id classNumber section')
      .select('-password');
    
    if (!student || student.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    if (!student.assignedClass) {
      return res.status(403).json({ 
        success: false, 
        message: 'No class assigned. Please contact your administrator.' 
      });
    }
    
    // Find quiz assigned to student's class
    const quiz = await Assessment.findOne({
      _id: quizId,
      assignedClasses: student.assignedClass._id,
      isPublished: true
    })
    .populate('subjectIds', 'name')
    .populate('createdBy', 'fullName email')
    .select('-attempts'); // Don't send attempts to prevent cheating
    
    if (!quiz) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quiz not found or you do not have access to it' 
      });
    }
    
    res.json({
      success: true,
      data: quiz
    });
  } catch (error) {
    console.error('Get quiz by ID error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch quiz' });
  }
});

// Submit quiz attempt
router.post('/quizzes/:quizId/submit', async (req, res) => {
  try {
    const { quizId } = req.params;
    const { answers, score, timeTaken } = req.body;
    const userId = req.userId;
    
    const quiz = await Assessment.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz not found' });
    }
    
    // Remove existing attempt if any
    if (quiz.attempts) {
      quiz.attempts = quiz.attempts.filter(
        (attempt) => {
          const attemptUserId = attempt.user ? (attempt.user.toString ? attempt.user.toString() : String(attempt.user)) : null;
          return attemptUserId !== userId;
        }
      );
    } else {
      quiz.attempts = [];
    }
    
    // Add new attempt
    quiz.attempts.push({
      user: userId,
      score: score,
      answers: answers,
      completedAt: new Date()
    });
    
    await quiz.save();
    
    res.json({
      success: true,
      message: 'Quiz submitted successfully',
      data: {
        score,
        totalPoints: quiz.totalPoints
      }
    });
  } catch (error) {
    console.error('Submit quiz error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit quiz' });
  }
});

// Save or update learning progress for content
router.post('/content-progress', async (req, res) => {
  try {
    const userId = req.userId;
    const { contentId, completed, progress, timeSpent } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ success: false, message: 'Content ID is required' });
    }
    
    const UserProgress = (await import('../models/UserProgress.js')).default;
    const Content = (await import('../models/Content.js')).default;
    
    // Verify content exists
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ success: false, message: 'Content not found' });
    }
    
    // Find or create progress record
    let userProgress = await UserProgress.findOne({
      userId: userId,
      contentId: contentId
    });
    
    if (userProgress) {
      // Update existing progress
      if (completed !== undefined) userProgress.completed = completed;
      if (progress !== undefined) userProgress.progress = Math.min(100, Math.max(0, progress));
      if (timeSpent !== undefined) userProgress.timeSpent = timeSpent;
      userProgress.lastAccessed = new Date();
      await userProgress.save();
    } else {
      // Create new progress record
      userProgress = new UserProgress({
        userId: userId,
        contentId: contentId,
        completed: completed || false,
        progress: progress ? Math.min(100, Math.max(0, progress)) : 0,
        timeSpent: timeSpent || 0,
        lastAccessed: new Date()
      });
      await userProgress.save();
    }
    
    res.json({
      success: true,
      message: 'Learning progress saved successfully',
      data: userProgress
    });
  } catch (error) {
    console.error('Save content progress error:', error);
    res.status(500).json({ success: false, message: 'Failed to save learning progress' });
  }
});

// Get learning progress for a student (for teacher dashboard)
router.get('/learning-progress', async (req, res) => {
  try {
    const userId = req.userId;
    const { subjectId } = req.query;
    
    const UserProgress = (await import('../models/UserProgress.js')).default;
    const Content = (await import('../models/Content.js')).default;
    
    // Build query
    const query = { userId: userId, contentId: { $exists: true, $ne: null } };
    
    // If subjectId is provided, filter by subject (must be a valid ObjectId)
    if (subjectId) {
      if (!mongoose.Types.ObjectId.isValid(subjectId)) {
        return res.status(400).json({
          success: false,
          message: 'subjectId must be a valid MongoDB id',
        });
      }
      const contentIds = await Content.find({ subject: subjectId }).select('_id');
      query.contentId = { $in: contentIds.map(c => c._id) };
    }
    
    const progressRecords = await UserProgress.find(query)
      .populate('contentId', 'title type subject')
      .sort({ lastAccessed: -1 });
    
    // Calculate overall progress
    const totalContent = subjectId 
      ? await Content.countDocuments({ subject: subjectId, isActive: true })
      : await Content.countDocuments({ isActive: true });
    
    const completedContent = progressRecords.filter(p => p.completed).length;
    const overallProgress = totalContent > 0 
      ? Math.round((completedContent / totalContent) * 100) 
      : 0;
    
    res.json({
      success: true,
      data: {
        progressRecords,
        overallProgress,
        completedContent,
        totalContent
      }
    });
  } catch (error) {
    console.error('Get learning progress error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch learning progress' });
  }
});

// Save overall progress for student (calculated from dashboard)
router.post('/overall-progress', async (req, res) => {
  try {
    const userId = req.userId;
    const { overallProgress } = req.body;
    
    if (overallProgress === undefined || overallProgress === null) {
      return res.status(400).json({ success: false, message: 'Overall progress is required' });
    }
    
    // Validate progress value
    const progressValue = Math.min(100, Math.max(0, Math.round(overallProgress)));
    
    // Update user's overall progress
    const user = await User.findByIdAndUpdate(
      userId,
      {
        overallProgress: progressValue,
        overallProgressUpdatedAt: new Date()
      },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.json({
      success: true,
      message: 'Overall progress saved successfully',
      data: {
        overallProgress: user.overallProgress,
        updatedAt: user.overallProgressUpdatedAt
      }
    });
  } catch (error) {
    console.error('Save overall progress error:', error);
    res.status(500).json({ success: false, message: 'Failed to save overall progress' });
  }
});

// Save login session time (logged-in time)
router.post('/session-time', async (req, res) => {
  try {
    const userId = req.userId;
    const { date, totalMinutes } = req.body;
    
    if (!date || totalMinutes === undefined) {
      return res.status(400).json({ success: false, message: 'Date and totalMinutes are required' });
    }
    
    const UserSession = (await import('../models/UserSession.js')).default;
    
    // Ensure date is in YYYY-MM-DD format
    const dateKey = date.includes('T') ? date.split('T')[0] : date;
    
    // Find or create session record for this date
    let session = await UserSession.findOne({
      userId: userId,
      date: dateKey
    });
    
    if (session) {
      // Update existing session - use maximum duration (in case of multiple updates)
      const newDuration = Math.round(totalMinutes);
      if (newDuration > session.duration) {
        session.duration = newDuration;
        session.endTime = new Date();
        await session.save();
      }
    } else {
      // Create new session record
      const startOfDay = new Date(dateKey);
      startOfDay.setHours(0, 0, 0, 0);
      
      session = new UserSession({
        userId: userId,
        date: dateKey,
        startTime: startOfDay,
        endTime: new Date(),
        duration: Math.round(totalMinutes)
      });
      await session.save();
    }
    
    res.json({
      success: true,
      message: 'Session time saved successfully',
      data: session
    });
  } catch (error) {
    console.error('Save session time error:', error);
    res.status(500).json({ success: false, message: 'Failed to save session time' });
  }
});

// Get user's session time data (weekly study time)
router.get('/session-time', async (req, res) => {
  try {
    const userId = req.userId;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    
    const UserSession = (await import('../models/UserSession.js')).default;
    
    // Get session records for the last 7 days
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const sessions = await UserSession.find({
      userId: userId,
      date: { $gte: sevenDaysAgo.toISOString().split('T')[0] }
    }).sort({ date: 1 });
    
    // Calculate weekly total
    const weeklyTotal = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
    
    // Get today's session
    const todayKey = today.toISOString().split('T')[0];
    const todaySession = sessions.find(s => s.date === todayKey);
    const todayTotal = todaySession ? (todaySession.duration || 0) : 0;
    
    // Format weekly data by day
    const weeklyData = {};
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      const session = sessions.find(s => s.date === dateKey);
      weeklyData[dateKey] = session ? (session.duration || 0) : 0;
    }
    
    res.json({
      success: true,
      data: {
        today: todayTotal,
        thisWeek: weeklyTotal,
        weeklyData: weeklyData,
        sessions: sessions
      }
    });
  } catch (error) {
    console.error('Get session time error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch session time' });
  }
});

// Student AI Tools Route - Uses hardcoded content (same as teacher tools)
router.post('/ai/tool', async (req, res) => {
  try {
    const { toolType, gradeLevel, subject, topic, board, ...params } = req.body;
    const userId = req.userId;

    const { getStudentSchoolProgramContext, validateAiToolBoardAccess } =
      await import('../utils/schoolProgram.js');
    const programCtx = await getStudentSchoolProgramContext(userId);
    const boardCheck = validateAiToolBoardAccess(programCtx.isAsliPrepExclusive, {
      board,
      gradeLevel,
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

    // Convert gradeLevel to classNumber format (Asli Prep → IIT track only)
    let effectiveGradeLevel = gradeLevel;
    if (programCtx.isAsliPrepExclusive) {
      effectiveGradeLevel = 'IIT-6';
    }

    let classNumber;
    if (effectiveGradeLevel === 'IIT-6' || effectiveGradeLevel === 'Class-6-IIT') {
      classNumber = 'IIT-6';
    } else {
      const classNum = parseInt(effectiveGradeLevel?.replace('Class ', '').trim());
      if (!isNaN(classNum)) {
        classNumber = classNum;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid class. Please select a valid class.'
        });
      }
    }

    // Validate required fields
    if (!classNumber || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Class and subject are required.'
      });
    }
    
    // For tools that require topic, validate it
    const toolsRequiringTopic = [
      'smart-study-guide-generator',
      'concept-breakdown-explainer',
      'smart-qa-practice-generator',
      'chapter-summary-creator',
      'key-points-formula-extractor',
      'quick-assignment-builder'
    ];
    
    if (toolsRequiringTopic.includes(toolType) && !topic) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required for this tool type.'
      });
    }

    // Validate subjects against supported curriculum set.
    const { VALID_SUBJECTS } = await import('../services/hardcoded-content-service.js');

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
    
    // Use normalized subject for processing
    const finalSubject = normalizedSubject;
    const classNum = isIIT6 ? classNumber : parseInt(classNumber);
    const classDisplay = isIIT6 ? 'IIT-6' : `Class ${classNum}`;
    const subTopicNormalized = String(params.subTopic || params.subtopic || '').trim().replace(/\s+/g, ' ');
    
    // For tools where topic is optional, pass empty string if not provided
    const topicForFetch = (toolType === 'personalized-revision-planner' || toolType === 'chapter-summary-creator') ? (topic || '') : topic;

    const tryParseJsonPayload = (content) => {
      const text = String(content || '').trim();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    const parsePositiveInt = (value) => {
      const num = Number.parseInt(String(value ?? ''), 10);
      return Number.isFinite(num) && num > 0 ? num : null;
    };

    const trimTextQuestions = (content, maxQuestions) => {
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
    };

    const limitQuestionsInJson = (parsed, maxQuestions) => {
      if (!maxQuestions || parsed == null) return parsed;
      if (Array.isArray(parsed)) return parsed.slice(0, maxQuestions);
      if (Array.isArray(parsed.questions)) return { ...parsed, questions: parsed.questions.slice(0, maxQuestions) };
      if (Array.isArray(parsed.mcqs)) return { ...parsed, mcqs: parsed.mcqs.slice(0, maxQuestions) };
      if (Array.isArray(parsed.items)) return { ...parsed, items: parsed.items.slice(0, maxQuestions) };
      return parsed;
    };

    const applyQuestionLimitToContent = (activeToolType, content, requestedCount) => {
      const limitedToolTypes = new Set([
        'exam-question-paper-generator',
        'worksheet-mcq-generator',
      ]);
      if (!limitedToolTypes.has(String(activeToolType || ''))) return String(content || '');
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
    };

    const buildRawDataForTool = (activeToolType, content) => {
      const parsed = tryParseJsonPayload(content);
      if (!parsed) return null;
      if (activeToolType === 'activity-project-generator') {
        if (Array.isArray(parsed)) return { activities: parsed };
        if (Array.isArray(parsed?.activities)) return { activities: parsed.activities };
        if (Array.isArray(parsed?.projects)) return { activities: parsed.projects };
        if (Array.isArray(parsed?.data?.activities)) return { activities: parsed.data.activities };
        if (Array.isArray(parsed?.data?.projects)) return { activities: parsed.data.projects };
        return null;
      }
      return parsed;
    };

    // Priority 1: Super Admin AI Tool Data (exact class+subject+topic+subtopic) with rotation.
    const { doc: adminDoc, matchType, totalCandidates, selectedIndex } = await fetchRotatingAiToolData({
      classLabel: classDisplay,
      subject: finalSubject,
      topic: String(topicForFetch || '').trim().replace(/\s+/g, ' '),
      subtopic: subTopicNormalized,
      toolName: toolType,
    });
    if (adminDoc) {
      const originalContent = String(adminDoc.generatedContent || adminDoc.content || '').trim();
      const content = applyQuestionLimitToContent(
        toolType,
        originalContent,
        params.questionCount ?? req.body?.questionCount,
      );
      const rawData = buildRawDataForTool(toolType, content);
      return res.json({
        success: true,
        data: {
          content,
          ...(rawData ? { rawData } : {}),
          toolType,
          metadata: {
            classNumber: isIIT6 ? 'IIT-6' : classNum,
            subject: finalSubject,
            topic: topicForFetch || '',
            subTopic: subTopicNormalized,
            ...params,
            generatedAt: new Date(),
            userId,
            source: 'super-admin-ai-tool-data',
            sourceLabel: 'Super Admin AI Tool Data',
            matchType,
            totalCandidates,
            selectedIndex,
          },
        },
      });
    }
    
    return res.status(404).json({
      success: false,
      code: 'AI_TOOL_DATA_NOT_FOUND',
      message:
        'No matching AI Tool Data found for the selected class, subject, topic, and sub topic. Please ask Super Admin to add this mapping in AI Tool Generations.',
    });
  } catch (error) {
    console.error(`Create student tool (${req.body.toolType}) error:`, error);
    res.status(500).json({
      success: false,
      message: error.message || `Failed to fetch content for ${req.body.toolType || 'tool'}`,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get Risk Analysis Reports for Student
router.get('/risk-analysis-reports', async (req, res) => {
  try {
    const studentId = req.userId;

    const reports = await RiskAnalysisReport.find({ studentId })
      .sort({ sentAt: -1 })
      .populate('adminId', 'fullName email')
      .select('-analysisData'); // Don't send full analysis data in list

    res.json({
      success: true,
      data: reports
    });
  } catch (error) {
    console.error('Error fetching risk analysis reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch risk analysis reports',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Download Risk Analysis Report PDF
router.get('/risk-analysis-reports/:reportId/download', async (req, res) => {
  try {
    const { reportId } = req.params;
    const studentId = req.userId;

    const report = await RiskAnalysisReport.findById(reportId);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Verify student owns this report
    if (report.studentId.toString() !== studentId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Mark as read
    if (!report.isRead) {
      report.isRead = true;
      report.readAt = new Date();
      await report.save();
    }

    const fs = await import('fs');

    if (!fs.existsSync(report.pdfPath)) {
      return res.status(404).json({
        success: false,
        message: 'PDF file not found'
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.pdfFilename}"`);
    
    const fileStream = fs.createReadStream(report.pdfPath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error downloading risk analysis report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Teacher daily work diary — entries from teachers in this student's school (class match preferred)
router.get('/teacher-work-diary', async (req, res) => {
  try {
    const student = await User.findById(req.userId);
    if (!student || !student.assignedAdmin) {
      return res.json({ success: true, data: [] });
    }
    const classNum =
      student.classNumber && student.classNumber !== 'Unassigned'
        ? String(student.classNumber).trim()
        : null;

    const base = { adminId: student.assignedAdmin, isActive: true };
    let teachers = classNum
      ? await Teacher.find({ ...base, assignedClassIds: classNum }).select('_id').lean()
      : [];
    if (!teachers.length) {
      teachers = await Teacher.find(base).select('_id').lean();
    }
    const teacherIds = teachers.map((t) => t._id);
    if (!teacherIds.length) {
      return res.json({ success: true, data: [] });
    }
    const limit = Math.min(parseInt(String(req.query.limit || '40'), 10) || 40, 100);
    const entries = await TeacherWorkDiary.find({ teacherId: { $in: teacherIds } })
      .sort({ forDate: -1 })
      .limit(limit)
      .populate('teacherId', 'fullName email')
      .lean();
    res.json({ success: true, data: entries });
  } catch (error) {
    console.error('Student teacher-work-diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to load teacher diary' });
  }
});

// Proxy file download for student content URLs (avoids browser CORS issues)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** NCERT / many government PDF hosts block or slow datacenter egress; browser fetch often works. */
function isBrowserDirectPdfHost(hostname) {
  const h = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (!h) return false;
  if (h === 'ncert.nic.in' || h.endsWith('.ncert.nic.in')) return true;
  const extra = String(process.env.PDF_PROXY_REDIRECT_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  return extra.some((e) => h === e || h.endsWith(`.${e}`));
}

/** When query `url=` is oddly encoded but still embeds NCERT, carve it out. */
function carveNcertUrl(rawUrl) {
  const variants = [];
  variants.push(String(rawUrl || '').trim());
  try {
    variants.push(decodeURIComponent(variants[0]));
  } catch {
    /* noop */
  }
  try {
    variants.push(decodeURIComponent(variants[1] || variants[0]));
  } catch {
    /* noop */
  }
  const re = /https?:\/\/[a-z0-9.-]*ncert\.nic\.in[^\s"'<>)]*/gi;
  for (const v of variants) {
    const m = v.match(re);
    if (m?.[0]) return m[0];
  }
  return '';
}

/**
 * Prefer browser-side fetch — datacenter egress often fails against NCERT.
 * Handles bare NCERT URLs, google viewer wrappers, odd encoding.
 */
function getPdfBrowserBypassTarget(rawUrlInput, unwrapDepth = 0) {
  if (unwrapDepth > 6) return '';
  const rawTrim = typeof rawUrlInput === 'string' ? rawUrlInput.trim() : '';

  /** @type {URL | null} */
  let parsed = null;
  try {
    parsed = new URL(rawTrim);
  } catch {
    parsed = null;
  }

  if (parsed && ['http:', 'https:'].includes(parsed.protocol)) {
    const h = parsed.hostname.replace(/\.$/, '').toLowerCase();
    if (isBrowserDirectPdfHost(h)) {
      return parsed.toString();
    }
    const unwrapViewer =
      h === 'docs.google.com' ||
      h.endsWith('.docs.google.com') ||
      h === 'drive.google.com';
    if (unwrapViewer) {
      const eu =
        parsed.searchParams.get('url') ||
        parsed.searchParams.get('embeddedurl');
      if (eu) {
        const decodedEu = decodeURIComponent(eu.replace(/\+/g, '%20'));
        const inner = getPdfBrowserBypassTarget(decodedEu, unwrapDepth + 1);
        if (inner) return inner;
      }
    }
  }

  const carved = carveNcertUrl(rawTrim);
  if (carved) {
    try {
      const innerParsed = new URL(carved);
      const ih = innerParsed.hostname.replace(/\.$/, '').toLowerCase();
      if (
        ['http:', 'https:'].includes(innerParsed.protocol) &&
        isBrowserDirectPdfHost(ih)
      ) {
        return innerParsed.toString();
      }
    } catch {
      /* noop */
    }
  }

  return '';
}

const PDF_FETCH_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.PDF_PROXY_FETCH_TIMEOUT_MS) || 55000, 15000),
  120000
);

function downloadWithNodeHttp(targetUrl, timeoutMs = PDF_FETCH_TIMEOUT_MS, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while fetching remote file'));
      return;
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      reject(new Error('Invalid remote URL'));
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const req = client.request(
      targetUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'application/pdf,application/octet-stream,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent': 'Mozilla/5.0 ASLI-PDF-Proxy/1.0',
        },
        timeout: timeoutMs,
        // Prefer IPv4 in production environments where IPv6 routes are flaky.
        family: 4,
      },
      (res) => {
        const statusCode = Number(res.statusCode || 0);
        const location = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          const redirectUrl = new URL(location, targetUrl).toString();
          res.resume();
          downloadWithNodeHttp(redirectUrl, timeoutMs, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          const e = new Error(`Failed to fetch remote file: ${statusCode}`);
          e.status = statusCode;
          reject(e);
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            buffer,
            upstreamType: String(res.headers['content-type'] || 'application/octet-stream'),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Remote fetch timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchRemoteFileWithRetry(targetUrl, contextLabel) {
  const maxAttempts = 4;
  let lastError = null;
  const timeoutMs = PDF_FETCH_TIMEOUT_MS;
  console.log(`[PDF_PROXY] start ${contextLabel}`, { targetUrl, maxAttempts, timeoutMs });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const upstream = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'application/pdf,application/octet-stream,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      clearTimeout(timeout);

      if (!upstream.ok) {
        const shouldRetry = upstream.status >= 500 || upstream.status === 429;
        if (shouldRetry && attempt < maxAttempts) {
          await wait(500 * attempt);
          continue;
        }
        const message = `Failed to fetch ${contextLabel}: ${upstream.status}`;
        const error = new Error(message);
        error.status = upstream.status;
        throw error;
      }

      const arrayBuffer = await upstream.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const upstreamType = upstream.headers.get('content-type') || 'application/octet-stream';
      console.log(`[PDF_PROXY] success ${contextLabel}`, {
        targetUrl,
        bytes: buffer.length,
        upstreamType,
        attempt,
      });
      return { buffer, upstreamType };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      const code = error?.cause?.code || error?.code;
      const msg = error?.message || String(error);
      if (attempt === maxAttempts) {
        console.warn(`[PDF_PROXY] fetch failed (final)`, {
          targetUrl,
          attempt,
          code: code || '',
          message: msg,
        });
      }
      const retryableNetworkError = ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code);
      const retryableAbort = error?.name === 'AbortError';
      if (retryableNetworkError || retryableAbort) {
        try {
          return await downloadWithNodeHttp(targetUrl, timeoutMs);
        } catch (fallbackError) {
          lastError = fallbackError;
        }
      }
      if (attempt < maxAttempts && (retryableNetworkError || retryableAbort)) {
        await wait(500 * attempt);
        continue;
      }
      break;
    }
  }

  const err = lastError || new Error(`Failed to fetch ${contextLabel}`);
  const c = err?.cause?.code || err?.code;
  const m = String(err?.message || '');
  if (c === 'UND_ERR_CONNECT_TIMEOUT' || m.includes('timeout') || m.includes('Timeout') || err?.name === 'AbortError') {
    err.isUpstreamTimeout = true;
  }
  throw err;
}

router.get('/content-download', async (req, res) => {
  try {
    const { url, filename } = req.query;
    console.log('[PDF_PROXY] /content-download request', {
      url: typeof url === 'string' ? url : '',
      filename: typeof filename === 'string' ? filename : '',
      userId: req.userId || '',
      hasTokenQuery: !!(req.query.token && typeof req.query.token === 'string'),
    });
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Missing required url query parameter'
      });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        message: 'Invalid download URL'
      });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        success: false,
        message: 'Only HTTP/HTTPS download URLs are supported'
      });
    }

    const bypassDl = getPdfBrowserBypassTarget(url);
    if (bypassDl) {
      console.log('[PDF_PROXY] /content-download 302 → browser (allowlisted)', {
        target: bypassDl.slice(0, 120),
      });
      return res.redirect(302, bypassDl);
    }

    const { buffer, upstreamType } = await fetchRemoteFileWithRetry(url, 'download file');
    const looksLikePdf = buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
    const isPdf = looksLikePdf || upstreamType.toLowerCase().includes('application/pdf');
    const safeFilename = typeof filename === 'string' && filename.trim()
      ? filename.trim()
      : decodeURIComponent(parsedUrl.pathname.split('/').pop() || 'download');

    res.setHeader('Content-Type', isPdf ? 'application/pdf' : upstreamType);
    res.setHeader('Content-Disposition', `${isPdf ? 'inline' : 'attachment'}; filename="${safeFilename.replace(/"/g, '')}"`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.removeHeader('X-Frame-Options');
    console.log('[PDF_PROXY] /content-download response', {
      status: 200,
      isPdf,
      upstreamType,
      bytes: buffer.length,
      filename: safeFilename,
    });
    res.send(buffer);
  } catch (error) {
    const isTimeout = error?.isUpstreamTimeout || String(error?.message || '').toLowerCase().includes('timeout');
    if (isTimeout) {
      console.warn('Student content-download proxy: upstream timeout', { message: error?.message });
    } else {
      console.error('Student content-download proxy error:', error);
    }
    const statusCode = error?.status && Number.isInteger(error.status)
      ? error.status
      : isTimeout
        ? 504
        : 500;
    res.status(statusCode).json({
      success: false,
      code: isTimeout ? 'UPSTREAM_TIMEOUT' : undefined,
      message: isTimeout
        ? 'The document host took too long to respond. Try again later or open the file in a new tab.'
        : statusCode === 500
          ? 'Failed to download file'
          : `Failed to download file: ${statusCode}`,
    });
  }
});

// Proxy file preview for student content URLs (inline rendering in iframe/object)
router.get('/content-preview', async (req, res) => {
  try {
    const { url, filename } = req.query;
    console.log('[PDF_PROXY] /content-preview request', {
      url: typeof url === 'string' ? url : '',
      filename: typeof filename === 'string' ? filename : '',
      userId: req.userId || '',
      hasTokenQuery: !!(req.query.token && typeof req.query.token === 'string'),
    });
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Missing required url query parameter'
      });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        message: 'Invalid preview URL'
      });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        success: false,
        message: 'Only HTTP/HTTPS preview URLs are supported'
      });
    }

    const bypass = getPdfBrowserBypassTarget(url);
    if (bypass) {
      console.log('[PDF_PROXY] /content-preview 302 → browser', {
        host: parsedUrl.hostname,
        bypassPreview: bypass.slice(0, 120),
      });
      return res.redirect(302, bypass);
    }

    const { buffer, upstreamType } = await fetchRemoteFileWithRetry(url, 'preview file');
    const looksLikePdf = buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
    const isPdf = looksLikePdf || upstreamType.toLowerCase().includes('application/pdf');
    const safeFilename = typeof filename === 'string' && filename.trim()
      ? filename.trim()
      : decodeURIComponent(parsedUrl.pathname.split('/').pop() || 'preview');

    res.setHeader('Content-Type', isPdf ? 'application/pdf' : upstreamType);
    res.setHeader('X-Source-Content-Type', upstreamType);
    res.setHeader('X-Pdf-Validated', isPdf ? '1' : '0');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename.replace(/"/g, '')}"`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.removeHeader('X-Frame-Options');
    console.log('[PDF_PROXY] /content-preview response', {
      status: 200,
      isPdf,
      upstreamType,
      bytes: buffer.length,
      filename: safeFilename,
    });
    res.send(buffer);
  } catch (error) {
    const isTimeout = error?.isUpstreamTimeout || String(error?.message || '').toLowerCase().includes('timeout');
    if (isTimeout) {
      console.warn('Student content-preview proxy: upstream timeout', {
        message: error?.message,
      });
    } else {
      console.error('Student content-preview proxy error:', error);
    }
    const statusCode = error?.status && Number.isInteger(error.status)
      ? error.status
      : isTimeout
        ? 504
        : 500;
    res.status(statusCode).json({
      success: false,
      code: isTimeout ? 'UPSTREAM_TIMEOUT' : undefined,
      message: isTimeout
        ? 'The document host took too long to respond. Try opening the original link, or use Download.'
        : statusCode === 500
          ? 'Failed to preview file'
          : `Failed to preview file: ${statusCode}`,
    });
  }
});

export default router;
