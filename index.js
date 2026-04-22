import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join, extname, basename } from 'path';
import fs from 'fs';
import axios from 'axios';
import { cleanCsvCell } from './utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from './utils/spreadsheet-to-csv.js';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import models
import User from './models/User.js';
import Video from './models/Video.js';
import LearningPath from './models/LearningPath.js';
import Assessment from './models/Assessment.js';
import Teacher from './models/Teacher.js';
import Subject from './models/Subject.js';
import UserProgress from './models/UserProgress.js';
import Exam from './models/Exam.js';
import Question from './models/Question.js';
import ExamResult from './models/ExamResult.js';
import Event from './models/Event.js';

// Import routes
import superAdminRoutes from './routes/superAdmin.js';
import adminRoutes from './routes/admin.js';
import teacherRoutes from './routes/teacher.js';
import studentRoutes from './routes/student.js';
import aiRoutes from './routes/ai.js';
import streamRoutes from './routes/streams.js';
import curriculumRoutes from './routes/curriculum.js';
import { verifyToken, verifySuperAdmin } from './middleware/auth.js';
import { getCalendarEvents, createCalendarEvent } from './controllers/calendarController.js';
import {
  listAiToolChildren,
  listAiToolRecords,
  getAiToolGenerationById,
  exportAiToolGenerationsBundle,
  getAiToolGenerationsMeta,
} from './controllers/aiToolGenerationsController.js';

// Load environment variables - explicitly specify path
const envPath = join(__dirname, '.env');
const envResult = dotenv.config({ path: envPath });

// Debug: Log if .env file was found
if (envResult.error) {
  console.warn('⚠️  Warning: Could not load .env file:', envResult.error.message);
  console.warn('   Attempted path:', envPath);
} else {
  console.log('✅ Loaded .env file from:', envPath);
  // Debug: Check if MONGO_URI was loaded
  if (envResult.parsed) {
    const hasMongoUri = 'MONGO_URI' in envResult.parsed;
    console.log('📋 Environment variables loaded:', Object.keys(envResult.parsed).length);
    console.log('🔍 MONGO_URI in parsed env:', hasMongoUri);
    if (hasMongoUri) {
      const mongoUriValue = envResult.parsed.MONGO_URI;
      console.log('🔍 MONGO_URI value (first 30 chars):', mongoUriValue ? mongoUriValue.substring(0, 30) + '...' : 'EMPTY');
    }
  }
  // Also check process.env after dotenv loads
  console.log('🔍 MONGO_URI in process.env:', !!process.env.MONGO_URI);
  if (process.env.MONGO_URI) {
    console.log('🔍 process.env.MONGO_URI (first 30 chars):', process.env.MONGO_URI.substring(0, 30) + '...');
  }
}

const app = express();
const PORT = process.env.PORT || 5000;

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// MongoDB connection - MUST be set in .env file
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set in environment variables!');
  console.error('   Please set MONGO_URI in your .env file');
  console.error('   Current process.env keys:', Object.keys(process.env).filter(k => k.includes('MONGO')).join(', ') || 'none');
  process.exit(1);
}

// Log which database is being connected to (without showing password)
const uriForLogging = MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
const dbName = MONGO_URI.split('/').pop()?.split('?')[0] || 'Unknown';
console.log('🔌 Connecting to MongoDB...');
console.log('📍 URI:', uriForLogging);
console.log('📦 Database:', dbName);

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(async () => {
  const dbName = mongoose.connection.db.databaseName;
  console.log('✅ Connected to MongoDB Atlas');
  console.log('📊 Database Name:', dbName);
  console.log('🔗 Connection State:', mongoose.connection.readyState === 1 ? 'Connected' : 'Not Connected');
  // Initialize boards (creates board structure only, no seed data)
  const { initializeBoards } = await import('./controllers/boardController.js');
  await initializeBoards();
})
.catch(err => console.error('❌ MongoDB connection error:', err));

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:5174', 
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
  // New Vercel frontend URL
  'https://asli-frontend.vercel.app',
  // Custom domain
  'https://aslilearn.ai',
  'https://www.aslilearn.ai',
  // Old Vercel URLs (keeping for backward compatibility)
  'https://alsi-stud-frontend-mf3r-ampkob5el-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-es6c3f5aq-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-ea1jir1t6-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-r50hrstmi-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-12gsssa10-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-gajkeubdu-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-hugnvpnzk-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-5i351br51-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-6p7vghuuv-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-9pn4j5v4f-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-18qclrtbv-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-mlmb076jn-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-m8dmkdu86-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r.vercel.app',
  process.env.CLIENT_URL
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow custom domain aslilearn.ai and ALL its subdomains (including www)
    if (origin && origin.match(/^https?:\/\/([a-z0-9-]+\.)?aslilearn\.ai(:[0-9]+)?$/)) {
      return callback(null, true);
    }
    
    // Allow new Vercel frontend domain and its preview deployments
    // Matches: asli-frontend.vercel.app, asli-frontend-*.vercel.app, asli-frontend-*-*.vercel.app
    // This pattern matches all Vercel preview deployment URLs that start with "asli-frontend"
    if (origin && origin.match(/^https:\/\/asli-frontend(-[a-z0-9]+(-[a-z0-9]+)*)?(-[a-z0-9]+-akhilesh2006s-projects)?\.vercel\.app$/)) {
      return callback(null, true);
    }
    
    // More flexible pattern: match any subdomain starting with "asli-frontend" ending with ".vercel.app"
    // This catches all preview deployments including branch previews
    if (origin && origin.match(/^https:\/\/asli-frontend.*\.vercel\.app$/)) {
      return callback(null, true);
    }
    
    // Allow any Vercel subdomain pattern for old project (backward compatibility)
    if (origin && origin.match(/^https:\/\/alsi-stud-frontend-mf3r-[a-z0-9]+-akhilesh2006s-projects\.vercel\.app$/)) {
      return callback(null, true);
    }
    
    // Allow the main old Vercel domain
    if (origin && origin.match(/^https:\/\/alsi-stud-frontend-mf3r\.vercel\.app$/)) {
      return callback(null, true);
    }

    // Allow localhost during local dev (with or without port)
    if (origin && (
      origin.match(/^http:\/\/localhost(:\d+)?$/) ||
      origin.match(/^http:\/\/127\.0\.0\.1(:\d+)?$/) ||
      origin.match(/^http:\/\/localhost:(5173|4173|4174|3000|8080)$/)
    )) {
      return callback(null, true);
    }
    
    // In production, be more permissive to avoid CORS issues
    if (process.env.NODE_ENV === 'production') {
      console.log('[CORS] Allowing origin in production:', origin);
      return callback(null, true);
    }
    
    console.warn('[CORS] Unrecognized origin, defaulting to allow:', origin);
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Cookie',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 204,
  maxAge: 86400
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files directly from disk
app.use('/uploads', express.static(join(__dirname, 'uploads')));

// Request logging middleware (after body parser)
app.use((req, res, next) => {
  if (req.path.includes('/api/auth/login')) {
    console.log('📥 Incoming request:', req.method, req.path);
    console.log('📦 Request body:', req.body);
  }
  next();
});

// Add CORS headers to all responses
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Expose-Headers', 'Set-Cookie');
  next();
});

// Simple health check endpoint for Nginx and frontend connectivity tests
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'AsliLearn backend is healthy',
    time: new Date().toISOString()
  });
});

