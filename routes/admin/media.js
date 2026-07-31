import express from 'express';
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
