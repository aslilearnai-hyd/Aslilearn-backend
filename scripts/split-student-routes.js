/**
 * Split routes/student.js into routes/student/*.js domain modules.
 * Preserves path contracts under /api/student.
 */
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studentPath = join(root, 'routes', 'student.js');
const outDir = join(root, 'routes', 'student');
fs.mkdirSync(outDir, { recursive: true });

const src = fs.readFileSync(studentPath, 'utf8');

function slice(startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  if (s < 0) throw new Error(`missing start: ${startMarker.slice(0, 60)}`);
  const e = endMarker ? src.indexOf(endMarker, s + 1) : src.length;
  if (e < 0) throw new Error(`missing end: ${endMarker?.slice(0, 60)}`);
  return src.slice(s, e);
}

const headerImports = `import express from 'express';
import http from 'http';
import https from 'https';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Video from '../../models/Video.js';
import Assessment from '../../models/Assessment.js';
import Exam from '../../models/Exam.js';
import Question from '../../models/Question.js';
import Teacher from '../../models/Teacher.js';
import Subject from '../../models/Subject.js';
import Content from '../../models/Content.js';
import StudentRemark from '../../models/StudentRemark.js';
import TeacherWorkDiary from '../../models/TeacherWorkDiary.js';
import RiskAnalysisReport from '../../models/RiskAnalysisReport.js';
import GeminiPerformanceReport from '../../models/GeminiPerformanceReport.js';
import { verifyToken } from '../../middleware/auth.js';
import { getMyWeeklyDigest } from '../../controllers/impactReportController.js';
import { getSchoolAdminCalendarEvents, monthBounds } from '../../controllers/calendarController.js';
import { examVisibleToSchool } from '../../utils/exam-visibility.js';
import {
  getStudentExamRanking,
  getAllStudentRankings,
} from '../../controllers/studentRankingController.js';
import geminiService, { generateStudentTool } from '../../services/gemini-service.js';
import { fetchRotatingAiToolData } from '../../services/ai-tool-rotation-service.js';
import {
  buildDeliveryMetadataFromDoc,
  buildRawDataForTool,
  unwrapStoredAiToolContent,
} from '../../utils/build-ai-tool-raw-data.js';
import {
  advancedAnalyticsMockData,
  buildPerQuestionAttemptAnalytics,
  enrichQuestionAnalyticsFromExamQuestions,
  generateAdvancedAnalytics,
} from '../../utils/advancedExamAnalytics.js';
import { normalizeSchoolBoard, resolveUserDisplayBoard } from '../../constants/boards.js';
import { QUESTION_LIST_SORT, ensureExamQuestionDisplayOrders } from '../../utils/exam-question-order.js';
import { dedupeExamResultRows } from '../../utils/dedupe-exam-results.js';
import {
  examMatchesStudentAssignedClass,
  resolveStudentClassNumber,
} from '../../utils/studentClassContent.js';
import { buildAdaptiveLearningPayload } from '../../services/student-adaptive-learning-service.js';
import {
  resolveSubjectContentIds,
  resolveSubjectContentIdsMany,
  subjectIdAllowedWithSiblings,
  resolveExamQuestionSubjectKey,
} from '../../utils/resolveSubjectContentIds.js';
import { assertAllowedFetchUrl, getContentProxyAllowlist } from '../../utils/url-allowlist.js';
import {
  buildCachedAnalysisResponse,
  cachedHasStaleAiExplanations,
  collectCachedExplanationsByQuestionId,
  getInFlight,
  inFlightKey,
  setInFlight,
  shouldRegenerateCachedReport,
} from '../../utils/examAiAnalysisCache.js';
import {
  escapeRegexClassSuffix,
  plainSubjectName,
  normalizeTopicLabel,
  subjectSlugMatches,
  topicFuzzyMatch,
  parseWeakTopicRowsFromQuery,
  resolveStudentClassDoc,
  resolveStudentSubjectIdsForLibrary,
  resolveStudentClassSubjects,
  resolveStudentContentBoard,
  getStudentAdminId,
} from './helpers.js';
`;

// Helpers block (before first route after middleware)
const helpersBody = slice(
  'function escapeRegexClassSuffix',
  "// Get student's videos",
);

fs.writeFileSync(
  join(outDir, 'helpers.js'),
  `import mongoose from 'mongoose';
import User from '../../models/User.js';
import Subject from '../../models/Subject.js';
import { resolveUserDisplayBoard } from '../../constants/boards.js';

${helpersBody.replace(/^const getStudentAdminId/, 'export const getStudentAdminId').replace(/^function /gm, 'export function ').replace(/^async function /gm, 'export async function ')}
`,
);

// Fix helpers - getStudentAdminId already has export from replace; ensure all exported
let helpersFile = fs.readFileSync(join(outDir, 'helpers.js'), 'utf8');
helpersFile = helpersFile
  .replace(/export export /g, 'export ')
  .replace(/\nconst getStudentAdminId/, '\nexport const getStudentAdminId');
fs.writeFileSync(join(outDir, 'helpers.js'), helpersFile);

function writeModule(name, body, extra = '') {
  const content = `${headerImports}
${extra}
const router = express.Router();

${body}

export default router;
`;
  fs.writeFileSync(join(outDir, name), content);
  console.log(name, content.split(/\n/).length);
}

