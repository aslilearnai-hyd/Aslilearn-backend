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
import { normalizeYoutubeEmbedUrl, isValidYouTubeUrl } from '../utils/youtubeEmbed.js';

const router = express.Router();

const VISIBILITY_FOR_STUDENT = ['student', 'both'];
const VISIBILITY_FOR_TEACHER = ['teacher', 'both'];

function isYoutubeSession(stream) {
  return !!(stream?.youtubeUrl || stream?.youtubeEmbedUrl);
}

function visibilityMatchesRole(visibility, role) {
  const v = visibility || 'both';
  if (role === 'student') return VISIBILITY_FOR_STUDENT.includes(v);
  if (role === 'teacher') return VISIBILITY_FOR_TEACHER.includes(v);
  return true;
}

function isSuperAdminRequest(req) {
  return req.user?.role === 'super-admin';
}

async function loadRequestUser(req, select) {
  const userId = req.userId;
  const role = req.user?.role;

  // Teachers authenticate with Teacher collection id in JWT, not User id
  if (role === 'teacher') {
    const teacherId = req.teacherId || userId;
    let teacher = null;
    if (teacherId && mongoose.Types.ObjectId.isValid(String(teacherId))) {
      teacher = await Teacher.findById(teacherId).select('fullName email adminId');
    }
    if (!teacher && req.user?.email) {
      teacher = await Teacher.findOne({ email: req.user.email }).select('fullName email adminId');
    }
    if (teacher) {
      return {
        _id: teacher._id,
        role: 'teacher',
        fullName: teacher.fullName || '',
        email: teacher.email || req.user?.email || '',
        assignedAdmin: teacher.adminId,
      };
    }
  }

  if (userId && mongoose.Types.ObjectId.isValid(String(userId))) {
    const query = User.findById(userId);
    const user = await (select ? query.select(select) : query);
    if (user) return user;
  }

  if (isSuperAdminRequest(req)) {
    return {
      _id: userId,
      role: 'super-admin',
      fullName: req.user?.fullName || req.user?.name || 'Super Admin',
      email: req.user?.email || '',
    };
  }

  if (role && req.user?.email) {
    return {
      _id: userId,
      role,
      fullName: req.user.fullName || req.user.name || '',
      email: req.user.email,
    };
  }

  return null;
}

async function assertSuperAdmin(req) {
  if (isSuperAdminRequest(req)) {
    return req.user;
  }
  const userId = req.userId;
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    const err = new Error('Access denied. Super admin only.');
    err.status = 403;
    throw err;
  }
  const user = await User.findById(userId).select('role');
  if (!user || user.role !== 'super-admin') {
    const err = new Error('Access denied. Super admin only.');
    err.status = 403;
    throw err;
  }
  return user;
}

function formatStreamRow(stream) {
  const row = stream.toObject ? stream.toObject() : { ...stream };
  row.joinCount = Array.isArray(row.joinLogs) ? row.joinLogs.length : 0;
  const schoolNames = [];
  if (Array.isArray(row.schoolAdminIds)) {
    for (const school of row.schoolAdminIds) {
      if (school?.schoolName) schoolNames.push(school.schoolName);
    }
  }
  if (schoolNames.length === 0 && row.adminId?.schoolName) {
    schoolNames.push(row.adminId.schoolName);
  }
  row.schoolNames = schoolNames;
  return row;
}

function schoolAccessFilter(schoolAdminId) {
  const id = schoolAdminId?._id || schoolAdminId;
  if (!id) return null;
  return {
    $or: [
      { adminId: id },
      { schoolAdminIds: id },
    ],
  };
}

function streamBelongsToSchool(stream, schoolAdminId) {
  const target = String(schoolAdminId?._id || schoolAdminId || '');
  if (!target) return false;
  if (String(stream.adminId?._id || stream.adminId || '') === target) return true;
  const ids = stream.schoolAdminIds || [];
  return ids.some((id) => String(id?._id || id) === target);
}

