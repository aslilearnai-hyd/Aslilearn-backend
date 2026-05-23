import { extractYouTubeIdFromUrl, fetchYouTubeDurationSeconds } from './youtubeDuration.js';

function isVideoType(type) {
  return String(type || '').toLowerCase() === 'video';
}

function primaryFileUrl(doc) {
  if (doc.fileUrl && String(doc.fileUrl).trim()) return String(doc.fileUrl).trim();
  if (Array.isArray(doc.fileUrls) && doc.fileUrls[0]) return String(doc.fileUrls[0]).trim();
  return '';
}

function isYouTubeUrl(url) {
  return url.includes('youtube.com') || url.includes('youtu.be');
}

/**
 * Fill missing duration (minutes) for Video rows, mainly YouTube links with duration 0 in DB.
 * @param {Array<Record<string, unknown>>} contents
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function enrichContentDurations(contents) {
  if (!Array.isArray(contents) || contents.length === 0) return contents;

  const enriched = await Promise.all(
    contents.map(async (doc) => {
      const existing = Number(doc.duration) || 0;
      if (existing > 0) return doc;
      if (!isVideoType(doc.type)) return doc;

      const url = primaryFileUrl(doc);
      if (!url || !isYouTubeUrl(url)) return doc;

      const videoId = extractYouTubeIdFromUrl(url);
      if (!videoId) return doc;

      const seconds = await fetchYouTubeDurationSeconds(videoId);
      if (seconds <= 0) return doc;

      const minutes = Math.max(1, Math.round(seconds / 60));
      return { ...doc, duration: minutes, durationSeconds: seconds };
    })
  );

  return enriched;
}
