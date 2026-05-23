import express from 'express';
import mongoose from 'mongoose';
import Stream from '../models/Stream.js';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Subject from '../models/Subject.js';
import { verifyToken, verifyAdmin, extractAdminId, verifyTeacher } from '../middleware/auth.js';
import {
  resolveStudentClassNumber,
  filterContentsForStudentClass,
  classLabelFromContent,
  normalizeClassNumberLabel,
} from '../utils/studentClassContent.js';

const router = express.Router();

// Get all streams for admin (filtered by adminId)
router.get('/admin/streams', verifyToken, verifyAdmin, extractAdminId, async (req, res) => {
  try {
    const adminId = req.adminId;
    const { status, subject, board } = req.query;

    const query = { adminId: adminId };

    if (status && status !== 'all') {
      query.status = status;
    }
    if (subject && subject !== 'all') {
      query.subject = subject;
    }
    if (board && board !== 'all') {
      query.board = board;
    }

    const streams = await Stream.find(query)
      .populate('streamer', 'fullName email')
      .populate('streamerTeacher', 'fullName email')
      .populate('subject', 'name')
      .sort({ scheduledStartTime: -1 });

    res.json({
      success: true,
      data: streams
    });
  } catch (error) {
    console.error('Error fetching streams:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch streams' });
  }
});

function plainSubjectNameStream(name) {
  if (!name || typeof name !== 'string') return '';
  const m = name.match(/^(.+?)_\d+$/);
  return m ? m[1] : name;
}

function classLabelFromStream(s) {
  const cn = s.classNumber;
  if (cn != null && String(cn).trim() !== '') return String(cn).trim();
  const n = s.subject?.name || '';
  const m = n.match(/_(\d+)$/);
  return m ? m[1] : '';
}

// Get live streams for students (filtered by board and class assigned subjects)
router.get('/student/streams', verifyToken, async (req, res) => {
  try {
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board')
      .populate('assignedClass', 'classNumber section assignedSubjects');

    if (!student) {
      return res.json({ success: true, data: [] });
    }

    // Get student's board
    let studentBoard = student.board;
    if (!studentBoard && student.assignedAdmin) {
      const admin = await User.findById(student.assignedAdmin).select('board');
      if (admin && admin.board) {
        studentBoard = admin.board;
      }
    }

    if (!studentBoard) {
      return res.json({ success: true, data: [] });
    }

    studentBoard = studentBoard.toUpperCase();

    // Get subjects assigned to student's class
    const Class = (await import('../models/Class.js')).default;
    let classSubjectIds = [];

    if (student.assignedClass) {
      let studentClass;
      if (typeof student.assignedClass === 'object' && student.assignedClass._id) {
        studentClass = student.assignedClass;
      } else {
        studentClass = await Class.findById(student.assignedClass)
          .populate('assignedSubjects');
      }

      if (studentClass && studentClass.assignedSubjects && studentClass.assignedSubjects.length > 0) {
        classSubjectIds = studentClass.assignedSubjects.map(subj =>
          subj._id ? subj._id : subj
        );
      }
    }

    // Fallback: find class by classNumber
    if (classSubjectIds.length === 0 && student.classNumber && student.classNumber !== 'Unassigned') {
      const studentClass = await Class.findOne({
        classNumber: student.classNumber,
        assignedAdmin: student.assignedAdmin,
        isActive: true
      })
      .populate('assignedSubjects');

      if (studentClass && studentClass.assignedSubjects && studentClass.assignedSubjects.length > 0) {
        classSubjectIds = studentClass.assignedSubjects.map(subj =>
          subj._id ? subj._id : subj
        );
      }
    }

    // Build query - only live or scheduled streams
    const query = {
      board: studentBoard,
      status: { $in: ['live', 'scheduled'] },
      isActive: true
    };

    // Filter by class assigned subjects if available
    if (classSubjectIds.length > 0) {
      query.subject = { $in: classSubjectIds };
    }

    let streams = await Stream.find(query)
      .populate('streamer', 'fullName email')
      .populate('streamerTeacher', 'fullName email')
      .populate('subject', 'name')
      .sort({ scheduledStartTime: -1 });

    const studentClassNum = resolveStudentClassNumber(student, student.assignedClass);
    streams = filterContentsForStudentClass(streams, studentClassNum, classSubjectIds);

    const { class: classQ, subject: subjectQ } = req.query;
    if (classQ && classQ !== 'all' && String(classQ).trim() !== '') {
      const want = normalizeClassNumberLabel(classQ);
      if (studentClassNum && want && want !== studentClassNum) {
        streams = [];
      } else if (want) {
        streams = streams.filter(
          (s) => normalizeClassNumberLabel(classLabelFromContent(s)) === want
        );
      }
    }
    if (
      subjectQ &&
      subjectQ !== 'all' &&
      String(subjectQ).trim() !== '' &&
      !mongoose.Types.ObjectId.isValid(subjectQ)
    ) {
      const want = String(subjectQ).trim().toLowerCase();
      streams = streams.filter(
        (s) => plainSubjectNameStream(s.subject?.name || '').toLowerCase() === want
      );
    }

    res.json({
      success: true,
      data: streams
    });
  } catch (error) {
    console.error('Error fetching student streams:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch streams' });
  }
});

