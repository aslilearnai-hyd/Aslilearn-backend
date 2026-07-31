import express from 'express';
import http from 'http';
import https from 'https';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Video from '../../models/Video.js';
import Assessment from '../../models/Assessment.js';
import Exam from '../../models/Exam.js';
import Question from '../../models/Question.js';
import Teacher from '../../models/Teacher.js';
import Subject from '../../models/Subject.js';
import Content from '../../models/Content.js';
import StudentRemark from '../../models/StudentRemark.js';
import TeacherWorkDiary from '../../models/TeacherWorkDiary.js';
import RiskAnalysisReport from '../../models/RiskAnalysisReport.js';
import GeminiPerformanceReport from '../../models/GeminiPerformanceReport.js';
import { verifyToken } from '../../middleware/auth.js';
import { getMyWeeklyDigest } from '../../controllers/impactReportController.js';
import { getSchoolAdminCalendarEvents, monthBounds } from '../../controllers/calendarController.js';
import { examVisibleToSchool } from '../../utils/exam-visibility.js';
import {
  getStudentExamRanking,
  getAllStudentRankings,
} from '../../controllers/studentRankingController.js';
import geminiService, { generateStudentTool } from '../../services/gemini-service.js';
import { fetchRotatingAiToolData } from '../../services/ai-tool-rotation-service.js';
import {
  buildDeliveryMetadataFromDoc,
  buildRawDataForTool,
  unwrapStoredAiToolContent,
} from '../../utils/build-ai-tool-raw-data.js';
import {
  advancedAnalyticsMockData,
  buildPerQuestionAttemptAnalytics,
  enrichQuestionAnalyticsFromExamQuestions,
  generateAdvancedAnalytics,
} from '../../utils/advancedExamAnalytics.js';
import { normalizeSchoolBoard, resolveUserDisplayBoard } from '../../constants/boards.js';
import { QUESTION_LIST_SORT, ensureExamQuestionDisplayOrders } from '../../utils/exam-question-order.js';
import { dedupeExamResultRows } from '../../utils/dedupe-exam-results.js';
import {
  examMatchesStudentAssignedClass,
  resolveStudentClassNumber,
} from '../../utils/studentClassContent.js';
import { buildAdaptiveLearningPayload } from '../../services/student-adaptive-learning-service.js';
import {
  resolveSubjectContentIds,
  resolveSubjectContentIdsMany,
  subjectIdAllowedWithSiblings,
  resolveExamQuestionSubjectKey,
} from '../../utils/resolveSubjectContentIds.js';
import { assertAllowedFetchUrl, getContentProxyAllowlist } from '../../utils/url-allowlist.js';
import {
  buildCachedAnalysisResponse,
  cachedHasStaleAiExplanations,
  collectCachedExplanationsByQuestionId,
  getInFlight,
  inFlightKey,
  setInFlight,
  shouldRegenerateCachedReport,
} from '../../utils/examAiAnalysisCache.js';
import {
  escapeRegexClassSuffix,
  plainSubjectName,
  normalizeTopicLabel,
  subjectSlugMatches,
  topicFuzzyMatch,
  parseWeakTopicRowsFromQuery,
  resolveStudentClassDoc,
  resolveStudentSubjectIdsForLibrary,
  resolveStudentClassSubjects,
  resolveStudentContentBoard,
  getStudentAdminId,
} from './helpers.js';


