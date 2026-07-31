import express from 'express';
import LearningPath from '../../models/LearningPath.js';

const router = express.Router();

router.post('/learning-paths', async (req, res) => {
  try {
    const { title, description, subjectIds, difficulty, estimatedHours, videoIds } = req.body;
    
    const newPath = new LearningPath({
      title,
      description,
      subjectIds,
      difficulty,
      estimatedHours,
      videoIds: videoIds || []
    });

    await newPath.save();
    res.status(201).json(newPath);
  } catch (error) {
    console.error('Failed to create learning path:', error);
    res.status(500).json({ message: 'Failed to create learning path' });
  }
});

router.put('/learning-paths/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const updatedPath = await LearningPath.findByIdAndUpdate(
      id, 
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    if (!updatedPath) {
      return res.status(404).json({ message: 'Learning path not found' });
    }

    res.json(updatedPath);
  } catch (error) {
    console.error('Failed to update learning path:', error);
    res.status(500).json({ message: 'Failed to update learning path' });
  }
});

router.delete('/learning-paths/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedPath = await LearningPath.findByIdAndDelete(id);

    if (!deletedPath) {
      return res.status(404).json({ message: 'Learning path not found' });
    }

    res.json({ message: 'Learning path deleted successfully' });
  } catch (error) {
    console.error('Failed to delete learning path:', error);
    res.status(500).json({ message: 'Failed to delete learning path' });
  }
});

export default router;
