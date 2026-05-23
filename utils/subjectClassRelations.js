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
 * Rebuild Subject.classIds from every active class that lists this subject in assignedSubjects.
 */
export async function rebuildSubjectClassIdsFromAssignedClasses(subjectId, adminId) {
  const subjectOid = new mongoose.Types.ObjectId(String(subjectId));
  const classQuery = {
    isActive: true,
    assignedSubjects: subjectOid,
  };
  if (adminId) classQuery.assignedAdmin = adminId;

  const classes = await Class.find(classQuery).select('_id').lean();
  await Subject.findByIdAndUpdate(subjectOid, {
    $set: { classIds: classes.map((c) => c._id) },
  });
  return classes.map((c) => c._id);
}

/**
 * Set subjects for one class section and keep Subject.classIds in sync (section-scoped).
 */
export async function syncClassSectionSubjects(classId, subjectIds, adminId) {
  const classOid = new mongoose.Types.ObjectId(String(classId));
  const classFilter = { _id: classOid, isActive: true };
  if (adminId) classFilter.assignedAdmin = adminId;

  const classDoc = await Class.findOne(classFilter).select('_id assignedSubjects').lean();
  if (!classDoc) return { ok: false, message: 'Class not found' };

  const newSubjectOids = [...new Set((subjectIds || []).map(String).filter(Boolean))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (newSubjectOids.length > 0) {
    const subjectFilter = { _id: { $in: newSubjectOids } };
    const found = await Subject.find(subjectFilter).select('_id').lean();
    if (found.length !== newSubjectOids.length) {
      return { ok: false, message: 'One or more subject IDs are invalid' };
    }
  }

  const previousIds = new Set((classDoc.assignedSubjects || []).map((id) => String(id)));
  const newIds = new Set(newSubjectOids.map((id) => String(id)));
  const touchedSubjectIds = new Set([...previousIds, ...newIds]);

  await Class.updateOne(
    { _id: classOid },
    { $set: { assignedSubjects: newSubjectOids, updatedAt: new Date() } }
  );

  for (const subjectId of touchedSubjectIds) {
    await rebuildSubjectClassIdsFromAssignedClasses(subjectId, adminId);
  }

  return { ok: true, classId: classOid, subjectCount: newSubjectOids.length };
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

/**
 * Classes linked to a subject.
 * @param {object} [options]
 * @param {boolean} [options.adminListOnly] — only Subject.classIds (explicit admin links), not legacy Class.assignedSubjects-only rows
 */
export async function getClassesForSubject(subjectId, adminId, options = {}) {
  const { adminListOnly = false } = options;
  const subject = await Subject.findById(subjectId).select('classIds').lean();
  if (!subject) return [];

  const idSet = new Set((subject.classIds || []).map((id) => String(id)));

  if (!adminListOnly) {
    const reverseQuery = { assignedSubjects: subjectId, isActive: true };
    if (adminId) reverseQuery.assignedAdmin = adminId;
    const reverse = await Class.find(reverseQuery).select('_id').lean();
    reverse.forEach((c) => idSet.add(String(c._id)));
  }

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
export async function formatAdminSubject(subject, adminId, options = {}) {
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

  const classDocs = await getClassesForSubject(subject._id, adminId, {
    adminListOnly: options.adminListOnly === true,
  });
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

/** One admin table row per subject (merges MATHS + MATHS_6 + MATHS_7 for display). */
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

    const variantIds = rows.map((r) => r.id);
    const cleanRow = rows.find((r) => !isCatalogStyleSubjectName(r.name));
    const catalogRows = rows.filter((r) => isCatalogStyleSubjectName(r.name));

    // Use the clean subject row as the table row; never pull class links from legacy catalog rows.
    let primary;
    if (cleanRow) {
      primary = { ...cleanRow };
      if (!primary.teacher) {
        const withTeacher = rows.find((r) => r.teacher);
        if (withTeacher) primary.teacher = withTeacher.teacher;
      }
      if (!primary.description) {
        const withDesc = rows.find((r) => r.description);
        if (withDesc) primary.description = withDesc.description;
      }
    } else {
      const fallback = catalogRows[0] || rows[0];
      primary = {
        ...fallback,
        name: extractPlainSubjectNameForContent(fallback.name),
      };
    }

    const classMap = new Map();
    for (const row of rows) {
      for (const c of row.classes || []) {
        if (c?.id) classMap.set(String(c.id), c);
      }
    }
    primary.classes = [...classMap.values()];
    primary.classIds = primary.classes.map((c) => c.id);
    primary.variantIds = variantIds;
    if (catalogRows.length > 0 && cleanRow) {
      primary._legacyCatalogVariantIds = catalogRows.map((r) => r.id);
    }
    merged.push(primary);
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

/** Subject IDs for a student's class document. */
export function subjectIdsFromClassDoc(classDoc) {
  if (!classDoc?.assignedSubjects?.length) return [];
  return classDoc.assignedSubjects.map((s) => (s._id ? s._id : s));
}
