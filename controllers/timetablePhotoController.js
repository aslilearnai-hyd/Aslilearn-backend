import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ClassTimetableImage from '../models/ClassTimetableImage.js';
import Class from '../models/Class.js';
import Teacher from '../models/Teacher.js';
import User from '../models/User.js';
import { getBackendRoot } from '../bootstrap/env.js';

const UPLOAD_DIR = path.join(getBackendRoot(), 'uploads', 'timetables');

function toObjectId(id) {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(String(id));
  }
  return null;
}

function resolveAdminId(req) {
  if (req.user?.role === 'super-admin') return null;
  return req.user?.userId || req.user?.id;
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function unlinkQuiet(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return;
  if (!fileUrl.startsWith('/uploads/timetables/')) return;
  const abs = path.join(getBackendRoot(), fileUrl.replace(/^\//, ''));
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

function serializePhoto(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc;
  const classRef = plain.classId;
  const classNumber =
    plain.classNumber ||
    (classRef && typeof classRef === 'object' ? classRef.classNumber : '') ||
    '';
  const sectionId =
    plain.sectionId ||
    (classRef && typeof classRef === 'object' ? classRef.section : '') ||
    '';
  const label =
    String(classNumber || '').trim() && String(sectionId || '').trim()
      ? `${String(classNumber).trim()}${String(sectionId).trim().toUpperCase()}`
      : String(classNumber || sectionId || 'Class timetable').trim();

  return {
    _id: plain._id,
    schoolAdminId: plain.schoolAdminId,
    classId:
      classRef && typeof classRef === 'object' && classRef._id
        ? String(classRef._id)
        : String(plain.classId || ''),
    classNumber: String(classNumber || '').trim(),
    sectionId: String(sectionId || '').trim().toUpperCase(),
    label,
    imageUrl: plain.imageUrl,
    originalFileName: plain.originalFileName || '',
    uploadedBy: plain.uploadedBy,
    uploadedByRole: plain.uploadedByRole,
    updatedAt: plain.updatedAt,
    createdAt: plain.createdAt,
  };
}

async function resolveSchoolAdminIdForWrite(req) {
  const role = req.user?.role;
  if (role === 'admin') {
    return toObjectId(resolveAdminId(req));
  }
  if (role === 'teacher') {
    const teacherId = toObjectId(req.user?.userId || req.user?.id);
    const teacher = await Teacher.findById(teacherId).select('adminId').lean();
    return toObjectId(teacher?.adminId);
  }
  return null;
}

async function assertClassBelongsToSchool(classId, schoolAdminId) {
  const cls = await Class.findOne({
    _id: classId,
    assignedAdmin: schoolAdminId,
  })
    .select('classNumber section assignedAdmin')
    .lean();
  return cls;
}

async function assertTeacherCanAccessClass(req, classId, schoolAdminId) {
  const teacherId = toObjectId(req.user?.userId || req.user?.id);
  const teacher = await Teacher.findById(teacherId)
    .select('adminId assignedClassIds assignments')
    .lean();
  if (!teacher) return false;
  if (String(teacher.adminId || '') !== String(schoolAdminId || '')) return false;

  const assigned = new Set(
    [
      ...(Array.isArray(teacher.assignedClassIds) ? teacher.assignedClassIds : []),
      ...(Array.isArray(teacher.assignments)
        ? teacher.assignments.map((a) => String(a?.classId || ''))
        : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );

  // If no explicit class assignments, allow any class in the same school
  // so teachers can still upload a timetable photo.
  if (assigned.size === 0) return true;
  return assigned.has(String(classId));
}

/** GET /api/timetable/photo-classes — class+section options for photo upload */
export async function listPhotoClasses(req, res) {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }

    const schoolAdminId = await resolveSchoolAdminIdForWrite(req);
    if (!schoolAdminId) {
      return res.status(400).json({ success: false, message: 'School context missing' });
    }

    let classes = await Class.find({
      assignedAdmin: schoolAdminId,
      $or: [{ isActive: true }, { isActive: { $exists: false } }],
    })
      .select('_id classNumber section')
      .sort({ classNumber: 1, section: 1 })
      .lean();

    if (role === 'teacher') {
      const teacherId = toObjectId(req.user?.userId || req.user?.id);
      const teacher = await Teacher.findById(teacherId)
        .select('assignedClassIds assignments')
        .lean();
      const assigned = new Set(
        [
          ...(Array.isArray(teacher?.assignedClassIds) ? teacher.assignedClassIds : []),
          ...(Array.isArray(teacher?.assignments)
            ? teacher.assignments.map((a) => String(a?.classId || ''))
            : []),
        ]
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      );
      if (assigned.size > 0) {
        classes = classes.filter(
          (c) =>
            assigned.has(String(c._id)) ||
            assigned.has(String(c.classNumber)) ||
            assigned.has(`${c.classNumber}${c.section}`)
        );
      }
    }

    return res.json({
      success: true,
      data: classes.map((c) => ({
        _id: c._id,
        classNumber: c.classNumber,
        section: c.section,
        label: `${String(c.classNumber || '').trim()}${String(c.section || '')
          .trim()
          .toUpperCase()}`,
      })),
    });
  } catch (error) {
    console.error('listPhotoClasses:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to list classes',
    });
  }
}

/** GET /api/timetable/photos — admin/teacher list for school */
export async function listTimetablePhotos(req, res) {
  try {
    const role = req.user?.role;
    let schoolAdminId = null;

    if (role === 'admin') {
      schoolAdminId = toObjectId(resolveAdminId(req));
    } else if (role === 'teacher') {
      schoolAdminId = await resolveSchoolAdminIdForWrite(req);
    } else {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }

    if (!schoolAdminId) {
      return res.status(400).json({ success: false, message: 'School context missing' });
    }

    const rows = await ClassTimetableImage.find({ schoolAdminId })
      .populate('classId', 'classNumber section')
      .sort({ classNumber: 1, sectionId: 1 })
      .lean({ virtuals: true });

    return res.json({
      success: true,
      data: rows.map(serializePhoto),
    });
  } catch (error) {
    console.error('listTimetablePhotos:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to list timetable photos',
    });
  }
}

/** GET /api/timetable/photo — one photo by classId, or student auto-scope */
export async function getTimetablePhoto(req, res) {
  try {
    const role = req.user?.role;
    const classIdParam = toObjectId(req.query.classId);

    if (role === 'student') {
      const user = await User.findById(req.user?.userId || req.user?.id)
        .populate('assignedClass', 'classNumber section')
        .select('assignedClass assignedAdmin')
        .lean();
      const classId = user?.assignedClass?._id;
      if (!classId) {
        return res.json({ success: true, data: null });
      }
      const schoolAdminId = toObjectId(user.assignedAdmin);
      const query = { classId };
      if (schoolAdminId) query.schoolAdminId = schoolAdminId;
      const row = await ClassTimetableImage.findOne(query)
        .populate('classId', 'classNumber section')
        .lean({ virtuals: true });
      return res.json({ success: true, data: serializePhoto(row) });
    }

    if (!classIdParam) {
      return res.status(400).json({ success: false, message: 'classId is required' });
    }

    const schoolAdminId = await resolveSchoolAdminIdForWrite(req);
    if (!schoolAdminId && role !== 'super-admin') {
      return res.status(400).json({ success: false, message: 'School context missing' });
    }

    const query = { classId: classIdParam };
    if (schoolAdminId) query.schoolAdminId = schoolAdminId;

    const row = await ClassTimetableImage.findOne(query)
      .populate('classId', 'classNumber section')
      .lean({ virtuals: true });

    return res.json({ success: true, data: serializePhoto(row) });
  } catch (error) {
    console.error('getTimetablePhoto:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch timetable photo',
    });
  }
}

/** POST /api/timetable/photo — multipart image + classId (admin / class photos only) */
export async function uploadTimetablePhoto(req, res) {
  try {
    const role = req.user?.role;
    if (role === 'teacher') {
      return res.status(403).json({
        success: false,
        message: 'Teachers upload a single personal timetable at /api/timetable/my-photo (no class link)',
      });
    }
    if (role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admin can upload class timetable photos' });
    }

    const classId = toObjectId(req.body?.classId);
    if (!classId) {
      return res.status(400).json({ success: false, message: 'classId is required' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'Please upload a timetable photo' });
    }

    const schoolAdminId = await resolveSchoolAdminIdForWrite(req);
    if (!schoolAdminId) {
      return res.status(400).json({ success: false, message: 'School context missing' });
    }

    const cls = await assertClassBelongsToSchool(classId, schoolAdminId);
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Class not found for this school' });
    }

    ensureUploadDir();
    const ext = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].includes(ext)
      ? ext
      : '.jpg';
    const filename = `${schoolAdminId}_${classId}_${Date.now()}${safeExt}`;
    const absPath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(absPath, req.file.buffer);
    const imageUrl = `/uploads/timetables/${filename}`;

    const sectionId = String(cls.section || '').trim().toUpperCase();
    const classNumber = String(cls.classNumber || '').trim();
    const uploadedBy = toObjectId(req.user?.userId || req.user?.id);

    const existing = await ClassTimetableImage.findOne({ schoolAdminId, classId });
    if (existing?.imageUrl) unlinkQuiet(existing.imageUrl);

    const doc = await ClassTimetableImage.findOneAndUpdate(
      { schoolAdminId, classId },
      {
        schoolAdminId,
        classId,
        classNumber,
        sectionId,
        imageUrl,
        originalFileName: req.file.originalname || filename,
        uploadedBy,
        uploadedByRole: role,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).populate('classId', 'classNumber section');

    return res.json({
      success: true,
      message: `${classNumber}${sectionId} timetable photo saved`,
      data: serializePhoto(doc),
    });
  } catch (error) {
    console.error('uploadTimetablePhoto:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload timetable photo',
    });
  }
}