// Proxy endpoint for external content (flipbooks, PDFs, etc.)
// Handle OPTIONS preflight
app.options('/api/proxy/content', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

app.get('/api/proxy/content', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    // Validate URL
    let targetUrl;
    try {
      targetUrl = decodeURIComponent(url);
      new URL(targetUrl); // Validate URL format
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Only allow specific domains for security
    const allowedDomains = ['epathshala.nic.in', 'ncert.nic.in', 'diksha.gov.in'];
    const urlObj = new URL(targetUrl);
    if (!allowedDomains.some(domain => urlObj.hostname.includes(domain))) {
      return res.status(403).json({ error: 'Domain not allowed' });
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
        'Accept-Encoding': isPDF ? 'identity' : 'gzip, deflate, br', // Don't compress PDFs
        'Referer': targetUrl,
        'Cache-Control': 'no-cache'
      },
      maxRedirects: 10,
      timeout: 60000,
      responseType: isPDF ? 'arraybuffer' : 'text', // Use arraybuffer for PDFs
      validateStatus: (status) => status < 600 // Accept all status codes, we'll handle errors
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

    // Set CORS and frame headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    
    // Handle PDF files - serve directly as binary
    if (contentType.includes('application/pdf') || contentType.includes('pdf') || isPDF) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${basename(urlObj.pathname)}"`);
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

// Health endpoint with CORS headers (handle both GET and OPTIONS)
app.get('/api/health', (req, res) => {
  const origin = req.headers.origin;
  
  // Always set CORS headers for health check
  if (origin) {
    // Allow aslilearn.ai and all subdomains
    if (origin.match(/^https?:\/\/([a-z0-9-]+\.)?aslilearn\.ai(:[0-9]+)?$/)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else if (origin.match(/^https:\/\/asli-frontend.*\.vercel\.app$/) ||
               origin.match(/^https:\/\/alsi-stud-frontend-mf3r.*\.vercel\.app$/) ||
               origin.match(/^http:\/\/localhost(:\d+)?$/) ||
               origin.match(/^http:\/\/127\.0\.0\.1(:\d+)?$/)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else {
      // In production, allow all origins for health check
      res.header('Access-Control-Allow-Origin', origin || '*');
    }
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Expose-Headers', 'Set-Cookie');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  
  res.status(200).json({ 
    status: 'ok', 
    env: process.env.NODE_ENV || 'production',
    timestamp: new Date().toISOString(),
    server: 'aslilearn-backend'
  });
});

// Handle OPTIONS preflight for health endpoint
app.options('/api/health', (req, res) => {
  const origin = req.headers.origin;
  
  // Always allow preflight for health check
  if (origin) {
    // Allow aslilearn.ai and all subdomains
    if (origin.match(/^https?:\/\/([a-z0-9-]+\.)?aslilearn\.ai(:[0-9]+)?$/)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else if (origin.match(/^https:\/\/asli-frontend.*\.vercel\.app$/) ||
               origin.match(/^https:\/\/alsi-stud-frontend-mf3r.*\.vercel\.app$/) ||
               origin.match(/^http:\/\/localhost(:\d+)?$/) ||
               origin.match(/^http:\/\/127\.0\.0\.1(:\d+)?$/)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else {
      // In production, allow all origins for health check
      res.header('Access-Control-Allow-Origin', origin || '*');
    }
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Expose-Headers', 'Set-Cookie');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  res.sendStatus(200);
});

// Handle CORS preflight for all API routes (Express does not treat '/api/*' as a glob)
app.options(/^\/api\/.*/, (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS, PATCH'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Cookie, X-Requested-With, Accept, Origin'
  );
  res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

// Auth routes (define before other routes to avoid conflicts)
// Logout endpoint - NO authentication required (allows logout even with expired/invalid tokens)
app.post('/api/auth/logout', (req, res) => {
  // For JWT-based auth, logout is handled client-side by removing the token
  // This endpoint just confirms the logout request
  // If using sessions, use req.logout()
  try {
    console.log('📤 Logout request received from:', req.headers.origin || 'unknown');
    
    // Handle CORS preflight if needed
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    
    if (req.logout && typeof req.logout === 'function') {
      // Session-based logout (if using sessions)
      req.logout((err) => {
        if (err) {
          console.error('Logout error:', err);
          return res.status(500).json({ success: false, message: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logout successful' });
      });
    } else {
      // JWT-based logout (token removed client-side)
      // Always return success - logout is handled client-side
      console.log('✅ Logout successful (JWT-based)');
      res.json({ success: true, message: 'Logout successful' });
    }
  } catch (error) {
    console.error('Logout error:', error);
    // Still return success for JWT-based auth since token is removed client-side
    res.json({ success: true, message: 'Logout successful' });
  }
});

// JWT auth middleware (defined here so /api/auth/me can be registered before app.use('/api', ...))
const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    req.isAuthenticated = () => true;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authenticated' });
  }
};
const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 'admin') return next();
  res.status(403).json({ message: 'Admin access required' });
};

// GET /api/auth/me — must be registered BEFORE app.use('/api', ...) so it is not shadowed
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    console.log('Auth me requested by:', req.user?.email, 'Role:', req.user?.role);
    if (req.user && req.user.role === 'super-admin') {
      return res.json({
        user: {
          id: req.user.id || 'super-admin-001',
          _id: req.user.id || 'super-admin-001',
          email: req.user.email,
          fullName: req.user.fullName || 'Super Admin',
          role: 'super-admin',
          classNumber: null,
          assignedSubjects: [],
          assignedClass: null
        }
      });
    }
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    await user.populate('assignedSubjects', 'name');
    await user.populate('assignedClass', 'classNumber section assignedSubjects');
    const userData = {
      id: user._id,
      _id: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      classNumber: user.classNumber,
      assignedSubjects: user.assignedSubjects || [],
      assignedClass: user.assignedClass || null
    };
    if (req.user.role === 'admin') userData.schoolName = user.schoolName || '';
    if (req.user.role === 'teacher') {
      const teacher = await Teacher.findById(req.user.userId || req.user.id).populate('subjects');
      if (teacher) userData.subjects = teacher.subjects || [];
    }
    res.json({ user: userData });
  } catch (error) {
    console.error('Failed to fetch user data:', error);
    res.status(500).json({ message: 'Failed to fetch user data' });
  }
});

// Update current user's profile
app.patch('/api/users/:userId', requireAuth, async (req, res) => {
  try {
    // For security, always update the authenticated user, ignore path param
    const userId = req.user.userId || req.user.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const allowedFields = ['fullName', 'email', 'age', 'educationStream', 'targetExam'];
    const updateData = {};
    for (const key of allowedFields) {
      if (key in req.body) {
        updateData[key] = req.body[key];
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Failed to update user profile:', error);
    return res.status(500).json({ success: false, message: 'Failed to update profile', error: error.message });
  }
});

// Calendar API — exams + holidays + custom (super-admin)
app.get('/api/calendar/events', verifyToken, verifySuperAdmin, getCalendarEvents);
app.post('/api/calendar/events', verifyToken, verifySuperAdmin, createCalendarEvent);
// Same handlers under /api/super-admin (avoids 404 if sub-router order/load differs)
app.get('/api/super-admin/calendar/events', verifyToken, verifySuperAdmin, getCalendarEvents);
app.post('/api/super-admin/calendar/events', verifyToken, verifySuperAdmin, createCalendarEvent);

// AI tool generations — register on app before /api/super-admin router (avoids 404 if sub-router order/load differs)
app.get('/api/super-admin/ai-tool-generations/meta', verifyToken, verifySuperAdmin, getAiToolGenerationsMeta);
app.get('/api/super-admin/ai-tool-generations/children', verifyToken, verifySuperAdmin, listAiToolChildren);
app.get('/api/super-admin/ai-tool-generations/records', verifyToken, verifySuperAdmin, listAiToolRecords);
app.get('/api/super-admin/ai-tool-generations/export-bundle', verifyToken, verifySuperAdmin, exportAiToolGenerationsBundle);
app.get('/api/super-admin/ai-tool-generations/document/:id', verifyToken, verifySuperAdmin, getAiToolGenerationById);

// Mount routes
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/curriculum', curriculumRoutes);
app.use('/api', streamRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/ai', aiRoutes);

// Serve static files
// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: true, // Set to true to ensure session is saved
  saveUninitialized: true, // Set to true to save new sessions
  cookie: {
    secure: false, // Set to false for Railway deployment
    httpOnly: false, // Set to false to allow JavaScript access
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax', // Set to 'lax' for better compatibility
    // Remove domain restriction to allow cross-origin sessions
  }
}));

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

// Passport strategies
passport.use(new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password'
}, async (email, password, done) => {
  try {
    // Check for specific admin credentials first
    if (email === 'amenityforge@gmail.com' && password === 'Amenity') {
      // Create or find admin user
      let adminUser = await User.findOne({ email: 'amenityforge@gmail.com' });
      
      if (!adminUser) {
        // Create admin user if doesn't exist
        const hashedPassword = await bcrypt.hash('Amenity', 12);
        adminUser = new User({
          email: 'amenityforge@gmail.com',
          password: hashedPassword,
          fullName: 'Admin User',
          role: 'admin',
          isActive: true
        });
        await adminUser.save();
      } else {
        // Update last login
        adminUser.lastLogin = new Date();
        await adminUser.save();
      }
      
      return done(null, adminUser);
    }

    // Check Teacher model first
    const teacher = await Teacher.findOne({ email });
    console.log('Teacher lookup for', email, ':', teacher ? 'Found' : 'Not found');
    
    if (teacher) {
      console.log('Teacher found:', teacher.email, 'Active:', teacher.isActive);
      const isValidPassword = await bcrypt.compare(password, teacher.password);
      console.log('Password validation for teacher:', isValidPassword);
      
      if (isValidPassword) {
        // Update last login
        teacher.lastLogin = new Date();
        await teacher.save();
        
        // Convert teacher to user format for session
        const teacherUser = {
          _id: teacher._id,
          email: teacher.email,
          fullName: teacher.fullName,
          role: 'teacher',
          isActive: teacher.isActive
        };
        
        console.log('Teacher authentication successful:', teacherUser.email);
        return done(null, teacherUser);
      } else {
        console.log('Teacher password invalid for:', email);
      }
    }

    // Regular user authentication
    const user = await User.findOne({ email });
    
    if (!user) {
      return done(null, false, { message: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return done(null, false, { message: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    return done(null, user);
  } catch (error) {
    return done(error);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    // First try to find in User model
    let user = await User.findById(id);
    if (user) {
      return done(null, user);
    }
    
    // If not found in User model, try Teacher model
    const teacher = await Teacher.findById(id);
    if (teacher) {
      // Convert teacher to user format for session
      const teacherUser = {
        _id: teacher._id,
        email: teacher.email,
        fullName: teacher.fullName,
        role: 'teacher',
        isActive: teacher.isActive
      };
      return done(null, teacherUser);
    }
    
    // If not found in either model
    done(null, false);
  } catch (error) {
    done(error);
  }
});

// Routes (requireAuth/requireAdmin defined earlier, before mount)
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Authentication routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, fullName, role = 'student' } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const newUser = new User({
      email,
      password: hashedPassword,
      fullName,
      role
    });

    await newUser.save();

    res.status(201).json({ 
      message: 'User created successfully',
      user: { 
        id: newUser._id, 
        email: newUser.email, 
        fullName: newUser.fullName, 
        role: newUser.role 
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Handle CORS preflight requests
app.options('/api/auth/login', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('=== LOGIN REQUEST ===');
    console.log('Request body:', req.body);
    console.log('Request headers:', req.headers);
    console.log('Content-Type:', req.headers['content-type']);
    
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      console.error('MongoDB not connected. Connection state:', mongoose.connection.readyState);
      return res.status(503).json({ message: 'Database not connected. Please try again.' });
    }
    
    // Check if body is parsed
    if (!req.body) {
      console.error('req.body is undefined or null');
      return res.status(400).json({ message: 'Invalid request body' });
    }
    
    const { email, password } = req.body;
    
    console.log('Extracted email:', email);
    console.log('Extracted password:', password ? '***' : 'undefined');
    
    if (!email || !password) {
      console.error('Missing email or password');
      return res.status(400).json({ message: 'Email and password are required' });
    }
    
    // Check for Super Admin credentials first
    const superAdminCredentials = [
      { email: 'sealucknow2017@gmail.com', password: 'Asli123', fullName: 'Super Admin' }
    ];
    
    const validCredential = superAdminCredentials.find(
      cred => cred.email.toLowerCase() === email.toLowerCase() && cred.password === password
    );
    
    if (validCredential) {
      console.log('Super Admin login detected');
      const token = jwt.sign(
        { 
          id: 'super-admin-001',
          userId: 'super-admin-001',
          email: validCredential.email,
          fullName: validCredential.fullName,
          role: 'super-admin'
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );
      
      return res.json({
        success: true,
        token,
        user: {
          id: 'super-admin-001',
          _id: 'super-admin-001',
          email: validCredential.email,
          fullName: validCredential.fullName,
          role: 'super-admin'
        }
      });
    }
    
    // Check for specific admin credentials
    if (email === 'amenityforge@gmail.com' && password === 'Amenity') {
      let adminUser = await User.findOne({ email: 'amenityforge@gmail.com' });
      
      if (!adminUser) {
        const hashedPassword = await bcrypt.hash('Amenity', 12);
        adminUser = new User({
          email: 'amenityforge@gmail.com',
          password: hashedPassword,
          fullName: 'Admin User',
          role: 'admin',
          isActive: true
        });
        await adminUser.save();
      }
      
      // Update last login without triggering full document validation
      await User.findByIdAndUpdate(adminUser._id, { lastLogin: new Date() }, { runValidators: false });
      
      const token = jwt.sign(
        { 
          userId: adminUser._id.toString(), 
          id: adminUser._id.toString(),
          email: adminUser.email, 
          role: adminUser.role 
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );
      
      return res.json({
        success: true,
        token,
        user: {
          id: adminUser._id.toString(),
          _id: adminUser._id.toString(),
          email: adminUser.email,
          fullName: adminUser.fullName,
          role: adminUser.role
        }
      });
    }

    // Check Teacher model first
    let teacher = null;
    try {
      teacher = await Teacher.findOne({ email: email.toLowerCase() });
    } catch (teacherError) {
      console.error('Error querying Teacher model:', teacherError);
      // Continue to user check if teacher query fails
    }
    
    if (teacher) {
      console.log('Teacher found:', teacher.email, 'Active:', teacher.isActive);
      const isValidPassword = await bcrypt.compare(password, teacher.password || '');
      
      if (isValidPassword && teacher.isActive) {
        // Update last login
        teacher.lastLogin = new Date();
        await teacher.save();
        
        const token = jwt.sign(
          { 
            userId: teacher._id.toString(),
            id: teacher._id.toString(),
            email: teacher.email, 
            role: 'teacher' 
          },
          process.env.JWT_SECRET || 'your-secret-key',
          { expiresIn: '24h' }
        );
        
        // Fetch teacher subjects if needed
        let subjects = [];
        try {
          const teacherWithSubjects = await Teacher.findById(teacher._id).populate('subjects');
          if (teacherWithSubjects && teacherWithSubjects.subjects) {
            subjects = teacherWithSubjects.subjects;
          }
        } catch (err) {
          console.log('Error fetching teacher subjects:', err);
        }
        
        return res.json({
          success: true,
          token,
          user: {
            id: teacher._id.toString(),
            _id: teacher._id.toString(),
            email: teacher.email,
            fullName: teacher.fullName,
            role: 'teacher',
            subjects: subjects
          }
        });
      }
    }

    // Regular user authentication
    let user = null;
    try {
      user = await User.findOne({ email: email.toLowerCase() });
      console.log('User lookup result:', user ? {
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        hasPassword: !!user.password
      } : 'User not found');
    } catch (userError) {
      console.error('Error querying User model:', userError);
      throw userError; // Re-throw if User query fails
    }
    
    if (!user) {
      console.log(`Login failed: User with email ${email.toLowerCase()} not found`);
      return res.status(401).json({ 
        success: false,
        message: 'User not found'
      });
    }

    console.log('Checking password for user:', user.email);
    const isValidPassword = await bcrypt.compare(password, user.password || '');
    console.log('Password validation result:', isValidPassword);
    
    if (!isValidPassword) {
      console.log(`Login failed: Invalid password for user ${user.email}`);
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials',
        hint: 'Password does not match'
      });
    }
    
    if (!user.isActive) {
      console.log(`Login failed: Account ${user.email} is deactivated`);
      return res.status(401).json({ 
        success: false,
        message: 'Account is deactivated',
        hint: 'Please contact administrator'
      });
    }

    // Update last login without triggering full document validation (avoids board enum validation)
    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() }, { runValidators: false });

    const token = jwt.sign(
      { 
        userId: user._id.toString(),
        id: user._id.toString(),
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true,
      token,
      user: {
        id: user._id.toString(),
        _id: user._id.toString(),
        email: user.email,
        fullName: user.fullName,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Internal server error', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Public routes
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await Video.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(videos);
  } catch (error) {
    console.error('Failed to fetch videos:', error);
    res.status(500).json({ message: 'Failed to fetch videos' });
  }
});

app.get('/api/learning-paths', async (req, res) => {
  try {
    const paths = await LearningPath.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(paths);
  } catch (error) {
    console.error('Failed to fetch learning paths:', error);
    res.status(500).json({ message: 'Failed to fetch learning paths' });
  }
});

app.get('/api/assessments', async (req, res) => {
  try {
    const assessments = await Assessment.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(assessments);
  } catch (error) {
    console.error('Failed to fetch assessments:', error);
    res.status(500).json({ message: 'Failed to fetch assessments' });
  }
});

// Admin routes (protected)
// For development, allow access without authentication, but prefer real auth if available
if (process.env.NODE_ENV === 'development') {
  console.log('Development mode: Admin routes accessible, but will use real auth if available');
  app.use('/api/admin', (req, res, next) => {
    // Check if user is already authenticated via JWT
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        // Use real authenticated user if token is valid
        req.user = decoded;
        req.isAuthenticated = () => true;
        console.log('Development mode: Using authenticated user from JWT:', decoded.email);
        return next();
      } catch (error) {
        // Token invalid, fall through to dev mode
        console.log('Development mode: JWT invalid, using dev user');
      }
    }
    // Only use mock user if no valid token
    req.user = { _id: 'dev-admin', email: 'dev@admin.com', role: 'admin' };
    req.isAuthenticated = () => true;
    next();
  });
} else {
  app.use('/api/admin', requireAuth, requireAdmin);
}

// Admin video management
app.post('/api/admin/videos', async (req, res) => {
  try {
    const { title, description, videoUrl, thumbnailUrl, duration, subjectId, difficulty } = req.body;
    
    const newVideo = new Video({
      title,
      description,
      videoUrl,
      thumbnailUrl,
      duration,
      subjectId,
      difficulty
    });

    await newVideo.save();
    res.status(201).json(newVideo);
  } catch (error) {
    console.error('Failed to create video:', error);
    res.status(500).json({ message: 'Failed to create video' });
  }
});

app.put('/api/admin/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const updatedVideo = await Video.findByIdAndUpdate(
      id, 
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    if (!updatedVideo) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json(updatedVideo);
  } catch (error) {
    console.error('Failed to update video:', error);
    res.status(500).json({ message: 'Failed to update video' });
  }
});

app.delete('/api/admin/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedVideo = await Video.findByIdAndDelete(id);

    if (!deletedVideo) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json({ message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Failed to delete video:', error);
    res.status(500).json({ message: 'Failed to delete video' });
  }
});

// Admin learning path management
app.post('/api/admin/learning-paths', async (req, res) => {
  try {
    const { title, description, subjectIds, difficulty, estimatedHours, videoIds } = req.body;
    
    const newPath = new LearningPath({
      title,
      description,
      subjectIds,
      difficulty,
      estimatedHours,
      videoIds: videoIds || []
    });

    await newPath.save();
    res.status(201).json(newPath);
  } catch (error) {
    console.error('Failed to create learning path:', error);
    res.status(500).json({ message: 'Failed to create learning path' });
  }
});

app.put('/api/admin/learning-paths/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const updatedPath = await LearningPath.findByIdAndUpdate(
      id, 
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    if (!updatedPath) {
      return res.status(404).json({ message: 'Learning path not found' });
    }

    res.json(updatedPath);
  } catch (error) {
    console.error('Failed to update learning path:', error);
    res.status(500).json({ message: 'Failed to update learning path' });
  }
});

app.delete('/api/admin/learning-paths/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedPath = await LearningPath.findByIdAndDelete(id);

    if (!deletedPath) {
      return res.status(404).json({ message: 'Learning path not found' });
    }

    res.json({ message: 'Learning path deleted successfully' });
  } catch (error) {
    console.error('Failed to delete learning path:', error);
    res.status(500).json({ message: 'Failed to delete learning path' });
  }
});

// Event photo upload storage
const eventPhotoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = join(__dirname, 'uploads', 'events');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = extname(file.originalname);
    cb(null, 'event-' + uniqueSuffix + ext);
  }
});

const eventPhotoUpload = multer({ 
  storage: eventPhotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit (increased from 5MB)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Admin event management
// GET all events
app.get('/api/admin/events', async (req, res) => {
  try {
    // Validate user
    if (!req.user || (!req.user._id && !req.user.id)) {
      console.error('GET /api/admin/events - User not found in request:', req.user);
      return res.status(401).json({ message: 'Unauthorized: User not found' });
    }

    // Get user ID from JWT payload (could be userId, _id, or id)
    let userId = req.user.userId || req.user._id || req.user.id;
    
    // If userId is in JWT but we need the actual user document, fetch it
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      // Try to find user by email if userId is not a valid ObjectId
      const user = await User.findOne({ 
        $or: [
          { email: req.user.email },
          { _id: userId }
        ],
        role: 'admin'
      });
      if (user) {
        userId = user._id;
        console.log('Found admin user from email:', user.email, 'ID:', userId);
      }
    }
    
    // Handle development mode where userId might be a string like 'dev-admin'
    // In this case, we need to find a real admin user or skip the query
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      console.log('Development mode detected, finding real admin user...');
      // Find the first admin user in the database
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
        console.log('Using admin user ID:', userId);
      } else {
        // No admin users found, return empty array
        console.log('No admin users found, returning empty events array');
        return res.json([]);
      }
    }
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid user ID format:', userId);
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    console.log('GET /api/admin/events - Fetching events for user:', userId);
    
    // Check if Event model is available
    if (!Event) {
      console.error('Event model is not available');
      return res.status(500).json({ message: 'Event model not available' });
    }
    
    // Use ObjectId for proper matching
    const userObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) 
      : userId;
    
    const events = await Event.find({ createdBy: userObjectId })
      .sort({ date: 1 });
    
    console.log(`GET /api/admin/events - Found ${events.length} events for user ${userId}`);
    res.json(events);
  } catch (error) {
    console.error('GET /api/admin/events - Failed to fetch events:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      message: 'Failed to fetch events',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// POST create event
app.post('/api/admin/events', (req, res, next) => {
  eventPhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          message: 'File too large. Maximum size is 10MB.' 
        });
      }
      if (err.message === 'Only image files are allowed!') {
        return res.status(400).json({ 
          message: 'Only image files are allowed.' 
        });
      }
      return res.status(500).json({ 
        message: 'File upload error',
        error: err.message 
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    console.log('Event creation request received:', {
      body: req.body,
      hasFile: !!req.file,
      user: req.user ? { 
        userId: req.user.userId, 
        _id: req.user._id, 
        id: req.user.id, 
        email: req.user.email,
        role: req.user.role 
      } : 'No user'
    });

    const { name, date, description } = req.body;
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Event name is required' });
    }
    
    if (!date) {
      return res.status(400).json({ message: 'Event date is required' });
    }

    // Validate date format - parse as local date to avoid timezone issues
    // Date string format: YYYY-MM-DD
    let eventDate;
    if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Parse as local date (not UTC) to preserve the exact date
      const [year, month, day] = date.split('-').map(Number);
      eventDate = new Date(year, month - 1, day);
    } else {
      eventDate = new Date(date);
    }
    
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
    
    console.log('Event date parsed:', {
      inputDate: date,
      parsedDate: eventDate,
      year: eventDate.getFullYear(),
      month: eventDate.getMonth() + 1,
      day: eventDate.getDate()
    });

    // Validate user
    if (!req.user) {
      console.error('User not found in request:', req.user);
      return res.status(401).json({ message: 'Unauthorized: User not found' });
    }

    // Get user ID from JWT payload (could be userId, _id, or id)
    let userId = req.user.userId || req.user._id || req.user.id;
    
    console.log('Initial userId from JWT:', userId, 'Type:', typeof userId, 'Email:', req.user.email);
    
    // If userId is not a valid ObjectId, try to find user by email
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      console.log('userId is not a valid ObjectId, looking up user by email:', req.user.email);
      if (!req.user.email) {
        return res.status(400).json({ message: 'User email not found in token' });
      }
      
      try {
        // Try to find user by email - try multiple approaches
        const emailLower = req.user.email.toLowerCase().trim();
        
        // First try: exact lowercase match
        let user = await User.findOne({ 
          email: emailLower,
          role: 'admin'
        });
        
        // Second try: case-insensitive with regex (if first fails)
        if (!user) {
          user = await User.findOne({ 
            email: { $regex: new RegExp(`^${emailLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            role: 'admin'
          });
        }
        
        // Third try: find any user with this email, then check role
        if (!user) {
          const anyUser = await User.findOne({ email: emailLower });
          if (anyUser && anyUser.role === 'admin') {
            user = anyUser;
          }
        }
        
        if (user) {
          userId = user._id;
          console.log('Found admin user from email for event creation:', user.email, 'ID:', userId);
        } else {
          console.error('Could not find admin user with email:', req.user.email);
          // List all admin emails for debugging
          const allAdmins = await User.find({ role: 'admin' }).select('email');
          console.log('Available admin emails:', allAdmins.map(a => a.email));
          return res.status(404).json({ 
            message: `Admin user not found with email: ${req.user.email}`,
            availableAdmins: allAdmins.map(a => a.email)
          });
        }
      } catch (dbError) {
        console.error('Database error while looking up user:', dbError);
        console.error('Error name:', dbError.name);
        console.error('Error message:', dbError.message);
        console.error('Error stack:', dbError.stack);
        return res.status(500).json({ 
          message: 'Database error while looking up user', 
          error: dbError.message,
          errorName: dbError.name
        });
      }
    }
    
    // Handle development mode where userId might be a string like 'dev-admin'
    // In this case, we need to find a real admin user
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      console.log('Development mode detected, finding real admin user...');
      // Find the first admin user in the database
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
        console.log('Using admin user ID for event creation:', userId);
      } else {
        return res.status(400).json({ message: 'No admin user found in database' });
      }
    }
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid user ID format after processing:', userId, 'Type:', typeof userId);
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    console.log('Final userId for event creation:', userId, 'Type:', typeof userId);

    // Ensure uploads/events directory exists
    const eventsUploadDir = join(__dirname, 'uploads', 'events');
    if (!fs.existsSync(eventsUploadDir)) {
      fs.mkdirSync(eventsUploadDir, { recursive: true });
    }
    
    let photoUrl = '';
    if (req.file) {
      photoUrl = `${req.protocol}://${req.get('host')}/uploads/events/${req.file.filename}`;
    }

    // Check if Event model is available
    if (!Event) {
      console.error('Event model is not available');
      return res.status(500).json({ message: 'Event model not available' });
    }

    // Ensure userId is converted to ObjectId
    const createdByObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) 
      : userId;

    console.log('Creating event with createdBy:', createdByObjectId.toString(), 'Type:', typeof createdByObjectId, 'for user:', userId);

    const newEvent = new Event({
      name: name.trim(),
      date: new Date(date),
      description: description || '',
      photo: photoUrl,
      createdBy: createdByObjectId
    });
    
    console.log('Event object before save:', {
      name: newEvent.name,
      date: newEvent.date,
      createdBy: newEvent.createdBy.toString(),
      createdByType: typeof newEvent.createdBy
    });

    const savedEvent = await newEvent.save();
    console.log('Event created successfully:', {
      eventId: savedEvent._id,
      name: savedEvent.name,
      createdBy: savedEvent.createdBy.toString(),
      date: savedEvent.date
    });
    res.status(201).json(savedEvent);
  } catch (error) {
    console.error('Failed to create event - Full error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Failed to create event', 
      error: error.message,
      errorName: error.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// PUT update event
app.put('/api/admin/events/:id', eventPhotoUpload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date, description } = req.body;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Get user ID from JWT
    let userId = req.user.userId || req.user._id || req.user.id;
    
    // If userId is in JWT but we need the actual user document, fetch it
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      const user = await User.findOne({ 
        $or: [
          { email: req.user.email },
          { _id: userId }
        ],
        role: 'admin'
      });
      if (user) {
        userId = user._id;
      }
    }
    
    // Handle development mode
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
      }
    }
    
    // Check if user owns this event
    if (event.createdBy.toString() !== userId.toString()) {
      console.error('User does not own this event:', {
        eventCreatedBy: event.createdBy.toString(),
        userId: userId.toString()
      });
      return res.status(403).json({ message: 'Unauthorized to update this event' });
    }

    let photoUrl = event.photo;
    if (req.file) {
      // Delete old photo if exists
      if (event.photo) {
        const oldPhotoPath = event.photo.replace(`${req.protocol}://${req.get('host')}`, '');
        const fullPath = join(__dirname, oldPhotoPath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
      photoUrl = `${req.protocol}://${req.get('host')}/uploads/events/${req.file.filename}`;
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      id,
      {
        name,
        date: new Date(date),
        description: description || '',
        photo: photoUrl,
        updatedAt: new Date()
      },
      { new: true }
    );

    res.json(updatedEvent);
  } catch (error) {
    console.error('Failed to update event:', error);
    res.status(500).json({ message: 'Failed to update event', error: error.message });
  }
});

// DELETE event
app.delete('/api/admin/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Get user ID from JWT payload (could be userId, _id, or id)
    let userId = req.user.userId || req.user._id || req.user.id;
    
    // If userId is in JWT but we need the actual user document, fetch it
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      // Try to find user by email if userId is not a valid ObjectId
      const user = await User.findOne({ 
        $or: [
          { email: req.user.email },
          { _id: userId }
        ],
        role: 'admin'
      });
      if (user) {
        userId = user._id;
        console.log('Found admin user from email for event deletion:', user.email, 'ID:', userId);
      }
    }
    
    // Handle development mode where userId might be a string like 'dev-admin'
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      console.log('Development mode detected, finding real admin user...');
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
        console.log('Using admin user ID for event deletion:', userId);
      } else {
        return res.status(400).json({ message: 'No admin user found in database' });
      }
    }
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid user ID format:', userId);
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    // Check if user owns this event
    if (event.createdBy.toString() !== userId.toString()) {
      console.error('User does not own this event:', {
        eventCreatedBy: event.createdBy.toString(),
        userId: userId.toString()
      });
      return res.status(403).json({ message: 'Unauthorized to delete this event' });
    }

    // Delete photo if exists
    if (event.photo) {
      const photoPath = event.photo.replace(`${req.protocol}://${req.get('host')}`, '');
      const fullPath = join(__dirname, photoPath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    await Event.findByIdAndDelete(id);
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Failed to delete event:', error);
    res.status(500).json({ message: 'Failed to delete event', error: error.message });
  }
});

