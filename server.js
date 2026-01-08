import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from './config/database.js';
import superAdminRoutes from './routes/superAdmin.js';
import adminRoutes from './routes/admin.js';
import { verifyToken, verifySuperAdmin } from './middleware/auth.js';
import User from './models/User.js';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables - explicitly specify path
dotenv.config({ path: join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - Allow multiple origins including custom domain
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://aslilearn.ai',
  'https://www.aslilearn.ai',
  'https://asli-frontend.vercel.app',
  'http://localhost:5173'
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow custom domain
    if (origin && origin.match(/^https:\/\/(www\.)?aslilearn\.ai$/)) {
      return callback(null, true);
    }
    
    // Allow Vercel domains
    if (origin && origin.match(/^https:\/\/asli-frontend.*\.vercel\.app$/)) {
      return callback(null, true);
    }
    
    // Allow localhost during development
    if (origin && origin.match(/^http:\/\/localhost:(5173|4173|4174)$/)) {
      return callback(null, true);
    }
    
    callback(null, true); // Allow all for now, can restrict later
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Connect to Database
connectDB();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Super Admin Backend',
    version: '1.0.0'
  });
});

// Auth login endpoint (Handles Super Admin and regular admin logins)
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('=== LOGIN REQUEST ===');
    console.log('Request body:', req.body);
    console.log('Request origin:', req.headers.origin);
    console.log('MongoDB connection state:', mongoose.connection.readyState);
    
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      console.error('❌ MongoDB not connected. Connection state:', mongoose.connection.readyState);
      return res.status(503).json({ 
        success: false,
        message: 'Database not connected. Please try again.' 
      });
    }
    
    const { email, password } = req.body;
    
    if (!email || !password) {
      console.error('Missing email or password');
      return res.status(400).json({ 
        success: false,
        message: 'Email and password are required' 
      });
    }
    
    console.log('Login attempt:', { email: email.toLowerCase(), timestamp: new Date().toISOString() });
    
    // Check for Super Admin credentials first
    const superAdminCredentials = [
      { email: 'amenityforge@gmail.com', password: 'Amenity', fullName: 'Super Admin' }
    ];
    
    const validCredential = superAdminCredentials.find(
      cred => cred.email.toLowerCase() === email.toLowerCase() && cred.password === password
    );
    
    if (validCredential) {
      console.log('Super Admin login detected');
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
      
      return res.json({
        success: true,
        token,
        user: {
          id: 'super-admin-001',
          email: validCredential.email,
          fullName: validCredential.fullName,
          role: 'super-admin'
        }
      });
    }
    
    // Check for regular admin login in database
    console.log('Looking for user with email:', email.toLowerCase());
    let user;
    try {
      user = await User.findOne({ email: email.toLowerCase() });
    } catch (dbError) {
      console.error('❌ Database query error:', dbError);
      return res.status(500).json({ 
        success: false,
        message: 'Database error. Please try again.',
        error: process.env.NODE_ENV === 'development' ? dbError.message : undefined
      });
    }
    
    if (!user) {
      console.log('User not found in database');
      return res.status(401).json({ 
        success: false,
        message: 'User not found' 
      });
    }
    
    console.log('User found:', { email: user.email, isActive: user.isActive, role: user.role, hasPassword: !!user.password });
    
    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ 
        success: false,
        message: 'Account is deactivated' 
      });
    }
    
    // Check if user has a password
    if (!user.password) {
      console.error('User has no password set');
      return res.status(500).json({ 
        success: false,
        message: 'Account configuration error. Please contact administrator.' 
      });
    }
    
    // Verify password
    console.log('Verifying password for user:', user.email);
    let isPasswordValid;
    try {
      isPasswordValid = await bcrypt.compare(password, user.password);
    } catch (bcryptError) {
      console.error('❌ Password comparison error:', bcryptError);
      return res.status(500).json({ 
        success: false,
        message: 'Authentication error. Please try again.' 
      });
    }
    console.log('Password valid:', isPasswordValid);
    
    if (!isPasswordValid) {
      console.log('Password verification failed');
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials' 
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    // Update last login
    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });
    
    console.log(`${user.role} login successful:`, { email: user.email, role: user.role });
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    res.status(500).json({ 
      success: false,
      message: 'Server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Auth verification endpoint
app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Get user from database
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
});

// Super Admin Routes
app.use('/api/super-admin', superAdminRoutes);

// Protected routes (require authentication)
app.use('/api/super-admin/protected', verifyToken, verifySuperAdmin, superAdminRoutes);

// Admin Routes
app.use('/api/admin', adminRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }
  
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format'
    });
  }
  
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Duplicate entry found'
    });
  }
  
  res.status(500).json({
    success: false,
    message: 'Internal Server Error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('🚀 Super Admin Backend Server Started!');
  console.log(`📡 Server running on port ${PORT}`);
  
  // Use local environment variables first, not Railway
  const baseUrl = process.env.BASE_URL || 
                  process.env.API_BASE_URL || 
                  `http://localhost:${PORT}`;
  
  console.log(`🌐 API Base URL: ${baseUrl}`);
  console.log(`🔐 Super Admin Login: ${baseUrl}/api/super-admin/login`);
  console.log(`📊 Dashboard Stats: ${baseUrl}/api/super-admin/stats`);
  console.log('');
  console.log('🔑 Super Admin Credentials:');
  console.log('   Email: amenityforge@gmail.com');
  console.log('   Password: Amenity');
  console.log('');
  
  const frontendUrl = process.env.FRONTEND_URL || 
                      process.env.CLIENT_URL || 
                      'http://localhost:5173';
  console.log(`📱 Frontend should connect to: ${frontendUrl}`);
  console.log('✅ Ready to accept requests!');
});

export default app;
