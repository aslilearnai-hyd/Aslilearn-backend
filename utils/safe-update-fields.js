/**
 * Safe field allowlists for mass-assignment prevention.
 */

export const SAFE_VIDEO_UPDATE_FIELDS = Object.freeze([
  'title',
  'description',
  'videoUrl',
  'thumbnailUrl',
  'thumbnail',
  'duration',
  'subjectId',
  'difficulty',
  'isPublished',
  'youtubeUrl',
  'isYouTubeVideo',
]);

export const SAFE_ASSESSMENT_UPDATE_FIELDS = Object.freeze([
  'title',
  'description',
  'questions',
  'subjectIds',
  'difficulty',
  'duration',
  'totalPoints',
  'isPublished',
  'driveLink',
  'isDriveQuiz',
  'assignedClasses',
]);

export const SAFE_LEARNING_PATH_UPDATE_FIELDS = Object.freeze([
  'title',
  'description',
  'subjectIds',
  'difficulty',
  'estimatedHours',
  'videoIds',
  'isPublished',
]);

export function pickAllowedFields(body, allowed) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
      out[key] = body[key];
    }
  }
  return out;
}
