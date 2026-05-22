import mongoose from 'mongoose';
import Subject from '../models/Subject.js';
import { subjectDisplayName } from './subjectDelete.js';

/** Subject was soft-deleted (name suffix from softDeleteSubject). */
export function isSoftDeletedSubjectName(name) {
  return String(name || '').includes('__deleted__');
}

export function isCatalogActiveSubject(doc) {
  if (!doc) return false;
  if (doc.isActive === false) return false;
  if (isSoftDeletedSubjectName(doc.name)) return false;
  return true;
}

const ACTIVE_SUBJECT_QUERY = {
  isActive: true,
  name: { $not: /__deleted__/ },
};

/** All active catalog subject ObjectIds (optionally narrowed by board, etc.). */
export async function getActiveCatalogSubjectIds(extraFilter = {}) {
  const rows = await Subject.find({ ...ACTIVE_SUBJECT_QUERY, ...extraFilter })
    .select('_id')
    .lean();
  return rows.map((r) => r._id);
}

/** Keep only ids that still exist on the active catalog. */
export async function filterToActiveCatalogSubjectIds(candidateIds) {
  if (!candidateIds?.length) return [];
  const ids = candidateIds
    .map((id) => {
      const str = String(id);
      return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
    })
    .filter(Boolean);
  if (!ids.length) return [];

  const rows = await Subject.find({
    _id: { $in: ids },
    ...ACTIVE_SUBJECT_QUERY,
  })
    .select('_id')
    .lean();
  return rows.map((r) => r._id);
}

export function buildActiveSubjectIdSet(subjectIds) {
  return new Set(subjectIds.map((id) => String(id)));
}

/** Drop inactive content or content tied to soft-deleted / inactive subjects. */
export function filterContentRowsForActiveCatalog(rows, activeIdSet) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    if (row?.isActive === false) return false;

    const subj = row.subject;
    let sid = null;
    let name = '';

    if (subj != null && typeof subj === 'object') {
      sid = subj._id != null ? String(subj._id) : null;
      name = subj.name || '';
      if (subj.isActive === false) return false;
    } else if (subj != null) {
      sid = String(subj);
    }

    if (!sid || !activeIdSet.has(sid)) return false;
    if (isSoftDeletedSubjectName(name)) return false;
    return true;
  });
}

/** Normalize populated subject for API responses. */
export function formatContentSubjectForResponse(subjectDoc, subjectId, fallbackName) {
  const displayName = subjectDoc?.name
    ? subjectDisplayName(subjectDoc.name)
    : subjectDisplayName(fallbackName) || fallbackName || 'General';

  return {
    _id: subjectId,
    name: displayName,
    board: subjectDoc?.board,
    classNumber: subjectDoc?.classNumber,
    stateName: subjectDoc?.stateName,
    missingFromCatalog: !subjectDoc,
  };
}