writeModule(
  'core.js',
  slice("router.get('/weekly-digest'", "function escapeRegexClassSuffix").trim() +
    '\n' +
    // dashboard is before helpers in original - already in weekly slice? 
    // weekly-digest through dashboard is BEFORE helpers. Re-do.
    '',
);

// Fix core: weekly + dashboard are BEFORE helpers in file
const coreBody =
  slice("router.get('/weekly-digest'", 'function escapeRegexClassSuffix');
writeModule('core.js', coreBody);

writeModule(
  'videos.js',
  slice("// Get student's videos", "router.get('/assessments'"),
);

// assessments includes hydrate helpers before exams
writeModule(
  'assessments.js',
  slice("router.get('/assessments'", 'async function hydrateExamQuestions'),
);

const examHelpersAndRoutes = slice(
  'async function hydrateExamQuestions',
  "router.get('/asli-prep-content'",
);
writeModule('examsList.js', examHelpersAndRoutes);

writeModule(
  'contentLibrary.js',
  slice("router.get('/asli-prep-content'", "router.get('/iq-rank-quizzes'"),
);

writeModule(
  'iqRank.js',
  slice("router.get('/iq-rank-quizzes'", "router.post('/homework-submission'"),
);

writeModule(
  'homework.js',
  slice("router.post('/homework-submission'", "router.get('/exam-results'"),
);

writeModule(
  'examResults.js',
  slice("router.get('/exam-results'", "router.get('/rankings'"),
);

writeModule(
  'rankingsRemarks.js',
  slice("router.get('/rankings'", "router.get('/quizzes'"),
);

writeModule(
  'quizzes.js',
  slice("router.get('/quizzes'", "router.get('/video-chapter-progress'"),
);

writeModule(
  'progress.js',
  slice("router.get('/video-chapter-progress'", "router.post('/ai/tool'"),
);

writeModule(
  'aiTool.js',
  slice("router.post('/ai/tool'", "router.get('/risk-analysis-reports'"),
);

writeModule(
  'riskDiary.js',
  slice("router.get('/risk-analysis-reports'", 'const wait = (ms)'),
);

writeModule(
  'contentProxy.js',
  slice('const wait = (ms)', "router.get('/calendar/events'"),
);

writeModule(
  'calendar.js',
  slice("router.get('/calendar/events'", 'export default router'),
);

// Main student.js shell
const shell = `import express from 'express';
import mongoose from 'mongoose';
import { verifyToken } from '../middleware/auth.js';

import coreRoutes from './student/core.js';
import videosRoutes from './student/videos.js';
import assessmentsRoutes from './student/assessments.js';
import examsListRoutes from './student/examsList.js';
import contentLibraryRoutes from './student/contentLibrary.js';
import iqRankRoutes from './student/iqRank.js';
import homeworkRoutes from './student/homework.js';
import examResultsRoutes from './student/examResults.js';
import rankingsRemarksRoutes from './student/rankingsRemarks.js';
import quizzesRoutes from './student/quizzes.js';
import progressRoutes from './student/progress.js';
import aiToolRoutes from './student/aiTool.js';
import riskDiaryRoutes from './student/riskDiary.js';
import contentProxyRoutes from './student/contentProxy.js';
import calendarRoutes from './student/calendar.js';

const router = express.Router();

// iframe / window.open GETs cannot send Authorization.
// ONLY content-preview and content-download may accept ?token= (short-lived JWT).
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const pathOnly = (req.originalUrl || req.url || '').split('?')[0].replace(/\\/+$/, '') || '';
  const isProxyRoute =
    pathOnly.endsWith('/content-preview') || pathOnly.endsWith('/content-download');
  if (!isProxyRoute) return next();
  const hdr = req.headers.authorization || req.get('Authorization');
  const raw = req.query.token;
  const tokenFromQuery =
    typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '';
  if (!hdr && tokenFromQuery) {
    req.headers.authorization = \`Bearer \${tokenFromQuery}\`;
  }
  next();
});

router.use(verifyToken);

router.use((req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      message: 'User ID not found. Please log in again.',
    });
  }
  if (!mongoose.Types.ObjectId.isValid(req.userId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID format. Please log in again.',
    });
  }
  const pathOnly = (req.originalUrl || req.url || '').split('?')[0].replace(/\\/+$/, '') || '';
  const isSharedContentProxy =
    pathOnly.endsWith('/content-preview') || pathOnly.endsWith('/content-download');
  if (req.user && req.user.role !== 'student' && !isSharedContentProxy) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Student privileges required.',
    });
  }
  next();
});

router.use(coreRoutes);
router.use(videosRoutes);
router.use(assessmentsRoutes);
router.use(examsListRoutes);
router.use(contentLibraryRoutes);
router.use(iqRankRoutes);
router.use(homeworkRoutes);
router.use(examResultsRoutes);
router.use(rankingsRemarksRoutes);
router.use(quizzesRoutes);
router.use(progressRoutes);
router.use(aiToolRoutes);
router.use(riskDiaryRoutes);
router.use(contentProxyRoutes);
router.use(calendarRoutes);

export default router;
`;

fs.writeFileSync(studentPath, shell);
console.log('student.js shell written');
