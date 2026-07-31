/**
 * Split routes/teacher.js into routes/teacher/*.js domain modules.
 * Preserves path contracts and auth order under /api/teacher:
 *   verifyToken → shared AI (teacher|student) → verifyTeacher → domain routers
 */
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backupPath = join(root, 'routes', 'teacher.js.bak-pre-split');
const teacherPath = join(root, 'routes', 'teacher.js');
const outDir = join(root, 'routes', 'teacher');

const srcPath = fs.existsSync(backupPath) ? backupPath : teacherPath;
const src = fs.readFileSync(srcPath, 'utf8');
const lines = src.split(/\r?\n/);

fs.mkdirSync(outDir, { recursive: true });

/** 1-based inclusive line range → string */
function linesOf(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

/** Rewrite single-level ../ imports to ../../ (do not touch already ../../) */
function fixRelImports(body) {
  return body
    .replace(/(from\s+['"])\.\.\/(?!\.)/g, '$1../../')
    .replace(/(import\s*\(\s*['"])\.\.\/(?!\.)/g, '$1../../');
}

const sharedImports = `import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import {
  verifyToken,
  verifyTeacher,
  extractTeacherId
} from '../../middleware/auth.js';
import {
  getTeacherDashboardStats,
  testTeacherData
} from '../../controllers/adminController.js';
import {
  createLessonPlan,
  createTestQuestions,
  createClasswork,
  createSchedule,
  createTeacherTool,
  generateContent,
  getGeneratedContent,
  getTeacherToolStats,
  getSubjects,
  getTopics,
  getAvailableContent
} from '../../controllers/aiToolsController.js';
import { getMyWeeklyDigest } from '../../controllers/impactReportController.js';
import Video from '../../models/Video.js';
import Assessment from '../../models/Assessment.js';
import Exam from '../../models/Exam.js';
import User from '../../models/User.js';
import ExamResult from '../../models/ExamResult.js';
import Teacher from '../../models/Teacher.js';
import Content from '../../models/Content.js';
import StudentRemark from '../../models/StudentRemark.js';
import TeacherWorkDiary from '../../models/TeacherWorkDiary.js';
import Subject from '../../models/Subject.js';
import { examVisibleToSchool, getSchoolAdminCalendarEvents, monthBounds } from '../../controllers/calendarController.js';
import {
  getExplicitTeacherSubjectObjectIds,
  subjectIdAllowed,
} from '../../utils/teacherSubjectScope.js';
import {
  resolveSubjectContentIds,
  resolveSubjectContentIdsMany,
  subjectIdAllowedWithSiblings,
  subjectGroupKey,
  extractPlainSubjectNameForContent,
} from '../../utils/resolveSubjectContentIds.js';
import { parseDateKeyToUtc, getTeacherClassesHandler } from './helpers.js';
`;

function writeModule(name, body, { includeMulter = false } = {}) {
  let multerBlock = '';
  if (includeMulter) {
    multerBlock = `
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadDir = path.join(__dirname, '../../uploads/pdfs');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'pdf-' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: {
    fileSize: 50 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});
`;
  }

  const content = `${sharedImports}
const router = express.Router();
${multerBlock}
${fixRelImports(body)}

export default router;
`;
  fs.writeFileSync(join(outDir, name), content);
  console.log(name, content.split(/\n/).length);
}

// --- helpers.js ---
let helpersBody = `${linesOf(59, 68)}

${linesOf(370, 489)}`
  .replace(/^function parseDateKeyToUtc/m, 'export function parseDateKeyToUtc')
  .replace(/^async function getTeacherClassesHandler/m, 'export async function getTeacherClassesHandler');

helpersBody = fixRelImports(helpersBody);

fs.writeFileSync(
  join(outDir, 'helpers.js'),
  `import mongoose from 'mongoose';
import Teacher from '../../models/Teacher.js';
import User from '../../models/User.js';
import Subject from '../../models/Subject.js';

${helpersBody}
`,
);
console.log('helpers.js ok');

writeModule(
  'aiShared.js',
  `
const allowTeacherOrStudent = (req, res, next) => {
  if (req.user.role === 'teacher' || req.user.role === 'student') {
    if (req.user.role === 'student') {
      req.teacherId = req.userId;
    } else if (req.user.role === 'teacher') {
      req.teacherId = req.userId;
    }
    next();
  } else {
    return res.status(403).json({ success: false, message: 'Access denied. Teacher or Student privileges required.' });
  }
};

${linesOf(132, 139)}
`,
);

writeModule('core.js', linesOf(145, 303));
writeModule('calendar.js', linesOf(304, 368));
writeModule(
  'classes.js',
  `
router.get('/classes', getTeacherClassesHandler);
router.get('/my-classes', getTeacherClassesHandler);

${linesOf(494, 725)}
`,
);
writeModule('ai.js', linesOf(727, 820), { includeMulter: true });
writeModule('content.js', `${linesOf(822, 933)}\n\n${linesOf(1724, 1856)}`);
writeModule('homework.js', `${linesOf(935, 1026)}\n\n${linesOf(1935, 2055)}`);
writeModule('attendance.js', linesOf(1085, 1261));
writeModule(
  'remarks.js',
  `${linesOf(1263, 1317)}

${linesOf(1858, 1933)}

${linesOf(2057, 2083)}

${linesOf(2222, 2358)}
`,
);
// End students list before attendance comment (1081–1084)
writeModule(
  'students.js',
  `${linesOf(1028, 1079)}

${linesOf(1319, 1722)}

${linesOf(2085, 2220)}
`,
);
writeModule('quizzes.js', linesOf(2360, 2520));
writeModule('workDiary.js', linesOf(2522, 2657));

const shell = `import express from 'express';
import {
  verifyToken,
  verifyTeacher,
  extractTeacherId
} from '../middleware/auth.js';

import aiSharedRoutes from './teacher/aiShared.js';
import coreRoutes from './teacher/core.js';
import calendarRoutes from './teacher/calendar.js';
import classesRoutes from './teacher/classes.js';
import aiRoutes from './teacher/ai.js';
import contentRoutes from './teacher/content.js';
import homeworkRoutes from './teacher/homework.js';
import attendanceRoutes from './teacher/attendance.js';
import remarksRoutes from './teacher/remarks.js';
import studentsRoutes from './teacher/students.js';
import quizzesRoutes from './teacher/quizzes.js';
import workDiaryRoutes from './teacher/workDiary.js';

const router = express.Router();

/*
 * REMOVED (July 2026): unauthenticated debug routes (POST /test-video, GET /test).
 * Auth order must stay: verifyToken → shared AI (teacher|student) → verifyTeacher.
 */
router.use(verifyToken);

// Dual-access AI + weekly digest (before teacher-only gate)
router.use(aiSharedRoutes);

router.use(verifyTeacher);
router.use(extractTeacherId);

router.use(coreRoutes);
router.use(calendarRoutes);
router.use(classesRoutes);
router.use(aiRoutes);
router.use(contentRoutes);
router.use(homeworkRoutes);
router.use(attendanceRoutes);
// Static /students/remarks before parametric /students/:id/* in students router
router.use(remarksRoutes);
router.use(studentsRoutes);
router.use(quizzesRoutes);
router.use(workDiaryRoutes);

export default router;
`;

fs.writeFileSync(teacherPath, shell);
console.log('teacher.js shell written');
