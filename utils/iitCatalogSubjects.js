/**
 * Resolve IIT-board catalog subjects for a student's class.
 * Class.assignedSubjects usually only lists curriculum subjects; EduOTT videos
 * live on separate IIT subject rows — include those when the school has IIT tracks.
 */
import Subject from '../models/Subject.js';
import { normalizeClassNumberLabel } from './studentClassContent.js';
import { learningPathSubjectGroup } from './resolveSubjectContentIds.js';

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

async function findIitCatalogSubjectsForClass(classNumber, opts = {}) {
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
    .select('_id name productCategory')
    .lean();

  return subjects.filter((row) => {
    const cat = String(row?.productCategory || '')
      .toUpperCase()
      .trim();
    // Untagged IIT subjects are visible to any school with IIT EduOTT on.
    if (!cat) return true;
    return allowedTracks.has(cat);
  });
}

/**
 * @param {string|number|null|undefined} classNumber
 * @param {{ iitCategories?: string[] }} [opts]
 * @returns {Promise<import('mongoose').Types.ObjectId[]>}
 */
export async function resolveIitCatalogSubjectIdsForClass(classNumber, opts = {}) {
  const subjects = await findIitCatalogSubjectsForClass(classNumber, opts);
  return subjects.map((row) => row._id);
}

/**
 * IIT catalog ids for one class that belong to the same Learning Path family
 * as seedSubjectName (Mathematics → Mathematics IIT Alpha, not Biology IIT).
 */
export async function resolveSameGroupIitCatalogSubjectIds(
  classNumber,
  seedSubjectName,
  opts = {},
) {
  const seedKey = learningPathSubjectGroup(seedSubjectName);
  if (!seedKey) return [];
  const subjects = await findIitCatalogSubjectsForClass(classNumber, opts);
  return subjects
    .filter((row) => learningPathSubjectGroup(row?.name) === seedKey)
    .map((row) => row._id);
}

function mergeIdLists(librarySubjectIds, extraIds) {
  const merged = new Map();
  for (const id of librarySubjectIds || []) {
    if (!id) continue;
    merged.set(String(id), id);
  }
  for (const id of extraIds || []) {
    if (!id) continue;
    merged.set(String(id), id);
  }
  return [...merged.values()];
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
  return mergeIdLists(librarySubjectIds, iitIds);
}

/**
 * Per-subject Learning Path fetch: add IIT siblings for this subject only.
 * Never attach Biology/Chemistry IIT onto a Mathematics query.
 */
export async function mergeSameGroupIitCatalogSubjectIds(
  librarySubjectIds,
  classNumber,
  seedSubjectName,
  opts = {},
) {
  const iitIds = await resolveSameGroupIitCatalogSubjectIds(
    classNumber,
    seedSubjectName,
    opts,
  );
  if (!iitIds.length) {
    return Array.isArray(librarySubjectIds) ? [...librarySubjectIds] : [];
  }
  return mergeIdLists(librarySubjectIds, iitIds);
}

/**
 * Teachers / admins browse across classes — merge IIT subjects for every class number provided.
 * If classNumbers is empty, merges IIT subjects for classes 6–12.
 */
export async function mergeIitCatalogSubjectsForClasses(
  librarySubjectIds,
  classNumbers = [],
  opts = {},
) {
  const classes = [
    ...new Set(
      (Array.isArray(classNumbers) ? classNumbers : [])
        .map((c) => normalizeClassNumberLabel(c))
        .filter(Boolean),
    ),
  ];
  const targets = classes.length > 0 ? classes : ['6', '7', '8', '9', '10', '11', '12'];
  let merged = Array.isArray(librarySubjectIds) ? [...librarySubjectIds] : [];
  for (const cn of targets) {
    merged = await mergeIitCatalogSubjectsIntoLibraryIds(merged, cn, opts);
  }
  return merged;
}
