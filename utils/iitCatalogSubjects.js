/**
 * Resolve IIT-board catalog subjects for a student's class.
 * Class.assignedSubjects usually only lists curriculum subjects; EduOTT videos
 * live on separate IIT subject rows — include those when the school has IIT tracks.
 */
import Subject from '../models/Subject.js';
import { normalizeClassNumberLabel } from './studentClassContent.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTrackSet(iitCategories) {
  return new Set(
    (Array.isArray(iitCategories) ? iitCategories : [])
      .map((c) => String(c || '').toUpperCase().trim())
      .filter(Boolean),
  );
}

/**
 * @param {string|number|null|undefined} classNumber
 * @param {{ iitCategories?: string[] }} [opts]
 * @returns {Promise<import('mongoose').Types.ObjectId[]>}
 */
export async function resolveIitCatalogSubjectIdsForClass(classNumber, opts = {}) {
  const allowedTracks = normalizeTrackSet(opts.iitCategories);
  if (!allowedTracks.size) return [];

  const classNum = normalizeClassNumberLabel(classNumber);
  if (!classNum) return [];

  const subjects = await Subject.find({
    isActive: true,
    name: { $not: /__deleted__/ },
    board: 'IIT',
    $or: [
      { classNumber: classNum },
      { classNumber: `Class ${classNum}` },
      { classNumber: `Class ${classNum}`.toUpperCase() },
      { name: new RegExp(`_${escapeRegex(classNum)}$`) },
    ],
  })
    .select('_id productCategory')
    .lean();

  return subjects
    .filter((row) => {
      const cat = String(row?.productCategory || '')
        .toUpperCase()
        .trim();
      // Untagged IIT subjects are visible to any school with IIT EduOTT on.
      if (!cat) return true;
      return allowedTracks.has(cat);
    })
    .map((row) => row._id);
}

/**
 * Merge IIT class subjects into an existing library id list (deduped).
 * @param {Array} librarySubjectIds
 * @param {string|number|null|undefined} classNumber
 * @param {{ iitCategories?: string[] }} [opts]
 */
export async function mergeIitCatalogSubjectsIntoLibraryIds(
  librarySubjectIds,
  classNumber,
  opts = {},
) {
  const iitIds = await resolveIitCatalogSubjectIdsForClass(classNumber, opts);
  if (!iitIds.length) {
    return Array.isArray(librarySubjectIds) ? [...librarySubjectIds] : [];
  }
  const merged = new Map();
  for (const id of librarySubjectIds || []) {
    if (!id) continue;
    merged.set(String(id), id);
  }
  for (const id of iitIds) {
    merged.set(String(id), id);
  }
  return [...merged.values()];
}
