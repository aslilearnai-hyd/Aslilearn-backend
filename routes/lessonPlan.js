import express from 'express';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/generate', verifyToken, async (req, res) => {
  try {
    const { subject, topic, gradeLevel, duration } = req.body;
    
    if (!subject || !topic || !gradeLevel) {
      return res.status(400).json({ 
        success: false, 
        message: 'Subject, topic, and grade level are required' 
      });
    }

    // Use the dedicated generateLessonPlan function instead of chat service
    const geminiServiceModule = await import('../services/gemini-service.js');
    const lessonPlan = await geminiServiceModule.generateLessonPlan(subject, topic, gradeLevel, duration || 90);
    
    res.json({
      success: true,
      lessonPlan: lessonPlan
    });
    
  } catch (error) {
    console.error('Lesson plan generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate lesson plan',
      error: error.message 
    });
  }
});

export default router;
