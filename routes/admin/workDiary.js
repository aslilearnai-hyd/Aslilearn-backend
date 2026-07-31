import express from 'express';
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
