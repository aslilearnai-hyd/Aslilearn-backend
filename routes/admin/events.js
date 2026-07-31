import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { join, extname } from 'path';
import fs from 'fs';
import { verifyToken, verifySuperAdmin, verifyAdmin } from '../../middleware/auth.js';
import { extractAuthToken } from '../../utils/auth-cookie.js';
import {
  generateProvisionalPassword,
  resolveTenantAdminId,
  SAFE_USER_UPDATE_FIELDS,
} from '../../utils/secure-tenant.js';
import { cleanCsvCell } from '../../utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from '../../utils/spreadsheet-to-csv.js';
import User from '../../models/User.js';
import Video from '../../models/Video.js';
import LearningPath from '../../models/LearningPath.js';
import Assessment from '../../models/Assessment.js';
import Teacher from '../../models/Teacher.js';
import Subject from '../../models/Subject.js';
import Exam from '../../models/Exam.js';
import Question from '../../models/Question.js';
import Event from '../../models/Event.js';
import { getBackendRoot } from '../../bootstrap/env.js';

const router = express.Router();
const __dirname = getBackendRoot();

const requireAuth = (req, res, next) => {
  const token = extractAuthToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    req.userId = decoded.userId || decoded.id || decoded._id;
    req.isAuthenticated = () => true;
    next();
  } catch {
    res.status(401).json({ message: 'Not authenticated' });
  }
};
const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 'admin') return next();
  res.status(403).json({ message: 'Admin access required' });
};

const buildSafeAppendQuestionPipeline = (questionId) => [
  { $set: { questions: { $cond: [{ $isArray: '$questions' }, '$questions', []] } } },
  { $set: { questions: { $concatArrays: ['$questions', [questionId]] } } },
];
const buildSafeRemoveQuestionPipeline = (questionId) => [
  { $set: { questions: { $cond: [{ $isArray: '$questions' }, '$questions', []] } } },
  {
    $set: {
      questions: {
        $filter: {
          input: '$questions',
          as: 'existingQuestionId',
          cond: { $ne: ['$$existingQuestionId', questionId] },
        },
      },
    },
  },
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ok =
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      mime === 'text/csv' ||
      mime === 'application/vnd.ms-excel' ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/msword' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ok) return cb(null, true);
    return cb(new Error('Unsupported file type'), false);
  },
});

// Event photo upload storage
const eventPhotoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = join(__dirname, 'uploads', 'events');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = extname(file.originalname);
    cb(null, 'event-' + uniqueSuffix + ext);
  }
});