/** DELETE /api/timetable/photo?classId= */
export async function deleteTimetablePhoto(req, res) {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }

    const classId = toObjectId(req.query.classId || req.body?.classId);
    if (!classId) {
      return res.status(400).json({ success: false, message: 'classId is required' });
    }

    const schoolAdminId = await resolveSchoolAdminIdForWrite(req);
    if (!schoolAdminId) {
      return res.status(400).json({ success: false, message: 'School context missing' });
    }

    if (role === 'teacher') {
      const ok = await assertTeacherCanAccessClass(req, classId, schoolAdminId);
      if (!ok) {
        return res.status(403).json({ success: false, message: 'Not allowed for this class' });
      }
    }

    const row = await ClassTimetableImage.findOneAndDelete({ schoolAdminId, classId });
    if (!row) {
      return res.status(404).json({ success: false, message: 'No timetable photo found' });
    }
    unlinkQuiet(row.imageUrl);

    return res.json({ success: true, message: 'Timetable photo removed' });
  } catch (error) {
    console.error('deleteTimetablePhoto:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete timetable photo',
    });
  }
}

function serializeTeacherPhoto(teacher) {
  if (!teacher?.timetableImageUrl) return null;
  return {
    _id: String(teacher._id),
    teacherId: String(teacher._id),
    label: 'My timetable',
    imageUrl: teacher.timetableImageUrl,
    originalFileName: teacher.timetableOriginalFileName || '',
    updatedAt: teacher.timetableUploadedAt || teacher.updatedAt || null,
  };
}

