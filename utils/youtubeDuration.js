/** @typedef {Map<string, number>} DurationCache */

/** @type {DurationCache} */
const durationCache = new Map();

/**
 * @param {string} url
 * @returns {string | null}
 */
export function extractYouTubeIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  if (match && match[2] && match[2].length === 11) return match[2];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const partialMatch = url.match(/watch\?v=([a-zA-Z0-9_-]{11})/);
  if (partialMatch) return partialMatch[1];
  return null;
}

/**
 * Fetch video length from YouTube watch page (no API key). Results are cached in memory.
 * @param {string} videoId
 * @returns {Promise<number>} seconds, or 0
 */
export async function fetchYouTubeDurationSeconds(videoId) {
  if (!videoId) return 0;
  if (durationCache.has(videoId)) return durationCache.get(videoId);

  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return 0;
    const html = await res.text();
    const lengthMatch = html.match(/"lengthSeconds":"(\d+)"/);
    if (lengthMatch) {
      const sec = parseInt(lengthMatch[1], 10);
      if (sec > 0) {
        durationCache.set(videoId, sec);
        return sec;
      }
    }
    const msMatch = html.match(/"approxDurationMs":"(\d+)"/);
    if (msMatch) {
      const sec = Math.round(parseInt(msMatch[1], 10) / 1000);
      if (sec > 0) {
        durationCache.set(videoId, sec);
        return sec;
      }
    }
  } catch (err) {
    console.warn('YouTube duration fetch failed:', videoId, err?.message || err);
  }
  return 0;
}
