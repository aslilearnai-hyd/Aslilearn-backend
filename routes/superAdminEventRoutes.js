import express from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import User from '../models/User.js';

const router = express.Router();

router.get('/events/:adminId', async (req, res) => {
  try {
    const { adminId } = req.params;
    
    // Validate adminId format
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(400).json({ message: 'Invalid admin ID format' });
    }
    
    // Convert to ObjectId for proper matching
    const adminObjectId = new mongoose.Types.ObjectId(adminId);
    
    // Verify admin exists
    const admin = await User.findById(adminObjectId);
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }
    
    if (admin.role !== 'admin') {
      return res.status(403).json({ message: 'User is not an admin' });
    }

    const events = await Event.find({ createdBy: adminObjectId }).sort({ date: 1 });
    res.json({ success: true, data: events, admin: { id: admin._id, email: admin.email, fullName: admin.fullName } });
  } catch (error) {
    console.error('Failed to fetch admin events:', error);
    res.status(500).json({ message: 'Failed to fetch events', error: error.message });
  }
});

// Admin assessment management — use authenticated handlers registered elsewhere; legacy stubs removed




export default router;