const eventPhotoUpload = multer({ 
  storage: eventPhotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit (increased from 5MB)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Admin event management
// GET all events
router.get('/events', async (req, res) => {
  try {
    // Validate user
    if (!req.user || (!req.user._id && !req.user.id)) {
      console.error('GET /api/admin/events - User not found in request:', req.user);
      return res.status(401).json({ message: 'Unauthorized: User not found' });
    }

    // Get user ID from JWT payload (could be userId, _id, or id)
    let userId = req.user.userId || req.user._id || req.user.id;
    
    // If userId is in JWT but we need the actual user document, fetch it
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      // Try to find user by email if userId is not a valid ObjectId
      const user = await User.findOne({ 
        $or: [
          { email: req.user.email },
          { _id: userId }
        ],
        role: 'admin'
      });
      if (user) {
        userId = user._id;
        console.log('Found admin user from email:', user.email, 'ID:', userId);
      }
    }
    
    // Handle development mode where userId might be a string like 'dev-admin'
    // In this case, we need to find a real admin user or skip the query
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      console.log('Development mode detected, finding real admin user...');
      // Find the first admin user in the database
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
        console.log('Using admin user ID:', userId);
      } else {
        // No admin users found, return empty array
        console.log('No admin users found, returning empty events array');
        return res.json([]);
      }
    }
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid user ID format:', userId);
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    console.log('GET /api/admin/events - Fetching events for user:', userId);
    
    // Check if Event model is available
    if (!Event) {
      console.error('Event model is not available');
      return res.status(500).json({ message: 'Event model not available' });
    }
    
    // Use ObjectId for proper matching
    const userObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) 
      : userId;
    
    const events = await Event.find({ createdBy: userObjectId })
      .sort({ date: 1 });
    
    console.log(`GET /api/admin/events - Found ${events.length} events for user ${userId}`);
    res.json(events);
  } catch (error) {
    console.error('GET /api/admin/events - Failed to fetch events:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      message: 'Failed to fetch events',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// POST create event
router.post('/events', (req, res, next) => {
  eventPhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          message: 'File too large. Maximum size is 10MB.' 
        });
      }
      if (err.message === 'Only image files are allowed!') {
        return res.status(400).json({ 
          message: 'Only image files are allowed.' 
        });
      }
      return res.status(500).json({ 
        message: 'File upload error',
        error: err.message 
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    console.log('Event creation request received:', {
      body: req.body,
      hasFile: !!req.file,
      user: req.user ? { 
        userId: req.user.userId, 
        _id: req.user._id, 
        id: req.user.id, 
        email: req.user.email,
        role: req.user.role 
      } : 'No user'
    });

    const { name, date, description } = req.body;
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Event name is required' });
    }
    
    if (!date) {
      return res.status(400).json({ message: 'Event date is required' });
    }

    // Validate date format - parse as local date to avoid timezone issues
    // Date string format: YYYY-MM-DD
    let eventDate;
    if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Parse as local date (not UTC) to preserve the exact date
      const [year, month, day] = date.split('-').map(Number);
      eventDate = new Date(year, month - 1, day);
    } else {
      eventDate = new Date(date);
    }
    
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
    
    console.log('Event date parsed:', {
      inputDate: date,
      parsedDate: eventDate,
      year: eventDate.getFullYear(),
      month: eventDate.getMonth() + 1,
      day: eventDate.getDate()
    });

    // Validate user
    if (!req.user) {
      console.error('User not found in request:', req.user);
      return res.status(401).json({ message: 'Unauthorized: User not found' });
    }

    // Get user ID from JWT payload (could be userId, _id, or id)
    let userId = req.user.userId || req.user._id || req.user.id;
    
    console.log('Initial userId from JWT:', userId, 'Type:', typeof userId, 'Email:', req.user.email);
    
    // If userId is not a valid ObjectId, try to find user by email
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      console.log('userId is not a valid ObjectId, looking up user by email:', req.user.email);
      if (!req.user.email) {
        return res.status(400).json({ message: 'User email not found in token' });
      }
      
      try {
        // Try to find user by email - try multiple approaches
        const emailLower = req.user.email.toLowerCase().trim();
        
        // First try: exact lowercase match
        let user = await User.findOne({ 
          email: emailLower,
          role: 'admin'
        });
        
        // Second try: case-insensitive with regex (if first fails)
        if (!user) {
          user = await User.findOne({ 
            email: { $regex: new RegExp(`^${emailLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            role: 'admin'
          });
        }
        
        // Third try: find any user with this email, then check role
        if (!user) {
          const anyUser = await User.findOne({ email: emailLower });
          if (anyUser && anyUser.role === 'admin') {
            user = anyUser;
          }
        }
        
        if (user) {
          userId = user._id;
          console.log('Found admin user from email for event creation:', user.email, 'ID:', userId);
        } else {
          console.error('Could not find admin user with email:', req.user.email);
          // List all admin emails for debugging
          const allAdmins = await User.find({ role: 'admin' }).select('email');
          console.log('Available admin emails:', allAdmins.map(a => a.email));
          return res.status(404).json({ 
            message: `Admin user not found with email: ${req.user.email}`,
            availableAdmins: allAdmins.map(a => a.email)
          });
        }
      } catch (dbError) {
        console.error('Database error while looking up user:', dbError);
        console.error('Error name:', dbError.name);
        console.error('Error message:', dbError.message);
        console.error('Error stack:', dbError.stack);
        return res.status(500).json({ 
          message: 'Database error while looking up user', 
          error: dbError.message,
          errorName: dbError.name
        });
      }
    }
    
    // Handle development mode where userId might be a string like 'dev-admin'
    // In this case, we need to find a real admin user
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      console.log('Development mode detected, finding real admin user...');
      // Find the first admin user in the database
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
        console.log('Using admin user ID for event creation:', userId);
      } else {
        return res.status(400).json({ message: 'No admin user found in database' });
      }
    }
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid user ID format after processing:', userId, 'Type:', typeof userId);
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    console.log('Final userId for event creation:', userId, 'Type:', typeof userId);

    // Ensure uploads/events directory exists
    const eventsUploadDir = join(__dirname, 'uploads', 'events');
    if (!fs.existsSync(eventsUploadDir)) {
      fs.mkdirSync(eventsUploadDir, { recursive: true });
    }
    
    let photoUrl = '';
    if (req.file) {
      photoUrl = `${req.protocol}://${req.get('host')}/uploads/events/${req.file.filename}`;
    }

    // Check if Event model is available
    if (!Event) {
      console.error('Event model is not available');
      return res.status(500).json({ message: 'Event model not available' });
    }

    // Ensure userId is converted to ObjectId
    const createdByObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) 
      : userId;

    console.log('Creating event with createdBy:', createdByObjectId.toString(), 'Type:', typeof createdByObjectId, 'for user:', userId);

    const newEvent = new Event({
      name: name.trim(),
      date: new Date(date),
      description: description || '',
      photo: photoUrl,
      createdBy: createdByObjectId
    });
    
    console.log('Event object before save:', {
      name: newEvent.name,
      date: newEvent.date,
      createdBy: newEvent.createdBy.toString(),
      createdByType: typeof newEvent.createdBy
    });

    const savedEvent = await newEvent.save();
    console.log('Event created successfully:', {
      eventId: savedEvent._id,
      name: savedEvent.name,
      createdBy: savedEvent.createdBy.toString(),
      date: savedEvent.date
    });
    res.status(201).json(savedEvent);
  } catch (error) {
    console.error('Failed to create event - Full error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Failed to create event', 
      error: error.message,
      errorName: error.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// PUT update event
router.put('/events/:id', eventPhotoUpload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date, description } = req.body;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Get user ID from JWT
    let userId = req.user.userId || req.user._id || req.user.id;
    
    // If userId is in JWT but we need the actual user document, fetch it
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      const user = await User.findOne({ 
        $or: [
          { email: req.user.email },
          { _id: userId }
        ],
        role: 'admin'
      });
      if (user) {
        userId = user._id;
      }
    }
    
    // Handle development mode
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
      }
    }
    
    // Check if user owns this event
    if (event.createdBy.toString() !== userId.toString()) {
      console.error('User does not own this event:', {
        eventCreatedBy: event.createdBy.toString(),
        userId: userId.toString()
      });
      return res.status(403).json({ message: 'Unauthorized to update this event' });
    }

    let photoUrl = event.photo;
    if (req.file) {
      // Delete old photo if exists
      if (event.photo) {
        const oldPhotoPath = event.photo.replace(`${req.protocol}://${req.get('host')}`, '');
        const fullPath = join(__dirname, oldPhotoPath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
      photoUrl = `${req.protocol}://${req.get('host')}/uploads/events/${req.file.filename}`;
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      id,
      {
        name,
        date: new Date(date),
        description: description || '',
        photo: photoUrl,
        updatedAt: new Date()
      },
      { new: true }
    );

    res.json(updatedEvent);
  } catch (error) {
    console.error('Failed to update event:', error);
    res.status(500).json({ message: 'Failed to update event', error: error.message });
  }
});

// DELETE event
router.delete('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Get user ID from JWT payload (could be userId, _id, or id)
    let userId = req.user.userId || req.user._id || req.user.id;
    
    // If userId is in JWT but we need the actual user document, fetch it
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      // Try to find user by email if userId is not a valid ObjectId
      const user = await User.findOne({ 
        $or: [
          { email: req.user.email },
          { _id: userId }
        ],
        role: 'admin'
      });
      if (user) {
        userId = user._id;
        console.log('Found admin user from email for event deletion:', user.email, 'ID:', userId);
      }
    }
    
    // Handle development mode where userId might be a string like 'dev-admin'
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      console.log('Development mode detected, finding real admin user...');
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
        console.log('Using admin user ID for event deletion:', userId);
      } else {
        return res.status(400).json({ message: 'No admin user found in database' });
      }
    }
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid user ID format:', userId);
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    // Check if user owns this event
    if (event.createdBy.toString() !== userId.toString()) {
      console.error('User does not own this event:', {
        eventCreatedBy: event.createdBy.toString(),
        userId: userId.toString()
      });
      return res.status(403).json({ message: 'Unauthorized to delete this event' });
    }

    // Delete photo if exists
    if (event.photo) {
      const photoPath = event.photo.replace(`${req.protocol}://${req.get('host')}`, '');
      const fullPath = join(__dirname, photoPath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    await Event.findByIdAndDelete(id);
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Failed to delete event:', error);
    res.status(500).json({ message: 'Failed to delete event', error: error.message });
  }
});

export default router;