const router = express.Router();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** NCERT / many government PDF hosts block or slow datacenter egress; browser fetch often works. */
function isBrowserDirectPdfHost(hostname) {
  const h = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (!h) return false;
  if (h === 'ncert.nic.in' || h.endsWith('.ncert.nic.in')) return true;
  const extra = String(process.env.PDF_PROXY_REDIRECT_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  return extra.some((e) => h === e || h.endsWith(`.${e}`));
}

/** When query `url=` is oddly encoded but still embeds NCERT, carve it out. */
function carveNcertUrl(rawUrl) {
  const variants = [];
  variants.push(String(rawUrl || '').trim());
  try {
    variants.push(decodeURIComponent(variants[0]));
  } catch {
    /* noop */
  }
  try {
    variants.push(decodeURIComponent(variants[1] || variants[0]));
  } catch {
    /* noop */
  }
  const re = /https?:\/\/[a-z0-9.-]*ncert\.nic\.in[^\s"'<>)]*/gi;
  for (const v of variants) {
    const m = v.match(re);
    if (m?.[0]) return m[0];
  }
  return '';
}

/**
 * Prefer browser-side fetch — datacenter egress often fails against NCERT.
 * Handles bare NCERT URLs, google viewer wrappers, odd encoding.
 */
function getPdfBrowserBypassTarget(rawUrlInput, unwrapDepth = 0) {
  if (unwrapDepth > 6) return '';
  const rawTrim = typeof rawUrlInput === 'string' ? rawUrlInput.trim() : '';

  /** @type {URL | null} */
  let parsed = null;
  try {
    parsed = new URL(rawTrim);
  } catch {
    parsed = null;
  }

  if (parsed && ['http:', 'https:'].includes(parsed.protocol)) {
    const h = parsed.hostname.replace(/\.$/, '').toLowerCase();
    if (isBrowserDirectPdfHost(h)) {
      return parsed.toString();
    }
    const unwrapViewer =
      h === 'docs.google.com' ||
      h.endsWith('.docs.google.com') ||
      h === 'drive.google.com';
    if (unwrapViewer) {
      const eu =
        parsed.searchParams.get('url') ||
        parsed.searchParams.get('embeddedurl');
      if (eu) {
        const decodedEu = decodeURIComponent(eu.replace(/\+/g, '%20'));
        const inner = getPdfBrowserBypassTarget(decodedEu, unwrapDepth + 1);
        if (inner) return inner;
      }
    }
  }

  const carved = carveNcertUrl(rawTrim);
  if (carved) {
    try {
      const innerParsed = new URL(carved);
      const ih = innerParsed.hostname.replace(/\.$/, '').toLowerCase();
      if (
        ['http:', 'https:'].includes(innerParsed.protocol) &&
        isBrowserDirectPdfHost(ih)
      ) {
        return innerParsed.toString();
      }
    } catch {
      /* noop */
    }
  }

  return '';
}

const PDF_FETCH_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.PDF_PROXY_FETCH_TIMEOUT_MS) || 55000, 15000),
  120000
);

function downloadWithNodeHttp(targetUrl, timeoutMs = PDF_FETCH_TIMEOUT_MS, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while fetching remote file'));
      return;
    }

    let parsed;
    try {
      parsed = assertAllowedFetchUrl(targetUrl, getContentProxyAllowlist());
    } catch (err) {
      reject(err);
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const req = client.request(
      targetUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'application/pdf,application/octet-stream,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent': 'Mozilla/5.0 ASLI-PDF-Proxy/1.0',
        },
        timeout: timeoutMs,
        // Prefer IPv4 in production environments where IPv6 routes are flaky.
        family: 4,
      },
      (res) => {
        const statusCode = Number(res.statusCode || 0);
        const location = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          const redirectUrl = new URL(location, targetUrl).toString();
          res.resume();
          try {
            assertAllowedFetchUrl(redirectUrl, getContentProxyAllowlist());
          } catch (err) {
            reject(err);
            return;
          }
          downloadWithNodeHttp(redirectUrl, timeoutMs, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          const e = new Error(`Failed to fetch remote file: ${statusCode}`);
          e.status = statusCode;
          reject(e);
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            buffer,
            upstreamType: String(res.headers['content-type'] || 'application/octet-stream'),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Remote fetch timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchRemoteFileWithRetry(targetUrl, contextLabel) {
  const maxAttempts = 4;
  let lastError = null;
  const timeoutMs = PDF_FETCH_TIMEOUT_MS;
  assertAllowedFetchUrl(targetUrl, getContentProxyAllowlist());
  console.log(`[PDF_PROXY] start ${contextLabel}`, { targetUrl, maxAttempts, timeoutMs });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const upstream = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'application/pdf,application/octet-stream,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      clearTimeout(timeout);

      if (!upstream.ok) {
        const shouldRetry = upstream.status >= 500 || upstream.status === 429;
        if (shouldRetry && attempt < maxAttempts) {
          await wait(500 * attempt);
          continue;
        }
        const message = `Failed to fetch ${contextLabel}: ${upstream.status}`;
        const error = new Error(message);
        error.status = upstream.status;
        throw error;
      }

      const arrayBuffer = await upstream.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const upstreamType = upstream.headers.get('content-type') || 'application/octet-stream';
      console.log(`[PDF_PROXY] success ${contextLabel}`, {
        targetUrl,
        bytes: buffer.length,
        upstreamType,
        attempt,
      });
      return { buffer, upstreamType };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      const code = error?.cause?.code || error?.code;
      const msg = error?.message || String(error);
      if (attempt === maxAttempts) {
        console.warn(`[PDF_PROXY] fetch failed (final)`, {
          targetUrl,
          attempt,
          code: code || '',
          message: msg,
        });
      }
      const retryableNetworkError = ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code);
      const retryableAbort = error?.name === 'AbortError';
      if (retryableNetworkError || retryableAbort) {
        try {
          return await downloadWithNodeHttp(targetUrl, timeoutMs);
        } catch (fallbackError) {
          lastError = fallbackError;
        }
      }
      if (attempt < maxAttempts && (retryableNetworkError || retryableAbort)) {
        await wait(500 * attempt);
        continue;
      }
      break;
    }
  }

  const err = lastError || new Error(`Failed to fetch ${contextLabel}`);
  const c = err?.cause?.code || err?.code;
  const m = String(err?.message || '');
  if (c === 'UND_ERR_CONNECT_TIMEOUT' || m.includes('timeout') || m.includes('Timeout') || err?.name === 'AbortError') {
    err.isUpstreamTimeout = true;
  }
  throw err;
}

