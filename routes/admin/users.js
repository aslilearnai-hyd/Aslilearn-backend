import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import {
  generateProvisionalPassword,
  resolveTenantAdminId,
  SAFE_USER_UPDATE_FIELDS,
} from '../../utils/secure-tenant.js';

const router = express.Router();

router.get('/users', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
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

router.post('/users', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
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
    if (!password || String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password is required and must be at least 8 characters',
      });
    }
    const hashedPassword = await bcrypt.hash(password, 12);

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

router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantAdminId = resolveTenantAdminId(req);
    if (!tenantAdminId && req.user?.role !== 'super-admin') {
      return res.status(403).json({ message: 'Admin identity required' });
    }

    const existing = await User.findById(id);
    if (!existing) {
      return res.status(404).json({ message: 'User not found' });
    }
    // School admins may only mutate users in their tenant
    if (req.user?.role === 'admin') {
      if (
        existing.role === 'student' &&
        String(existing.assignedAdmin || '') !== String(tenantAdminId)
      ) {
        return res.status(403).json({ message: 'Access denied for this student' });
      }
      if (existing.role === 'admin' && String(existing._id) !== String(tenantAdminId)) {
        return res.status(403).json({ message: 'Access denied for this admin' });
      }
      if (existing.role === 'super-admin') {
        return res.status(403).json({ message: 'Cannot modify super admin' });
      }
    }

    const updates = {};
    for (const key of SAFE_USER_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key];
      }
    }
    // Never allow role / assignedAdmin escalation via this endpoint
    delete updates.role;
    delete updates.assignedAdmin;
    delete updates.email;

    if (req.body.password) {
      if (String(req.body.password).length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
      }
      updates.password = await bcrypt.hash(req.body.password, 12);
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

// Recoverable, tenant-scoped bulk removal. The UI deliberately places this in
// a Danger Zone and requires an exact second-step phrase containing the count.
router.delete('/users/delete-all', async (req, res) => {
  try {
    const tenantAdminId = resolveTenantAdminId(req);
    if (!tenantAdminId || req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'A school administrator account is required.' });
    }

    const activeFilter = {
      role: 'student',
      assignedAdmin: tenantAdminId,
      deletedAt: { $exists: false },
    };
    const actualCount = await User.countDocuments(activeFilter);
    const expectedCount = Number(req.body?.expectedCount);
    const expectedPhrase = `DELETE ${actualCount} STUDENTS`;
    const confirmation = String(req.body?.confirmation || '').trim().toUpperCase();

    if (!Number.isInteger(expectedCount) || expectedCount !== actualCount || confirmation !== expectedPhrase) {
      req.setAudit?.({
        action: 'student.archive_all_blocked',
        summary: 'Blocked bulk student removal because confirmation did not match',
        meta: { actualCount, expectedCount },
      });
      return res.status(409).json({
        message: `Student count changed or confirmation did not match. Type exactly: ${expectedPhrase}`,
        studentCount: actualCount,
        confirmationPhrase: expectedPhrase,
      });
    }

    const now = new Date();
    const result = await User.updateMany(activeFilter, {
      $set: {
        isActive: false,
        deletedAt: now,
        deletedBy: req.user._id,
        deletionReason: 'Bulk removal by school administrator',
      },
    });
    req.setAudit?.({
      action: 'student.archive_all',
      summary: `Archived all ${result.modifiedCount} students in this school`,
      meta: { modifiedCount: result.modifiedCount, tenantAdminId: String(tenantAdminId) },
    });
    return res.json({
      message: `${result.modifiedCount} students were removed from the active directory. Records remain recoverable.`,
      deletedCount: result.modifiedCount,
      recoverable: true,
    });
  } catch (error) {
    console.error('Failed to archive all students:', error);
    return res.status(500).json({ message: 'Failed to remove students.' });
  }
});

// Teacher management endpoints


export default router;
