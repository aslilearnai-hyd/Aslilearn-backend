/**
 * Split routes/admin.js into routes/admin/*.js domain modules.
 * Preserves /api/admin path contracts and auth middleware order.
 */
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const routes = join(root, 'routes');
const out = join(routes, 'admin');
fs.mkdirSync(out, { recursive: true });

function fixRel(s) {
  return s
    .replace(/(from\s+['"])\.\.\/(?!\.)/g, '$1../../')
    .replace(/(import\s*\(\s*['"])\.\.\/(?!\.)/g, '$1../../');
}

// Move existing folded routers into routes/admin/
for (const [src, dest] of [
  ['adminEventRoutes.js', 'events.js'],
  ['adminLearningPathRoutes.js', 'learningPaths.js'],
  ['adminUsersRoutes.js', 'users.js'],
]) {
  const body = fs.readFileSync(join(routes, src), 'utf8');
  fs.writeFileSync(join(out, dest), fixRel(body));
  console.log('moved', src, '-> admin/' + dest);
}

const multerSetup = `const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
`;

function write(name, contents) {
  fs.writeFileSync(join(out, name), contents);
  console.log(name, contents.split(/\n/).length);
}

write(
  'dashboard.js',
  `import express from 'express';
import RiskAnalysisReport from '../../models/RiskAnalysisReport.js';
import {
  getAdminDashboardStats,
  getAnalytics,
  getAdminReports,
  getSchoolSettings,
  updateSchoolSettings,
  getTeacherDashboardStats,
} from '../../controllers/adminController.js';
import {
  getMySchoolImpactReport,
  downloadMySchoolImpactPdf,
} from '../../controllers/impactReportController.js';

const router = express.Router();

router.get('/dashboard/stats', getAdminDashboardStats);
router.get('/analytics', getAnalytics);
router.get('/reports', getAdminReports);
router.get('/impact-report', getMySchoolImpactReport);
router.get('/impact-report/pdf', downloadMySchoolImpactPdf);
router.get('/school-settings', getSchoolSettings);
router.put('/school-settings', updateSchoolSettings);
router.get('/risk-summary', async (req, res) => {
  try {
    const adminId = req.adminId;
    const filter = {
      'analysisData.riskLevel': { $regex: /^high$/i },
    };
    if (adminId) {
      filter.adminId = adminId;
    }

    const reports = await RiskAnalysisReport.find(filter)
      .sort({ sentAt: -1 })
      .limit(50)
      .populate('studentId', 'fullName name email classNumber')
      .lean();

    const students = reports.slice(0, 10).map((r) => {
      const scoreRaw = r.analysisData?.riskScore;
      const riskScorePct =
        scoreRaw != null && Number.isFinite(Number(scoreRaw))
          ? Math.round(Number(scoreRaw) <= 1 ? Number(scoreRaw) * 100 : Number(scoreRaw))
          : null;
      return {
        _id: r._id,
        studentId: r.studentId,
        riskScore: riskScorePct,
      };
    });

    res.json({ success: true, students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/teacher/dashboard', getTeacherDashboardStats);

export default router;
`,
);

write(
  'students.js',
  `import express from 'express';
import multer from 'multer';
import User from '../../models/User.js';
import {
  verifyDataOwnership,
  addAdminIdToBody,
} from '../../middleware/auth.js';
import {
  getStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  getStudentAnalytics,
  assignSubjectsToStudent,
  assignClassToStudent,
  uploadStudentsCsv,
} from '../../controllers/adminController.js';

const router = express.Router();
${multerSetup}
router.get('/students', getStudents);
router.get('/students/analytics', getStudentAnalytics);
router.post('/students', addAdminIdToBody, createStudent);
router.put('/students/:id', verifyDataOwnership(User), updateStudent);
router.delete('/students/:id', verifyDataOwnership(User), deleteStudent);
router.post('/students/:studentId/assign-subjects', assignSubjectsToStudent);
router.post('/students/:studentId/assign-class', assignClassToStudent);
router.post('/students/upload', upload.single('file'), uploadStudentsCsv);

export default router;
`,
);

write(
  'classesSubjects.js',
  `import express from 'express';
import {
  getClasses,
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  createClass,
  assignSubjectsToClassById,
  deleteAllClasses,
  deleteClass,
  promoteClasses,
  assignSubjectsToClass,
} from '../../controllers/adminController.js';

const router = express.Router();

router.get('/classes', getClasses);
router.get('/subjects', getSubjects);
router.post('/subjects', createSubject);
router.put('/subjects/:id', updateSubject);
router.delete('/subjects/:id', deleteSubject);
router.post('/classes', createClass);
router.post('/classes/by-id/:classId/assign-subjects', assignSubjectsToClassById);
router.delete('/classes/delete-all', deleteAllClasses);
router.delete('/classes/:id', deleteClass);
router.post('/classes/promote', promoteClasses);
router.post('/classes/:classNumber/assign-subjects', assignSubjectsToClass);

export default router;
`,
);

write(
  'teachers.js',
  `import express from 'express';
import multer from 'multer';
import Teacher from '../../models/Teacher.js';
import {
  verifyDataOwnership,
  addAdminIdToBody,
} from '../../middleware/auth.js';
import {
  getTeachers,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  bulkDeleteTeachers,
  assignSubjects,
  assignClasses,
  uploadTeachersCsv,
} from '../../controllers/adminController.js';

const router = express.Router();
${multerSetup}
router.get('/teachers', getTeachers);
router.post('/teachers', addAdminIdToBody, createTeacher);
router.post('/teachers/bulk-delete', bulkDeleteTeachers);
router.post('/teachers/upload', upload.single('file'), uploadTeachersCsv);
router.put('/teachers/:id', verifyDataOwnership(Teacher), updateTeacher);
router.delete('/teachers/:id', verifyDataOwnership(Teacher), deleteTeacher);
router.post('/teachers/:teacherId/assign-subjects', assignSubjects);
router.post('/teachers/:teacherId/assign-classes', assignClasses);

export default router;
`,
);

write(
  'media.js',
  `import express from 'express';
import Video from '../../models/Video.js';
import {
  verifyDataOwnership,
  addAdminIdToBody,
} from '../../middleware/auth.js';
import {
  getVideos,
  createVideo,
  updateVideo,
  deleteVideo,
} from '../../controllers/adminController.js';

const router = express.Router();

router.get('/videos', getVideos);
router.post('/videos', addAdminIdToBody, createVideo);
router.put('/videos/:id', verifyDataOwnership(Video), updateVideo);
router.delete('/videos/:id', verifyDataOwnership(Video), deleteVideo);

export default router;
`,
);

write(
  'assessments.js',
  `import express from 'express';
import Assessment from '../../models/Assessment.js';
import {
  verifyDataOwnership,
  addAdminIdToBody,
} from '../../middleware/auth.js';
import {
  getAssessments,
  createAssessment,
  updateAssessment,
  deleteAssessment,
  getQuizzes,
  createQuiz,
} from '../../controllers/adminController.js';

const router = express.Router();

router.get('/assessments', getAssessments);
router.post('/assessments', addAdminIdToBody, createAssessment);
router.put('/assessments/:id', verifyDataOwnership(Assessment), updateAssessment);
router.delete('/assessments/:id', verifyDataOwnership(Assessment), deleteAssessment);
router.get('/quizzes', getQuizzes);
router.post('/quizzes', addAdminIdToBody, createQuiz);

export default router;
`,
);

write(
  'exams.js',
  `import express from 'express';
import {
  getViewableExams,
  getExamDetails,
  getStudentExamResults,
  getExamPerformanceAnalytics,
} from '../../controllers/adminExamViewController.js';

const router = express.Router();

router.get('/exams/viewable', getViewableExams);
router.get('/exams/:examId/view', getExamDetails);
router.get('/exam-results', getStudentExamResults);
router.get('/exams/:examId/analytics', getExamPerformanceAnalytics);

export default router;
`,
);

write(
  'content.js',
  `import express from 'express';
import mongoose from 'mongoose';
import Content from '../../models/Content.js';
import {
  buildActiveSubjectIdSet,
  filterContentRowsForActiveCatalog,
  getActiveCatalogSubjectIds,
} from '../../utils/activeCatalog.js';

const router = express.Router();

router.get('/asli-prep-content', async (req, res) => {
  try {
    const { subject, type, topic, surface } = req.query;
    const adminId = req.adminId;

    console.log('📚 Fetching Asli Prep content for admin:', adminId);
    console.log('Query params:', { subject, type, topic, surface });
    console.log('📚 Fetching all content (board restrictions removed)');

    const { getAdminSchoolProgramContext, applySchoolProgramContentFilters, isAllowedContentType } =
      await import('../../utils/schoolProgram.js');
    const programCtx = {
      ...(await getAdminSchoolProgramContext(adminId)),
      surface,
    };

    if (type && type !== 'all' && !isAllowedContentType(type, programCtx.isAsliPrepExclusive)) {
      return res.json({ success: true, data: [] });
    }

    const activeSubjectIds = await getActiveCatalogSubjectIds();
    const activeIdSet = buildActiveSubjectIdSet(activeSubjectIds);

    const query = {
      isActive: true,
      subject: { $in: activeSubjectIds },
    };

    if (subject && subject !== 'all' && mongoose.Types.ObjectId.isValid(subject)) {
      const sid = String(subject);
      if (activeIdSet.has(sid)) {
        query.subject = new mongoose.Types.ObjectId(sid);
      } else {
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
      .populate('subject', 'name isActive classNumber board stateName productCategory')
      .sort({ createdAt: -1 })
      .lean();

    contents = filterContentRowsForActiveCatalog(contents, activeIdSet);
    contents = applySchoolProgramContentFilters(contents, programCtx);

    console.log(\`✅ Found \${contents.length} active catalog contents\`);

    const { enrichContentDurations } = await import('../../utils/enrichContentDurations.js');
    contents = await enrichContentDurations(contents);

    const { dedupeLibraryContents } = await import('../../utils/dedupeLibraryContents.js');
    contents = dedupeLibraryContents(contents);

    res.json({
      success: true,
      data: contents,
    });
  } catch (error) {
    console.error('❌ Error fetching Asli Prep content for admin:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch content', error: error.message });
  }
});

export default router;
`,
);

write(
  'riskAi.js',
  `import express from 'express';
import { verifyAdmin } from '../../middleware/auth.js';
import {
  analyzeStudentRisk,
  downloadAndSendRiskAnalysisPDF,
  downloadRiskAnalysisPDF,
} from '../../controllers/adminController.js';

const router = express.Router();

router.post('/ai/student-risk-analysis', verifyAdmin, analyzeStudentRisk);
router.post('/ai/student-risk-analysis/download-send', verifyAdmin, downloadAndSendRiskAnalysisPDF);
router.get('/reports/download/:reportId', verifyAdmin, downloadRiskAnalysisPDF);

export default router;
`,
);

write(
  'workDiary.js',
  `import express from 'express';
import mongoose from 'mongoose';
import TeacherWorkDiary from '../../models/TeacherWorkDiary.js';

const router = express.Router();

router.get('/teacher-work-diary', async (req, res) => {
  try {
    const { teacherId, limit = '60' } = req.query;
    const q = {};
    if (req.adminId) {
      q.adminId = req.adminId;
    }
    if (teacherId && mongoose.Types.ObjectId.isValid(String(teacherId))) {
      q.teacherId = new mongoose.Types.ObjectId(String(teacherId));
    }
    const lim = Math.min(parseInt(String(limit), 10) || 60, 200);
    const entries = await TeacherWorkDiary.find(q)
      .sort({ forDate: -1 })
      .limit(lim)
      .populate('teacherId', 'fullName email')
      .populate('classId', 'classNumber section name')
      .lean();
    res.json({ success: true, data: entries });
  } catch (error) {
    console.error('Admin teacher-work-diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to load teacher diaries' });
  }
});

export default router;
`,
);

// Thin composition shell
const shell = `import express from 'express';
import {
  verifyToken,
  verifyAdmin,
  extractAdminId,
} from '../middleware/auth.js';

import dashboardRoutes from './admin/dashboard.js';
import studentsRoutes from './admin/students.js';
import classesSubjectsRoutes from './admin/classesSubjects.js';
import teachersRoutes from './admin/teachers.js';
import mediaRoutes from './admin/media.js';
import assessmentsRoutes from './admin/assessments.js';
import examsRoutes from './admin/exams.js';
import contentRoutes from './admin/content.js';
import riskAiRoutes from './admin/riskAi.js';
import workDiaryRoutes from './admin/workDiary.js';
import eventsRoutes from './admin/events.js';
import learningPathsRoutes from './admin/learningPaths.js';
import usersRoutes from './admin/users.js';

const router = express.Router();

router.use(verifyToken);
router.use(verifyAdmin);
router.use(extractAdminId);

router.use(dashboardRoutes);
router.use(studentsRoutes);
router.use(classesSubjectsRoutes);
router.use(teachersRoutes);
router.use(mediaRoutes);
router.use(assessmentsRoutes);
router.use(examsRoutes);
router.use(contentRoutes);
router.use(riskAiRoutes);
router.use(workDiaryRoutes);
router.use(eventsRoutes);
router.use(learningPathsRoutes);
router.use(usersRoutes);

export default router;
`;

fs.writeFileSync(join(routes, 'admin.js'), shell);
console.log('admin.js shell written');

// Remove old top-level route files (only imported by admin.js)
for (const f of ['adminEventRoutes.js', 'adminLearningPathRoutes.js', 'adminUsersRoutes.js']) {
  fs.unlinkSync(join(routes, f));
  console.log('deleted', f);
}