// Super Admin: Get events by admin ID (read-only view)
app.get('/api/super-admin/events/:adminId', async (req, res) => {
  try {
    const { adminId } = req.params;
    console.log('Super admin fetching events for adminId:', adminId);
    
    // Validate adminId format
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      console.error('Invalid adminId format:', adminId);
      return res.status(400).json({ message: 'Invalid admin ID format' });
    }
    
    // Convert to ObjectId for proper matching
    const adminObjectId = new mongoose.Types.ObjectId(adminId);
    
    // Verify admin exists
    const admin = await User.findById(adminObjectId);
    if (!admin) {
      console.error('Admin not found with ID:', adminId);
      return res.status(404).json({ message: 'Admin not found' });
    }
    
    if (admin.role !== 'admin') {
      console.error('User is not an admin:', admin.role);
      return res.status(403).json({ message: 'User is not an admin' });
    }

    console.log('Admin found:', admin.email, admin.fullName, 'ID:', admin._id);
    console.log('Searching for events with createdBy:', adminObjectId.toString());
    
    // Fetch all events and filter to ensure proper scoping
    // First, get all events to debug
    const allEvents = await Event.find({}).sort({ date: 1 });
    console.log(`Total events in database: ${allEvents.length}`);
    
    // Log all events' createdBy values for debugging
    if (allEvents.length > 0) {
      console.log('All events createdBy values:', allEvents.map(e => ({
        eventId: e._id,
        eventName: e.name,
        createdBy: e.createdBy ? e.createdBy.toString() : 'null',
        createdByMatches: e.createdBy ? e.createdBy.toString() === adminObjectId.toString() : false
      })));
    }
    
    // Fetch events created by this specific admin using strict ObjectId matching
    // Try multiple query approaches to ensure we get the right events
    const events = await Event.find({ 
      createdBy: adminObjectId 
    }).sort({ date: 1 });
    
    // Also try string comparison as a fallback
    const eventsByString = await Event.find({}).sort({ date: 1 }).then(evts => 
      evts.filter(e => e.createdBy && e.createdBy.toString() === adminObjectId.toString())
    );
    
    // Use the ObjectId query result, but log both for comparison
    console.log(`Found ${events.length} events using ObjectId query for admin ${admin.email} (ID: ${adminId})`);
    console.log(`Found ${eventsByString.length} events using string comparison`);
    
    // Ensure we only return events that match
    const finalEvents = events.filter(e => {
      const matches = e.createdBy && e.createdBy.toString() === adminObjectId.toString();
      if (!matches && e.createdBy) {
        console.warn(`Event ${e._id} (${e.name}) createdBy ${e.createdBy.toString()} does not match admin ${adminObjectId.toString()}`);
      }
      return matches;
    });
    
    console.log(`Returning ${finalEvents.length} events for admin ${admin.email}`);
    
    res.json(finalEvents);
  } catch (error) {
    console.error('Failed to fetch events:', error);
    res.status(500).json({ 
      message: 'Failed to fetch events', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Admin assessment management
app.post('/api/admin/assessments', async (req, res) => {
  try {
    const { title, description, questions, subjectIds, difficulty, duration } = req.body;
    
    // Calculate total points
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    
    const newAssessment = new Assessment({
      title,
      description,
      questions,
      subjectIds,
      difficulty,
      duration,
      totalPoints
    });

    await newAssessment.save();
    res.status(201).json(newAssessment);
  } catch (error) {
    console.error('Failed to create assessment:', error);
    res.status(500).json({ message: 'Failed to create assessment' });
  }
});

app.put('/api/admin/assessments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Recalculate total points if questions are updated
    if (updates.questions) {
      updates.totalPoints = updates.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    }
    
    const updatedAssessment = await Assessment.findByIdAndUpdate(
      id, 
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    if (!updatedAssessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    res.json(updatedAssessment);
  } catch (error) {
    console.error('Failed to update assessment:', error);
    res.status(500).json({ message: 'Failed to update assessment' });
  }
});

app.delete('/api/admin/assessments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedAssessment = await Assessment.findByIdAndDelete(id);

    if (!deletedAssessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    res.json({ message: 'Assessment deleted successfully' });
  } catch (error) {
    console.error('Failed to delete assessment:', error);
    res.status(500).json({ message: 'Failed to delete assessment' });
  }
});

// Admin user management
app.get('/api/admin/users', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const adminId = decoded.userId;

    // Only return students assigned to this admin
    const users = await User.find({ 
      role: 'student',
      assignedAdmin: adminId 
    }).select('-password').sort({ createdAt: -1 });
    
    res.json(users);
  } catch (error) {
    console.error('Failed to fetch users:', error);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

app.post('/api/admin/users', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const adminId = decoded.userId;

    const { email, password, fullName, classNumber, phone, role = 'student', isActive = true } = req.body;
    
    // Validate required fields for students
    if (role === 'student' && (!fullName || !email || !classNumber)) {
      return res.status(400).json({ 
        success: false,
        message: 'Full name, email, and class number are required for students' 
      });
    }
    
    // Get admin to inherit board and school
    const admin = await User.findById(adminId).select('board schoolName');
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    if (role === 'student' && !admin.board) {
      return res.status(400).json({ success: false, message: 'Admin must have a board assigned' });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password || 'Password123', 12);

    // Create user and assign to this admin
    const newUser = new User({
      email,
      password: hashedPassword,
      fullName,
      classNumber: role === 'student' ? classNumber.trim() : undefined,
      phone: phone || '',
      role,
      board: role === 'student' ? (admin.board || null) : undefined,
      schoolName: role === 'student' ? (admin.schoolName || '') : undefined,
      isActive,
      assignedAdmin: adminId  // Assign to the logged-in admin
    });

    await newUser.save();

    res.status(201).json({
      success: true,
      id: newUser._id,
      email: newUser.email,
      fullName: newUser.fullName,
      classNumber: newUser.classNumber,
      phone: newUser.phone,
      board: newUser.board,
      schoolName: newUser.schoolName,
      role: newUser.role,
      isActive: newUser.isActive,
      assignedAdmin: newUser.assignedAdmin
    });
  } catch (error) {
    console.error('Failed to create user:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create user';
    
    if (error.name === 'ValidationError') {
      errorMessage = `Validation error: ${Object.values(error.errors).map((e) => e.message).join(', ')}`;
    } else if (error.code === 11000) {
      // Duplicate key error (MongoDB)
      errorMessage = 'A user with this email already exists';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({ 
      success: false, 
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Hash password if provided
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 12);
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      id, 
      { ...updates, updatedAt: new Date() },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updatedUser);
  } catch (error) {
    console.error('Failed to update user:', error);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

// Delete all students endpoint - MUST be before /:id route
app.delete('/api/admin/users/delete-all', async (req, res) => {
  try {
    // Delete all users with role 'student'
    const result = await User.deleteMany({ role: 'student' });
    
    res.json({ 
      message: `Successfully deleted ${result.deletedCount} students`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Failed to delete all students:', error);
    res.status(500).json({ message: 'Failed to delete all students' });
  }
});

// Teacher management endpoints
app.get('/api/admin/teachers', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const adminId = decoded.userId;

    // Only return teachers assigned to this admin
    const teachers = await Teacher.find({ adminId })
      .populate('subjects')
      .select('-password')
      .sort({ createdAt: -1 });
    
    if (!teachers || teachers.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No teachers found in database',
        data: []
      });
    }
    
    // Transform the data to include assignedClassIds
    const transformedTeachers = teachers.map(teacher => ({
      _id: teacher._id,
      id: teacher._id,
      fullName: teacher.fullName,
      email: teacher.email,
      phone: teacher.phone,
      department: teacher.department,
      qualifications: teacher.qualifications,
      subjects: teacher.subjects || [],
      assignedClassIds: teacher.assignedClassIds || [],
      role: teacher.role,
      isActive: teacher.isActive,
      createdAt: teacher.createdAt,
      updatedAt: teacher.updatedAt
    }));
    
    res.json(transformedTeachers);
  } catch (error) {
    console.error('Failed to fetch teachers:', error);
    res.status(500).json({ message: 'Failed to fetch teachers' });
  }
});

app.post('/api/admin/teachers', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const adminId = decoded.userId;

    const { email, password, fullName, phone, department, qualifications, subjects } = req.body;
    
    // Check if teacher already exists
    const existingTeacher = await Teacher.findOne({ email });
    if (existingTeacher) {
      return res.status(400).json({ message: 'Teacher already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password || 'Password123', 12);

    // Create new teacher and assign to this admin
    const newTeacher = new Teacher({
      email,
      password: hashedPassword,
      fullName,
      phone,
      department,
      qualifications,
      subjects: subjects || [],
      role: 'teacher',
      isActive: true,
      adminId: adminId  // Assign to the logged-in admin
    });

    await newTeacher.save();
    res.status(201).json({ message: 'Teacher created successfully' });
  } catch (error) {
    console.error('Failed to create teacher:', error);
    res.status(500).json({ message: 'Failed to create teacher' });
  }
});

app.put('/api/admin/teachers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Remove password from update data if present
    delete updateData.password;
    
    const updatedTeacher = await Teacher.findByIdAndUpdate(id, updateData, { new: true }).populate('subjects');
    
    if (!updatedTeacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    res.json(updatedTeacher);
  } catch (error) {
    console.error('Failed to update teacher:', error);
    res.status(500).json({ message: 'Failed to update teacher' });
  }
});

app.delete('/api/admin/teachers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedTeacher = await Teacher.findByIdAndDelete(id);
    if (!deletedTeacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    res.json({ message: 'Teacher deleted successfully' });
  } catch (error) {
    console.error('Failed to delete teacher:', error);
    res.status(500).json({ message: 'Failed to delete teacher' });
  }
});

// Subject management endpoints - filter by admin's board
app.get('/api/admin/subjects', async (req, res) => {
  try {
    // Get admin's board from token (if admin) or return all (if super-admin)
    let adminBoard = null;
    if (req.user && req.user.role === 'admin') {
      const adminId = req.user.userId || req.user._id || req.user.id;
      const admin =
        adminId && mongoose.Types.ObjectId.isValid(String(adminId))
          ? await User.findById(adminId)
          : null;
      if (admin && admin.board) {
        adminBoard = admin.board;
      }
    }
    
    // Build query - filter by board if admin, show all if super-admin
    const query = adminBoard ? { board: adminBoard, isActive: true } : { isActive: true };
    
    const subjects = await Subject.find(query)
      .populate('createdBy', 'fullName email')
      .sort({ name: 1 });
    
    if (!subjects || subjects.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No subjects found in database',
        data: []
      });
    }
    
    console.log(`📚 Admin subjects endpoint: Found ${subjects.length} subjects for board: ${adminBoard || 'ALL'}`);
    
    // Get all teachers and find which ones are assigned to each subject
    const teachers = await Teacher.find({ isActive: true })
      .select('_id fullName email subjects')
      .lean();
    
    // Create a map of subject ID to assigned teachers
    const subjectTeachersMap = new Map();
    teachers.forEach(teacher => {
      if (teacher.subjects && Array.isArray(teacher.subjects)) {
        teacher.subjects.forEach(subjectId => {
          const subjectIdStr = subjectId.toString();
          if (!subjectTeachersMap.has(subjectIdStr)) {
            subjectTeachersMap.set(subjectIdStr, []);
          }
          subjectTeachersMap.get(subjectIdStr).push({
            id: teacher._id.toString(),
            fullName: teacher.fullName,
            email: teacher.email
          });
        });
      }
    });
    
    // Format subjects with teacher information
    const formattedSubjects = subjects.map(subject => {
      const subjectObj = subject.toObject();
      const subjectIdStr = subject._id.toString();
      const assignedTeachers = subjectTeachersMap.get(subjectIdStr) || [];
      
      // If there are multiple teachers, show the first one (or you can show all)
      return {
        ...subjectObj,
        id: subjectObj._id.toString(),
        teacher: assignedTeachers.length > 0 ? assignedTeachers[0] : null,
        teachers: assignedTeachers // Include all teachers if needed
      };
    });
    
    console.log(`✅ Returning ${formattedSubjects.length} subjects with teacher assignments`);
    
    res.json(formattedSubjects);
  } catch (error) {
    console.error('Failed to fetch subjects:', error);
    res.status(500).json({ message: 'Failed to fetch subjects' });
  }
});

app.post('/api/admin/subjects', async (req, res) => {
  try {
    const { name, description, code, teacher, grade, department } = req.body;
    
    // Check if subject code already exists
    const existingSubject = await Subject.findOne({ code });
    if (existingSubject) {
      return res.status(400).json({ message: 'Subject code already exists' });
    }

    // Create new subject
    const newSubject = new Subject({
      name,
      description,
      code,
      teacher: teacher || null,
      grade,
      department,
      isActive: true
    });

    await newSubject.save();
    
    // If teacher is assigned, add subject to teacher's subjects array
    if (teacher) {
      await Teacher.findByIdAndUpdate(teacher, { $addToSet: { subjects: newSubject._id } });
    }
    
    res.status(201).json({ message: 'Subject created successfully' });
  } catch (error) {
    console.error('Failed to create subject:', error);
    res.status(500).json({ message: 'Failed to create subject' });
  }
});

app.put('/api/admin/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { teacher } = req.body;
    
    const subject = await Subject.findById(id);
    if (!subject) {
      return res.status(404).json({ 
        success: false,
        message: 'Subject not found in database' 
      });
    }

    // If teacher is being changed, update both old and new teacher
    if (subject.teacher && subject.teacher.toString() !== teacher) {
      // Remove from old teacher
      await Teacher.findByIdAndUpdate(subject.teacher, { $pull: { subjects: id } });
    }
    
    if (teacher && subject.teacher?.toString() !== teacher) {
      // Add to new teacher
      await Teacher.findByIdAndUpdate(teacher, { $addToSet: { subjects: id } });
    }
    
    const updatedSubject = await Subject.findByIdAndUpdate(id, req.body, { new: true }).populate('teacher', 'fullName email');
    res.json(updatedSubject);
  } catch (error) {
    console.error('Failed to update subject:', error);
    res.status(500).json({ message: 'Failed to update subject' });
  }
});

