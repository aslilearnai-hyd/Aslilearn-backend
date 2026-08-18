import mongoose from 'mongoose';
import OmrResultBatch from '../models/OmrResultBatch.js';
import OmrResultRow from '../models/OmrResultRow.js';
import OmrCandidateStudentMap from '../models/OmrCandidateStudentMap.js';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Class from '../models/Class.js';
import { parseOmrScoresBuffer } from '../utils/omr-scores-csv.js';

function resolveAdminId(req) {
  return req.adminId || req.user?.userId || req.user?.id || req.userId;
}

function resolveOmrAdminId(req) {
  const explicit = req.body?.adminId || req.query?.adminId;
  if (explicit) return String(explicit);
  return resolveAdminId(req);
}

function resolveOmrActorId(req, fallbackAdminId) {
  return req.user?.userId || req.user?.id || req.userId || fallbackAdminId;
}

function requireOmrSchoolAdminId(req, res) {
  const adminId = resolveOmrAdminId(req);
  if (!adminId) {
    res.status(400).json({
      success: false,
      message: 'School (adminId) is required',
    });
    return null;
  }
  return adminId;
}

function toObjectId(id) {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(String(id))) {
    return new mongoose.Types.ObjectId(String(id));
  }
  return null;
}

function serializeSubject(s = {}) {
  return {
    r: s.r || 0,
    w: s.w || 0,
    l: s.l || 0,
    marks: s.marks || 0,
  };
}

function serializeRow(row, student) {
  return {
    _id: row._id,
    batchId: row.batchId,
    candidateId: row.candidateId,
    candidateName: row.candidateName || '',
    fatherName: row.fatherName || '',
    group: row.group || '',
    other: row.other || '',
    maths: serializeSubject(row.maths),
    physics: serializeSubject(row.physics),
    chemistry: serializeSubject(row.chemistry),
    biology: serializeSubject(row.biology),
    totalQuestions: row.totalQuestions,
    attempted: row.attempted,
    correct: row.correct,
    wrong: row.wrong,
    left: row.left,
    rightPct: row.rightPct,
    wrongPct: row.wrongPct,
    totalMarks: row.totalMarks,
    percentage: row.percentage,
    testRank: row.testRank,
    finalRank: row.finalRank,
    groupRank: row.groupRank,
    userId: row.userId || null,
    assignedAt: row.assignedAt || null,
    student: student
      ? {
          _id: student._id,
          fullName: student.fullName || '',
          email: student.email || '',
          classNumber: student.classNumber || '',
          section: student.section || '',
        }
      : null,
  };
}

export const uploadOmrResults = async (req, res) => {
  try {
    const adminId = requireOmrSchoolAdminId(req, res);
    if (!adminId) return;
    const actorId = resolveOmrActorId(req, adminId);
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const parsed = parseOmrScoresBuffer(req.file.buffer, req.file.originalname || '');
    if (!parsed.rows.length) {
      return res.status(400).json({
        success: false,
        message: 'No valid OMR score rows found in the file',
        errors: parsed.errors || [],
      });
    }

    const candidateIds = parsed.rows.map((r) => r.candidateId);
    const maps = await OmrCandidateStudentMap.find({
      adminId,
      candidateId: { $in: candidateIds },
    }).lean();
    const mapByCandidate = new Map(maps.map((m) => [m.candidateId, m.userId]));

    const batch = await OmrResultBatch.create({
      adminId,
      testNo: parsed.testNo,
      testTitle: parsed.testTitle,
      testDate: parsed.testDate,
      uploadedBy: actorId,
      rowCount: parsed.rows.length,
      assignedCount: 0,
      sourceFileName: req.file.originalname || '',
    });

    const now = new Date();
    const docs = parsed.rows.map((r) => {
      const mappedUserId = mapByCandidate.get(r.candidateId) || null;
      return {
        batchId: batch._id,
        adminId,
        ...r,
        userId: mappedUserId,
        assignedAt: mappedUserId ? now : null,
        assignedBy: mappedUserId ? actorId : null,
      };
    });

    await OmrResultRow.insertMany(docs, { ordered: false });
    const assignedCount = docs.filter((d) => d.userId).length;
    batch.assignedCount = assignedCount;
    await batch.save();

    res.status(201).json({
      success: true,
      message: `Imported ${docs.length} OMR rows`,
      data: {
        batch: {
          _id: batch._id,
          testNo: batch.testNo,
          testTitle: batch.testTitle,
          testDate: batch.testDate,
          rowCount: batch.rowCount,
          assignedCount: batch.assignedCount,
          sourceFileName: batch.sourceFileName,
          createdAt: batch.createdAt,
        },
        parseErrors: parsed.errors || [],
        autoAssigned: assignedCount,
      },
    });
  } catch (error) {
    console.error('uploadOmrResults:', error);
    res.status(500).json({ success: false, message: error.message || 'Upload failed' });
  }
};

