import Joi from 'joi';

// Validation schemas for Super Admin operations

export const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required'
  }),
  password: Joi.string().min(6).required().messages({
    'string.min': 'Password must be at least 6 characters long',
    'any.required': 'Password is required'
  })
});

export const createAdminSchema = Joi.object({
  name: Joi.string().min(2).max(50).required().messages({
    'string.min': 'Name must be at least 2 characters long',
    'string.max': 'Name must not exceed 50 characters',
    'any.required': 'Name is required'
  }),
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required'
  }),
  permissions: Joi.array().items(Joi.string()).default([]).messages({
    'array.base': 'Permissions must be an array'
  })
});

export const updateAdminSchema = Joi.object({
  permissions: Joi.array().items(Joi.string()).optional().messages({
    'array.base': 'Permissions must be an array'
  }),
  isActive: Joi.boolean().optional().messages({
    'boolean.base': 'isActive must be a boolean value'
  })
});

export const createUserSchema = Joi.object({
  name: Joi.string().min(2).max(50).required().messages({
    'string.min': 'Name must be at least 2 characters long',
    'string.max': 'Name must not exceed 50 characters',
    'any.required': 'Name is required'
  }),
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required'
  }),
  role: Joi.string().valid('student', 'teacher', 'admin').required().messages({
    'any.only': 'Role must be one of: student, teacher, admin',
    'any.required': 'Role is required'
  }),
  details: Joi.string().max(100).optional().messages({
    'string.max': 'Details must not exceed 100 characters'
  })
});

export const createCourseSchema = Joi.object({
  title: Joi.string().min(5).max(100).required().messages({
    'string.min': 'Title must be at least 5 characters long',
    'string.max': 'Title must not exceed 100 characters',
    'any.required': 'Title is required'
  }),
  subject: Joi.string().min(2).max(50).required().messages({
    'string.min': 'Subject must be at least 2 characters long',
    'string.max': 'Subject must not exceed 50 characters',
    'any.required': 'Subject is required'
  }),
  grade: Joi.string().valid('Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12').required().messages({
    'any.only': 'Grade must be one of: Class 8, Class 9, Class 10, Class 11, Class 12',
    'any.required': 'Grade is required'
  }),
  board: Joi.string().valid('CBSE', 'ICSE', 'State Board', 'IB').required().messages({
    'any.only': 'Board must be one of: CBSE, ICSE, State Board, IB',
    'any.required': 'Board is required'
  }),
  teacher: Joi.string().min(2).max(50).required().messages({
    'string.min': 'Teacher name must be at least 2 characters long',
    'string.max': 'Teacher name must not exceed 50 characters',
    'any.required': 'Teacher is required'
  })
});

// Validation middleware
export const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errorMessages = error.details.map(detail => detail.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errorMessages
      });
    }
    
    req.body = value;
    next();
  };
};

// Custom validation functions
export const validateSuperAdminCredentials = (email, password) => {
  return email === 'sealucknow2017@gmail.com' && password === 'Asli123';
};

export const ALLOWED_SCHOOL_PORTAL_PERMISSIONS = [
  'User Management',
  'Content Management',
  'Analytics',
  'Subscriptions',
  'Settings',
  'Exam Management',
  'Learning Paths',
  'School Calendar',
  'Vidya AI',
  'Edu OTT',
];

export const validatePermissions = (permissions) => {
  return permissions.every((permission) => ALLOWED_SCHOOL_PORTAL_PERMISSIONS.includes(permission));
};

export const validateRole = (role) => {
  const allowedRoles = ['student', 'teacher', 'admin'];
  return allowedRoles.includes(role);
};