app.delete('/api/admin/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const subject = await Subject.findById(id);
    if (!subject) {
      return res.status(404).json({ 
        success: false,
        message: 'Subject not found in database' 
      });
    }

    const { removeSubjectIdFromAllAssignments } = await import(
      './utils/removeSubjectAssignments.js'
    );
    await removeSubjectIdFromAllAssignments(id);

    await Subject.findByIdAndDelete(id);
    res.json({ message: 'Subject deleted successfully' });
  } catch (error) {
    console.error('Failed to delete subject:', error);
    res.status(500).json({ message: 'Failed to delete subject' });
  }
});

// Assign subjects to teacher endpoint
app.post('/api/admin/teachers/:id/assign-subjects', async (req, res) => {
  try {
    const { id } = req.params;
    const { subjectIds } = req.body;
    
    console.log('Assigning subjects to teacher:', { teacherId: id, subjectIds });
    
    const teacher = await Teacher.findById(id);
    if (!teacher) {
      console.log('Teacher not found:', id);
      return res.status(404).json({ 
        success: false,
        message: 'Teacher not found in database' 
      });
    }

    console.log('Teacher found:', teacher.email, 'Current subjects:', teacher.subjects);

    // Update teacher's subjects
    teacher.subjects = subjectIds || [];
    await teacher.save();

    console.log('Teacher subjects updated:', teacher.subjects);

    // Update subjects to point to this teacher
    if (subjectIds && subjectIds.length > 0) {
      await Subject.updateMany(
        { _id: { $in: subjectIds } },
        { teacher: id }
      );
      console.log('Subjects updated to point to teacher:', id);
    }

    res.json({ message: 'Subjects assigned successfully' });
  } catch (error) {
    console.error('Failed to assign subjects:', error);
    res.status(500).json({ message: 'Failed to assign subjects' });
  }
});

// Exam management endpoints
app.get('/api/admin/exams', async (req, res) => {
  try {
    const exams = await Exam.find()
      .populate('createdBy', 'fullName email')
      .populate('questions')
      .sort({ createdAt: -1 });
    
    if (!exams || exams.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No exams found in database',
        data: []
      });
    }
    
    res.json(exams);
  } catch (error) {
    console.error('Failed to fetch exams:', error);
    res.status(500).json({ message: 'Failed to fetch exams' });
  }
});

app.post('/api/admin/exams', async (req, res) => {
  try {
    const {
      title,
      description,
      examType,
      duration,
      totalQuestions,
      totalMarks,
      instructions,
      startDate,
      endDate
    } = req.body;

    const exam = new Exam({
      title,
      description,
      examType: examType || 'weekend',
      duration,
      totalQuestions,
      totalMarks,
      instructions,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      createdBy: req.user.id
    });

    await exam.save();
    res.status(201).json(exam);
  } catch (error) {
    console.error('Failed to create exam:', error);
    res.status(500).json({ message: 'Failed to create exam' });
  }
});

app.put('/api/admin/exams/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Convert date strings to Date objects if present
    if (updateData.startDate) {
      updateData.startDate = new Date(updateData.startDate);
    }
    if (updateData.endDate) {
      updateData.endDate = new Date(updateData.endDate);
    }

    const exam = await Exam.findByIdAndUpdate(id, updateData, { new: true });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    res.json(exam);
  } catch (error) {
    console.error('Failed to update exam:', error);
    res.status(500).json({ message: 'Failed to update exam' });
  }
});

app.delete('/api/admin/exams/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete all questions associated with this exam
    await Question.deleteMany({ exam: id });
    
    const deletedExam = await Exam.findByIdAndDelete(id);
    if (!deletedExam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    console.error('Failed to delete exam:', error);
    res.status(500).json({ message: 'Failed to delete exam' });
  }
});

// Student exam endpoints
// This route is now handled by student.js with proper multi-tenant filtering
// app.get('/api/student/exams', requireAuth, async (req, res) => {
//   try {
//     console.log('Fetching student exams for user:', req.user.id);
//     
//     const exams = await Exam.find({ isActive: true })
//       .populate('questions')
//       .sort({ createdAt: -1 });
//     
//     console.log('Found exams:', exams.length);
//     console.log('Exam details:', exams.map(exam => ({
//       id: exam._id,
//       title: exam.title,
//       examType: exam.examType,
//       isActive: exam.isActive,
//       questionsCount: exam.questions.length
//     })));
//     
//     res.json(exams);
//   } catch (error) {
//     console.error('Failed to fetch student exams:', error);
//     res.status(500).json({ message: 'Failed to fetch exams', error: error.message });
//   }
// });

// This route is now handled by student.js with proper multi-tenant filtering
// app.get('/api/student/exams/:examId', requireAuth, async (req, res) => {
//   try {
//     const { examId } = req.params;
//     
//     if (!mongoose.Types.ObjectId.isValid(examId)) {
//       return res.status(400).json({ message: 'Invalid exam ID format' });
//     }
//     
//     const exam = await Exam.findById(examId)
//       .populate('questions');
//     
//     if (!exam) {
//       return res.status(404).json({ message: 'Exam not found' });
//     }
//     
//     res.json(exam);
//   } catch (error) {
//     console.error('Failed to fetch exam:', error);
//     res.status(500).json({ message: 'Failed to fetch exam' });
//   }
// });

// Save exam results
// Update exam result to include board
// POST exam results - This route is now handled by student.js routes
// REMOVED: Duplicate route that was causing user data isolation issues
// The correct route should be in backend/routes/student.js which properly uses req.userId

// Get student exam results - This route is now handled by student.js routes
// REMOVED: Duplicate route that was causing user data isolation issues
// The correct route is in backend/routes/student.js which properly filters by req.userId

