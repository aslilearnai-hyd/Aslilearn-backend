/**
 * Auth domain handlers (lifted from app.js — behavior preserved).
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {
  setAuthCookie,
  setRefreshCookie,
  clearAuthCookie,
  extractRefreshToken,
} from '../utils/auth-cookie.js';
import { resolveUserDisplayBoard } from '../constants/boards.js';
import {
  isVidyaEnabledForStudents,
  isVidyaEnabledForTeachers,
} from '../utils/vidyaSchoolAccess.js';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';

export async function logout(req, res) {
  // Clear cookies and revoke opaque refresh so body/cookie reuse fails after logout.
  try {
    console.log('📤 Logout request received from:', req.headers.origin || 'unknown');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }

    try {
      const token =
        (typeof req.headers?.authorization === 'string' &&
          req.headers.authorization.startsWith('Bearer ') &&
          req.headers.authorization.slice(7).trim()) ||
        req.cookies?.aslilearn_token ||
        '';
      if (token && process.env.JWT_SECRET) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        req.setAudit?.({
          action: 'auth.logout',
          summary: `Logout: ${decoded.email || decoded.id || 'user'}`,
          actor: {
            id: decoded.userId || decoded.id || null,
            role: decoded.role || null,
            email: decoded.email || null,
            name: decoded.fullName || decoded.name || null,
          },
        });
      } else {
        req.setAudit?.({ action: 'auth.logout', summary: 'Logout' });
      }
    } catch {
      req.setAudit?.({ action: 'auth.logout', summary: 'Logout' });
    }

    const rawRefresh = extractRefreshToken(req);
    if (rawRefresh) {
      try {
        const { revokeRefreshToken } = await import('../utils/auth-tokens.js');
        await revokeRefreshToken(rawRefresh);
      } catch (err) {
        console.warn('Logout refresh revoke skipped:', err?.message || err);
      }
    }

    if (req.logout && typeof req.logout === 'function') {
      return req.logout((err) => {
        if (err) {
          console.error('Logout error:', err);
          return res.status(500).json({ success: false, message: 'Logout failed' });
        }
        clearAuthCookie(res);
        res.json({ success: true, message: 'Logout successful' });
      });
    }

    clearAuthCookie(res);
    return res.json({ success: true, message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    clearAuthCookie(res);
    return res.json({ success: true, message: 'Logout successful' });
  }
}

// Refresh access token (opaque refresh token rotation; body or httpOnly cookie)

export async function refresh(req, res) {
  try {
    const raw = extractRefreshToken(req);
    if (!raw) {
      return res.status(400).json({ success: false, message: 'refreshToken is required' });
    }
    const { rotateRefreshToken, signAccessToken } = await import('../utils/auth-tokens.js');
    const rotated = await rotateRefreshToken(raw, {
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || '',
    });
    if (!rotated) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }
    const accessToken = signAccessToken({
      userId: String(rotated.userId),
      id: String(rotated.userId),
      role: rotated.role,
    });
    setAuthCookie(res, accessToken);
    setRefreshCookie(res, rotated.refreshToken);
    return res.json({
      success: true,
      token: accessToken,
      accessToken,
      refreshToken: rotated.refreshToken,
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '2h',
    });
  } catch (error) {
    console.error('Refresh error:', error);
    return res.status(500).json({ success: false, message: 'Failed to refresh session' });
  }
}

// Forgot password — always generic response (no email enumeration)

export async function forgotPassword(req, res) {
  const generic = {
    success: true,
    message: 'If an account exists for that email, password reset instructions have been issued.',
  };
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return res.json(generic);
    }
    let role = 'student';
    let userId = null;
    const teacher = await Teacher.findOne({ email }).select('_id email');
    if (teacher) {
      role = 'teacher';
      userId = teacher._id;
    } else {
      const user = await User.findOne({ email }).select('_id email role');
      if (user) {
        role = user.role;
        userId = user._id;
      }
    }
    if (userId) {
      const { createPasswordResetToken } = await import('../utils/auth-tokens.js');
      const { resetToken, expiresAt } = await createPasswordResetToken({ email, role, userId });
      // Production: send email via configured mailer. Dev: log token once.
      if (process.env.NODE_ENV !== 'production' || process.env.LOG_PASSWORD_RESET_TOKENS === '1') {
        console.info('[password-reset] token issued', { email, expiresAt: expiresAt.toISOString(), resetToken });
      }
      // Hook for mail provider (optional)
      if (typeof process.env.PASSWORD_RESET_WEBHOOK === 'string' && process.env.PASSWORD_RESET_WEBHOOK) {
        try {
          await fetch(process.env.PASSWORD_RESET_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, resetToken, expiresAt }),
          });
        } catch (mailErr) {
          console.warn('Password reset webhook failed:', mailErr?.message);
        }
      }
    }
    return res.json(generic);
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.json(generic);
  }
}

export async function resetPassword(req, res) {
  try {
    const raw = req.body?.token || req.body?.resetToken;
    const newPassword = String(req.body?.password || req.body?.newPassword || '');
    if (!raw || newPassword.length < 12) {
      return res.status(400).json({
        success: false,
        message: 'Valid reset token and a new password of at least 12 characters are required',
      });
    }
    const { consumePasswordResetToken } = await import('../utils/auth-tokens.js');
    const doc = await consumePasswordResetToken(raw);
    if (!doc) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    if (doc.role === 'teacher') {
      await Teacher.findByIdAndUpdate(doc.userId, { password: hashed });
    } else {
      await User.findByIdAndUpdate(doc.userId, { password: hashed }, { runValidators: false });
    }
    return res.json({ success: true, message: 'Password updated. You can sign in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
}

export async function me(req, res) {
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
    const authId = req.user.userId || req.user.id;
    const { resolveIsAsliPrepExclusive } = await import('../utils/schoolProgram.js');

    // Teachers authenticate against the Teacher collection (JWT id = Teacher._id), not User.
    if (req.user.role === 'teacher') {
      const teacher = await Teacher.findById(authId).populate('subjects', 'name');
      if (teacher) {
        let teacherAdmin = null;
        if (teacher.adminId) {
          teacherAdmin = await User.findById(teacher.adminId)
            .select('board curriculumBoard isAsliPrepExclusive iitCategories schoolName schoolLogo vidyaEnabledForTeachers vidyaEnabledForStudents')
            .lean();
        }
        const teacherCtx = { board: teacher.board, isAsliPrepExclusive: false };
        const isAsliPrepExclusive = resolveIsAsliPrepExclusive(teacherCtx, teacherAdmin);
        const displayBoard = resolveUserDisplayBoard(teacherCtx, teacherAdmin);
        const curriculumBoard =
          teacherAdmin?.curriculumBoard ||
          (teacherAdmin?.board && teacherAdmin.board !== 'ASLI_EXCLUSIVE_SCHOOLS'
            ? teacherAdmin.board
            : '') ||
          (teacher.board && teacher.board !== 'ASLI_EXCLUSIVE_SCHOOLS' ? teacher.board : '') ||
          (displayBoard && displayBoard !== 'ASLI_EXCLUSIVE_SCHOOLS' ? displayBoard : '') ||
          'CBSE';
        const iitCategories = Array.isArray(teacherAdmin?.iitCategories)
          ? teacherAdmin.iitCategories
          : [];

        const teacherUserData = {
          id: teacher._id,
          _id: teacher._id,
          email: teacher.email,
          fullName: teacher.fullName,
          role: 'teacher',
          classNumber: null,
          section: '',
          phone: teacher.phone || '',
          board: displayBoard || teacher.board || '',
          curriculumBoard,
          iitCategories,
          schoolName: teacherAdmin?.schoolName || teacher.school || '',
          schoolLogo: teacherAdmin?.schoolLogo || '',
          profilePhoto: '',
          assignedSubjects: [],
          assignedClass: null,
          studyStreak: { current: 0, longest: 0, lastActiveDate: '' },
          isAsliPrepExclusive,
          subjects: teacher.subjects || [],
          vidyaEnabled: isVidyaEnabledForTeachers(teacherAdmin),
          schoolName: teacherAdmin?.schoolName || teacher.school || teacher.schoolName || '',
          phone: teacher.phone || '',
          classNumber: teacher.classNumber || '',
          interestedCourses: teacher.interestedCourses || [],
          interestedSubjects: teacher.interestedSubjects || [],
          iitCategories: Array.isArray(teacher.iitCategories) && teacher.iitCategories.length
            ? teacher.iitCategories
            : iitCategories,
          isIndividualAccount: Boolean(teacher.isIndividualAccount),
          ...((await import('../utils/individualAccount.js')).resolveIndividualAccess(teacher)),
        };
        if (teacherAdmin) {
          teacherUserData.assignedAdmin = {
            board: teacherAdmin.board,
            curriculumBoard: teacherAdmin.curriculumBoard,
            isAsliPrepExclusive: teacherAdmin.isAsliPrepExclusive === true,
            iitCategories,
            schoolName: teacherAdmin.schoolName || '',
            schoolLogo: teacherAdmin.schoolLogo || '',
          };
        }
        return res.json({ user: teacherUserData });
      }
    }

    const user = await User.findById(authId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    await user.populate('assignedSubjects', 'name');
    await user.populate('assignedClass', 'classNumber section assignedSubjects');
    if (user.role === 'student' && user.assignedAdmin) {
      await user.populate(
        'assignedAdmin',
        'board curriculumBoard isAsliPrepExclusive iitCategories schoolName schoolLogo vidyaEnabledForTeachers vidyaEnabledForStudents'
      );
    }
    let teacherAdmin = null;
    if (user.role === 'teacher') {
      const teacher = await Teacher.findById(user._id).select('adminId').lean();
      if (teacher?.adminId) {
        teacherAdmin = await User.findById(teacher.adminId)
          .select('board curriculumBoard isAsliPrepExclusive iitCategories schoolName schoolLogo vidyaEnabledForTeachers vidyaEnabledForStudents')
          .lean();
      }
    }
    const displayBoard = resolveUserDisplayBoard(user, user.assignedAdmin || teacherAdmin);
    const isAsliPrepExclusive = resolveIsAsliPrepExclusive(
      user,
      user.role === 'student' ? user.assignedAdmin : teacherAdmin,
    );
    const resolvedIitCategories =
      Array.isArray(user.iitCategories) && user.iitCategories.length > 0
        ? user.iitCategories
        : Array.isArray(user.assignedAdmin?.iitCategories)
          ? user.assignedAdmin.iitCategories
          : Array.isArray(teacherAdmin?.iitCategories)
            ? teacherAdmin.iitCategories
            : [];
    const userData = {
      id: user._id,
      _id: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      classNumber:
        (user.classNumber != null &&
          String(user.classNumber).trim() !== '' &&
          String(user.classNumber).trim() !== 'Unassigned'
          ? String(user.classNumber).trim()
          : '') ||
        (user.assignedClass?.classNumber != null &&
        String(user.assignedClass.classNumber).trim() !== ''
          ? String(user.assignedClass.classNumber).trim()
          : ''),
      section:
        user.assignedClass?.section != null && String(user.assignedClass.section).trim() !== ''
          ? String(user.assignedClass.section).trim()
          : '',
      phone: user.phone || '',
      age: user.age ?? 18,
      educationStream: user.educationStream || '',
      targetExam: user.targetExam || '',
      board: displayBoard || user.board || '',
      curriculumBoard:
        user.curriculumBoard ||
        user.assignedAdmin?.curriculumBoard ||
        (user.role === 'teacher' ? teacherAdmin?.curriculumBoard : null) ||
        (displayBoard && displayBoard !== 'ASLI_EXCLUSIVE_SCHOOLS' ? displayBoard : '') ||
        'CBSE',
      iitCategories: resolvedIitCategories,
      schoolName:
        user.schoolName ||
        user.assignedAdmin?.schoolName ||
        (user.role === 'teacher' ? teacherAdmin?.schoolName : '') ||
        '',
      schoolLogo:
        user.schoolLogo ||
        user.assignedAdmin?.schoolLogo ||
        (user.role === 'teacher' ? teacherAdmin?.schoolLogo : '') ||
        '',
      profilePhoto: user.profilePhoto || '',
      assignedSubjects: user.assignedSubjects || [],
      assignedClass: user.assignedClass || null,
      studyStreak: user.studyStreak || { current: 0, longest: 0, lastActiveDate: '' },
      isAsliPrepExclusive,
      interestedCourses: user.interestedCourses || [],
      interestedSubjects: user.interestedSubjects || [],
      isIndividualAccount: Boolean(user.isIndividualAccount),
      ...((await import('../utils/individualAccount.js')).resolveIndividualAccess(user)),
    };
    if (user.role === 'student') {
      userData.vidyaEnabled = isVidyaEnabledForStudents(user.assignedAdmin);
      if (user.assignedAdmin) {
        userData.assignedAdmin = {
          _id: user.assignedAdmin._id,
          board: user.assignedAdmin.board,
          curriculumBoard: user.assignedAdmin.curriculumBoard,
          isAsliPrepExclusive: user.assignedAdmin.isAsliPrepExclusive === true,
          iitCategories: Array.isArray(user.assignedAdmin.iitCategories)
            ? user.assignedAdmin.iitCategories
            : [],
          schoolName: user.assignedAdmin.schoolName || '',
          schoolLogo: user.assignedAdmin.schoolLogo || '',
        };
      }
    }
    if (req.user.role === 'admin') {
      userData.schoolName = user.schoolName || '';
      userData.schoolLogo = user.schoolLogo || '';
    }
    if (req.user.role === 'teacher') {
      const teacher = await Teacher.findById(authId).populate('subjects');
      if (teacher) userData.subjects = teacher.subjects || [];
      if (teacherAdmin) {
        userData.assignedAdmin = {
          board: teacherAdmin.board,
          curriculumBoard: teacherAdmin.curriculumBoard,
          isAsliPrepExclusive: teacherAdmin.isAsliPrepExclusive === true,
          iitCategories: Array.isArray(teacherAdmin.iitCategories)
            ? teacherAdmin.iitCategories
            : [],
          schoolName: teacherAdmin.schoolName || '',
          schoolLogo: teacherAdmin.schoolLogo || '',
        };
      }
      userData.vidyaEnabled = isVidyaEnabledForTeachers(teacherAdmin);
    }
    res.json({ user: userData });
  } catch (error) {
    console.error('Failed to fetch user data:', error);
    res.status(500).json({ message: 'Failed to fetch user data' });
  }
}

export async function trialLoginQuizzes(req, res) {
  try {
    if (req.user?.role !== 'student') {
      return res.json({ success: true, data: [] });
    }
    const authId = req.user.userId || req.user.id;
    const student = await User.findById(authId);
    if (!student) {
      return res.json({ success: true, data: [] });
    }
    const { isTrialQuizAudience } = await import('../utils/individualAccount.js');
    if (!isTrialQuizAudience(student)) {
      return res.json({ success: true, data: [] });
    }

    const IQRankQuiz = (await import('../models/IQRankQuiz.js')).default;
    const IQRankQuizResult = (await import('../models/IQRankQuizResult.js')).default;

    const quizzes = await IQRankQuiz.find({
      isActive: true,
      trialOnly: true,
      promptOnLogin: true,
    })
      .populate('subject', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const results = await IQRankQuizResult.find({
      userId: student._id,
      quizId: { $in: quizzes.map((q) => q._id) },
    })
      .select('quizId')
      .lean();
    const done = new Set(results.map((r) => String(r.quizId)));
    const pending = quizzes.filter((q) => !done.has(String(q._id)));

    res.json({ success: true, data: pending });
  } catch (error) {
    console.error('trial-login-quizzes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch trial login quizzes' });
  }
}

// Update current user's profile

export async function patchUser(req, res) {
  try {
    // For security, always update the authenticated user, ignore path param
    const userId = req.user.userId || req.user.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const allowedFields = ['fullName', 'email', 'age', 'educationStream', 'targetExam', 'phone', 'profilePhoto'];
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
}

export async function register(req, res) {
  try {
    const {
      normalizeIndividualSignupBody,
      resolveIndividualAccess,
    } = await import('../utils/individualAccount.js');
    const parsed = normalizeIndividualSignupBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }
    const d = parsed.data;

    const existingUser = await User.findOne({ email: d.email });
    if (existingUser) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }
    const existingTeacher = await Teacher.findOne({ email: d.email });
    if (existingTeacher) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(d.password, 12);
    const trialFields = {
      isIndividualAccount: true,
      schoolName: d.schoolName,
      phone: d.phone,
      classNumber: d.classNumber || 'Unassigned',
      curriculumBoard: d.curriculumBoard,
      board: d.isAsliPrepExclusive ? 'ASLI_EXCLUSIVE_SCHOOLS' : d.curriculumBoard,
      isAsliPrepExclusive: d.isAsliPrepExclusive,
      iitCategories: d.iitCategories,
      interestedCourses: d.interestedCourses,
      interestedSubjects: d.interestedSubjects,
      accountSource: d.accountSource || 'web_register',
      subscriptionStatus: 'trial',
      trialStartsAt: d.trialStartsAt,
      trialEndsAt: d.trialEndsAt,
    };

    if (d.role === 'teacher') {
      const teacher = new Teacher({
        email: d.email,
        password: hashedPassword,
        fullName: d.fullName,
        phone: d.phone,
        school: d.schoolName,
        schoolName: d.schoolName,
        board: trialFields.board,
        curriculumBoard: d.curriculumBoard,
        classNumber: d.classNumber,
        iitCategories: d.iitCategories,
        interestedCourses: d.interestedCourses,
        interestedSubjects: d.interestedSubjects,
        accountSource: trialFields.accountSource,
        isIndividualAccount: true,
        subscriptionStatus: 'trial',
        trialStartsAt: d.trialStartsAt,
        trialEndsAt: d.trialEndsAt,
        adminId: null,
        isActive: true,
        role: 'teacher',
      });
      await teacher.save();

      const access = resolveIndividualAccess(teacher);
      return res.status(201).json({
        message: `Account created. Your ${d.trialDays}-day free trial has started.`,
        user: {
          id: teacher._id,
          email: teacher.email,
          fullName: teacher.fullName,
          role: 'teacher',
          schoolName: teacher.schoolName,
          phone: teacher.phone,
          classNumber: teacher.classNumber,
          interestedCourses: teacher.interestedCourses,
          interestedSubjects: teacher.interestedSubjects,
          iitCategories: teacher.iitCategories,
          ...access,
        },
      });
    }

    const newUser = new User({
      email: d.email,
      password: hashedPassword,
      fullName: d.fullName,
      role: 'student',
      assignedAdmin: null,
      ...trialFields,
      isActive: true,
    });
    await newUser.save();

    const access = resolveIndividualAccess(newUser);
    return res.status(201).json({
      message: `Account created. Your ${d.trialDays}-day free trial has started.`,
      user: {
        id: newUser._id,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        schoolName: newUser.schoolName,
        phone: newUser.phone,
        classNumber: newUser.classNumber,
        interestedCourses: newUser.interestedCourses,
        interestedSubjects: newUser.interestedSubjects,
        iitCategories: newUser.iitCategories,
        ...access,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

// Handle CORS preflight requests

export async function login(req, res) {
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      console.error('MongoDB not connected. Connection state:', mongoose.connection.readyState);
      return res.status(503).json({ message: 'Database not connected. Please try again.' });
    }
    
    // Check if body is parsed
    if (!req.body) {
      return res.status(400).json({ message: 'Invalid request body' });
    }
    
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '').trim();
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    
    // Authenticate against DB only (no hardcoded credential backdoors)
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
        const { resolveIndividualAccess } = await import('../utils/individualAccount.js');
        const teacherAccess = resolveIndividualAccess(teacher);
        if (teacher.isIndividualAccount && teacherAccess.paymentRequired && teacher.subscriptionStatus === 'trial') {
          teacher.subscriptionStatus = 'expired';
        }
        await teacher.save();
        
        const token = jwt.sign(
          { 
            userId: teacher._id.toString(),
            id: teacher._id.toString(),
            email: teacher.email, 
            role: 'teacher' 
          }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '2h', algorithm: 'HS256' });
        setAuthCookie(res, token);

        let refreshToken = null;
        try {
          const { issueRefreshToken } = await import('../utils/auth-tokens.js');
          const issued = await issueRefreshToken({
            userId: teacher._id,
            role: 'teacher',
            userAgent: req.headers['user-agent'] || '',
            ip: req.ip || '',
          });
          refreshToken = issued.refreshToken;
          setRefreshCookie(res, refreshToken);
        } catch (refreshErr) {
          console.warn('Refresh token issue skipped:', refreshErr?.message);
        }

        req.setAudit?.({
          action: 'auth.login',
          summary: `Teacher login: ${teacher.email}`,
          actor: {
            id: teacher._id.toString(),
            role: 'teacher',
            email: teacher.email,
            name: teacher.fullName || null,
          },
          meta: { loginRole: 'teacher' },
        });

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
          accessToken: token,
          refreshToken,
          expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '2h',
          user: {
            id: teacher._id.toString(),
            _id: teacher._id.toString(),
            email: teacher.email,
            fullName: teacher.fullName,
            role: 'teacher',
            subjects: subjects,
            schoolName: teacher.schoolName || teacher.school || '',
            phone: teacher.phone || '',
            classNumber: teacher.classNumber || '',
            interestedCourses: teacher.interestedCourses || [],
            interestedSubjects: teacher.interestedSubjects || [],
            iitCategories: teacher.iitCategories || [],
            isIndividualAccount: Boolean(teacher.isIndividualAccount),
            ...teacherAccess,
          }
        });
      }
    }

    // Regular user authentication
    let user = null;
    try {
      user = await User.findOne({ email: email.toLowerCase() });
    } catch (userError) {
      console.error('Error querying User model:', userError);
      throw userError; // Re-throw if User query fails
    }
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials'
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password || '');
    
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials'
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

    const { resolveIndividualAccess } = await import('../utils/individualAccount.js');
    const access = resolveIndividualAccess(user);
    if (user.isIndividualAccount && access.paymentRequired && user.subscriptionStatus === 'trial') {
      await User.findByIdAndUpdate(
        user._id,
        { subscriptionStatus: 'expired' },
        { runValidators: false }
      );
    }

    const token = jwt.sign(
      { 
        userId: user._id.toString(),
        id: user._id.toString(),
        email: user.email, 
        role: user.role 
      }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '2h', algorithm: 'HS256' });
    setAuthCookie(res, token);

    let refreshToken = null;
    try {
      const { issueRefreshToken } = await import('../utils/auth-tokens.js');
      const issued = await issueRefreshToken({
        userId: user._id,
        role: user.role,
        userAgent: req.headers['user-agent'] || '',
        ip: req.ip || '',
      });
      refreshToken = issued.refreshToken;
      setRefreshCookie(res, refreshToken);
    } catch (refreshErr) {
      console.warn('Refresh token issue skipped:', refreshErr?.message);
    }

    req.setAudit?.({
      action: 'auth.login',
      summary: `${user.role} login: ${user.email}`,
      actor: {
        id: user._id.toString(),
        role: user.role,
        email: user.email,
        name: user.fullName || null,
      },
      meta: { loginRole: user.role },
    });

    res.json({ 
      success: true,
      token,
      accessToken: token,
      refreshToken,
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '2h',
      user: {
        id: user._id.toString(),
        _id: user._id.toString(),
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        schoolName: user.schoolName || '',
        phone: user.phone || '',
        classNumber: user.classNumber || '',
        interestedCourses: user.interestedCourses || [],
        interestedSubjects: user.interestedSubjects || [],
        iitCategories: user.iitCategories || [],
        isIndividualAccount: Boolean(user.isIndividualAccount),
        ...access,
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
}

