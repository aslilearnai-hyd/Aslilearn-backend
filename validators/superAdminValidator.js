import Joi from 'joi';
import {
  ALLOWED_SCHOOL_PORTAL_PERMISSIONS,
  ALLOWED_TEACHER_PORTAL_PERMISSIONS,
  ALLOWED_STUDENT_PORTAL_PERMISSIONS,
} from '../utils/schoolRolePortal.js';

export {
  ALLOWED_SCHOOL_PORTAL_PERMISSIONS,
  ALLOWED_TEACHER_PORTAL_PERMISSIONS,
  ALLOWED_STUDENT_PORTAL_PERMISSIONS,
};

// Validation schemas for Super Admin operations

export const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required().messages({
    'string.email': 'Please provide a valid email address (check for typos like .con instead of .com)',
    'string.empty': 'Email is required',
    'any.required': 'Email is required',
  }),
  password: Joi.string().trim().min(6).required().messages({
    'string.min': 'Password must be at least 6 characters long',
    'string.empty': 'Password is required',
    'any.required': 'Password is required',
  }),
});

/** School admin provisioning — allow extra school fields; require core identity. */
export const createAdminSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  schoolName: Joi.string().min(2).max(200).required(),
  board: Joi.string().min(2).max(80).required(),
  state: Joi.string().min(2).max(100).required(),
  permissions: Joi.array().items(Joi.string()).default([]),
  teacherPermissions: Joi.array().items(Joi.string()).optional(),
  studentPermissions: Joi.array().items(Joi.string()).optional(),
  vidyaEnabledForAdmins: Joi.boolean().optional(),
  vidyaEnabledForTeachers: Joi.boolean().optional(),
  vidyaEnabledForStudents: Joi.boolean().optional(),
  isAsliPrepExclusive: Joi.boolean().optional(),
  schoolLogo: Joi.string().allow('', null).optional(),
  contactPerson: Joi.string().allow('', null).optional(),
  phone: Joi.string().allow('', null).optional(),
  secondaryContactPerson: Joi.string().allow('', null).optional(),
  secondaryContactPhone: Joi.string().allow('', null).optional(),
  place: Joi.string().allow('', null).optional(),
  pin: Joi.string().pattern(/^[1-9]\d{5}$/).allow('', null).optional().messages({
    'string.pattern.base': 'Pincode must be exactly 6 digits (Indian PIN)',
  }),
  schoolDetails: Joi.object().unknown(true).optional(),
}).unknown(true);

export const updateAdminSchema = Joi.object({
  permissions: Joi.array().items(Joi.string()).optional(),
  isActive: Joi.boolean().optional(),
}).unknown(true);

export const createUserSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  role: Joi.string().valid('student', 'teacher', 'admin').required(),
  details: Joi.string().max(100).optional(),
}).unknown(true);

export const createCourseSchema = Joi.object({
  title: Joi.string().min(5).max(100).required(),
  subject: Joi.string().min(2).max(50).required(),
  grade: Joi.string().required(),
  board: Joi.string().required(),
  teacher: Joi.string().min(2).max(50).required(),
}).unknown(true);

/** Generic body validator — unknown keys kept unless schema forbids them. */
export const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: false,
      allowUnknown: true,
    });

    if (error) {
      const errorMessages = error.details.map((detail) => detail.message);
      return res.status(400).json({
        success: false,
        // Prefer the first field message so the login UI is actionable
        // instead of a bare "Validation failed".
        message: errorMessages[0] || 'Validation failed',
        errors: errorMessages,
      });
    }

    req.body = value;
    next();
  };
};

// Custom validation functions — never hardcode live credentials
export const validateSuperAdminCredentials = () => false;

export const validatePermissions = (permissions) => {
  return permissions.every((permission) => ALLOWED_SCHOOL_PORTAL_PERMISSIONS.includes(permission));
};

export const validateTeacherPermissions = (permissions) => {
  return permissions.every((permission) => ALLOWED_TEACHER_PORTAL_PERMISSIONS.includes(permission));
};

export const validateStudentPermissions = (permissions) => {
  return permissions.every((permission) => ALLOWED_STUDENT_PORTAL_PERMISSIONS.includes(permission));
};

export const validateRole = (role) => {
  const allowedRoles = ['student', 'teacher', 'admin'];
  return allowedRoles.includes(role);
};