// Test endpoint for debugging
app.get('/api/admin/test', (req, res) => {
  res.json({ message: 'Server is running', timestamp: new Date().toISOString() });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Quick test endpoint to verify teacher account
app.get('/api/debug/test-teacher', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ email: 'teacher@test.com' });
    if (!teacher) {
      return res.json({ 
        exists: false, 
        message: 'Teacher account does not exist' 
      });
    }
    
    // Test password
    const bcrypt = require('bcryptjs');
    const isPasswordValid = await bcrypt.compare('Password123', teacher.password);
    
    res.json({
      exists: true,
      email: teacher.email,
      fullName: teacher.fullName,
      isActive: teacher.isActive,
      passwordValid: isPasswordValid,
      message: isPasswordValid ? 'Teacher account is ready' : 'Password mismatch'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to check exams in database
app.get('/api/debug/exams', async (req, res) => {
  try {
    const allExams = await Exam.find({}).populate('questions');
    const activeExams = await Exam.find({ isActive: true }).populate('questions');
    
    res.json({
      totalExams: allExams.length,
      activeExams: activeExams.length,
      allExams: allExams.map(exam => ({
        id: exam._id,
        title: exam.title,
        examType: exam.examType,
        isActive: exam.isActive,
        questionsCount: exam.questions.length,
        createdAt: exam.createdAt
      })),
      activeExams: activeExams.map(exam => ({
        id: exam._id,
        title: exam.title,
        examType: exam.examType,
        isActive: exam.isActive,
        questionsCount: exam.questions.length
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to show exam questions and correct answers
app.get('/api/debug/exam-answers/:examId', async (req, res) => {
  try {
    const { examId } = req.params;
    const exam = await Exam.findById(examId).populate('questions');
    
    if (!exam) {
      return res.status(404).json({ 
        success: false,
        message: 'Exam not found in database' 
      });
    }
    
    const questionsWithAnswers = exam.questions.map((question, index) => ({
      questionNumber: index + 1,
      questionId: question._id,
      questionText: question.questionText,
      questionImage: question.questionImage,
      questionType: question.questionType,
      options: question.options,
      correctAnswer: question.correctAnswer,
      marks: question.marks,
      negativeMarks: question.negativeMarks,
      subject: question.subject
    }));
    
    res.json({
      examId: exam._id,
      examTitle: exam.title,
      examType: exam.examType,
      totalQuestions: exam.questions.length,
      questions: questionsWithAnswers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create test student account for easy testing
app.post('/api/debug/create-test-student', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    
    // Check if test student already exists
    const existingStudent = await User.findOne({ email: 'student@test.com' });
    if (existingStudent) {
      return res.json({ 
        message: 'Test student already exists',
        student: {
          email: existingStudent.email,
          fullName: existingStudent.fullName,
          role: existingStudent.role
        }
      });
    }
    
    // Create test student
    const hashedPassword = await bcrypt.hash('password123', 10);
    const testStudent = new User({
      fullName: 'Test Student',
      email: 'student@test.com',
      password: hashedPassword,
      role: 'student',
      isActive: true,
      classNumber: 'Test-Class-1',
      phone: '+1234567890'
    });
    
    await testStudent.save();
    
    res.json({
      message: 'Test student created successfully',
      student: {
        email: testStudent.email,
        fullName: testStudent.fullName,
        role: testStudent.role,
        password: 'password123'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fix/Create user for login (for Railway debugging)
app.post('/api/debug/fix-user', async (req, res) => {
  try {
    const { email = 'ak@gmail.com', password = 'Password123', fullName = 'Akhilesh', role = 'admin' } = req.body;
    
    // Check if user exists
    let user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.log('Creating new user:', email);
      const hashedPassword = await bcrypt.hash(password, 12);
      user = new User({
        email: email.toLowerCase(),
        password: hashedPassword,
        fullName: fullName,
        role: role,
        isActive: true,
        board: 'ASLI_EXCLUSIVE_SCHOOLS',
        schoolName: 'Default School'
      });
      await user.save();
      
      return res.json({
        success: true,
        message: 'User created successfully',
        user: {
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          password: password
        }
      });
    } else {
      console.log('Updating existing user:', email);
      const hashedPassword = await bcrypt.hash(password, 12);
      user.password = hashedPassword;
      user.isActive = true;
      await user.save();
      
      return res.json({
        success: true,
        message: 'User password updated successfully',
        user: {
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          password: password
        }
      });
    }
  } catch (error) {
    console.error('Fix user error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Create test user with specific email
app.post('/api/debug/create-user', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { email, fullName, role } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.json({ 
        message: 'User already exists',
        user: {
          email: existingUser.email,
          fullName: existingUser.fullName,
          role: existingUser.role
        }
      });
    }
    
    // Create user
    const hashedPassword = await bcrypt.hash('Password123', 10);
    const newUser = new User({
      fullName: fullName || 'Test User',
      email: email,
      password: hashedPassword,
      role: role || 'student',
      isActive: true,
      classNumber: 'Test-Class-1',
      phone: '+1234567890'
    });
    
    await newUser.save();
    
    res.json({
      message: 'User created successfully',
      user: {
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        password: 'Password123'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List all existing users (for debugging)
app.get('/api/debug/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    
    res.json({
      message: 'Existing users found',
      count: users.length,
      users: users.map(user => ({
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }))
    });
  } catch (error) {
    console.error('Failed to fetch users:', error);
    res.status(500).json({ error: error.message });
  }
});

// List all existing teachers (for debugging)
app.get('/api/debug/teachers', async (req, res) => {
  try {
    const teachers = await Teacher.find().populate('subjects').select('-password').sort({ createdAt: -1 });
    
    res.json({
      message: 'Existing teachers found',
      count: teachers.length,
      teachers: teachers.map(teacher => ({
        id: teacher._id,
        email: teacher.email,
        fullName: teacher.fullName,
        department: teacher.department,
        qualifications: teacher.qualifications,
        subjects: teacher.subjects?.map(s => ({ id: s._id, name: s.name })) || [],
        subjectsCount: teacher.subjects?.length || 0,
        isActive: teacher.isActive,
        createdAt: teacher.createdAt,
        lastLogin: teacher.lastLogin
      }))
    });
  } catch (error) {
    console.error('Failed to fetch teachers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create test teacher account for easy testing
app.post('/api/debug/create-test-teacher', async (req, res) => {
  try {
    const bcrypt = await import('bcryptjs');
    
    // Check if test teacher already exists
    const existingTeacher = await Teacher.findOne({ email: 'teacher@test.com' });
    if (existingTeacher) {
      // Update password to ensure it's correct
      const hashedPassword = await bcrypt.default.hash('Password123', 10);
      existingTeacher.password = hashedPassword;
      await existingTeacher.save();
      
      return res.json({ 
        message: 'Test teacher already exists, password updated',
        teacher: {
          email: existingTeacher.email,
          fullName: existingTeacher.fullName,
          role: existingTeacher.role,
          password: 'Password123'
        }
      });
    }
    
    // Create test teacher
    const hashedPassword = await bcrypt.default.hash('Password123', 10);
    const testTeacher = new Teacher({
      email: 'teacher@test.com',
      password: hashedPassword,
      fullName: 'Test Teacher',
      phone: '+1234567890',
      department: 'Science',
      qualifications: 'M.Sc Physics, B.Ed',
      role: 'teacher',
      isActive: true
    });
    
    await testTeacher.save();
    
    res.json({ 
      message: 'Test teacher created successfully',
      teacher: {
        email: testTeacher.email,
        fullName: testTeacher.fullName,
        role: testTeacher.role,
        password: 'Password123'
      }
    });
  } catch (error) {
    console.error('Failed to create test teacher:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a guaranteed working test teacher
app.post('/api/debug/create-working-teacher', async (req, res) => {
  try {
    const bcrypt = await import('bcryptjs');
    
    // Delete any existing test teacher first
    await Teacher.deleteOne({ email: 'testteacher@cognilearn.com' });
    
    // Create guaranteed working teacher
    const hashedPassword = await bcrypt.default.hash('Teacher123', 10);
    const workingTeacher = new Teacher({
      email: 'testteacher@cognilearn.com',
      password: hashedPassword,
      fullName: 'Test Teacher CogniLearn',
      phone: '+1234567890',
      department: 'Mathematics',
      qualifications: 'M.Sc Mathematics, B.Ed',
      role: 'teacher',
      isActive: true
    });
    
    await workingTeacher.save();
    
    res.json({ 
      message: 'Working test teacher created successfully',
      credentials: {
        email: 'testteacher@cognilearn.com',
        password: 'Teacher123',
        fullName: 'Test Teacher CogniLearn',
        role: 'teacher'
      },
      loginUrl: 'http://localhost:5174/signin'
    });
  } catch (error) {
    console.error('Failed to create working teacher:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fix teacher login - check and reset password
app.post('/api/debug/fix-teacher-login', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        message: 'Email is required' 
      });
    }

    const password = newPassword || 'Password123';
    
    // Find teacher
    const teacher = await Teacher.findOne({ email: email.toLowerCase() });
    
    if (!teacher) {
      return res.status(404).json({ 
        success: false,
        message: `Teacher with email "${email}" not found in database`,
        suggestion: 'Use /api/debug/create-test-teacher to create a test teacher account'
      });
    }

    console.log(`🔧 Fixing teacher login for: ${teacher.email}`);
    console.log(`   Current status: Active=${teacher.isActive}, HasPassword=${!!teacher.password}`);

    // Activate account if inactive
    if (!teacher.isActive) {
      teacher.isActive = true;
      console.log('   ✅ Activating account');
    }

    // Reset password
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.default.hash(password, 12);
    teacher.password = hashedPassword;
    await teacher.save();

    // Verify password
    const verifyPassword = await bcrypt.default.compare(password, teacher.password);
    
    res.json({ 
      success: true,
      message: 'Teacher account fixed successfully',
      teacher: {
        email: teacher.email,
        fullName: teacher.fullName,
        isActive: teacher.isActive,
        passwordReset: true,
        passwordVerified: verifyPassword
      },
      credentials: {
        email: teacher.email,
        password: password,
        note: 'Use these credentials to login'
      }
    });
  } catch (error) {
    console.error('Failed to fix teacher login:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Create multiple teacher accounts for testing
app.post('/api/debug/create-multiple-teachers', async (req, res) => {
  try {
    const bcrypt = await import('bcryptjs');
    
    const teachers = [
      {
        email: 'math.teacher@cognilearn.com',
        password: 'MathTeacher123',
        fullName: 'Dr. Sarah Johnson',
        phone: '+1234567891',
        department: 'Mathematics',
        qualifications: 'Ph.D Mathematics, M.Ed',
        role: 'teacher',
        isActive: true
      },
      {
        email: 'physics.teacher@cognilearn.com',
        password: 'PhysicsTeacher123',
        fullName: 'Prof. Michael Chen',
        phone: '+1234567892',
        department: 'Physics',
        qualifications: 'Ph.D Physics, B.Ed',
        role: 'teacher',
        isActive: true
      },
      {
        email: 'chemistry.teacher@cognilearn.com',
        password: 'ChemTeacher123',
        fullName: 'Dr. Emily Rodriguez',
        phone: '+1234567893',
        department: 'Chemistry',
        qualifications: 'Ph.D Chemistry, M.Ed',
        role: 'teacher',
        isActive: true
      },
      {
        email: 'english.teacher@cognilearn.com',
        password: 'EnglishTeacher123',
        fullName: 'Ms. Jennifer Smith',
        phone: '+1234567894',
        department: 'English',
        qualifications: 'M.A English Literature, B.Ed',
        role: 'teacher',
        isActive: true
      }
    ];
    
    const createdTeachers = [];
    
    for (const teacherData of teachers) {
      // Delete existing teacher if exists
      await Teacher.deleteOne({ email: teacherData.email });
      
      // Hash password
      const hashedPassword = await bcrypt.default.hash(teacherData.password, 10);
      
      // Create teacher
      const teacher = new Teacher({
        ...teacherData,
        password: hashedPassword
      });
      
      await teacher.save();
      createdTeachers.push({
        email: teacherData.email,
        password: teacherData.password,
        fullName: teacherData.fullName,
        department: teacherData.department,
        role: teacherData.role
      });
    }
    
    res.json({ 
      message: 'Multiple teachers created successfully',
      teachers: createdTeachers,
      loginUrl: 'http://localhost:5174/signin',
      totalCreated: createdTeachers.length
    });
  } catch (error) {
    console.error('Failed to create multiple teachers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Teacher routes are already mounted above at line 195

// Get teacher profile with subjects
app.get('/api/teacher/profile', async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.user._id).populate('subjects');
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }
    
    console.log('Teacher profile requested:', {
      id: teacher._id,
      email: teacher.email,
      subjectsCount: teacher.subjects?.length || 0,
      subjects: teacher.subjects?.map(s => s.name) || []
    });
    
    res.json({
      id: teacher._id,
      fullName: teacher.fullName,
      email: teacher.email,
      phone: teacher.phone,
      department: teacher.department,
      qualifications: teacher.qualifications,
      subjects: teacher.subjects || []
    });
  } catch (error) {
    console.error('Failed to fetch teacher profile:', error);
    res.status(500).json({ message: 'Failed to fetch teacher profile' });
  }
});

// Assign subjects to current teacher (for testing)
app.post('/api/teacher/assign-subjects', async (req, res) => {
  try {
    const { subjectIds } = req.body;
    const teacherId = req.user._id;
    
    console.log('Assigning subjects to teacher:', { teacherId, subjectIds });
    
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    // Update teacher's subjects
    teacher.subjects = subjectIds;
    await teacher.save();
    
    // Populate subjects for response
    await teacher.populate('subjects');
    
    res.json({
      message: 'Subjects assigned successfully',
      teacher: {
        id: teacher._id,
        email: teacher.email,
        subjects: teacher.subjects
      }
    });
  } catch (error) {
    console.error('Failed to assign subjects:', error);
    res.status(500).json({ message: 'Failed to assign subjects' });
  }
});

// Teacher content creation endpoints
app.post('/api/teacher/quizzes', async (req, res) => {
  try {
    const { title, description, subject, duration, difficulty, questions } = req.body;
    const teacherId = req.user._id;
    
    // Calculate total points
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    
    const newQuiz = new Assessment({
      title,
      description,
      questions,
      subjectIds: [subject],
      difficulty,
      duration,
      totalPoints,
      createdBy: teacherId,
      isPublished: true
    });

    await newQuiz.save();
    res.status(201).json(newQuiz);
  } catch (error) {
    console.error('Failed to create quiz:', error);
    res.status(500).json({ message: 'Failed to create quiz' });
  }
});

app.post('/api/teacher/videos', async (req, res) => {
  try {
    const { title, description, videoUrl, subject, duration, difficulty } = req.body;
    const teacherId = req.user._id;
    
    // Extract YouTube video ID from URL
    let youtubeId = '';
    if (videoUrl && videoUrl.includes('youtube.com/watch?v=')) {
      youtubeId = videoUrl.split('v=')[1].split('&')[0];
    } else if (videoUrl && videoUrl.includes('youtu.be/')) {
      youtubeId = videoUrl.split('youtu.be/')[1].split('?')[0];
    }
    
    const thumbnailUrl = youtubeId ? `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg` : '';
    
    const newVideo = new Video({
      title,
      description,
      videoUrl,
      thumbnailUrl,
      duration: parseInt(duration),
      subjectId: subject,
      difficulty,
      createdBy: teacherId,
      isPublished: true
    });

    await newVideo.save();
    res.status(201).json(newVideo);
  } catch (error) {
    console.error('Failed to create video:', error);
    res.status(500).json({ message: 'Failed to create video' });
  }
});

app.post('/api/teacher/assessments', async (req, res) => {
  try {
    const { title, description, subject, type, duration, difficulty, questions, isDriveQuiz, driveLink } = req.body;
    const teacherId = req.user._id;
    
    // Calculate total points
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    
    const newAssessment = new Assessment({
      title,
      description,
      questions,
      subjectIds: [subject],
      difficulty,
      duration,
      totalPoints,
      createdBy: new mongoose.Types.ObjectId(teacherId),
      isPublished: true,
      isDriveQuiz: isDriveQuiz || false,
      driveLink: driveLink || ''
    });

    await newAssessment.save();
    res.status(201).json(newAssessment);
  } catch (error) {
    console.error('Failed to create assessment:', error);
    res.status(500).json({ message: 'Failed to create assessment' });
  }
});

// Get teacher's content
app.get('/api/teacher/quizzes', async (req, res) => {
  try {
    const teacherId = req.user._id;
    const quizzes = await Assessment.find({ 
      createdBy: teacherId,
      isPublished: true 
    }).sort({ createdAt: -1 });
    res.json(quizzes);
  } catch (error) {
    console.error('Failed to fetch teacher quizzes:', error);
    res.status(500).json({ message: 'Failed to fetch quizzes' });
  }
});

app.get('/api/teacher/videos', async (req, res) => {
  try {
    const teacherId = req.user._id;
    const videos = await Video.find({ 
      createdBy: teacherId,
      isPublished: true 
    }).sort({ createdAt: -1 });
    res.json(videos);
  } catch (error) {
    console.error('Failed to fetch teacher videos:', error);
    res.status(500).json({ message: 'Failed to fetch videos' });
  }
});

app.get('/api/teacher/assessments', async (req, res) => {
  try {
    const teacherId = req.user._id;
    const assessments = await Assessment.find({ 
      createdBy: teacherId,
      isPublished: true 
    }).sort({ createdAt: -1 });
    res.json(assessments);
  } catch (error) {
    console.error('Failed to fetch teacher assessments:', error);
    res.status(500).json({ message: 'Failed to fetch assessments' });
  }
});

// Student endpoints to access teacher-created content
app.get('/api/student/content', async (req, res) => {
  try {
    // Get all published content from teachers
    const [videos, assessments] = await Promise.all([
      Video.find({ isPublished: true }).populate('createdBy', 'fullName').sort({ createdAt: -1 }),
      Assessment.find({ isPublished: true }).populate('createdBy', 'fullName').sort({ createdAt: -1 })
    ]);
    
    if ((!videos || videos.length === 0) && (!assessments || assessments.length === 0)) {
      return res.status(404).json({ 
        success: false,
        message: 'No content found in database',
        videos: [],
        assessments: [],
        totalVideos: 0,
        totalAssessments: 0
      });
    }
    
    res.json({
      videos: videos || [],
      assessments: assessments || [],
      totalVideos: videos ? videos.length : 0,
      totalAssessments: assessments ? assessments.length : 0
    });
  } catch (error) {
    console.error('Failed to fetch student content:', error);
    res.status(500).json({ message: 'Failed to fetch content' });
  }
});

// These routes are now handled by student.js with proper multi-tenant filtering
// app.get('/api/student/videos', async (req, res) => {
//   try {
//     const videos = await Video.find({ isPublished: true })
//       .populate('createdBy', 'fullName')
//       .sort({ createdAt: -1 });
//     res.json(videos);
//   } catch (error) {
//     console.error('Failed to fetch student videos:', error);
//     res.status(500).json({ message: 'Failed to fetch videos' });
//   }
// });

// app.get('/api/student/assessments', async (req, res) => {
//   try {
//     const assessments = await Assessment.find({ isPublished: true })
//       .populate('createdBy', 'fullName')
//       .sort({ createdAt: -1 });
//     res.json(assessments);
//   } catch (error) {
//     console.error('Failed to fetch student assessments:', error);
//     res.status(500).json({ message: 'Failed to fetch assessments' });
//   }
// });

// This route is now handled by studentRoutes in routes/student.js
// app.get('/api/student/quizzes', async (req, res) => {
//   try {
//     const quizzes = await Assessment.find({ isPublished: true })
//       .populate('createdBy', 'fullName')
//       .sort({ createdAt: -1 });
//     res.json(quizzes);
//   } catch (error) {
//     console.error('Failed to fetch student quizzes:', error);
//     res.status(500).json({ message: 'Failed to fetch quizzes' });
//   }
// });

// Question management endpoints
app.get('/api/admin/exams/:examId/questions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { examId } = req.params;
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID format' });
    }
    
    console.log('Fetching questions for exam ID:', examId);
    const questions = await Question.find({ exam: examId }).sort({ createdAt: -1 });
    console.log('Found questions:', questions.length);
    res.json(questions);
  } catch (error) {
    console.error('Failed to fetch questions:', error);
    res.status(500).json({ message: 'Failed to fetch questions', error: error.message });
  }
});

app.post('/api/admin/exams/:examId/questions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { examId } = req.params;
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID format' });
    }
    const {
      questionText,
      questionImage,
      questionType,
      options,
      correctAnswer,
      marks,
      negativeMarks,
      explanation,
      subject
    } = req.body;

    console.log('Creating question with data:', {
      questionText,
      questionImage,
      questionType,
      options,
      correctAnswer,
      marks,
      negativeMarks,
      explanation,
      subject,
      examId
    });

    // Validate that either question text or image is provided
    if (!questionText?.trim() && !questionImage) {
      return res.status(400).json({ message: 'Either question text or image is required' });
    }

    // Clean up questionText - set to empty string if only whitespace
    const cleanQuestionText = questionText?.trim() || '';

    // Validate question type and options
    if ((questionType === 'mcq' || questionType === 'multiple') && (!options || options.length === 0)) {
      return res.status(400).json({ message: 'Options are required for MCQ and Multiple Choice questions' });
    }

    const question = new Question({
      questionText: cleanQuestionText,
      questionImage,
      questionType,
      options,
      correctAnswer,
      marks: marks || 1,
      negativeMarks: negativeMarks || 0,
      explanation,
      subject: subject || 'maths',
      exam: examId,
      createdBy: req.user.id
    });

    await question.save();
    console.log('Question saved successfully:', question._id);

    // Add question to exam
    await Exam.findByIdAndUpdate(examId, { $push: { questions: question._id } });
    console.log('Question added to exam:', examId);

    res.status(201).json(question);
  } catch (error) {
    console.error('Failed to create question:', error);
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    res.status(500).json({ 
      message: 'Failed to create question', 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.put('/api/admin/questions/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const question = await Question.findByIdAndUpdate(id, updateData, { new: true });
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }

    res.json(question);
  } catch (error) {
    console.error('Failed to update question:', error);
    res.status(500).json({ message: 'Failed to update question' });
  }
});

app.delete('/api/admin/questions/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const question = await Question.findById(id);
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }

    // Remove question from exam
    await Exam.findByIdAndUpdate(question.exam, { $pull: { questions: id } });
    
    await Question.findByIdAndDelete(id);
    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Failed to delete question:', error);
    res.status(500).json({ message: 'Failed to delete question' });
  }
});

// Image upload endpoint for questions
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/questions/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'question-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
  }
});

const imageUpload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

app.post('/api/admin/upload-question-image', (req, res, next) => {
  imageUpload.single('image')(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          success: false,
          message: 'File too large. Maximum size is 5MB.' 
        });
      }
      if (err.message === 'Only image files are allowed!') {
        return res.status(400).json({ 
          success: false,
          message: 'Only image files are allowed.' 
        });
      }
      return res.status(500).json({ 
        success: false,
        message: 'File upload error',
        error: err.message 
      });
    }
    next();
  });
}, (req, res) => {
  try {
    console.log('Image upload request received:', {
      file: req.file ? {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        filename: req.file.filename
      } : 'No file',
      body: req.body
    });

    if (!req.file) {
      console.log('No file provided in request');
      return res.status(400).json({ message: 'No image file provided' });
    }

    // Ensure the uploads directory exists
    const fs = require('fs');
    const path = require('path');
    const uploadDir = path.join(__dirname, 'uploads', 'questions');
    
    if (!fs.existsSync(uploadDir)) {
      console.log('Creating uploads/questions directory');
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const imageUrl = `/uploads/questions/${req.file.filename}`;
    console.log('Image uploaded successfully:', imageUrl);
    
    res.json({ 
      success: true,
      imageUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (error) {
    console.error('Failed to upload image:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to upload image',
      error: error.message 
    });
  }
});

// Generic file upload endpoint for homework and other documents
const fileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = join(__dirname, 'uploads', 'files');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = extname(file.originalname);
    cb(null, 'file-' + uniqueSuffix + ext);
  }
});

const fileUpload = multer({ 
  storage: fileStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for documents
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/gif'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed. Accepted: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT, Images'), false);
    }
  }
});

app.post('/api/upload', verifyToken, fileUpload.single('file'), (req, res) => {
  try {
    console.log('File upload request received:', {
      file: req.file ? {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        filename: req.file.filename
      } : 'No file',
      body: req.body
    });

    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No file provided' 
      });
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/files/${req.file.filename}`;
    console.log('File uploaded successfully:', fileUrl);
    
    res.json({ 
      success: true,
      url: fileUrl,
      fileUrl: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Failed to upload file:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to upload file',
      error: error.message 
    });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Failed to delete user:', error);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

app.patch('/api/admin/users/:id/toggle-status', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const updatedUser = await User.findByIdAndUpdate(
      id, 
      { isActive, updatedAt: new Date() },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updatedUser);
  } catch (error) {
    console.error('Failed to toggle user status:', error);
    res.status(500).json({ message: 'Failed to toggle user status' });
  }
});

// CSV upload endpoint - Add CORS preflight
app.options('/api/admin/users/upload', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.post('/api/admin/users/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('CSV upload request received');
    console.log('File:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'No file');
    console.log('Request headers:', {
      authorization: req.headers.authorization ? 'Present' : 'Missing',
      'content-type': req.headers['content-type'],
      origin: req.headers.origin
    });
    
    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const adminId = decoded.userId;
    console.log('Admin ID for CSV upload:', adminId);

    // Get admin to inherit board and school
    const admin = await User.findById(adminId).select('board schoolName role');
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    if (!admin.board) {
      return res.status(400).json({ 
        message: 'Admin must have a board assigned before uploading students. Please update your admin profile first.' 
      });
    }

    console.log('Admin board:', admin.board, 'School:', admin.schoolName);

    // Accept .xlsx / .xls natively OR .csv (encoding auto-detected).
    let csvData;
    try {
      ({ csv: csvData } = spreadsheetBufferToCsv(req.file.buffer, req.file.originalname));
    } catch (err) {
      return res.status(400).json({ message: `Failed to read uploaded file: ${err.message}` });
    }
    
    // Parse CSV data - handle both \n and \r\n line endings
    const lines = csvData.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) {
      return res.status(400).json({ message: 'File must have at least a header row and one data row' });
    }

    // Helper function to parse CSV line (handles quoted values); cleanCsvCell
    // also normalizes smart punctuation (−, –, —, ’, “, …) back to plain ASCII.
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++; // Skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(cleanCsvCell(current));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(cleanCsvCell(current)); // Add last field
      return result;
    };

    // Get header row
    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    
    // Validate headers - check for both classNumber and classnumber
    const requiredHeaders = ['name', 'email', 'phone'];
    const classHeader = headers.find(h => h === 'classnumber');
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    
    if (missingHeaders.length > 0) {
      return res.status(400).json({ 
        message: `Missing required headers: ${missingHeaders.join(', ')}` 
      });
    }
    
    if (!classHeader) {
      return res.status(400).json({ 
        message: 'Missing class header. Please include "classnumber" column' 
      });
    }

    const createdUsers = [];
    const errors = [];
    const createdClasses = new Map(); // Track created classes to avoid duplicates

    // Import Class model
    const Class = (await import('./models/Class.js')).default;

    // Helper function to parse class number and section from CSV
    const parseClassInfo = (classValue) => {
      if (!classValue || classValue.trim() === '' || classValue.toLowerCase() === 'unassigned') {
        return { classNumber: null, section: 'A' };
      }

      const classStr = classValue.trim();
      
      // Try to extract section from formats like "10-A", "10A", "Class 10-A", "Class 10A"
      const sectionMatch = classStr.match(/[-_]?([ABC])$/i);
      const section = sectionMatch ? sectionMatch[1].toUpperCase() : 'A';
      
      // Extract class number (remove "Class", "Class-", section, etc.)
      let classNumber = classStr
        .replace(/^class\s*/i, '')  // Remove "Class" prefix
        .replace(/[-_]?[ABC]$/i, '')  // Remove section suffix
        .trim();
      
      // If still empty or invalid, use the original value
      if (!classNumber || classNumber === '') {
        classNumber = classStr.replace(/[-_]?[ABC]$/i, '').trim();
      }

      return { classNumber, section };
    };

    // Helper function to get or create class
    const getOrCreateClass = async (classNumber, section) => {
      if (!classNumber || classNumber === 'Unassigned') {
        return null;
      }

      const classKey = `${classNumber}-${section}`;
      
      // Check if we already created this class in this batch
      if (createdClasses.has(classKey)) {
        return createdClasses.get(classKey);
      }

      // Check if class already exists
      let classDoc = await Class.findOne({
        classNumber: classNumber.trim(),
        section: section,
        assignedAdmin: adminId
      });

      if (!classDoc) {
        // Create new class
        const fullClassName = `Class ${classNumber}${section}`;
        classDoc = new Class({
          classNumber: classNumber.trim(),
          section: section,
          name: fullClassName,
          description: `Auto-created from CSV upload`,
          board: admin.board,
          school: admin.schoolName || '',
          assignedAdmin: adminId,
          isActive: true,
          assignedSubjects: []
        });

        await classDoc.save();
        console.log(`✅ Created new class: ${fullClassName}`);
      }

      createdClasses.set(classKey, classDoc);
      return classDoc;
    };

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]).map(v => v.trim().replace(/^"|"$/g, ''));
        
        if (values.length !== headers.length) {
          errors.push(`Row ${i + 1}: Column count mismatch`);
          continue;
        }

        // Create user object
        const userData = {};
        headers.forEach((header, index) => {
          userData[header] = values[index];
        });

        // Check if user already exists
        const existingUser = await User.findOne({ email: userData.email });
        if (existingUser) {
          errors.push(`Row ${i + 1}: User with email ${userData.email} already exists`);
          continue;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash('Password123', 12);

        // Parse class information from CSV
        const classValue = userData.classnumber || userData.class || '';
        const { classNumber, section } = parseClassInfo(classValue);

        // Get or create class if class number is provided
        let assignedClass = null;
        if (classNumber && classNumber !== 'Unassigned') {
          try {
            assignedClass = await getOrCreateClass(classNumber, section);
          } catch (classError) {
            errors.push(`Row ${i + 1}: Failed to create class ${classNumber}${section}: ${classError.message}`);
            // Continue with user creation even if class creation fails
          }
        }

        // Create new user and assign to the logged-in admin
        const newUser = new User({
          fullName: userData.name,
          email: userData.email,
          classNumber: classNumber || 'Unassigned',
          phone: userData.phone,
          password: hashedPassword,
          role: 'student',
          isActive: true,
          assignedAdmin: adminId,  // Assign to the logged-in admin
          assignedClass: assignedClass ? assignedClass._id : undefined,  // Assign to class if created
          board: admin.board,      // Inherit board from admin
          schoolName: admin.schoolName || ''  // Inherit school name from admin
        });

        await newUser.save();
        createdUsers.push({
          id: newUser._id,
          name: newUser.fullName,
          email: newUser.email,
          classNumber: newUser.classNumber,
          class: assignedClass ? `${assignedClass.classNumber}${assignedClass.section}` : 'Unassigned'
        });

      } catch (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
      }
    }

    const classesCreated = createdClasses.size;
    let message = `CSV processed successfully. Created ${createdUsers.length} students.`;
    if (classesCreated > 0) {
      message += ` Created ${classesCreated} new class${classesCreated > 1 ? 'es' : ''}.`;
    }

    res.json({
      message: message,
      createdUsers,
      classesCreated: classesCreated,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Failed to upload CSV:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Failed to upload CSV',
      error: error.message,
      hint: error.message.includes('board') ? 'Make sure your admin account has a board assigned' : 'Please check the CSV format and try again'
    });
  }
});

// Teacher CSV Upload Endpoint
app.options('/api/admin/teachers/upload', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.post('/api/admin/teachers/upload', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    console.log('Teacher CSV upload request received');
    console.log('File:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'No file');
    console.log('Request headers:', {
      authorization: req.headers.authorization ? 'Present' : 'Missing',
      'content-type': req.headers['content-type'],
      origin: req.headers.origin
    });
    
    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const adminId = decoded.userId;
    console.log('Admin ID for teacher CSV upload:', adminId);

    // Get admin to inherit board and school
    const admin = await User.findById(adminId).select('board schoolName role');
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    if (!admin.board) {
      return res.status(400).json({ 
        message: 'Admin must have a board assigned before uploading teachers. Please update your admin profile first.' 
      });
    }

    console.log('Admin board:', admin.board, 'School:', admin.schoolName);

    // Accept .xlsx / .xls natively OR .csv (encoding auto-detected).
    let csvData;
    try {
      ({ csv: csvData } = spreadsheetBufferToCsv(req.file.buffer, req.file.originalname));
    } catch (err) {
      return res.status(400).json({ message: `Failed to read uploaded file: ${err.message}` });
    }
    
    // Parse CSV data - handle both \n and \r\n line endings
    const lines = csvData.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) {
      return res.status(400).json({ message: 'File must have at least a header row and one data row' });
    }

    // Helper function to parse CSV line (handles quoted values); cleanCsvCell
    // also normalizes smart punctuation (−, –, —, ’, “, …) back to plain ASCII.
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++; // Skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(cleanCsvCell(current));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(cleanCsvCell(current)); // Add last field
      return result;
    };

    // Get header row
    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    
    // Validate headers
    const requiredHeaders = ['name', 'email'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    
    if (missingHeaders.length > 0) {
      return res.status(400).json({ 
        message: `Missing required headers: ${missingHeaders.join(', ')}` 
      });
    }

    const createdTeachers = [];
    const errors = [];

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]).map(v => v.trim().replace(/^"|"$/g, ''));
        
        if (values.length !== headers.length) {
          errors.push(`Row ${i + 1}: Column count mismatch`);
          continue;
        }

        // Create teacher object
        const teacherData = {};
        headers.forEach((header, index) => {
          teacherData[header] = values[index];
        });

        // Check if teacher already exists
        const existingTeacher = await Teacher.findOne({ email: teacherData.email });
        if (existingTeacher) {
          errors.push(`Row ${i + 1}: Teacher with email ${teacherData.email} already exists`);
          continue;
        }

        // Hash password (default password)
        const hashedPassword = await bcrypt.hash('Password123', 12);

        // Parse subjects (comma-separated)
        let subjectIds = [];
        if (teacherData.subjects) {
          const subjectNames = teacherData.subjects.split(',').map(s => s.trim()).filter(s => s);
          // Find subjects by name
          for (const subjectName of subjectNames) {
            const subject = await Subject.findOne({ 
              name: { $regex: new RegExp(`^${subjectName}$`, 'i') },
              assignedAdmin: adminId
            });
            if (subject) {
              subjectIds.push(subject._id);
            } else {
              errors.push(`Row ${i + 1}: Subject "${subjectName}" not found. Please create the subject first.`);
            }
          }
        }

        // Create new teacher
        const newTeacher = new Teacher({
          fullName: teacherData.name,
          email: teacherData.email,
          phone: teacherData.phone || '',
          department: teacherData.department || '',
          qualifications: teacherData.qualifications || '',
          subjects: subjectIds,
          password: hashedPassword,
          isActive: true,
          assignedAdmin: adminId,
          board: admin.board,
          schoolName: admin.schoolName || ''
        });

        await newTeacher.save();
        createdTeachers.push({
          id: newTeacher._id,
          name: newTeacher.fullName,
          email: newTeacher.email,
          department: newTeacher.department,
          subjects: subjectIds.length
        });

      } catch (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
      }
    }

    let message = `CSV processed successfully. Created ${createdTeachers.length} teachers.`;
    if (errors.length > 0) {
      message += ` ${errors.length} error(s) occurred.`;
    }

    res.json({
      message: message,
      createdTeachers,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Failed to upload teacher CSV:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Failed to upload CSV',
      error: error.message,
      hint: error.message.includes('board') ? 'Make sure your admin account has a board assigned' : 'Please check the CSV format and try again'
    });
  }
});

// Classes endpoint - returns classes from Class model and students
app.get('/api/admin/classes', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const adminId = decoded.userId;

    // Get classes from Class model
    const Class = (await import('./models/Class.js')).default;
    const classDocuments = await Class.find({
      assignedAdmin: adminId,
      isActive: true
    }).sort({ classNumber: 1, section: 1 });

    // Get students assigned to this admin
    const students = await User.find({ 
      role: 'student',
      assignedAdmin: adminId 
    }).select('fullName email classNumber phone isActive createdAt lastLogin');
    
    if (!students || students.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No students found in database',
        data: []
      });
    }
    
    // Create a map of classNumber+section to students
    const studentClassMap = new Map();
    students.forEach(student => {
      const classKey = student.classNumber || 'Unassigned';
      if (!studentClassMap.has(classKey)) {
        studentClassMap.set(classKey, []);
      }
      studentClassMap.get(classKey).push({
        id: student._id,
        name: student.fullName,
        email: student.email,
        classNumber: student.classNumber,
        phone: student.phone,
        status: student.isActive ? 'active' : 'inactive',
        createdAt: student.createdAt,
        lastLogin: student.lastLogin
      });
    });

    // Format classes with students
    const classes = classDocuments.map(classDoc => {
      const fullClassKey = `${classDoc.classNumber}${classDoc.section}`;
      const classStudents = studentClassMap.get(fullClassKey) || [];
      
      return {
        id: classDoc._id.toString(),
        name: classDoc.name || `Class ${classDoc.classNumber}${classDoc.section}`,
        description: classDoc.description || '',
        classNumber: classDoc.classNumber,
        section: classDoc.section,
        subject: 'General',
        grade: classDoc.classNumber,
        teacher: 'TBD',
        schedule: 'Mon-Fri 9:00 AM',
        room: `Room ${classDoc.classNumber}${classDoc.section}`,
        studentCount: classStudents.length,
        students: classStudents,
        createdAt: classDoc.createdAt
      };
    });

    // Also include classes that exist only in student data (for backward compatibility)
    const classKeysFromStudents = new Set(students.map(s => s.classNumber).filter(Boolean));
    classKeysFromStudents.forEach(classKey => {
      // Check if this class already exists in classDocuments
      const exists = classDocuments.some(c => `${c.classNumber}${c.section}` === classKey);
      if (!exists && classKey !== 'Unassigned') {
        const classStudents = studentClassMap.get(classKey) || [];
        classes.push({
          id: classKey,
          name: `Class ${classKey}`,
          description: `Students in class ${classKey}`,
          classNumber: classKey,
          section: '',
          subject: 'General',
          grade: classKey,
          teacher: 'TBD',
          schedule: 'Mon-Fri 9:00 AM',
          room: `Room ${classKey}`,
          studentCount: classStudents.length,
          students: classStudents,
          createdAt: new Date().toISOString()
        });
      }
    });
    
    console.log('Classes being returned:', classes.map(c => ({ 
      name: c.name, 
      classNumber: c.classNumber,
      section: c.section,
      studentCount: c.studentCount
    })));
    res.json(classes);
  } catch (error) {
    console.error('Failed to fetch classes:', error);
    res.status(500).json({ message: 'Failed to fetch classes' });
  }
});

// Create new class
app.post('/api/admin/classes', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const adminId = decoded.userId;

    const { classNumber, section, description } = req.body;
    
    // Validate required fields
    if (!classNumber || !section) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class number and section are required' 
      });
    }

    if (!['A', 'B', 'C'].includes(section)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Section must be A, B, or C' 
      });
    }
    
    // Get admin to inherit board and school
    const admin = await User.findById(adminId).select('board schoolName');
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    if (!admin.board) {
      return res.status(400).json({ success: false, message: 'Admin must have a board assigned' });
    }

    // Check if class already exists (classNumber + section + admin)
    const Class = (await import('./models/Class.js')).default;
    const existingClass = await Class.findOne({
      classNumber: classNumber.trim(),
      section: section,
      assignedAdmin: adminId
    });

    if (existingClass) {
      return res.status(400).json({ 
        success: false, 
        message: `Class ${classNumber}${section} already exists. Cannot create duplicate classes.` 
      });
    }

    // Create full class name
    const fullClassName = `Class ${classNumber}${section}`;
    
    // Create new class
    const newClass = new Class({
      classNumber: classNumber.trim(),
      section: section,
      name: fullClassName,
      description: description?.trim() || '',
      board: admin.board,
      school: admin.schoolName || '',
      assignedAdmin: adminId,
      isActive: true,
      assignedSubjects: []
    });

    await newClass.save();

    res.status(201).json({
      success: true,
      message: 'Class created successfully',
      data: {
        id: newClass._id,
        classNumber: newClass.classNumber,
        section: newClass.section,
        name: newClass.name,
        description: newClass.description,
        board: newClass.board,
        school: newClass.school,
        assignedAdmin: newClass.assignedAdmin
      }
    });
  } catch (error) {
    console.error('Failed to create class:', error);
    res.status(500).json({ success: false, message: 'Failed to create class' });
  }
});

// Delete class
app.delete('/api/admin/classes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // For now, just return success - in a real app, you'd delete from database
    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Failed to delete class:', error);
    res.status(500).json({ message: 'Failed to delete class' });
  }
});


// Admin Quizzes endpoints
app.get('/api/quizzes', async (req, res) => {
  try {
    const quizzes = await Assessment.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(quizzes);
  } catch (error) {
    console.error('Failed to fetch quizzes:', error);
    res.status(500).json({ message: 'Failed to fetch quizzes' });
  }
});

app.post('/api/quizzes', async (req, res) => {
  try {
    const { title, description, subject, difficulty, duration, questions } = req.body;
    
    // Map difficulty values to model enum
    const difficultyMap = {
      'easy': 'beginner',
      'medium': 'intermediate', 
      'hard': 'advanced'
    };
    
    const newQuiz = new Assessment({
      title,
      description,
      subjectIds: [subject],
      difficulty: difficultyMap[difficulty] || 'beginner',
      duration,
      questions: [], // Start with empty questions array
      totalPoints: 0, // Will be calculated when questions are added
      isPublished: true,
      createdBy: null // Remove user dependency for now
    });

    await newQuiz.save();
    res.status(201).json(newQuiz);
  } catch (error) {
    console.error('Failed to create quiz:', error);
    res.status(500).json({ message: 'Failed to create quiz' });
  }
});

app.put('/api/quizzes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const quiz = await Assessment.findByIdAndUpdate(id, updateData, { new: true });
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    res.json(quiz);
  } catch (error) {
    console.error('Failed to update quiz:', error);
    res.status(500).json({ message: 'Failed to update quiz' });
  }
});

app.delete('/api/quizzes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Assessment.findByIdAndDelete(id);
    res.json({ message: 'Quiz deleted successfully' });
  } catch (error) {
    console.error('Failed to delete quiz:', error);
    res.status(500).json({ message: 'Failed to delete quiz' });
  }
});

app.patch('/api/quizzes/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const quiz = await Assessment.findByIdAndUpdate(id, { isPublished: isActive }, { new: true });
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    res.json(quiz);
  } catch (error) {
    console.error('Failed to toggle quiz status:', error);
    res.status(500).json({ message: 'Failed to toggle quiz status' });
  }
});

// Admin Videos endpoints
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await Video.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(videos);
  } catch (error) {
    console.error('Failed to fetch videos:', error);
    res.status(500).json({ message: 'Failed to fetch videos' });
  }
});

app.post('/api/videos', async (req, res) => {
  try {
    const { title, description, subject, duration, videoUrl, thumbnail, youtubeUrl, isYouTubeVideo } = req.body;
    
    // Map difficulty values to model enum
    const difficultyMap = {
      'easy': 'beginner',
      'medium': 'intermediate', 
      'hard': 'advanced'
    };
    
    const newVideo = new Video({
      title,
      description,
      subjectId: subject,
      duration,
      videoUrl: isYouTubeVideo ? '' : (videoUrl || ''),
      thumbnailUrl: isYouTubeVideo ? '' : (thumbnail || ''),
      youtubeUrl: isYouTubeVideo ? (youtubeUrl || '') : '',
      isYouTubeVideo: isYouTubeVideo || false,
      difficulty: difficultyMap['medium'] || 'beginner', // Default to medium
      isPublished: true,
      createdBy: null // Remove user dependency for now
    });

    await newVideo.save();
    res.status(201).json(newVideo);
  } catch (error) {
    console.error('Failed to create video:', error);
    res.status(500).json({ message: 'Failed to create video' });
  }
});

app.put('/api/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const video = await Video.findByIdAndUpdate(id, updateData, { new: true });
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    
    res.json(video);
  } catch (error) {
    console.error('Failed to update video:', error);
    res.status(500).json({ message: 'Failed to update video' });
  }
});

app.delete('/api/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Video.findByIdAndDelete(id);
    res.json({ message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Failed to delete video:', error);
    res.status(500).json({ message: 'Failed to delete video' });
  }
});

app.patch('/api/videos/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const video = await Video.findByIdAndUpdate(id, { isPublished: isActive }, { new: true });
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    
    res.json(video);
  } catch (error) {
    console.error('Failed to toggle video status:', error);
    res.status(500).json({ message: 'Failed to toggle video status' });
  }
});

// Duplicate assessments GET route removed - handled above

app.post('/api/assessments', async (req, res) => {
  try {
    const { title, description, subject, type, difficulty, duration, totalMarks, passingMarks, questions, driveLink, isDriveQuiz } = req.body;
    
    // Map difficulty values to model enum
    const difficultyMap = {
      'easy': 'beginner',
      'medium': 'intermediate', 
      'hard': 'advanced'
    };
    
    const newAssessment = new Assessment({
      title,
      description,
      subjectIds: [subject],
      type,
      difficulty: difficultyMap[difficulty] || 'beginner',
      duration,
      totalPoints: totalMarks,
      passingPoints: passingMarks,
      questions: [], // Start with empty questions array
      driveLink: driveLink || '',
      isDriveQuiz: isDriveQuiz || false,
      isPublished: true,
      createdBy: null // Remove user dependency for now
    });

    await newAssessment.save();
    res.status(201).json(newAssessment);
  } catch (error) {
    console.error('Failed to create assessment:', error);
    res.status(500).json({ message: 'Failed to create assessment' });
  }
});

app.put('/api/assessments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const assessment = await Assessment.findByIdAndUpdate(id, updateData, { new: true });
    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }
    
    res.json(assessment);
  } catch (error) {
    console.error('Failed to update assessment:', error);
    res.status(500).json({ message: 'Failed to update assessment' });
  }
});

app.delete('/api/assessments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Assessment.findByIdAndDelete(id);
    res.json({ message: 'Assessment deleted successfully' });
  } catch (error) {
    console.error('Failed to delete assessment:', error);
    res.status(500).json({ message: 'Failed to delete assessment' });
  }
});

app.patch('/api/assessments/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const assessment = await Assessment.findByIdAndUpdate(id, { isPublished: isActive }, { new: true });
    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }
    
    res.json(assessment);
  } catch (error) {
    console.error('Failed to toggle assessment status:', error);
    res.status(500).json({ message: 'Failed to toggle assessment status' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// AI Chat endpoints (Vidya-AI dashboards use Gemini API only)
const getVidyaGeminiConfig = () => {
  const apiKey = process.env.VIDYA_AI_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
  const model = process.env.VIDYA_AI_GEMINI_MODEL || 'gemini-2.0-flash';
  const fallbackModels = String(
    process.env.VIDYA_AI_GEMINI_FALLBACK_MODELS || 'gemini-2.0-flash-lite,gemini-2.5-flash-lite,gemini-2.5-flash'
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== model);
  const baseUrl = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  return { apiKey, model, fallbackModels, baseUrl };
};

const normalizeGeminiText = (value) => {
  return value == null ? '' : String(value).trim();
};

const extractGeminiText = (payload) => {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
};

const parseGeminiErrorText = (errorText) => {
  try {
    const payload = JSON.parse(errorText);
    const message = payload?.error?.message;
    return message ? String(message) : String(errorText || '');
  } catch (_) {
    return String(errorText || '');
  }
};

const callGeminiWithModelFallback = async ({ payload, isVision = false }) => {
  const { apiKey, model, fallbackModels, baseUrl } = getVidyaGeminiConfig();
  if (!apiKey) {
    throw new Error('Missing VIDYA_AI_GEMINI_API_KEY (or GEMINI_API_KEY) for Vidya-AI');
  }

  const models = [model, ...fallbackModels];
  let lastError = null;

  for (const modelName of models) {
    const response = await fetch(`${baseUrl}/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      const text = extractGeminiText(data);
      if (!text) {
        lastError = new Error(`Vidya-AI Gemini ${isVision ? 'vision ' : ''}returned empty response for model ${modelName}`);
        continue;
      }
      return text;
    }

    const errorText = await response.text();
    const parsedMessage = parseGeminiErrorText(errorText);
    const error = new Error(
      `Vidya-AI Gemini ${isVision ? 'vision ' : ''}request failed (${response.status}) on ${modelName}: ${parsedMessage}`
    );
    error.statusCode = response.status;
    lastError = error;

    // Retry with next Gemini model for quota/rate/availability errors.
    if (response.status === 429 || response.status === 503 || response.status === 404) {
      continue;
    }
    break;
  }

  throw lastError || new Error('Vidya-AI Gemini request failed');
};

const callVidyaGeminiText = async ({ message, context = {}, chatHistory = [] }) => {
  const studentName = context?.studentName || 'Student';
  let systemInstruction = `You are Vidya AI for AsliLearn.
Give direct, accurate, educational answers.
Use clear language and step-by-step explanations for problem solving.
Keep responses focused and practical.`;

  if (context?.currentSubject) {
    systemInstruction += `\nCurrent subject: ${context.currentSubject}`;
    if (context?.currentTopic) {
      systemInstruction += `\nCurrent topic: ${context.currentTopic}`;
    }
  }

  const historyContents = (Array.isArray(chatHistory) ? chatHistory : [])
    .slice(-8)
    .map((msg) => {
      const text = normalizeGeminiText(msg?.content);
      if (!text) return null;
      return {
        role: msg?.role === 'assistant' ? 'model' : 'user',
        parts: [{ text }]
      };
    })
    .filter(Boolean);

  const payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [
      ...historyContents,
      {
        role: 'user',
        parts: [{ text: normalizeGeminiText(message) || `Help ${studentName} with studies.` }]
      }
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1400
    }
  };

  return callGeminiWithModelFallback({ payload, isVision: false });
};

const callVidyaGeminiVision = async ({ imageBase64, context = '' }) => {
  const prompt = `Analyze this educational image and help the student.
${context ? `Context: ${context}` : ''}
Provide: (1) what you see, (2) explanation/solution, (3) key takeaways.`;

  const payload = {
    systemInstruction: {
      parts: [{ text: 'You are a helpful educational vision assistant.' }]
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: imageBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1400
    }
  };

  return callGeminiWithModelFallback({ payload, isVision: true });
};

// Store chat sessions in memory (in production, use a database)
const chatSessions = new Map();

app.post('/api/ai-chat', async (req, res) => {
  try {
    const { userId, message, context } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ message: 'User ID and message are required' });
    }

    // Get or create chat session
    let session = chatSessions.get(userId);
    if (!session) {
      session = {
        id: Date.now().toString(),
        userId,
        messages: [],
        context: context || {},
        createdAt: new Date(),
        updatedAt: new Date()
      };
      chatSessions.set(userId, session);
    }

    // Add user message
    const userMessage = {
      role: 'user',
      content: message,
      timestamp: new Date()
    };
    session.messages.push(userMessage);

    // Generate AI response (Gemini-only path for Vidya-AI)
    const aiResponse = await callVidyaGeminiText({
      message,
      context: context || session.context,
      chatHistory: session.messages.slice(-10)
    });

    // Add AI response
    const aiMessage = {
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date()
    };
    session.messages.push(aiMessage);

    // Update session
    session.updatedAt = new Date();
    session.context = { ...session.context, ...context };

    res.json({
      success: true,
      message: aiResponse,
      session: {
        id: session.id,
        messages: session.messages,
        context: session.context
      }
    });
  } catch (error) {
    console.error('AI chat error:', error);
    const status = Number(error?.statusCode) || 500;
    res.status(status).json({ message: error?.message || 'Failed to process chat message' });
  }
});

app.get('/api/users/:userId/chat-sessions', async (req, res) => {
  try {
    const { userId } = req.params;
    const session = chatSessions.get(userId);
    
    if (!session) {
      return res.json([]);
    }

    res.json([session]);
  } catch (error) {
    console.error('Failed to fetch chat sessions:', error);
    res.status(500).json({ message: 'Failed to fetch chat sessions' });
  }
});

app.post('/api/ai-chat/analyze-image', async (req, res) => {
  try {
    const { image, context } = req.body;

    if (!image) {
      return res.status(400).json({ message: 'Image is required' });
    }

    // Remove data URL prefix if present
    const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, '');
    
    const analysis = await callVidyaGeminiVision({
      imageBase64: base64Data,
      context
    });

    res.json({
      success: true,
      analysis
    });
  } catch (error) {
    console.error('Image analysis error:', error);
    const status = Number(error?.statusCode) || 500;
    res.status(status).json({ message: error?.message || 'Failed to analyze image' });
  }
});

// Subject Management endpoints
app.get('/api/subjects', async (req, res) => {
  try {
    const subjects = await Subject.find({ isActive: true })
      .populate('videos', 'title duration')
      .populate('quizzes', 'question')
      .populate('createdBy', 'fullName')
      .sort({ createdAt: -1 });
    
    if (!subjects || subjects.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No subjects found in database',
        subjects: []
      });
    }
    
    res.json({ success: true, subjects });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects' });
  }
});

app.get('/api/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid subject ID format' });
    }
    
    const subject = await Subject.findById(id);
    
    if (!subject) {
      return res.status(404).json({ 
        success: false, 
        message: 'Subject not found in database' 
      });
    }
    
    res.json({ success: true, subject });
  } catch (error) {
    console.error('Error fetching subject:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch subject',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/subjects', async (req, res) => {
  try {
    const { name, description, category, difficulty, duration, subjects, color, icon } = req.body;
    
    const subject = new Subject({
      name,
      description,
      category,
      difficulty,
      duration,
      subjects,
      color,
      icon,
      createdBy: req.user?.id || 'admin-user' // Fallback for testing
    });
    
    await subject.save();
    res.status(201).json({ success: true, subject });
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({ success: false, message: 'Failed to create subject' });
  }
});

app.put('/api/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const subject = await Subject.findByIdAndUpdate(id, updates, { new: true });
    
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    
    res.json({ success: true, subject });
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({ success: false, message: 'Failed to update subject' });
  }
});

app.delete('/api/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const subject = await Subject.findByIdAndUpdate(id, { isActive: false }, { new: true });
    
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    const { removeSubjectIdFromAllAssignments } = await import(
      './utils/removeSubjectAssignments.js'
    );
    await removeSubjectIdFromAllAssignments(id);
    
    res.json({ success: true, message: 'Subject deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating subject:', error);
    res.status(500).json({ success: false, message: 'Failed to deactivate subject' });
  }
});

// Add video to subject
app.post('/api/subjects/:id/videos', async (req, res) => {
  try {
    const { id } = req.params;
    const { videoId } = req.body;
    
    const subject = await Subject.findByIdAndUpdate(
      id,
      { $addToSet: { videos: videoId } },
      { new: true }
    );
    
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    
    res.json({ success: true, subject });
  } catch (error) {
    console.error('Error adding video to subject:', error);
    res.status(500).json({ success: false, message: 'Failed to add video to subject' });
  }
});

// Add quiz to subject
app.post('/api/subjects/:id/quizzes', async (req, res) => {
  try {
    const { id } = req.params;
    const { quizId } = req.body;
    
    const subject = await Subject.findByIdAndUpdate(
      id,
      { $addToSet: { quizzes: quizId } },
      { new: true }
    );
    
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    
    res.json({ success: true, subject });
  } catch (error) {
    console.error('Error adding quiz to subject:', error);
    res.status(500).json({ success: false, message: 'Failed to add quiz to subject' });
  }
});

// Assign subjects to any teacher (for debugging)
app.post('/api/debug/assign-subjects-to-teacher', async (req, res) => {
  try {
    const { teacherEmail, subjectIds } = req.body;
    
    const teacher = await Teacher.findOne({ email: teacherEmail });
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }
    
    // Update teacher's subjects
    teacher.subjects = subjectIds;
    await teacher.save();
    
    // Populate subjects for response
    await teacher.populate('subjects');
    
    res.json({
      message: 'Subjects assigned successfully',
      teacher: {
        id: teacher._id,
        email: teacher.email,
        fullName: teacher.fullName,
        subjects: teacher.subjects
      }
    });
  } catch (error) {
    console.error('Failed to assign subjects:', error);
    res.status(500).json({ message: 'Failed to assign subjects' });
  }
});

