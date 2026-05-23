import mongoose from 'mongoose';
import Class from '../models/Class.js';
import Subject from '../models/Subject.js';
import Teacher from '../models/Teacher.js';
import {
  extractPlainSubjectNameForContent,
  subjectGroupKey,
} from './resolveSubjectContentIds.js';

/** True if name looks like Super Admin catalog key (e.g. Biology_6). */
export function isCatalogStyleSubjectName(name) {
  return /_\d+$/.test(String(name || '').split('__deleted__')[0].trim());
}

/**
 * Bidirectional sync: Subject.classIds <-> Class.assignedSubjects for one subject.
 */
export async function syncSubjectClassIds(subjectId, classIds, adminId) {
  const subjectOid = new mongoose.Types.ObjectId(String(subjectId));
  const normalized = [...new Set((classIds || []).map((id) => String(id)).filter(Boolean))];
  const classOids = normalized
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const classFilter = { _id: { $in: classOids } };
  if (adminId) classFilter.assignedAdmin = adminId;

  const validClasses = await Class.find(classFilter).select('_id').lean();
  const validIds = validClasses.map((c) => c._id);

  await Subject.findByIdAndUpdate(subjectOid, { $set: { classIds: validIds } });

  await Class.updateMany(
    { assignedSubjects: subjectOid, ...(adminId ? { assignedAdmin: adminId } : {}) },
    { $pull: { assignedSubjects: subjectOid } }
  );
  if (validIds.length > 0) {
    await Class.updateMany({ _id: { $in: validIds } }, { $addToSet: { assignedSubjects: subjectOid } });
  }

  return validIds;
}

/**
 * Assign primary teacher on subject + keep Teacher.subjects in sync.
 */
export async function syncSubjectTeacher(subjectId, teacherId, adminId) {
  const subjectOid = new mongoose.Types.ObjectId(String(subjectId));
  const teacherFilter = { _id: subjectOid };
  if (!teacherId) {
    await Subject.findByIdAndUpdate(subjectOid, { $unset: { teacherId: 1 } });
    await Teacher.updateMany(
      adminId ? { adminId, subjects: subjectOid } : { subjects: subjectOid },
      { $pull: { subjects: subjectOid } }
    );
    return null;
  }

  const teacherQuery = { _id: teacherId, isActive: true };
  if (adminId) teacherQuery.adminId = adminId;
  const teacher = await Teacher.findOne(teacherQuery);
  if (!teacher) return null;

  await Subject.findByIdAndUpdate(subjectOid, { $set: { teacherId: teacher._id } });

  if (adminId) {
    await Teacher.updateMany(
      { adminId, subjects: subjectOid, _id: { $ne: teacher._id } },
      { $pull: { subjects: subjectOid } }
    );
  } else {
    await Teacher.updateMany(
      { subjects: subjectOid, _id: { $ne: teacher._id } },
      { $pull: { subjects: subjectOid } }
    );
  }
  await Teacher.findByIdAndUpdate(teacher._id, { $addToSet: { subjects: subjectOid } });
  return teacher;
}

/** Classes linked to a subject (classIds + reverse assignedSubjects). */
export async function getClassesForSubject(subjectId, adminId) {
  const subject = await Subject.findById(subjectId).select('classIds').lean();
  if (!subject) return [];

  const idSet = new Set((subject.classIds || []).map((id) => String(id)));
  const reverseQuery = { assignedSubjects: subjectId, isActive: true };
  if (adminId) reverseQuery.assignedAdmin = adminId;
  const reverse = await Class.find(reverseQuery).select('_id').lean();
  reverse.forEach((c) => idSet.add(String(c._id)));

  if (idSet.size === 0) return [];
  const query = { _id: { $in: [...idSet] }, isActive: true };
  if (adminId) query.assignedAdmin = adminId;
  return Class.find(query)
    .select('_id classNumber section name')
    .sort({ classNumber: 1, section: 1 })
    .lean();
}

export function formatClassLabel(classDoc) {
  if (!classDoc) return '';
  const num = classDoc.classNumber || '';
  const section = classDoc.section ? `-${classDoc.section}` : '';
  const name = classDoc.name || `Class ${num}${section}`;
  return num ? `Class ${num}${section}` : name;
}

