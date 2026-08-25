/**
 * School portal feature catalogs for admin / teacher / student dashboards.
 * IDs must stay in sync with client `school-role-access.ts` and mobile `school-management.ts`.
 */

export const ALLOWED_SCHOOL_PORTAL_PERMISSIONS = [
  'User Management',
  'Content Management',
  'Analytics',
  'Subscriptions',
  'Settings',
  'Exam Management',
  'Learning Paths',
  'School Calendar',
  'Vidya AI',
  'Edu OTT',
];

export const ALLOWED_TEACHER_PORTAL_PERMISSIONS = [
  'Dashboard',
  'My Classes',
  'My Students',
  'Learning Paths',
  'Edu OTT',
  'Vidya AI',
  'Calendar',
  'Offline Results',
  'Settings',
  'Reports',
];

export const ALLOWED_STUDENT_PORTAL_PERMISSIONS = [
  'Dashboard',
  'Learning Paths',
  'Edu OTT',
  'Exams',
  'Quiz',
  'Offline Results',
  'Timetable',
  'Vidya AI',
  'Profile',
];

export function filterKnownPermissions(list, allowed) {
  const allowedSet = new Set(allowed);
  if (!Array.isArray(list)) return [];
  return list.map((p) => String(p)).filter((p) => allowedSet.has(p));
}

/** Empty or full catalog ⇒ unlimited (all features). */
export function isUnlimitedPortalAccess(perms, allowedIds) {
  if (!perms || perms.length === 0) return true;
  const set = new Set(perms);
  return allowedIds.every((f) => set.has(f));
}

export function resolvePortalPermissions(mode, selected, allowedIds) {
  if (mode === 'unlimited') return [...allowedIds];
  return filterKnownPermissions(selected, allowedIds);
}

/**
 * Normalize stored permissions for API clients.
 * Empty array historically means unlimited → expand to full catalog.
 */
export function expandPortalPermissions(perms, allowedIds) {
  if (isUnlimitedPortalAccess(perms, allowedIds)) return [...allowedIds];
  return filterKnownPermissions(perms, allowedIds);
}