// Debug current session
app.get('/api/debug/current-session', (req, res) => {
  res.json({
    isAuthenticated: req.isAuthenticated(),
    user: req.user ? {
      id: req.user._id,
      email: req.user.email,
      fullName: req.user.fullName,
      role: req.user.role
    } : null
  });
});

// Super Admin Authentication
app.post('/api/super-admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Super admin credentials
    const superAdminCredentials = [
      { email: 'sealucknow2017@gmail.com', password: 'Asli123', fullName: 'Super Admin' }
    ];
    
    // Check super admin credentials
    const validCredential = superAdminCredentials.find(
      cred => cred.email.toLowerCase() === email.toLowerCase() && cred.password === password
    );
    
    if (validCredential) {
      const token = jwt.sign(
        { 
          id: 'super-admin-001',
          email: validCredential.email,
          fullName: validCredential.fullName,
          role: 'super-admin'
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );
      
      res.json({
        success: true,
        token,
        user: {
          id: 'super-admin-001',
          email: validCredential.email,
          fullName: validCredential.fullName,
          role: 'super-admin'
        }
      });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Super admin login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Super Admin Dashboard Stats
app.get('/api/super-admin/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTeachers = await Teacher.countDocuments();
    const totalVideos = await Video.countDocuments();
    const totalAssessments = await Assessment.countDocuments();

    const totalAdmins = await User.countDocuments({ role: 'admin' });

    res.json({
      success: true,
      data: {
        totalUsers,
        revenue: 0, // Revenue tracking to be implemented
        courses: totalVideos,
        teachers: totalTeachers,
        admins: totalAdmins,
        superAdmins: 1
      }
    });
  } catch (error) {
    console.error('Stats error:', error);

    // Fallback so the dashboard doesn't completely break if DB is down
    res.status(200).json({
      success: false,
      message: 'Failed to fetch stats from database, using fallback zeros',
      data: {
        totalUsers: 0,
        revenue: 0,
        courses: 0,
        teachers: 0,
        admins: 0,
        superAdmins: 1
      }
    });
  }
});

// Get all admins with enhanced data
app.get('/api/super-admin/admins', async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' }).select('-password');

    const adminsWithCounts = await Promise.all(
      admins.map(async (admin) => {
        const studentCount = await User.countDocuments({
          role: 'student',
          assignedAdmin: admin._id
        });

        const teacherCount = await Teacher.countDocuments({
          adminId: admin._id
        });

        return {
          id: admin._id,
          _id: admin._id,
          name: admin.fullName || admin.name,
          email: admin.email,
          schoolName: admin.schoolName || admin.name || '',
          totalStudents: studentCount,
          totalTeachers: teacherCount,
          createdAt: admin.createdAt,
          status: admin.isActive !== false ? 'active' : 'inactive'
        };
      })
    );

    res.json({
      success: true,
      data: adminsWithCounts
    });
  } catch (error) {
    console.error('Error fetching admins:', error);

    // Fallback: return empty list instead of 500 so UI still loads
    res.status(200).json({
      success: false,
      message: 'Failed to fetch admins from database, returning empty list',
      data: []
    });
  }
});