router.get('/content-download', async (req, res) => {
  try {
    const { url, filename } = req.query;
    console.log('[PDF_PROXY] /content-download request', {
      url: typeof url === 'string' ? url : '',
      filename: typeof filename === 'string' ? filename : '',
      userId: req.userId || '',
      hasTokenQuery: !!(req.query.token && typeof req.query.token === 'string'),
    });
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Missing required url query parameter'
      });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        message: 'Invalid download URL'
      });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        success: false,
        message: 'Only HTTP/HTTPS download URLs are supported'
      });
    }

    const bypassDl = getPdfBrowserBypassTarget(url);
    if (bypassDl) {
      try {
        assertAllowedFetchUrl(bypassDl, getContentProxyAllowlist());
      } catch (err) {
        return res.status(err.status || 403).json({
          success: false,
          message: err.message || 'Domain not allowed',
        });
      }
      console.log('[PDF_PROXY] /content-download 302 → browser (allowlisted)', {
        target: bypassDl.slice(0, 120),
      });
      return res.redirect(302, bypassDl);
    }

    try {
      assertAllowedFetchUrl(url, getContentProxyAllowlist());
    } catch (err) {
      return res.status(err.status || 403).json({
        success: false,
        message: err.message || 'Domain not allowed',
      });
    }

    const { buffer, upstreamType } = await fetchRemoteFileWithRetry(url, 'download file');
    const looksLikePdf = buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
    const isPdf = looksLikePdf || upstreamType.toLowerCase().includes('application/pdf');
    const safeFilename = typeof filename === 'string' && filename.trim()
      ? filename.trim()
      : decodeURIComponent(parsedUrl.pathname.split('/').pop() || 'download');

    res.setHeader('Content-Type', isPdf ? 'application/pdf' : upstreamType);
    res.setHeader('Content-Disposition', `${isPdf ? 'inline' : 'attachment'}; filename="${safeFilename.replace(/"/g, '')}"`);
    setPdfProxyCorsHeaders(req, res);
    allowTrustedPdfFraming(res);
    console.log('[PDF_PROXY] /content-download response', {
      status: 200,
      isPdf,
      upstreamType,
      bytes: buffer.length,
      filename: safeFilename,
    });
    res.send(buffer);
  } catch (error) {
    const isTimeout = error?.isUpstreamTimeout || String(error?.message || '').toLowerCase().includes('timeout');
    if (isTimeout) {
      console.warn('Student content-download proxy: upstream timeout', { message: error?.message });
    } else {
      console.error('Student content-download proxy error:', error);
    }
    const statusCode = error?.status && Number.isInteger(error.status)
      ? error.status
      : isTimeout
        ? 504
        : 500;
    res.status(statusCode).json({
      success: false,
      code: isTimeout ? 'UPSTREAM_TIMEOUT' : undefined,
      message: isTimeout
        ? 'The document host took too long to respond. Try again later or open the file in a new tab.'
        : statusCode === 500
          ? 'Failed to download file'
          : `Failed to download file: ${statusCode}`,
    });
  }
});

