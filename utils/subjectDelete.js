/**
 * Soft-delete a subject: unassign from teachers/classes/students, mark inactive,
 * and rename once so unique name/code indexes allow re-creation.
 */
export async function softDeleteSubject(subject) {
  const { removeSubjectIdFromAllAssignments } = await import('./removeSubjectAssignments.js');
  await removeSubjectIdFromAllAssignments(subject._id);

  const baseName = String(subject.name || 'subject').split('__deleted__')[0].trim() || 'subject';
  subject.isActive = false;
  subject.code = undefined;
  subject.name = `${baseName}__deleted__${Date.now()}`;
  await subject.save();
}

/** Display name without soft-delete suffixes */
export function subjectDisplayName(name) {
  return String(name || '').split('__deleted__')[0].trim();
}
