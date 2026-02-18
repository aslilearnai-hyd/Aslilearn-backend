// Super Admin Constants

export const SUPER_ADMIN_CREDENTIALS = {
  email: 'sealucknow2017@gmail.com',
  password: 'Asli123'
};

export const USER_ROLES = {
  STUDENT: 'student',
  TEACHER: 'teacher',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super-admin'
};

export const PERMISSIONS = {
  USER_MANAGEMENT: 'User Management',
  CONTENT_MANAGEMENT: 'Content Management',
  ANALYTICS: 'Analytics',
  SUBSCRIPTIONS: 'Subscriptions',
  SETTINGS: 'Settings'
};

export const COURSE_GRADES = [
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12'
];

export const COURSE_BOARDS = [
  'CBSE',
  'ICSE',
  'State Board',
  'IB'
];

export const SUBJECTS = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'English',
  'Hindi',
  'Social Science',
  'Computer Science',
  'Economics',
  'Business Studies'
];

export const SUBSCRIPTION_PLANS = {
  BASIC: 'Basic',
  PREMIUM: 'Premium',
  PRO: 'Pro'
};

export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'Active',
  PENDING: 'Pending',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired'
};

export const PAYMENT_METHODS = [
  'Credit Card',
  'Debit Card',
  'UPI',
  'Net Banking',
  'Wallet'
];

export const DEFAULT_PASSWORDS = {
  ADMIN: 'admin123',
  USER: 'password123'
};

export const API_ENDPOINTS = {
  LOGIN: '/api/super-admin/login',
  STATS: '/api/super-admin/stats',
  ADMINS: '/api/super-admin/admins',
  USERS: '/api/super-admin/users',
  COURSES: '/api/super-admin/courses',
  ANALYTICS: '/api/super-admin/analytics',
  SUBSCRIPTIONS: '/api/super-admin/subscriptions',
  EXPORT: '/api/super-admin/export'
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500
};

export const RESPONSE_MESSAGES = {
  SUCCESS: 'Success',
  ERROR: 'Error',
  VALIDATION_FAILED: 'Validation failed',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  CONFLICT: 'Conflict',
  INTERNAL_ERROR: 'Internal server error',
  INVALID_CREDENTIALS: 'Invalid credentials',
  ADMIN_CREATED: 'Admin created successfully',
  ADMIN_UPDATED: 'Admin updated successfully',
  USER_CREATED: 'User created successfully',
  COURSE_CREATED: 'Course created successfully',
  DATA_EXPORTED: 'Data exported successfully'
};

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100
};

export const FILE_UPLOAD = {
  MAX_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
  UPLOAD_PATH: 'uploads/'
};

export const CACHE_KEYS = {
  STATS: 'super_admin:stats',
  ADMINS: 'super_admin:admins',
  USERS: 'super_admin:users',
  COURSES: 'super_admin:courses',
  ANALYTICS: 'super_admin:analytics'
};

export const CACHE_TTL = {
  STATS: 300, // 5 minutes
  ADMINS: 600, // 10 minutes
  USERS: 600, // 10 minutes
  COURSES: 600, // 10 minutes
  ANALYTICS: 300 // 5 minutes
};








