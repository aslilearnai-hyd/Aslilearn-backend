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
 * Link a teacher to a subject without removing other teachers who teach the same subject.
 * Sets Subject.teacherId (primary) when explicitly assigned from subject management.
 *
 * Note: This only updates Subject.teacherId (the subject's primary teacher). It does NOT
 * modify the teacher's own `subjects` list — that list is owned solely by the "Assign
 * Subjects" teacher flow. Auto-adding here previously caused subjects the admin never
 * selected in the Assign Subjects modal to appear on the teacher card.
 */
export async function syncSubjectTeacher(subjectId, teacherId, adminId) {
  const subjectOid = new mongoose.Types.ObjectId(String(subjectId));
  if (!teacherId) {
    // Only clear the shared primary if it belongs to this school (subjects are global by board).
    if (adminId) {
      const subject = await Subject.findById(subjectOid).select('teacherId').lean();
      if (subject?.teacherId) {
        const current = await Teacher.findById(subject.teacherId).select('adminId').lean();
        if (current && String(current.adminId) === String(adminId)) {
          await Subject.findByIdAndUpdate(subjectOid, { $unset: { teacherId: 1 } });
        }
      }
    } else {
      await Subject.findByIdAndUpdate(subjectOid, { $unset: { teacherId: 1 } });
    }
    return null;
  }

  const teacherQuery = { _id: teacherId, isActive: true };
  if (adminId) teacherQuery.adminId = adminId;
  const teacher = await Teacher.findOne(teacherQuery);
  if (!teacher) return null;

  // Do not overwrite another school's primary teacher on the shared Subject doc.
  if (adminId) {
    const subject = await Subject.findById(subjectOid).select('teacherId').lean();
    if (subject?.teacherId) {
      const current = await Teacher.findById(subject.teacherId).select('adminId').lean();
      if (current && String(current.adminId) !== String(adminId)) {
        return teacher;
      }
    }
  }

  await Subject.findByIdAndUpdate(subjectOid, { $set: { teacherId: teacher._id } });
  return teacher;
}

/**
 * Keep Subject.teacherId (primary) in sync after a teacher's subject list changes.
 * Does not remove subjects from other teachers.
 */
export async function syncTeacherSubjectPrimaryLinks(
  teacherId,
  previousSubjectIds,
  newSubjectIds,
  adminId
) {
  const teacherOid = new mongoose.Types.ObjectId(String(teacherId));
  const prev = new Set((previousSubjectIds || []).map(String));
  const next = new Set((newSubjectIds || []).map(String));
  const removed = [...prev].filter((id) => !next.has(id));
  const added = [...next].filter((id) => !prev.has(id));
  const teacherScope = { isActive: true, ...(adminId ? { adminId } : {}) };

  for (const subjectId of removed) {
    const subjectOid = new mongoose.Types.ObjectId(String(subjectId));
    await Subject.updateOne(
      { _id: subjectOid, teacherId: teacherOid },
      { $unset: { teacherId: 1 } }
    );
    const replacement = await Teacher.findOne({
      ...teacherScope,
      subjects: subjectOid,
      _id: { $ne: teacherOid },
    })
      .select('_id')
      .lean();
    if (replacement) {
      // Only claim the shared primary slot if empty or already ours.
      const subject = await Subject.findById(subjectOid).select('teacherId').lean();
      let canSet = !subject?.teacherId;
      if (!canSet && subject?.teacherId && adminId) {
        const current = await Teacher.findById(subject.teacherId).select('adminId').lean();
        canSet = current && String(current.adminId) === String(adminId);
      } else if (!canSet && !adminId) {
        canSet = true;
      }
      if (canSet) {
        await Subject.findByIdAndUpdate(subjectOid, { $set: { teacherId: replacement._id } });
      }
    }
  }

  for (const subjectId of added) {
    const subjectOid = new mongoose.Types.ObjectId(String(subjectId));
    await Subject.updateOne(
      {
        _id: subjectOid,
        $or: [{ teacherId: null }, { teacherId: { $exists: false } }],
      },
      { $set: { teacherId: teacherOid } }
    );
  }
}

/**
 * Before hiding Biology_6-style rows, copy their classIds onto the clean sibling
 * so Assigned Classes is not lost when the catalog row is filtered out.
 */
export function mergeCatalogClassIdsOntoCleanSiblings(subjectDocs) {
  const byKey = new Map();
  for (const s of subjectDocs || []) {
    const key = subjectGroupKey(s.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(s);
  }

  for (const group of byKey.values()) {
    const clean = group.find((s) => !isCatalogStyleSubjectName(s.name));
    if (!clean) continue;
    const merged = new Set((clean.classIds || []).map((id) => String(id)));
    for (const s of group) {
      if (!isCatalogStyleSubjectName(s.name)) continue;
      for (const id of s.classIds || []) merged.add(String(id));
    }
    clean.classIds = [...merged].filter((id) => mongoose.Types.ObjectId.isValid(id));
  }

  return subjectDocs;
}

/**
 * When a teacher has subjects + classes (or explicit subject↔class assignments),
 * keep Subject.classIds ↔ Class.assignedSubjects in sync so Subjects table
 * "Assigned Classes" matches Teacher assignments.
 */
export async function syncTeacherSubjectClassLinks(teacherId, adminId) {
  if (!teacherId || !mongoose.Types.ObjectId.isValid(String(teacherId))) {
    return { ok: false, message: 'Invalid teacher id' };
  }

  const teacherQuery = { _id: teacherId, isActive: true };
  if (adminId) teacherQuery.adminId = adminId;
  const teacher = await Teacher.findOne(teacherQuery)
    .select('_id subjects assignedClassIds assignments')
    .lean();
  if (!teacher) return { ok: false, message: 'Teacher not found' };

  const subjectIds = [...new Set((teacher.subjects || []).map((id) => String(id)).filter(Boolean))];
  const assignedClassIds = [
    ...new Set((teacher.assignedClassIds || []).map((id) => String(id)).filter(Boolean)),
  ];
  const assignments = Array.isArray(teacher.assignments) ? teacher.assignments : [];

  const pairs = new Map(); // subjectId -> Set(classId)
  const ensurePair = (subjectId, classId) => {
    if (!subjectId || !classId) return;
    if (!mongoose.Types.ObjectId.isValid(subjectId) || !mongoose.Types.ObjectId.isValid(classId)) return;
    if (!pairs.has(subjectId)) pairs.set(subjectId, new Set());
    pairs.get(subjectId).add(classId);
  };

  if (assignments.length > 0) {
    for (const row of assignments) {
      ensurePair(String(row.subjectId || ''), String(row.classId || ''));
    }
  } else {
    for (const subjectId of subjectIds) {
      for (const classId of assignedClassIds) ensurePair(subjectId, classId);
    }
  }

  for (const [subjectId, classIdSet] of pairs.entries()) {
    const subject = await Subject.findById(subjectId).select('classIds').lean();
    if (!subject) continue;
    const merged = [
      ...new Set([
        ...(subject.classIds || []).map((id) => String(id)),
        ...[...classIdSet],
      ]),
    ];
    await syncSubjectClassIds(subjectId, merged, adminId);
  }

  return { ok: true, subjectCount: pairs.size };
}

/**
 * Classes linked to a subject.
 * @param {object} [options]
 * @param {boolean} [options.adminListOnly] — only Subject.classIds (explicit admin links), not legacy Class.assignedSubjects-only rows
 */
export async function getClassesForSubject(subjectId, adminId, options = {}) {
  const { adminListOnly = false, extraClassIds = [] } = options;
  const subject = await Subject.findById(subjectId).select('classIds teacherId').lean();
  if (!subject) return [];

  const idSet = new Set((subject.classIds || []).map((id) => String(id)));
  for (const id of extraClassIds || []) {
    if (id) idSet.add(String(id));
  }

  if (!adminListOnly) {
    const reverseQuery = { assignedSubjects: subjectId, isActive: true };
    if (adminId) reverseQuery.assignedAdmin = adminId;
    const reverse = await Class.find(reverseQuery).select('_id').lean();
    reverse.forEach((c) => idSet.add(String(c._id)));

    // Also surface classes from teachers assigned this subject (Teacher Mgmt flow).
    const teacherQuery = {
      isActive: true,
      $or: [{ subjects: subject._id }, ...(subject.teacherId ? [{ _id: subject.teacherId }] : [])],
    };
    if (adminId) teacherQuery.adminId = adminId;
    const teachers = await Teacher.find(teacherQuery)
      .select('assignedClassIds assignments subjects')
      .lean();
    for (const teacher of teachers) {
      const assignments = Array.isArray(teacher.assignments) ? teacher.assignments : [];
      if (assignments.length > 0) {
        for (const row of assignments) {
          if (String(row.subjectId) === String(subjectId) && row.classId) {
            idSet.add(String(row.classId));
          }
        }
      } else {
        for (const classId of teacher.assignedClassIds || []) {
          idSet.add(String(classId));
        }
      }
    }
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
      .select('_id fullName email adminId')
      .lean();
    // Subject.teacherId is shared across schools; only show if teacher belongs to this admin.
    const sameSchool =
      !adminId || (t?.adminId && String(t.adminId) === String(adminId));
    if (t && sameSchool) {
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
    // Preserve classIds merged onto lean docs (e.g. catalog → clean sibling) before DB re-read.
    extraClassIds: (subject.classIds || []).map((id) => String(id)),
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
