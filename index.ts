import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { users, videos, learningPaths, assessments } from './schema';

/*
 * DEPRECATED Postgres/Passport prototype. Production API is backend/index.js (Mongo).
 * Refusing to listen unless explicitly enabled.
 */
if (process.env.ALLOW_LEGACY_TS_SERVER !== '1') {
  console.error(
    '[DEPRECATED] backend/index.ts is disabled. Use `node index.js`. Set ALLOW_LEGACY_TS_SERVER=1 only for emergency debugging.',
  );
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Database connection
const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/cognilearn';
const client = postgres(connectionString);
const db = drizzle(client);

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || (process.env.NODE_ENV === 'production' ? 'https://asli-frontend.vercel.app' : 'http://localhost:5173'),
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
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
    const user = await db.select().from(users).where(eq(users.email, email)).limit(1);
    
    if (user.length === 0) {
      return done(null, false, { message: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user[0].password);
    if (!isValidPassword) {
      return done(null, false, { message: 'Invalid credentials' });
    }

    return done(null, user[0]);
  } catch (error) {
    return done(error);
  }
}));

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await db.select().from(users).where(eq(users.id, id)).limit(1);
    done(null, user[0]);
  } catch (error) {
    done(error);
  }
});

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(2),
  role: z.enum(['student', 'admin']).default('student')
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Authentication routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, fullName, role } = registerSchema.parse(req.body);
    
    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const newUser = await db.insert(users).values({
      email,
      password: hashedPassword,
      fullName,
      role,
      createdAt: new Date()
    }).returning();

    res.status(201).json({ 
      message: 'User created successfully',
      user: { id: newUser[0].id, email: newUser[0].email, fullName: newUser[0].fullName, role: newUser[0].role }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/auth/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return res.status(500).json({ message: 'Internal server error' });
    if (!user) return res.status(401).json({ message: info.message });
    
    req.logIn(user, (err) => {
      if (err) return res.status(500).json({ message: 'Login failed' });
      res.json({ 
        message: 'Login successful',
        user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role }
      });
    });
  })(req, res, next);
});

app.post('/api/auth/logout', (req, res) => {
  // For JWT-based auth, logout is handled client-side by removing the token
  // This endpoint just confirms the logout request
  try {
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
      res.json({ success: true, message: 'Logout successful' });
    }
  } catch (error) {
    console.error('Logout error:', error);
    // Still return success for JWT-based auth since token is removed client-side
    res.json({ success: true, message: 'Logout successful' });
  }
});

app.get('/api/auth/me', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ 
      user: { 
        id: req.user.id, 
        email: req.user.email, 
        fullName: req.user.fullName, 
        role: req.user.role 
      } 
    });
  } else {
    res.status(401).json({ message: 'Not authenticated' });
  }
});

// Public routes
app.get('/api/videos', async (req, res) => {
  try {
    const allVideos = await db.select().from(videos);
    res.json(allVideos);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch videos' });
  }
});

app.get('/api/learning-paths', async (req, res) => {
  try {
    const allPaths = await db.select().from(learningPaths);
    res.json(allPaths);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch learning paths' });
  }
});

app.get('/api/assessments', async (req, res) => {
  try {
    const allAssessments = await db.select().from(assessments);
    res.json(allAssessments);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch assessments' });
  }
});

// Admin routes (protected)
app.use('/api/admin', (req, res, next) => {
  if (!req.isAuthenticated() || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
});

// Admin video management
app.post('/api/admin/videos', async (req, res) => {
  try {
    const { title, description, videoUrl, thumbnailUrl, duration, subjectId, difficulty } = req.body;
    
    const newVideo = await db.insert(videos).values({
      title,
      description,
      videoUrl,
      thumbnailUrl,
      duration,
      subjectId,
      difficulty,
      createdAt: new Date()
    }).returning();

    res.status(201).json(newVideo[0]);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create video' });
  }
});

app.put('/api/admin/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const updatedVideo = await db.update(videos)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(videos.id, id))
      .returning();

    if (updatedVideo.length === 0) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json(updatedVideo[0]);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update video' });
  }
});

app.delete('/api/admin/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedVideo = await db.delete(videos)
      .where(eq(videos.id, id))
      .returning();

    if (deletedVideo.length === 0) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json({ message: 'Video deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete video' });
  }
});

// Admin learning path management
app.post('/api/admin/learning-paths', async (req, res) => {
  try {
    const { title, description, subjectIds, difficulty, estimatedHours } = req.body;
    
    const newPath = await db.insert(learningPaths).values({
      title,
      description,
      subjectIds,
      difficulty,
      estimatedHours,
      createdAt: new Date()
    }).returning();

    res.status(201).json(newPath[0]);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create learning path' });
  }
});

// Admin assessment management
app.post('/api/admin/assessments', async (req, res) => {
  try {
    const { title, description, questions, subjectIds, difficulty, duration } = req.body;
    
    const newAssessment = await db.insert(assessments).values({
      title,
      description,
      questions,
      subjectIds,
      difficulty,
      duration,
      createdAt: new Date()
    }).returning();

    res.status(201).json(newAssessment[0]);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create assessment' });
  }
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