// Get streams for teacher (filtered by teacher's assigned subjects)
router.get('/teacher/streams', verifyToken, verifyTeacher, async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const teacher = await Teacher.findById(teacherId).populate('subjects');

    if (!teacher) {
      return res.json({ success: true, data: [] });
    }

    const assignedSubjectIds = teacher.subjects?.map(s => s._id || s) || [];

    if (assignedSubjectIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const query = {
      adminId: teacher.adminId,
      subject: { $in: assignedSubjectIds },
      isActive: true
    };

    const streams = await Stream.find(query)
      .populate('streamer', 'fullName email')
      .populate('streamerTeacher', 'fullName email')
      .populate('subject', 'name')
      .sort({ scheduledStartTime: -1 });

    res.json({
      success: true,
      data: streams
    });
  } catch (error) {
    console.error('Error fetching teacher streams:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch streams' });
  }
});

// Get all streams for super admin (no filtering)
router.get('/super-admin/streams', verifyToken, async (req, res) => {
  try {
    // Check if user is super admin
    const user = await User.findById(req.userId);
    if (!user || user.role !== 'super-admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super admin only.'
      });
    }

    const { status, subject, board } = req.query;

    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }
    if (subject && subject !== 'all') {
      query.subject = subject;
    }
    if (board && board !== 'all') {
      query.board = board;
    }

    const streams = await Stream.find(query)
      .populate('streamer', 'fullName email')
      .populate('streamerTeacher', 'fullName email')
      .populate('subject', 'name')
      .sort({ scheduledStartTime: -1 });

    res.json({
      success: true,
      data: streams
    });
  } catch (error) {
    console.error('Error fetching streams:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch streams' });
  }
});

// Create a new stream (admin or teacher)
router.post('/streams', verifyToken, extractAdminId, async (req, res) => {
  try {
    const adminId = req.adminId;
    const userId = req.userId;
    const userRole = req.user?.role;

    const {
      title,
      description,
      subject,
      board,
      classNumber,
      scheduledStartTime,
      maxViewers,
      isChatEnabled,
      isRecording,
      streamType
    } = req.body;

    // Validate required fields
    if (!title || !subject || !board || !scheduledStartTime) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, subject, board, scheduledStartTime'
      });
    }

    // Check if user is admin or teacher
    let streamerId = null;
    let streamerTeacherId = null;

    if (userRole === 'admin') {
      streamerId = userId;
    } else if (userRole === 'teacher') {
      const Teacher = (await import('../models/Teacher.js')).default;
      const teacher = await Teacher.findOne({ email: req.user?.email });
      if (teacher) {
        streamerTeacherId = teacher._id;
        // Use teacher's adminId
        const finalAdminId = teacher.adminId || adminId;
        
        const stream = new Stream({
          title,
          description: description || '',
          streamer: null,
          streamerTeacher: streamerTeacherId,
          subject,
          board: board.toUpperCase(),
          classNumber: classNumber || null,
          status: 'scheduled',
          scheduledStartTime: new Date(scheduledStartTime),
          streamUrl: '', // Will be generated when stream starts
          playbackUrl: '', // Will be generated when stream starts
          streamKey: generateStreamKey(), // Generate unique stream key
          viewerCount: 0,
          maxViewers: maxViewers || 0,
          isRecording: isRecording || false,
          isChatEnabled: isChatEnabled !== false,
          adminId: finalAdminId,
          streamType: streamType || 'live'
        });

        await stream.save();
        await stream.populate('subject', 'name');
        await stream.populate('streamerTeacher', 'fullName email');

        return res.json({
          success: true,
          data: stream,
          message: 'Stream created successfully'
        });
      }
    }

    // Admin or super admin stream creation
    const stream = new Stream({
      title,
      description: description || '',
      streamer: userRole === 'super-admin' ? userId : streamerId,
      streamerTeacher: null,
      subject,
      board: board.toUpperCase(),
      classNumber: classNumber || null,
      status: 'scheduled',
      scheduledStartTime: new Date(scheduledStartTime),
      streamUrl: '',
      playbackUrl: '',
      streamKey: generateStreamKey(),
      viewerCount: 0,
      maxViewers: maxViewers || 0,
      isRecording: isRecording || false,
      isChatEnabled: isChatEnabled !== false,
      adminId: adminId || null, // Can be null for super admin
      streamType: streamType || 'live'
    });

    await stream.save();
    await stream.populate('subject', 'name');
    await stream.populate('streamer', 'fullName email');

    res.json({
      success: true,
      data: stream,
      message: 'Stream created successfully'
    });
  } catch (error) {
    console.error('Error creating stream:', error);
    res.status(500).json({ success: false, message: 'Failed to create stream' });
  }
});

