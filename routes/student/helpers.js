import mongoose from 'mongoose';
import User from '../../models/User.js';
import Subject from '../../models/Subject.js';
import { resolveUserDisplayBoard } from '../../constants/boards.js';

export function escapeRegexClassSuffix(classNum) {
  return String(classNum).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function plainSubjectName(name) {
  if (!name || typeof name !== 'string') return '';
  const m = name.match(/^(.+?)_\d+$/);
  return m ? m[1] : name;
}

export function normalizeTopicLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function subjectSlugMatches(docSubjectPlain, rowSubject) {
  const plain = plainSubjectName(docSubjectPlain || '').toLowerCase().trim();
  const row = String(rowSubject || '').toLowerCase().trim();
  if (!row) return true;
  if (!plain) return false;
  const aliases = {
    maths: ['maths', 'math', 'mathematics'],
    physics: ['physics'],
    chemistry: ['chemistry', 'chem'],
    biology: ['biology', 'bio'],
  };
  const rowAliases = aliases[row] || [row];
  return rowAliases.some((a) => plain.includes(a) || a.includes(plain));
}

export function topicFuzzyMatch(haystack, needle) {
  const h = normalizeTopicLabel(haystack);
  const n = normalizeTopicLabel(needle);
  if (!h || !n) return false;
  if (h.includes(n) || n.includes(h)) return true;
  const hTokens = h.split(' ').filter((t) => t.length > 2);
  const nTokens = n.split(' ').filter((t) => t.length > 2);
  if (nTokens.length === 0) return false;
  let hits = 0;
  for (const t of nTokens) {
    if (hTokens.some((ht) => ht === t || ht.includes(t) || t.includes(ht))) hits += 1;
  }
  const need = nTokens.length >= 3 ? 2 : 1;
  return hits >= need;
}

/** topicRows query: "maths|Probability,physics|Motion and Kinematics" */
export function parseWeakTopicRowsFromQuery(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((part) => {
      const piece = String(part || '').trim();
      if (!piece) return null;
      if (piece.includes('|')) {
        const pipe = piece.indexOf('|');
        return {
          subject: String(piece.slice(0, pipe)).toLowerCase().trim(),
          topic: String(piece.slice(pipe + 1)).trim(),
        };
      }
      return { subject: '', topic: piece };
    })
    .filter((r) => r && r.topic);
}

/** Populated Class with assignedSubjects, or lookup by student.classNumber + admin. */
export async function resolveStudentClassDoc(student) {
  const Class = (await import('../../models/Class.js')).default;
  if (student.assignedClass) {
    if (typeof student.assignedClass === 'object' && student.assignedClass._id) {
      if (student.assignedClass.assignedSubjects !== undefined) {
        return student.assignedClass;
      }
      return await Class.findById(student.assignedClass._id).populate('assignedSubjects');
    }
    return await Class.findById(student.assignedClass).populate('assignedSubjects');
  }
  const aid = student.assignedAdmin?._id || student.assignedAdmin;
  if (student.classNumber && student.classNumber !== 'Unassigned' && aid) {
    return await Class.findOne({
      classNumber: student.classNumber,
      assignedAdmin: aid,
      isActive: true,
    }).populate('assignedSubjects');
  }
  return null;
}

/**
 * Subject IDs for student: class.assignedSubjects, subject.classIds, student.assignedSubjects.
 * Does not match subject names with class number suffixes.
 */
export async function resolveStudentSubjectIdsForLibrary(student, adminBoardRaw, studentClassDoc) {
  const idStrToOid = new Map();
  const addId = (id) => {
    if (!id) return;
    const oid =
      id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));
    idStrToOid.set(oid.toString(), oid);
  };

  if (student.assignedSubjects?.length) {
    for (const subj of student.assignedSubjects) {
      addId(subj._id ? subj._id : subj);
    }
  }

  if (studentClassDoc?.assignedSubjects?.length) {
    for (const subj of studentClassDoc.assignedSubjects) {
      addId(subj._id ? subj._id : subj);
    }
  }

  if (studentClassDoc?._id) {
    const linked = await Subject.find({
      isActive: true,
      name: { $not: /__deleted__/ },
      classIds: studentClassDoc._id,
    })
      .select('_id')
      .lean();
    for (const row of linked) addId(row._id);
  }

  return Array.from(idStrToOid.values());
}

/** Active catalog subjects assigned to the student's class (not whole board). */
export async function resolveStudentClassSubjects(student) {
  const studentClassDoc = await resolveStudentClassDoc(student);
  const adminBoard =
    student.assignedAdmin?.board ||
    (await User.findById(student.assignedAdmin).select('board').lean())?.board ||
    student.board;

  let librarySubjectIds = await resolveStudentSubjectIdsForLibrary(
    student,
    adminBoard,
    studentClassDoc
  );
  const { filterToActiveCatalogSubjectIds } = await import('../../utils/activeCatalog.js');
  librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);

  const subjects =
    librarySubjectIds.length === 0
      ? []
      : await Subject.find({
          _id: { $in: librarySubjectIds },
          isActive: true,
          name: { $not: /__deleted__/ },
        })
          .sort({ name: 1 })
          .lean();

  const { resolveStudentClassNumber, filterContentsForStudentClass } = await import(
    '../utils/studentClassContent.js'
  );

  return {
    subjects,
    librarySubjectIds,
    studentClassDoc,
    studentClassNumber: resolveStudentClassNumber(student, studentClassDoc),
    adminBoard,
    filterContentsForStudentClass,
  };
}

/** Curriculum board for sibling subject/content lookup (not ASLI_EXCLUSIVE_SCHOOLS hub code). */
export function resolveStudentContentBoard(student, adminBoard) {
  const display = resolveUserDisplayBoard(student, student?.assignedAdmin);
  if (display && String(display).toUpperCase() !== 'ASLI_EXCLUSIVE_SCHOOLS') {
    return String(display).toUpperCase();
  }
  const raw = adminBoard ? String(adminBoard).toUpperCase() : '';
  if (raw && raw !== 'ASLI_EXCLUSIVE_SCHOOLS') return raw;
  return 'CBSE';
}

// Get student's assigned admin and filter content accordingly
export const getStudentAdminId = async (req, res, next) => {
  try {
    const student = await User.findById(req.userId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    if (!student.assignedAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Student not assigned to any admin' 
      });
    }
    
    req.studentAdminId = student.assignedAdmin;
    next();
  } catch (error) {
    console.error('Error getting student admin:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