// Delete admin - This route is handled by the controller in routes/superAdmin.js
// Keeping this for backward compatibility but it should use the controller's deleteAdmin function
// The controller handles cascading deletion of all related data

// Get all users
app.get('/api/super-admin/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// Create new user
app.post('/api/super-admin/users', async (req, res) => {
  try {
    const { name, email, role, details } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    // Create new user
    const hashedPassword = await bcrypt.hash('password123', 10); // Default password
    const newUser = new User({
      fullName: name,
      email,
      password: hashedPassword,
      role: role,
      details: details,
      isActive: true
    });
    
    await newUser.save();
    
    res.json({
      success: true,
      message: 'User created successfully',
      user: {
        id: newUser._id,
        name: newUser.fullName,
        email: newUser.email,
        role: newUser.role,
        details: newUser.details,
        status: 'Active',
        joinDate: newUser.createdAt
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
});

// Get all courses/videos
app.get('/api/super-admin/courses', async (req, res) => {
  try {
    const courses = await Video.find().populate('teacher', 'fullName').sort({ createdAt: -1 });
    res.json(courses);
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch courses' });
  }
});

// Create new course
app.post('/api/super-admin/courses', async (req, res) => {
  try {
    const { title, subject, grade, board, teacher } = req.body;
    
    // Find teacher by name
    const teacherUser = await User.findOne({ fullName: teacher, role: 'teacher' });
    if (!teacherUser) {
      return res.status(400).json({ success: false, message: 'Teacher not found' });
    }
    
    const newCourse = new Video({
      title: title,
      subject: subject,
      grade: grade,
      board: board,
      teacher: teacherUser._id,
      description: `${subject} course for ${grade} - ${board}`,
      isPublished: true
    });
    
    await newCourse.save();
    
    res.json({
      success: true,
      message: 'Course created successfully',
      course: {
        id: newCourse._id,
        title: newCourse.title,
        subject: newCourse.subject,
        grade: newCourse.grade,
        board: newCourse.board,
        teacher: teacherUser.fullName,
        status: 'Published',
        created: newCourse.createdAt
      }
    });
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ success: false, message: 'Failed to create course' });
  }
});

// Get analytics data
app.get('/api/super-admin/analytics', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTeachers = await Teacher.countDocuments();
    const totalVideos = await Video.countDocuments();
    
    // Calculate daily active users (mock data)
    const dailyActive = Math.floor(totalUsers * 0.1);
    const weeklyActive = Math.floor(totalUsers * 0.3);
    const monthlyActive = Math.floor(totalUsers * 0.7);
    
    res.json({
      dailyActive,
      weeklyActive,
      monthlyActive,
      avgSessionTime: "24m 35s",
      completionRate: 76,
      revenueGrowth: 23.5,
      userGrowth: 18.2,
      courseEngagement: 89
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
});

// Subscriptions / billing: handled by superAdmin routes (Razorpay-backed getSubscriptions)

// Export data
app.get('/api/super-admin/export', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    const videos = await Video.find();
    const teachers = await Teacher.find();
    
    const exportData = {
      users: users,
      videos: videos,
      teachers: teachers,
      exportDate: new Date().toISOString()
    };
    
    res.json(exportData);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: 'Failed to export data' });
  }
});