// Update stream
router.put('/streams/:id', verifyToken, extractAdminId, async (req, res) => {
  try {
    const adminId = req.adminId;
    const streamId = req.params.id;
    const user = await User.findById(req.userId);

    // Super admin can update any stream, others need matching adminId
    const query = user?.role === 'super-admin' 
      ? { _id: streamId }
      : { _id: streamId, adminId };

    const stream = await Stream.findOne(query);

    if (!stream) {
      return res.status(404).json({ success: false, message: 'Stream not found' });
    }

    const {
      title,
      description,
      subject,
      board,
      classNumber,
      scheduledStartTime,
      maxViewers,
      isChatEnabled,
      isRecording,
      status
    } = req.body;

    if (title) stream.title = title;
    if (description !== undefined) stream.description = description;
    if (subject) stream.subject = subject;
    if (board) stream.board = board.toUpperCase();
    if (classNumber !== undefined) stream.classNumber = classNumber;
    if (scheduledStartTime) stream.scheduledStartTime = new Date(scheduledStartTime);
    if (maxViewers !== undefined) stream.maxViewers = maxViewers;
    if (isChatEnabled !== undefined) stream.isChatEnabled = isChatEnabled;
    if (isRecording !== undefined) stream.isRecording = isRecording;
    if (status) stream.status = status;

    await stream.save();
    await stream.populate('subject', 'name');
    await stream.populate('streamer', 'fullName email');
    await stream.populate('streamerTeacher', 'fullName email');

    res.json({
      success: true,
      data: stream,
      message: 'Stream updated successfully'
    });
  } catch (error) {
    console.error('Error updating stream:', error);
    res.status(500).json({ success: false, message: 'Failed to update stream' });
  }
});

// Start stream (update status to live and generate stream URLs)
router.post('/streams/:id/start', verifyToken, extractAdminId, async (req, res) => {
  try {
    const adminId = req.adminId;
    const streamId = req.params.id;
    const user = await User.findById(req.userId);

    // Super admin can start any stream, others need matching adminId
    const query = user?.role === 'super-admin' 
      ? { _id: streamId }
      : { _id: streamId, adminId };

    const stream = await Stream.findOne(query);

    if (!stream) {
      return res.status(404).json({ success: false, message: 'Stream not found' });
    }

    if (stream.status === 'live') {
      return res.status(400).json({ success: false, message: 'Stream is already live' });
    }

    // Generate stream URLs (this would integrate with your streaming service)
    // For now, using placeholder URLs - you'll replace these with actual streaming service URLs
    const streamUrl = generateStreamUrl(stream.streamKey);
    const playbackUrl = generatePlaybackUrl(stream.streamKey);

    stream.status = 'live';
    stream.actualStartTime = new Date();
    stream.streamUrl = streamUrl;
    stream.playbackUrl = playbackUrl;

    await stream.save();
    await stream.populate('subject', 'name');
    await stream.populate('streamer', 'fullName email');
    await stream.populate('streamerTeacher', 'fullName email');

    res.json({
      success: true,
      data: stream,
      message: 'Stream started successfully'
    });
  } catch (error) {
    console.error('Error starting stream:', error);
    res.status(500).json({ success: false, message: 'Failed to start stream' });
  }
});

