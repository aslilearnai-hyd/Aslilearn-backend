import express from 'express';
import axios from 'axios';
import { basename } from 'path';
import { verifyToken } from '../middleware/auth.js';
import { assertAllowedFetchUrl, getContentProxyAllowlist } from '../utils/url-allowlist.js';
import { getAllowedOrigins } from '../bootstrap/cors-origins.js';

const router = express.Router();
const TRUSTED_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://aslilearn.ai https://www.aslilearn.ai https://*.vercel.app";

router.options('/api/proxy/content', (req, res) => {
  const origin = req.headers.origin;
  if (origin && getAllowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

router.get('/api/proxy/content', verifyToken, async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    let targetUrl;
    let urlObj;
    try {
      targetUrl = decodeURIComponent(String(url));
      urlObj = assertAllowedFetchUrl(targetUrl, getContentProxyAllowlist());
      targetUrl = urlObj.href;
    } catch (error) {
      const status = error.status || 400;
      return res.status(status).json({ error: error.message || 'Invalid or disallowed URL' });
    }

    console.log('Proxying content from:', targetUrl);

    // Determine if this is a PDF
    const isPDF = targetUrl.toLowerCase().endsWith('.pdf') || targetUrl.includes('.pdf');
    
    // Fetch the content - use arraybuffer for PDFs, text for HTML
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': isPDF ? 'application/pdf,*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': isPDF ? 'identity' : 'gzip, deflate, br',
        'Referer': targetUrl,
        'Cache-Control': 'no-cache'
      },
      maxRedirects: 0, // do not follow redirects blindly (SSRF)
      timeout: 60000,
      responseType: isPDF ? 'arraybuffer' : 'text',
      validateStatus: (status) => status < 400,
    });

    // Check if request was successful
    if (response.status >= 400) {
      console.error(`Failed to fetch content: HTTP ${response.status}`);
      return res.status(response.status).json({ 
        error: 'Failed to fetch content',
        message: `Source server returned ${response.status}`,
        url: targetUrl
      });
    }

    // Get content type
    let contentType = response.headers['content-type'] || 'text/html';
    
    // If URL ends with .pdf, ensure content type is set correctly
    if (targetUrl.toLowerCase().endsWith('.pdf') || contentType.includes('pdf')) {
      contentType = 'application/pdf';
    }
    
    console.log('Content type:', contentType, 'Status:', response.status);

    const reqOrigin = req.headers.origin;
    if (reqOrigin && getAllowedOrigins().includes(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Security-Policy', TRUSTED_FRAME_ANCESTORS);
    
    // Handle PDF files - serve directly as binary
    if (contentType.includes('application/pdf') || contentType.includes('pdf') || isPDF) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${basename(urlObj.pathname || 'document.pdf')}"`);
      // Send PDF binary data (response.data is already arraybuffer for PDFs)
      res.send(Buffer.from(response.data));
      return;
    }
    
    // Modify HTML to fix relative URLs and remove frame-blocking
    if (contentType.includes('text/html')) {
      let html = response.data;
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
      const fullBaseUrl = baseUrl + basePath;
      
      // Add base tag to help with relative URLs
      if (!html.includes('<base')) {
        html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${fullBaseUrl}">`);
      }
      
      // Fix relative URLs to be absolute (more comprehensive)
      html = html.replace(/href=["'](\/[^"']+)["']/g, `href="${baseUrl}$1"`);
      html = html.replace(/src=["'](\/[^"']+)["']/g, `src="${baseUrl}$1"`);
      html = html.replace(/url\(["']?(\/[^"')]+)["']?\)/g, `url("${baseUrl}$1")`);
      html = html.replace(/action=["'](\/[^"']+)["']/g, `action="${baseUrl}$1"`);
      
      // For flipbooks, also fix relative paths that don't start with /
      html = html.replace(/href=["']([^"']+\.(css|js|png|jpg|gif|svg))["']/g, (match, path) => {
        if (!path.startsWith('http') && !path.startsWith('/')) {
          return `href="${fullBaseUrl}${path}"`;
        }
        return match;
      });
      html = html.replace(/src=["']([^"']+\.(css|js|png|jpg|gif|svg))["']/g, (match, path) => {
        if (!path.startsWith('http') && !path.startsWith('/')) {
          return `src="${fullBaseUrl}${path}"`;
        }
        return match;
      });
      
      // Remove X-Frame-Options meta tags and CSP that block framing
      html = html.replace(/<meta[^>]*http-equiv=["']X-Frame-Options["'][^>]*>/gi, '');
      html = html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
      html = html.replace(/X-Frame-Options[^;]*;?/gi, '');
      
      // Remove scripts that check for framing
      html = html.replace(/if\s*\([^)]*top\s*!==\s*self[^)]*\)[^}]*}/gi, '');
      html = html.replace(/if\s*\([^)]*window\.top[^)]*\)[^}]*}/gi, '');
      html = html.replace(/window\.top\s*!==\s*window\.self/gi, 'true');
      html = html.replace(/self\s*!==\s*top/gi, 'false');
      
      // Add script to allow iframe embedding
      const allowFrameScript = `
        <script>
          try {
            if (window.parent !== window) {
              // We're in an iframe, allow it
              window.frameElement = window.frameElement || {};
            }
          } catch(e) {
            // Cross-origin, that's fine
          }
        </script>
      `;
      html = html.replace(/<head([^>]*)>/i, `<head$1>${allowFrameScript}`);
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } else {
      res.setHeader('Content-Type', contentType);
      res.send(response.data);
    }
  } catch (error) {
    console.error('Proxy error:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      url: req.query.url,
      status: error.response?.status,
      statusText: error.response?.statusText,
      headers: error.response?.headers
    });
    
    // If it's a 404 from the target server, return 404
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: 'Content not found',
        message: 'The requested content was not found on the source server'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch content',
      message: error.message,
      details: error.response?.status ? `HTTP ${error.response.status}` : 'Network error'
    });
  }
});

// Extra /api/health duplicate removed (single health registered earlier).

// Handle CORS preflight for all API routes (Express does not treat '/api/*' as a glob)


export default router;