// Direct video creation endpoint for testing
app.post('/api/test-video', async (req, res) => {
  try {
    console.log('=== DIRECT VIDEO TEST ===');
    console.log('Body:', req.body);
    
    const { title, description, subject, duration, videoUrl } = req.body;
    
    const testVideo = new Video({
      title: title || 'Direct Test Video',
      description: description || 'Test Description',
      subjectId: subject || 'test',
      duration: parseInt(duration) * 60 || 3600,
      videoUrl: videoUrl || 'https://test.com',
      youtubeUrl: videoUrl || 'https://test.com',
      isYouTubeVideo: true,
      difficulty: 'beginner',
      createdBy: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      adminId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      isPublished: true
    });
    
    console.log('Direct test video object:', testVideo);
    await testVideo.save();
    console.log('Direct test video saved successfully:', testVideo._id);
    
    res.json({ success: true, message: 'Direct test video created', data: testVideo });
  } catch (error) {
    console.error('=== DIRECT TEST VIDEO ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error name:', error.name);
    console.error('Error stack:', error.stack);
    console.error('Full error:', error);
    res.status(500).json({ success: false, message: 'Direct test failed', error: error.message, details: error });
  }
});

// Working video creation endpoint for teachers
app.post('/api/teacher/videos-working', async (req, res) => {
  try {
    console.log('=== WORKING TEACHER VIDEO ENDPOINT ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    console.log('Token:', token);
    
    // Verify token and get user info (fallback secret for local dev)
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, jwtSecret);
    console.log('Decoded token:', decoded);
    
    if (decoded.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }
    
    let teacherId = decoded.userId || decoded.id || decoded._id;
    if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
      // Fallback: resolve by email
      if (decoded.email) {
        const userDoc = await User.findOne({ email: decoded.email }).select('_id');
        teacherId = userDoc?._id?.toString();
      }
    }
    console.log('Teacher ID resolved:', teacherId);
    if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher identity in token' });
    }
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body || {};

    // Normalize inputs
    const minutes = Number.isFinite(Number(duration)) ? Number(duration) : 1;
    const durationSeconds = Math.max(1, Math.floor(minutes)) * 60;

    const newVideo = new Video({
      title: (title || 'Untitled Video').trim(),
      description: (description || '').trim(),
      subjectId: (subject || 'general').toString().trim(),
      duration: durationSeconds,
      videoUrl: (videoUrl || '').trim(),
      youtubeUrl: (videoUrl || '').trim(),
      isYouTubeVideo: !!videoUrl,
      difficulty: (difficulty || 'beginner').toLowerCase(),
      createdBy: new mongoose.Types.ObjectId(teacherId),
      // For multi-tenant visibility, prefer teacher's admin if available; fallback to teacherId
      adminId: new mongoose.Types.ObjectId(teacherId),
      isPublished: true
    });
    // Pre-validate to surface detailed errors
    const validationError = newVideo.validateSync();
    if (validationError) {
      console.error('Video validation error:', validationError);
      return res.status(400).json({ success: false, message: 'Validation failed', error: validationError.message, details: validationError.errors });
    }

    await newVideo.save();
    console.log('Working video created successfully:', newVideo._id);
    
    res.status(201).json({ success: true, data: newVideo });
  } catch (error) {
    console.error('Working video creation error:', error);
    res.status(500).json({ success: false, message: 'Failed to create video', error: error.message, stack: error.stack });
  }
});

// Teacher video creation using EXACT admin logic - visible to ALL students
app.post('/api/teacher-videos-admin-style', async (req, res) => {
  try {
    console.log('=== TEACHER VIDEO EXACT ADMIN STYLE ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    console.log('Token:', token);
    
    // Verify token and get user info
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded token:', decoded);
    
    if (decoded.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }
    
    const teacherId = decoded.userId;
    console.log('Teacher ID from token:', teacherId);
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body;
    
    console.log('Parsed data:', { title, description, subject, duration, videoUrl, difficulty });
    
    // Validate required fields
    if (!title || !subject || !duration) {
      console.error('Missing required fields:', { title, subject, duration });
      return res.status(400).json({ message: 'Missing required fields: title, subject, duration' });
    }
    
    // Use EXACT same logic as admin video creation - teachers act as admins
    const videoData = {
      title,
      description: description || '',
      videoUrl: videoUrl || '',
      thumbnailUrl: '', // Empty like admin
      duration: parseInt(duration), // NO conversion - exact like admin
      subjectId: subject,
      difficulty: difficulty || 'beginner',
      isPublished: true, // Make visible to ALL students
      adminId: new mongoose.Types.ObjectId(teacherId), // Use actual teacher ID as adminId
      createdBy: new mongoose.Types.ObjectId(teacherId) // Also set createdBy
    };
    
    console.log('Video data to save:', videoData);
    
    const newVideo = new Video(videoData);
    
    await newVideo.save();
    console.log('Teacher video created successfully:', newVideo._id);
    
    res.status(201).json(newVideo); // Exact same response as admin
  } catch (error) {
    console.error('Teacher video creation error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Failed to create video', error: error.message }); // Include error details
  }
});

// Teacher assessment creation using EXACT admin logic - visible to ALL students
app.post('/api/teacher-assessments-admin-style', async (req, res) => {
  try {
    console.log('=== TEACHER ASSESSMENT EXACT ADMIN STYLE ===');
    console.log('Body:', req.body);
    
    const { title, description, questions, subject, duration, difficulty } = req.body;
    
    // Convert single subject to subjectIds array (like admin)
    const subjectIds = Array.isArray(subject) ? subject : [subject];
    
    // Calculate total points (exact like admin)
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    
    // Use EXACT same logic as admin assessment creation
    const newAssessment = new Assessment({
      title,
      description,
      questions,
      subjectIds,
      difficulty: difficulty || 'beginner',
      duration: parseInt(duration),
      totalPoints,
      isPublished: true, // Make visible to ALL students
      adminId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011') // Use a default adminId
    });
    
    await newAssessment.save();
    console.log('Teacher assessment created successfully:', newAssessment._id);
    
    res.status(201).json(newAssessment); // Exact same response as admin
  } catch (error) {
    console.error('Teacher assessment creation error:', error);
    res.status(500).json({ message: 'Failed to create assessment' }); // Exact same error response
  }
});

// Super simple test endpoint to isolate video creation issue
app.post('/api/test-video-simple', async (req, res) => {
  try {
    console.log('=== SUPER SIMPLE VIDEO TEST ===');
    console.log('Body:', req.body);
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body || {};
    
    // Normalize inputs
    const normalizedTitle = (title || '').trim() || 'Untitled Video';
    const normalizedDescription = (description || '').trim();
    const normalizedSubject = (subject || '').toString().trim() || 'general';
    const minutes = Number.isFinite(Number(duration)) ? Number(duration) : 1;
    const durationSeconds = Math.max(1, Math.floor(minutes)) * 60; // schema expects seconds
    const normalizedUrl = (videoUrl || '').toString().trim();
    const normalizedDifficulty = (difficulty || 'beginner').toLowerCase();

    // Create video with safe defaults to avoid validation errors
    const testVideo = new Video({
      title: normalizedTitle,
      description: normalizedDescription,
      videoUrl: normalizedUrl,
      thumbnailUrl: '',
      duration: durationSeconds,
      subjectId: normalizedSubject,
      difficulty: ['beginner','intermediate','advanced'].includes(normalizedDifficulty) ? normalizedDifficulty : 'beginner',
      isPublished: true,
      adminId: new mongoose.Types.ObjectId(), // Generate new valid ObjectId
      createdBy: new mongoose.Types.ObjectId(), // Add required createdBy field
      youtubeUrl: normalizedUrl,
      isYouTubeVideo: !!normalizedUrl
    });
    
    await testVideo.save();
    console.log('Test video created successfully:', testVideo._id);
    
    res.status(201).json({ success: true, message: 'Test video created', data: testVideo });
  } catch (error) {
    console.error('Test video error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SUPER SIMPLE video creation - guaranteed to work
app.post('/api/super-simple-video', async (req, res) => {
  try {
    console.log('=== SUPER SIMPLE VIDEO CREATION ===');
    console.log('Body:', req.body);
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body || {};
    
    // Create minimal video with all required fields
    const video = new Video({
      title: title || 'Test Video',
      description: description || '',
      videoUrl: videoUrl || '',
      thumbnailUrl: '',
      duration: 60, // Fixed duration
      subjectId: subject || 'general',
      difficulty: difficulty === 'medium' ? 'intermediate' : (difficulty || 'beginner'),
      isPublished: true,
      adminId: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId(),
      youtubeUrl: videoUrl || '',
      isYouTubeVideo: !!videoUrl
    });
    
    await video.save();
    console.log('SUPER SIMPLE video created:', video._id);
    
    res.status(201).json({ success: true, data: video });
  } catch (error) {
    console.error('SUPER SIMPLE video error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Working assessment creation endpoint
app.post('/api/create-assessment', async (req, res) => {
  try {
    console.log('=== ASSESSMENT CREATION ===');
    console.log('Body:', req.body);
    
    const { title, description, subject, difficulty, duration, totalMarks, driveLink, isDriveQuiz } = req.body || {};
    
    // Create assessment with minimal required fields
    const assessment = new Assessment({
      title: title || 'Untitled Assessment',
      description: description || '',
      subjectIds: [subject || 'general'],
      questions: [], // Empty array as required
      duration: parseInt(duration) || 30,
      difficulty: difficulty || 'beginner',
      totalPoints: parseInt(totalMarks) || 10,
      driveLink: driveLink || '',
      isDriveQuiz: !!isDriveQuiz,
      isPublished: true,
      adminId: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId()
    });
    
    await assessment.save();
    console.log('Assessment created successfully:', assessment._id);
    
    res.status(201).json(assessment);
  } catch (error) {
    console.error('Assessment creation error:', error);
    res.status(500).json({ message: 'Failed to create assessment', error: error.message });
  }
});

// Teacher assessment creation endpoint
app.post('/api/teacher/assessments', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, jwtSecret);
    
    const teacherId = decoded.userId || decoded.id || decoded._id;
    if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher identity in token' });
    }
    
    const teacherDoc = await Teacher.findById(teacherId).select('_id adminId');
    if (!teacherDoc) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    const { title, description, subject, questions, timeLimit, difficulty, link } = req.body || {};
    
    if (!title || !subject || !questions) {
      return res.status(400).json({ success: false, message: 'Missing required fields: title, subject, questions' });
    }
    
    const newAssessment = new Assessment({
      title: String(title).trim(),
      description: (description || '').trim(),
      subjectIds: [String(subject).trim()], // Assessment model uses subjectIds array
      questions: [], // Empty array for now, questions can be added later
      duration: parseInt(timeLimit) || 30, // Assessment model uses duration, not timeLimit
      difficulty: (difficulty || 'medium').toLowerCase(),
      driveLink: (link || '').trim(), // Use driveLink field from model
      isDriveQuiz: !!link, // Set to true if link is provided
      isPublished: true,
      createdBy: teacherDoc._id,
      adminId: teacherDoc.adminId || teacherDoc._id,
      totalPoints: parseInt(questions) || 10
    });
    
    const validationError = newAssessment.validateSync();
    if (validationError) {
      return res.status(400).json({ success: false, message: 'Validation failed', error: validationError.message, details: validationError.errors });
    }
    
    await newAssessment.save();
    return res.status(201).json({ success: true, data: newAssessment });
  } catch (error) {
    console.error('Teacher assessment creation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create assessment', error: error.message });
  }
});

// Delete video endpoint for teachers
app.delete('/api/videos/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, jwtSecret);
    
    const teacherId = decoded.userId || decoded.id || decoded._id;
    if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher identity' });
    }
    
    const videoId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID' });
    }
    
    // Find and delete video (only if created by this teacher)
    const video = await Video.findOneAndDelete({
      _id: videoId,
      createdBy: teacherId
    });
    
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found or not authorized to delete' });
    }
    
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete video', error: error.message });
  }
});

// Teacher video creation endpoint - ensures videos persist on teacher dashboard
app.post('/api/teacher/videos', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, jwtSecret);

    // Resolve teacher
    const teacherId = decoded.userId || decoded.id || decoded._id;
    if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher identity in token' });
    }
    const teacherDoc = await Teacher.findById(teacherId).select('_id adminId');
    if (!teacherDoc) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const { title, description, subject, duration, videoUrl, difficulty } = req.body || {};
    if (!title || !subject || (!duration && duration !== 0)) {
      return res.status(400).json({ success: false, message: 'Missing required fields: title, subject, duration' });
    }

    // Duration comes in minutes from UI; convert to seconds for schema
    const minutes = Number.isFinite(Number(duration)) ? Number(duration) : 1;
    const durationSeconds = Math.max(1, Math.floor(minutes)) * 60;

    const newVideo = new Video({
      title: String(title).trim(),
      description: (description || '').trim(),
      videoUrl: (videoUrl || '').trim(),
      youtubeUrl: (videoUrl || '').trim(),
      isYouTubeVideo: !!videoUrl,
      thumbnailUrl: '',
      duration: durationSeconds,
      subjectId: String(subject).trim(),
      difficulty: (difficulty || 'beginner').toLowerCase(),
      isPublished: true,
      createdBy: teacherDoc._id,
      adminId: teacherDoc.adminId || teacherDoc._id
    });

    const validationError = newVideo.validateSync();
    if (validationError) {
      return res.status(400).json({ success: false, message: 'Validation failed', error: validationError.message, details: validationError.errors });
    }

    await newVideo.save();
    return res.status(201).json({ success: true, data: newVideo });
  } catch (error) {
    console.error('Teacher /api/teacher/videos error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create video', error: error.message });
  }
});

// Emergency video creation endpoint - no auth required for testing
app.post('/api/emergency-video-create', async (req, res) => {
  try {
    console.log('=== EMERGENCY VIDEO CREATION ===');
    console.log('Body:', req.body);
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body || {};
    
    // Validate required fields
    if (!title || !subject || (!duration && duration !== 0)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: title, subject, duration' 
      });
    }
    
    // Create a valid ObjectId for adminId (using current timestamp)
    const adminId = new mongoose.Types.ObjectId();
    
    const minutes = Number.isFinite(Number(duration)) ? Number(duration) : 1;
    const durationSeconds = Math.max(1, Math.floor(minutes)) * 60;

    const videoData = {
      title: (title || 'Untitled Video').trim(),
      description: (description || '').trim(),
      videoUrl: (videoUrl || '').trim(),
      thumbnailUrl: '',
      duration: durationSeconds,
      subjectId: (subject || 'general').toString().trim(),
      difficulty: (difficulty || 'beginner').toLowerCase(),
      isPublished: true,
      adminId: adminId,
      createdBy: adminId, // Set createdBy to adminId for emergency endpoint
      youtubeUrl: (videoUrl || '').trim(),
      isYouTubeVideo: !!videoUrl
    };
    
    console.log('Creating video with data:', videoData);
    
    const newVideo = new Video(videoData);
    const validationError = newVideo.validateSync();
    if (validationError) {
      console.error('Emergency creation validation error:', validationError);
      return res.status(400).json({ success: false, message: 'Validation failed', error: validationError.message, details: validationError.errors });
    }
    await newVideo.save();
    
    console.log('Emergency video created successfully:', newVideo._id);
    
    res.json({ 
      success: true, 
      message: 'Video created successfully',
      data: newVideo 
    });
    
  } catch (error) {
    console.error('Emergency video creation error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create video', 
      error: error.message,
      stack: error.stack
    });
  }
});

// Lesson Plan Generation endpoint
app.post('/api/lesson-plan/generate', async (req, res) => {
  try {
    const { subject, topic, gradeLevel, duration } = req.body;
    
    if (!subject || !topic || !gradeLevel) {
      return res.status(400).json({ 
        success: false, 
        message: 'Subject, topic, and grade level are required' 
      });
    }

    // Use the dedicated generateLessonPlan function instead of chat service
    const geminiServiceModule = await import('./services/gemini-service.js');
    const lessonPlan = await geminiServiceModule.generateLessonPlan(subject, topic, gradeLevel, duration || 90);
    
    res.json({
      success: true,
      lessonPlan: lessonPlan
    });
    
  } catch (error) {
    console.error('Lesson plan generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate lesson plan',
      error: error.message 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server accessible at http://0.0.0.0:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
});