export const listOmrBatches = async (req, res) => {
  try {
    const adminId = requireOmrSchoolAdminId(req, res);
    if (!adminId) return;
    const batches = await OmrResultBatch.find({ adminId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({
      success: true,
      data: batches.map((b) => ({
        ...b,
        unassignedCount: Math.max(0, (b.rowCount || 0) - (b.assignedCount || 0)),
      })),
    });
  } catch (error) {
    console.error('listOmrBatches:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteOmrBatch = async (req, res) => {
  try {
    const adminId = requireOmrSchoolAdminId(req, res);
    if (!adminId) return;
    const batchId = toObjectId(req.params.id);
    if (!batchId) {
      return res.status(400).json({ success: false, message: 'Invalid batch id' });
    }

    const batch = await OmrResultBatch.findOne({ _id: batchId, adminId });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Uploaded file not found' });
    }

    await OmrResultRow.deleteMany({ batchId, adminId });
    await OmrResultBatch.deleteOne({ _id: batchId, adminId });

    res.json({
      success: true,
      message: `Removed ${batch.sourceFileName || batch.testTitle || 'uploaded file'}`,
    });
  } catch (error) {
    console.error('deleteOmrBatch:', error);
    res.status(500).json({ success: false, message: error.message || 'Could not remove file' });
  }
};

export const getOmrBatch = async (req, res) => {
  try {
    const adminId = requireOmrSchoolAdminId(req, res);
    if (!adminId) return;
    const batchId = toObjectId(req.params.id);
    if (!batchId) {
      return res.status(400).json({ success: false, message: 'Invalid batch id' });
    }

    const batch = await OmrResultBatch.findOne({ _id: batchId, adminId }).lean();
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    const rows = await OmrResultRow.find({ batchId, adminId }).sort({ finalRank: 1, percentage: -1 }).lean();
    const studentIds = rows.map((r) => r.userId).filter(Boolean);
    const students = studentIds.length
      ? await User.find({ _id: { $in: studentIds } })
          .select('_id fullName email classNumber section')
          .lean()
      : [];
    const studentById = new Map(students.map((s) => [String(s._id), s]));

    const maps = await OmrCandidateStudentMap.find({
      adminId,
      candidateId: { $in: rows.map((r) => r.candidateId) },
    }).lean();
    const suggestedByCandidate = new Map(maps.map((m) => [m.candidateId, String(m.userId)]));

    res.json({
      success: true,
      data: {
        batch: {
          ...batch,
          unassignedCount: Math.max(0, (batch.rowCount || 0) - (batch.assignedCount || 0)),
        },
        rows: rows.map((r) => ({
          ...serializeRow(r, r.userId ? studentById.get(String(r.userId)) : null),
          suggestedUserId: suggestedByCandidate.get(r.candidateId) || null,
        })),
      },
    });
  } catch (error) {
    console.error('getOmrBatch:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const assignOmrRows = async (req, res) => {
  try {
    const adminId = requireOmrSchoolAdminId(req, res);
    if (!adminId) return;
    const actorId = resolveOmrActorId(req, adminId);
    const batchId = toObjectId(req.params.id);
    if (!batchId) {
      return res.status(400).json({ success: false, message: 'Invalid batch id' });
    }

    const batch = await OmrResultBatch.findOne({ _id: batchId, adminId });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    if (!assignments.length) {
      return res.status(400).json({ success: false, message: 'assignments array is required' });
    }

    let updated = 0;
    const now = new Date();

    for (const a of assignments) {
      const rowId = toObjectId(a.rowId);
      const userId = a.userId === null || a.userId === '' ? null : toObjectId(a.userId);
      if (!rowId) continue;

      const row = await OmrResultRow.findOne({ _id: rowId, batchId, adminId });
      if (!row) continue;

      if (userId) {
        const student = await User.findOne({
          _id: userId,
          role: 'student',
          assignedAdmin: adminId,
        })
          .select('_id')
          .lean();
        if (!student) continue;

        row.userId = userId;
        row.assignedAt = now;
        row.assignedBy = actorId;
        await row.save();

        await OmrCandidateStudentMap.findOneAndUpdate(
          { adminId, candidateId: row.candidateId },
          { $set: { userId, adminId, candidateId: row.candidateId } },
          { upsert: true, new: true },
        );
        updated += 1;
      } else {
        row.userId = null;
        row.assignedAt = null;
        row.assignedBy = null;
        await row.save();
        updated += 1;
      }
    }

    const assignedCount = await OmrResultRow.countDocuments({
      batchId,
      adminId,
      userId: { $ne: null },
    });
    batch.assignedCount = assignedCount;
    await batch.save();

    res.json({
      success: true,
      message: `Updated ${updated} assignment(s)`,
      data: { updated, assignedCount, unassignedCount: Math.max(0, batch.rowCount - assignedCount) },
    });
  } catch (error) {
    console.error('assignOmrRows:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const listOmrClassOptions = async (req, res) => {
  try {
    const adminId = requireOmrSchoolAdminId(req, res);
    if (!adminId) return;

    const adminOid = toObjectId(adminId);
    if (!adminOid) {
      return res.status(400).json({ success: false, message: 'Invalid school adminId' });
    }

    const rows = await User.aggregate([
      {
        $match: {
          role: 'student',
          assignedAdmin: adminOid,
          isActive: { $ne: false },
          classNumber: { $exists: true, $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id: { classNumber: '$classNumber', section: '$section' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.classNumber': 1, '_id.section': 1 } },
    ]);

    res.json({
      success: true,
      data: rows.map((r) => ({
        classNumber: String(r._id?.classNumber || ''),
        section: String(r._id?.section || ''),
        label: `${r._id?.classNumber || ''}-${r._id?.section || ''}`.replace(/-$/, '').trim() || String(r._id?.classNumber || ''),
        count: r.count || 0,
      })),
    });
  } catch (error) {
    console.error('listOmrClassOptions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const listOmrStudentsForAssign = async (req, res) => {
  try {
    const adminId = requireOmrSchoolAdminId(req, res);
    if (!adminId) return;

    const adminOid = toObjectId(adminId);
    if (!adminOid) {
      return res.status(400).json({ success: false, message: 'Invalid school adminId' });
    }

    const filter = {
      role: 'student',
      assignedAdmin: adminOid,
      isActive: { $ne: false },
    };

    const classNumber = String(req.query.classNumber || '').trim();
    const section = String(req.query.section || '').trim();
    if (classNumber) filter.classNumber = classNumber;
    if (section) filter.section = section;

    const students = await User.find(filter)
      .select('_id fullName email classNumber section')
      .sort({ fullName: 1, email: 1 })
      .limit(2000)
      .lean();

    res.json({
      success: true,
      data: students.map((s) => ({
        _id: s._id,
        fullName: s.fullName || '',
        email: s.email || '',
        classNumber: s.classNumber || '',
        section: s.section || '',
      })),
    });
  } catch (error) {
    console.error('listOmrStudentsForAssign:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getOmrAdminSummary = async (req, res) => {
  try {
    const adminId = requireOmrSchoolAdminId(req, res);
    if (!adminId) return;

    const latest = await OmrResultBatch.findOne({ adminId }).sort({ createdAt: -1 }).lean();
    if (!latest) {
      return res.json({
        success: true,
        data: { batch: null, stats: null },
      });
    }

    const rows = await OmrResultRow.find({ batchId: latest._id, adminId }).lean();
    const assigned = rows.filter((r) => r.userId);
    const avgPct =
      rows.length > 0
        ? Math.round((rows.reduce((s, r) => s + (r.percentage || 0), 0) / rows.length) * 10) / 10
        : 0;

    res.json({
      success: true,
      data: {
        batch: latest,
        stats: {
          rowCount: rows.length,
          assignedCount: assigned.length,
          unassignedCount: rows.length - assigned.length,
          averagePercentage: avgPct,
          topPercentage: rows.reduce((m, r) => Math.max(m, r.percentage || 0), 0),
        },
      },
    });
  } catch (error) {
    console.error('getOmrAdminSummary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getStudentOmrResults = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const rows = await OmrResultRow.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const batchIds = [...new Set(rows.map((r) => String(r.batchId)))];
    const batches = await OmrResultBatch.find({ _id: { $in: batchIds } }).lean();
    const batchById = new Map(batches.map((b) => [String(b._id), b]));

    const data = rows.map((r) => {
      const batch = batchById.get(String(r.batchId));
      return {
        ...serializeRow(r, null),
        testNo: batch?.testNo || '',
        testTitle: batch?.testTitle || '',
        testDate: batch?.testDate || null,
        batchCreatedAt: batch?.createdAt || null,
      };
    });

    const latest = data[0] || null;
    let trend = null;
    if (data.length >= 2) {
      trend = Math.round(((data[0].percentage || 0) - (data[1].percentage || 0)) * 10) / 10;
    }

    res.json({
      success: true,
      data: {
        latest,
        trend,
        history: data,
      },
    });
  } catch (error) {
    console.error('getStudentOmrResults:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTeacherOmrResults = async (req, res) => {
  try {
    const teacherId = req.teacherId || req.user?.userId || req.user?.id;
    const teacher = await Teacher.findById(teacherId).select('adminId assignedClassIds').lean();
    if (!teacher?.adminId) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    let studentFilter = {
      role: 'student',
      assignedAdmin: teacher.adminId,
      isActive: { $ne: false },
    };

    if (teacher.assignedClassIds?.length) {
      const classDocs = await Class.find({
        _id: { $in: teacher.assignedClassIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) },
        assignedAdmin: teacher.adminId,
      })
        .select('_id')
        .lean();
      const classOids = classDocs.map((c) => c._id);
      if (classOids.length) {
        studentFilter = {
          ...studentFilter,
          $or: [
            { assignedClass: { $in: classOids } },
            { assignedClassIds: { $in: classOids.map(String) } },
          ],
        };
      }
    }

    const students = await User.find(studentFilter).select('_id fullName email classNumber section').lean();
    const studentIds = students.map((s) => s._id);
    if (!studentIds.length) {
      return res.json({ success: true, data: [] });
    }

    const rows = await OmrResultRow.find({
      adminId: teacher.adminId,
      userId: { $in: studentIds },
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const batchIds = [...new Set(rows.map((r) => String(r.batchId)))];
    const batches = await OmrResultBatch.find({ _id: { $in: batchIds } }).lean();
    const batchById = new Map(batches.map((b) => [String(b._id), b]));
    const studentById = new Map(students.map((s) => [String(s._id), s]));

    res.json({
      success: true,
      data: rows.map((r) => {
        const batch = batchById.get(String(r.batchId));
        return {
          ...serializeRow(r, studentById.get(String(r.userId))),
          testNo: batch?.testNo || '',
          testTitle: batch?.testTitle || '',
          testDate: batch?.testDate || null,
        };
      }),
    });
  } catch (error) {
    console.error('getTeacherOmrResults:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