/** Build API shape for admin subject list. */
export async function formatAdminSubject(subject, adminId) {
  const subjectId = String(subject._id);
  let teacher = null;
  if (subject.teacherId) {
    const t = await Teacher.findById(subject.teacherId)
      .select('_id fullName email')
      .lean();
    if (t) {
      teacher = {
        id: String(t._id),
        fullName: t.fullName,
        email: t.email,
      };
    }
  }
  if (!teacher) {
    const fallback = await Teacher.findOne({
      subjects: subject._id,
      isActive: true,
      ...(adminId ? { adminId } : {}),
    })
      .select('_id fullName email')
      .lean();
    if (fallback) {
      teacher = {
        id: String(fallback._id),
        fullName: fallback.fullName,
        email: fallback.email,
      };
    }
  }

  const classDocs = await getClassesForSubject(subject._id, adminId);
  const classes = classDocs.map((c) => ({
    id: String(c._id),
    classNumber: c.classNumber,
    className: c.name || formatClassLabel(c),
    section: c.section,
  }));

  return {
    id: subjectId,
    _id: subject._id,
    name: String(subject.name || '').split('__deleted__')[0].trim(),
    description: subject.description || '',
    board: subject.board,
    isActive: subject.isActive !== false,
    teacher,
    classes,
    classIds: classes.map((c) => c.id),
    createdAt: subject.createdAt,
  };
}

/**
 * Hide Biology_6-style rows when a clean sibling (BIOLOGY, BIOIOGY) exists in the same list.
 */
export function filterCatalogSubjectsWithCleanSibling(subjectDocs) {
  const cleanKeys = new Set();
  for (const s of subjectDocs) {
    if (!isCatalogStyleSubjectName(s.name)) {
      cleanKeys.add(subjectGroupKey(s.name));
    }
  }
  return subjectDocs.filter((s) => {
    if (!isCatalogStyleSubjectName(s.name)) return true;
    return !cleanKeys.has(subjectGroupKey(s.name));
  });
}

function rowPriority(row) {
  let score = 0;
  if (!isCatalogStyleSubjectName(row.name)) score += 100;
  if (row.teacher) score += 50;
  if (row.classes?.length) score += 30;
  return score;
}

/** One admin table row per subject (merges MATHS + MATHS_6 + MATHS_7). */
export function dedupeAdminSubjectsByPlainName(formattedRows) {
  const groups = new Map();
  for (const row of formattedRows) {
    const key = subjectGroupKey(row.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const merged = [];
  for (const rows of groups.values()) {
    if (rows.length === 1) {
      merged.push({
        ...rows[0],
        variantIds: [rows[0].id],
      });
      continue;
    }

    const sorted = [...rows].sort((a, b) => rowPriority(b) - rowPriority(a));
    const primary = { ...sorted[0] };
    const classMap = new Map();
    const variantIds = new Set();

    for (const r of sorted) {
      variantIds.add(r.id);
      for (const c of r.classes || []) {
        classMap.set(c.id, c);
      }
      if (!primary.teacher && r.teacher) primary.teacher = r.teacher;
    }

    const cleanRow = sorted.find((r) => !isCatalogStyleSubjectName(r.name));
    if (cleanRow) {
      primary.id = cleanRow.id;
      primary._id = cleanRow._id;
      primary.name = cleanRow.name;
      if (!primary.description && cleanRow.description) {
        primary.description = cleanRow.description;
      }
    } else {
      primary.name = extractPlainSubjectNameForContent(primary.name);
    }

    primary.classes = [...classMap.values()].sort((a, b) =>
      String(a.classNumber || '').localeCompare(String(b.classNumber || ''), undefined, {
        numeric: true,
      })
    );
    primary.classIds = primary.classes.map((c) => c.id);
    primary.variantIds = [...variantIds];
    merged.push(primary);
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

/** Subject IDs for a student's class document. */
export function subjectIdsFromClassDoc(classDoc) {
  if (!classDoc?.assignedSubjects?.length) return [];
  return classDoc.assignedSubjects.map((s) => (s._id ? s._id : s));
}
