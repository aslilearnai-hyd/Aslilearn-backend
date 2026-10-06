/**
 * Merge active teacher rows from the User and legacy Teacher stores.
 * Activity collections reference User._id, so a matching User identity wins.
 */
export function mergeTeacherIdentityRows(userTeachers = [], teacherDocs = []) {
  const normalizedEmail = (value) => String(value || '').toLowerCase().trim();
  const byId = new Map();
  const userEmails = new Set();

  for (const teacher of userTeachers) {
    const email = normalizedEmail(teacher.email);
    if (email) userEmails.add(email);
    byId.set(String(teacher._id), {
      teacherId: teacher._id,
      name: teacher.fullName || '',
      email: teacher.email || '',
      lastLogin: teacher.lastLogin,
      createdAt: teacher.createdAt,
    });
  }

  for (const profile of teacherDocs) {
    const profileId = String(profile._id);
    const email = normalizedEmail(profile.email);
    if (email && userEmails.has(email)) continue;
    if (byId.has(profileId)) continue;
    byId.set(profileId, {
      teacherId: profile._id,
      name: profile.fullName || profile.name || '',
      email: profile.email || '',
      lastLogin: profile.lastLogin || null,
      createdAt: profile.createdAt,
    });
  }

  return [...byId.values()];
}