// End stream
router.post('/streams/:id/end', verifyToken, extractAdminId, async (req, res) => {
  try {
    const adminId = req.adminId;
    const streamId = req.params.id;
    const user = await User.findById(req.userId);

    // Super admin can end any stream, others need matching adminId
    const query = user?.role === 'super-admin' 
      ? { _id: streamId }
      : { _id: streamId, adminId };

    const stream = await Stream.findOne(query);

    if (!stream) {
      return res.status(404).json({ success: false, message: 'Stream not found' });
    }

    stream.status = 'ended';
    stream.endTime = new Date();

    // If recording was enabled, generate recording URL
    if (stream.isRecording) {
      // This would integrate with your streaming service to get the recording
      stream.recordingUrl = generateRecordingUrl(stream.streamKey);
    }

    await stream.save();
    await stream.populate('subject', 'name');
    await stream.populate('streamer', 'fullName email');
    await stream.populate('streamerTeacher', 'fullName email');

    res.json({
      success: true,
      data: stream,
      message: 'Stream ended successfully'
    });
  } catch (error) {
    console.error('Error ending stream:', error);
    res.status(500).json({ success: false, message: 'Failed to end stream' });
  }
});

// Delete stream
router.delete('/streams/:id', verifyToken, extractAdminId, async (req, res) => {
  try {
    const adminId = req.adminId;
    const streamId = req.params.id;
    const user = await User.findById(req.userId);

    // Super admin can delete any stream, others need matching adminId
    const query = user?.role === 'super-admin' 
      ? { _id: streamId }
      : { _id: streamId, adminId };

    const stream = await Stream.findOne(query);

    if (!stream) {
      return res.status(404).json({ success: false, message: 'Stream not found' });
    }

    // Don't allow deletion of live streams
    if (stream.status === 'live') {
      return res.status(400).json({ success: false, message: 'Cannot delete live stream' });
    }

    await Stream.findByIdAndDelete(streamId);

    res.json({
      success: true,
      message: 'Stream deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting stream:', error);
    res.status(500).json({ success: false, message: 'Failed to delete stream' });
  }
});

// Get single stream by ID
router.get('/streams/:id', verifyToken, async (req, res) => {
  try {
    const streamId = req.params.id;

    const stream = await Stream.findById(streamId)
      .populate('streamer', 'fullName email')
      .populate('streamerTeacher', 'fullName email')
      .populate('subject', 'name');

    if (!stream) {
      return res.status(404).json({ success: false, message: 'Stream not found' });
    }

    res.json({
      success: true,
      data: stream
    });
  } catch (error) {
    console.error('Error fetching stream:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stream' });
  }
});

// Helper functions
function generateStreamKey() {
  // Generate a unique stream key
  return `stream_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

function generateStreamUrl(streamKey) {
  // This would integrate with your streaming service (e.g., RTMP URL)
  // Example: `rtmp://your-streaming-server.com/live/${streamKey}`
  // For WebRTC: `wss://your-signaling-server.com/${streamKey}`
  // For HLS: `https://your-cdn.com/live/${streamKey}.m3u8`
  return `rtmp://localhost:1935/live/${streamKey}`;
}

function getStreamPublicBaseUrl() {
  const base =
    process.env.BASE_URL ||
    process.env.API_BASE_URL ||
    `http://localhost:${process.env.PORT || 5000}`;
  return base.replace(/\/$/, '');
}

function generatePlaybackUrl(streamKey) {
  // This would integrate with your streaming service (e.g., HLS playback URL)
  const baseUrl = getStreamPublicBaseUrl();
  return `${baseUrl}/live/${streamKey}.m3u8`;
}

function generateRecordingUrl(streamKey) {
  // This would integrate with your streaming service to get the recording
  const baseUrl = getStreamPublicBaseUrl();
  return `${baseUrl}/recordings/${streamKey}.mp4`;
}

export default router;