/** GET /api/timetable/my-photo — teacher's own single timetable photo */
export async function getMyTimetablePhoto(req, res) {
  try {
    if (req.user?.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teachers only' });
    }
    const teacherId = toObjectId(req.user?.userId || req.user?.id);
    const teacher = await Teacher.findById(teacherId)
      .select('timetableImageUrl timetableOriginalFileName timetableUploadedAt updatedAt')
      .lean();
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    return res.json({ success: true, data: serializeTeacherPhoto(teacher) });
  } catch (error) {
    console.error('getMyTimetablePhoto:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch timetable photo',
    });
  }
}

/** POST /api/timetable/my-photo — upload teacher's single timetable (no class) */
export async function uploadMyTimetablePhoto(req, res) {
  try {
    if (req.user?.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teachers only' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'Please upload a timetable photo' });
    }

    const teacherId = toObjectId(req.user?.userId || req.user?.id);
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    ensureUploadDir();
    const ext = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].includes(ext)
      ? ext
      : '.jpg';
    const filename = `teacher_${teacherId}_${Date.now()}${safeExt}`;
    const absPath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(absPath, req.file.buffer);
    const imageUrl = `/uploads/timetables/${filename}`;

    if (teacher.timetableImageUrl) unlinkQuiet(teacher.timetableImageUrl);

    teacher.timetableImageUrl = imageUrl;
    teacher.timetableOriginalFileName = req.file.originalname || filename;
    teacher.timetableUploadedAt = new Date();
    await teacher.save();

    return res.json({
      success: true,
      message: 'Timetable photo saved',
      data: serializeTeacherPhoto(teacher),
    });
  } catch (error) {
    console.error('uploadMyTimetablePhoto:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload timetable photo',
    });
  }
}

/** DELETE /api/timetable/my-photo */
export async function deleteMyTimetablePhoto(req, res) {
  try {
    if (req.user?.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teachers only' });
    }
    const teacherId = toObjectId(req.user?.userId || req.user?.id);
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    if (!teacher.timetableImageUrl) {
      return res.status(404).json({ success: false, message: 'No timetable photo found' });
    }
    unlinkQuiet(teacher.timetableImageUrl);
    teacher.timetableImageUrl = '';
    teacher.timetableOriginalFileName = '';
    teacher.timetableUploadedAt = null;
    await teacher.save();
    return res.json({ success: true, message: 'Timetable photo removed' });
  } catch (error) {
    console.error('deleteMyTimetablePhoto:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete timetable photo',
    });
  }
}