function setPdfProxyCorsHeaders(req, res) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}

/** Let aslilearn.ai / Vercel embed proxied PDFs (nginx may still override — prefer canvas preview). */
function allowTrustedPdfFraming(res) {
  res.removeHeader('X-Frame-Options');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://aslilearn.ai https://www.aslilearn.ai https://*.vercel.app",
  );
}

// Proxy file preview for student content URLs (inline rendering in iframe/object)
router.get('/content-preview', async (req, res) => {
  try {
    const { url, filename } = req.query;
    console.log('[PDF_PROXY] /content-preview request', {
      url: typeof url === 'string' ? url : '',
      filename: typeof filename === 'string' ? filename : '',
      userId: req.userId || '',
      hasTokenQuery: !!(req.query.token && typeof req.query.token === 'string'),
    });
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Missing required url query parameter'
      });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        message: 'Invalid preview URL'
      });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        success: false,
        message: 'Only HTTP/HTTPS preview URLs are supported'
      });
    }

    const forceProxy =
      req.query.forceProxy === '1' ||
      req.query.forceProxy === 'true' ||
      req.query.serve === '1';
    const bypass = forceProxy ? '' : getPdfBrowserBypassTarget(url);
    if (bypass) {
      try {
        assertAllowedFetchUrl(bypass, getContentProxyAllowlist());
      } catch (err) {
        return res.status(err.status || 403).json({
          success: false,
          message: err.message || 'Domain not allowed',
        });
      }
      console.log('[PDF_PROXY] /content-preview 302 → browser', {
        host: parsedUrl.hostname,
        bypassPreview: bypass.slice(0, 120),
      });
      return res.redirect(302, bypass);
    }

    try {
      assertAllowedFetchUrl(url, getContentProxyAllowlist());
    } catch (err) {
      return res.status(err.status || 403).json({
        success: false,
        message: err.message || 'Domain not allowed',
      });
    }

    const { buffer, upstreamType } = await fetchRemoteFileWithRetry(url, 'preview file');
    const looksLikePdf = buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
    const isPdf = looksLikePdf || upstreamType.toLowerCase().includes('application/pdf');
    const safeFilename = typeof filename === 'string' && filename.trim()
      ? filename.trim()
      : decodeURIComponent(parsedUrl.pathname.split('/').pop() || 'preview');

    res.setHeader('Content-Type', isPdf ? 'application/pdf' : upstreamType);
    res.setHeader('X-Source-Content-Type', upstreamType);
    res.setHeader('X-Pdf-Validated', isPdf ? '1' : '0');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename.replace(/"/g, '')}"`);
    setPdfProxyCorsHeaders(req, res);
    allowTrustedPdfFraming(res);
    console.log('[PDF_PROXY] /content-preview response', {
      status: 200,
      isPdf,
      upstreamType,
      bytes: buffer.length,
      filename: safeFilename,
    });
    res.send(buffer);
  } catch (error) {
    const isTimeout = error?.isUpstreamTimeout || String(error?.message || '').toLowerCase().includes('timeout');
    if (isTimeout) {
      console.warn('Student content-preview proxy: upstream timeout', {
        message: error?.message,
      });
    } else {
      console.error('Student content-preview proxy error:', error);
    }
    const statusCode = error?.status && Number.isInteger(error.status)
      ? error.status
      : isTimeout
        ? 504
        : 500;
    res.status(statusCode).json({
      success: false,
      code: isTimeout ? 'UPSTREAM_TIMEOUT' : undefined,
      message: isTimeout
        ? 'The document host took too long to respond. Try opening the original link, or use Download.'
        : statusCode === 500
          ? 'Failed to preview file'
          : `Failed to preview file: ${statusCode}`,
    });
  }
});

/** GET /api/student/calendar/events?month=yyyy-mm */


export default router;
