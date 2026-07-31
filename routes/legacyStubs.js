import express from 'express';
const router = express.Router();
const gone = (msg = 'Removed.') => (_req, res) =>
  res.status(410).json({ success: false, message: msg });

router.post('/api/quizzes', gone());
router.put('/api/quizzes/:id', gone());
router.delete('/api/quizzes/:id', gone());
router.patch('/api/quizzes/:id/toggle', gone());
router.get('/api/videos/legacy-public', gone());
router.post('/api/videos', gone());
router.post('/api/subjects', gone());
router.put('/api/subjects/:id', gone());
router.delete('/api/subjects/:id', gone());
router.post('/api/subjects/:id/videos', gone());
router.post('/api/subjects/:id/quizzes', gone());
router.post('/api/admin/assessments-legacy-unauth', gone());
router.put('/api/admin/assessments/:id/legacy-unauth', gone());
router.delete('/api/admin/assessments/:id/legacy-unauth', gone());
router.get('/api/admin/exams', (_req, res) => res.status(410).json({ success: false, message: 'Use /api/admin/exams/viewable' }));
router.post('/api/admin/exams', (_req, res) => res.status(403).json({ success: false, message: 'Admins cannot create or edit exams' }));
router.put('/api/admin/exams/:id', (_req, res) => res.status(403).json({ success: false, message: 'Admins cannot create or edit exams' }));
router.delete('/api/admin/exams/:id', (_req, res) => res.status(403).json({ success: false, message: 'Admins cannot create or edit exams' }));
router.post('/api/test-video', gone());
router.post('/api/test-video-simple', gone());
router.post('/api/super-simple-video', gone());
router.post('/api/create-assessment', gone());
router.post('/api/emergency-video-create', gone());
router.post('/api/teacher-assessments-admin-style', gone());

export default router;