async function resolveSchoolAdminIds(input) {
  const raw = Array.isArray(input?.schoolAdminIds)
    ? input.schoolAdminIds
    : input?.schoolAdminId
      ? [input.schoolAdminId]
      : [];

  const unique = [...new Set(raw.map((id) => String(id)).filter(Boolean))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );
  if (unique.length === 0) return { ids: [], admins: [] };

  const admins = await User.find({ _id: { $in: unique }, role: 'admin' }).select('board schoolName');
  if (admins.length !== unique.length) {
    const err = new Error('One or more selected schools are invalid or have no admin account');
    err.status = 400;
    throw err;
  }

  return { ids: admins.map((a) => a._id), admins };
}

function resolveStreamerId(userId) {
  return userId && mongoose.Types.ObjectId.isValid(String(userId)) ? userId : null;
}

// Get all streams for admin (filtered by adminId)
router.get('/admin/streams', verifyToken, verifyAdmin, extractAdminId, async (req, res) => {
  try {
    const adminId = req.adminId;
    const { status, subject, board } = req.query;

    const query = { ...schoolAccessFilter(adminId) };

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
      .populate('adminId', 'schoolName fullName email')
      .populate('schoolAdminIds', 'schoolName fullName email')
      .sort({ scheduledStartTime: -1 });

    res.json({
      success: true,
      data: streams.map(formatStreamRow)
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

    const schoolAdminId = student.assignedAdmin?._id || student.assignedAdmin;

    // Get student's board
    let studentBoard = student.board;
    if (!studentBoard && student.assignedAdmin) {
      const admin = await User.findById(student.assignedAdmin).select('board');
      if (admin && admin.board) {
        studentBoard = admin.board;
      }
    }

    // YouTube live sessions scoped to the student's school (no board/subject required)
    const youtubeStreams = schoolAdminId
      ? await Stream.find({
          ...schoolAccessFilter(schoolAdminId),
          isActive: true,
          status: { $in: ['live', 'scheduled'] },
          youtubeUrl: { $exists: true, $ne: '' },
          visibility: { $in: VISIBILITY_FOR_STUDENT },
        })
          .populate('streamer', 'fullName email')
          .populate('streamerTeacher', 'fullName email')
          .populate('subject', 'name')
          .populate('adminId', 'schoolName')
          .populate('schoolAdminIds', 'schoolName')
          .sort({ scheduledStartTime: -1 })
      : [];

    if (!studentBoard) {
      return res.json({ success: true, data: youtubeStreams.map(formatStreamRow) });
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

    // Legacy board/subject streams (non-YouTube)
    const legacyQuery = {
      board: studentBoard,
      status: { $in: ['live', 'scheduled'] },
      isActive: true,
      $or: [
        { youtubeUrl: { $exists: false } },
        { youtubeUrl: '' },
      ],
    };

    if (classSubjectIds.length > 0) {
      legacyQuery.subject = { $in: classSubjectIds };
    }

    let legacyStreams = await Stream.find(legacyQuery)
      .populate('streamer', 'fullName email')
      .populate('streamerTeacher', 'fullName email')
      .populate('subject', 'name')
      .sort({ scheduledStartTime: -1 });

    const studentClassNum = resolveStudentClassNumber(student, student.assignedClass);
    legacyStreams = filterContentsForStudentClass(legacyStreams, studentClassNum, classSubjectIds);

    const youtubeIds = new Set(youtubeStreams.map((s) => String(s._id)));
    let streams = [
      ...youtubeStreams,
      ...legacyStreams.filter((s) => !youtubeIds.has(String(s._id))),
    ];

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
      data: streams.map(formatStreamRow)
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

    const youtubeStreams = teacher.adminId
      ? await Stream.find({
          ...schoolAccessFilter(teacher.adminId),
          isActive: true,
          youtubeUrl: { $exists: true, $ne: '' },
          visibility: { $in: VISIBILITY_FOR_TEACHER },
        })
          .populate('streamer', 'fullName email')
          .populate('streamerTeacher', 'fullName email')
          .populate('subject', 'name')
          .populate('adminId', 'schoolName')
          .populate('schoolAdminIds', 'schoolName')
          .sort({ scheduledStartTime: -1 })
      : [];

    const legacyQuery = {
      ...schoolAccessFilter(teacher.adminId),
      isActive: true,
      $or: [
        { youtubeUrl: { $exists: false } },
        { youtubeUrl: '' },
      ],
    };

    if (assignedSubjectIds.length > 0) {
      legacyQuery.subject = { $in: assignedSubjectIds };
    } else {
      return res.json({ success: true, data: youtubeStreams.map(formatStreamRow) });
    }

    const legacyStreams = await Stream.find(legacyQuery)
      .populate('streamer', 'fullName email')
      .populate('streamerTeacher', 'fullName email')
      .populate('subject', 'name')
      .sort({ scheduledStartTime: -1 });

    const youtubeIds = new Set(youtubeStreams.map((s) => String(s._id)));
    const streams = [
      ...youtubeStreams,
      ...legacyStreams.filter((s) => !youtubeIds.has(String(s._id))),
    ];

    res.json({
      success: true,
      data: streams.map(formatStreamRow)
    });
  } catch (error) {
    console.error('Error fetching teacher streams:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch streams' });
  }
});

// Get all streams for super admin (no filtering)
router.get('/super-admin/streams', verifyToken, async (req, res) => {
  try {
    if (!isSuperAdminRequest(req)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super admin only.',
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
      .populate('adminId', 'schoolName fullName email')
      .populate('schoolAdminIds', 'schoolName fullName email')
      .sort({ scheduledStartTime: -1 });

    res.json({
      success: true,
      data: streams.map(formatStreamRow)
    });
  } catch (error) {
    console.error('Error fetching streams:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch streams' });
  }
});

// Super admin: create a YouTube Live session for a school (embedded in Edu OTT)
router.post('/super-admin/live-sessions', verifyToken, async (req, res) => {
  try {
    await assertSuperAdmin(req);

    const {
      title,
      description,
      youtubeUrl,
      schoolAdminId,
      schoolAdminIds,
      visibility,
      scheduledStartTime,
      status,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ success: false, message: 'Session name is required' });
    }
    if (!youtubeUrl?.trim() || !isValidYouTubeUrl(youtubeUrl)) {
      return res.status(400).json({
        success: false,
        message: 'A valid YouTube Live URL or embed link is required',
      });
    }

    const { ids: resolvedSchoolIds, admins: schoolAdmins } = await resolveSchoolAdminIds({
      schoolAdminIds,
      schoolAdminId,
    });
    if (resolvedSchoolIds.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one school is required' });
    }

    const primarySchool = schoolAdmins[0];
    const allowedVisibility = ['teacher', 'student', 'both'];
    const finalVisibility = allowedVisibility.includes(visibility) ? visibility : 'both';
    const embedUrl = normalizeYoutubeEmbedUrl(youtubeUrl);

    const stream = new Stream({
      title: title.trim(),
      description: (description || '').trim(),
      streamer: resolveStreamerId(req.userId),
      subject: null,
      board: (primarySchool.board || 'ASLI_EXCLUSIVE_SCHOOLS').toUpperCase(),
      classNumber: null,
      status: ['live', 'scheduled', 'ended', 'cancelled'].includes(status) ? status : 'live',
      scheduledStartTime: scheduledStartTime ? new Date(scheduledStartTime) : new Date(),
      youtubeUrl: youtubeUrl.trim(),
      youtubeEmbedUrl: embedUrl,
      playbackUrl: embedUrl,
      visibility: finalVisibility,
      adminId: primarySchool._id,
      schoolAdminIds: resolvedSchoolIds,
      isActive: true,
      streamType: 'live',
      viewerCount: 0,
      joinLogs: [],
    });

    await stream.save();
    await stream.populate('adminId', 'schoolName fullName email');
    await stream.populate('schoolAdminIds', 'schoolName fullName email');

    res.json({
      success: true,
      data: formatStreamRow(stream),
      message: `Live session saved for ${resolvedSchoolIds.length} school${resolvedSchoolIds.length === 1 ? '' : 's'}`,
    });
  } catch (error) {
    console.error('Error creating YouTube live session:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to create live session',
    });
  }
});

// Super admin: update YouTube live session
router.put('/super-admin/live-sessions/:id', verifyToken, async (req, res) => {
  try {
    await assertSuperAdmin(req);

    const stream = await Stream.findById(req.params.id);
    if (!stream) {
      return res.status(404).json({ success: false, message: 'Live session not found' });
    }

    const {
      title,
      description,
      youtubeUrl,
      schoolAdminId,
      schoolAdminIds,
      visibility,
      scheduledStartTime,
      status,
      isActive,
    } = req.body;

    if (title?.trim()) stream.title = title.trim();
    if (description !== undefined) stream.description = String(description || '').trim();

    if (youtubeUrl?.trim()) {
      if (!isValidYouTubeUrl(youtubeUrl)) {
        return res.status(400).json({ success: false, message: 'Invalid YouTube URL' });
      }
      const embedUrl = normalizeYoutubeEmbedUrl(youtubeUrl);
      stream.youtubeUrl = youtubeUrl.trim();
      stream.youtubeEmbedUrl = embedUrl;
      stream.playbackUrl = embedUrl;
    }

    if (schoolAdminIds !== undefined || schoolAdminId) {
      const { ids: resolvedSchoolIds, admins: schoolAdmins } = await resolveSchoolAdminIds({
        schoolAdminIds,
        schoolAdminId,
      });
      if (resolvedSchoolIds.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one school is required' });
      }
      stream.schoolAdminIds = resolvedSchoolIds;
      stream.adminId = schoolAdmins[0]._id;
      stream.board = (schoolAdmins[0].board || stream.board || 'ASLI_EXCLUSIVE_SCHOOLS').toUpperCase();
    }

    if (['teacher', 'student', 'both'].includes(visibility)) {
      stream.visibility = visibility;
    }
    if (scheduledStartTime) stream.scheduledStartTime = new Date(scheduledStartTime);
    if (['live', 'scheduled', 'ended', 'cancelled'].includes(status)) stream.status = status;
    if (typeof isActive === 'boolean') stream.isActive = isActive;

    await stream.save();
    await stream.populate('adminId', 'schoolName fullName email');
    await stream.populate('schoolAdminIds', 'schoolName fullName email');

    res.json({
      success: true,
      data: formatStreamRow(stream),
      message: 'Live session updated successfully',
    });
  } catch (error) {
    console.error('Error updating YouTube live session:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to update live session',
    });
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
    const isSuperAdmin = isSuperAdminRequest(req);

    // Super admin can update any stream, others need matching adminId
    const query = isSuperAdmin
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
    const isSuperAdmin = isSuperAdminRequest(req);

    // Super admin can start any stream, others need matching adminId
    const query = isSuperAdmin
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
    const isSuperAdmin = isSuperAdminRequest(req);

    // Super admin can end any stream, others need matching adminId
    const query = isSuperAdmin
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

// Log "Join Session" click and return embed URL (stays inside AsliLearn)
router.post('/streams/:id/join', verifyToken, async (req, res) => {
  try {
    const streamId = req.params.id;
    const user = await loadRequestUser(req, 'role fullName email assignedAdmin board');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const stream = await Stream.findById(streamId)
      .populate('subject', 'name')
      .populate('adminId', 'schoolName board');

    if (!stream || !stream.isActive) {
      return res.status(404).json({ success: false, message: 'Live session not found' });
    }

    if (!['live', 'scheduled'].includes(stream.status)) {
      return res.status(400).json({ success: false, message: 'This session is not available to join' });
    }

    const role = user.role;
    let allowed = false;

    if (role === 'super-admin') {
      allowed = true;
    } else if (role === 'admin') {
      allowed = streamBelongsToSchool(stream, user._id);
    } else if (role === 'teacher') {
      const teacher = await Teacher.findById(user._id).select('adminId subjects email');
      const resolvedTeacher =
        teacher ||
        (user.email ? await Teacher.findOne({ email: user.email }).select('adminId subjects email') : null);
      if (resolvedTeacher && streamBelongsToSchool(stream, resolvedTeacher.adminId)) {
        if (isYoutubeSession(stream)) {
          allowed = visibilityMatchesRole(stream.visibility, 'teacher');
        } else {
          const subjectIds = (resolvedTeacher.subjects || []).map((s) => String(s._id || s));
          allowed = !stream.subject || subjectIds.includes(String(stream.subject._id || stream.subject));
        }
      }
    } else if (role === 'student') {
      const schoolAdminId = user.assignedAdmin?._id || user.assignedAdmin;
      if (schoolAdminId && streamBelongsToSchool(stream, schoolAdminId)) {
        if (isYoutubeSession(stream)) {
          allowed = visibilityMatchesRole(stream.visibility, 'student');
        } else {
          allowed = true; // legacy streams already filtered at list time
        }
      }
    }

    if (!allowed) {
      return res.status(403).json({ success: false, message: 'You do not have access to this live session' });
    }

    const embedUrl =
      stream.youtubeEmbedUrl ||
      normalizeYoutubeEmbedUrl(stream.youtubeUrl) ||
      stream.playbackUrl ||
      '';

    if (!embedUrl) {
      return res.status(400).json({ success: false, message: 'No playable stream URL configured' });
    }

    stream.joinLogs = stream.joinLogs || [];
    stream.joinLogs.push({
      user: user._id,
      userRole: role,
      fullName: user.fullName || '',
      email: user.email || '',
      joinedAt: new Date(),
    });
    stream.viewerCount = (stream.viewerCount || 0) + 1;
    await stream.save();

    res.json({
      success: true,
      data: {
        sessionId: stream._id,
        title: stream.title,
        embedUrl,
        youtubeUrl: stream.youtubeUrl,
        status: stream.status,
        viewerCount: stream.viewerCount,
      },
      message: 'Joined session',
    });
  } catch (error) {
    console.error('Error joining stream:', error);
    res.status(500).json({ success: false, message: 'Failed to join session' });
  }
});

// Delete stream
router.delete('/streams/:id', verifyToken, extractAdminId, async (req, res) => {
  try {
    const adminId = req.adminId;
    const streamId = req.params.id;
    const isSuperAdmin = isSuperAdminRequest(req);

    // Super admin can delete any stream, others need matching adminId
    const query = isSuperAdmin
      ? { _id: streamId }
      : { _id: streamId, adminId };

    const stream = await Stream.findOne(query);

    if (!stream) {
      return res.status(404).json({ success: false, message: 'Stream not found' });
    }

    // Don't allow deletion of live native streams (YouTube sessions can be removed by super admin)
    if (stream.status === 'live' && !(isSuperAdmin && stream.youtubeUrl)) {
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
      .populate('subject', 'name')
      .populate('adminId', 'schoolName');

    if (!stream) {
      return res.status(404).json({ success: false, message: 'Stream not found' });
    }

    const row = formatStreamRow(stream);
    if (req.user?.role !== 'super-admin' && req.user?.role !== 'admin') {
      delete row.joinLogs;
    }

    res.json({
      success: true,
      data: row
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

