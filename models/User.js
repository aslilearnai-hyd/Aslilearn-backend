import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['student', 'teacher', 'admin', 'super-admin'],
    default: 'student'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  classNumber: {
    type: String,
    default: 'Unassigned'
  },
  phone: {
    type: String,
    default: ''
  },
  age: {
    type: Number,
    min: 1,
    max: 120,
    default: 18
  },
  educationStream: {
    type: String,
    trim: true,
    default: ''
  },
  targetExam: {
    type: String,
    trim: true,
    default: ''
  },
  profilePhoto: {
    type: String,
    default: ''
  },
  permissions: {
    type: [String],
    default: []
  },
  details: {
    type: String,
    default: ''
  },
  assignedAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  /** Link to schools collection (canonical school profile) */
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    default: null,
  },
  assignedTeacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    default: null
  },
  // Class assigned to student (references Class model)
  assignedClass: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    default: null
  },
  // Subjects assigned to student by admin
  assignedSubjects: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject'
  }],
  // Board assignment for admins and students (ASLI_EXCLUSIVE_SCHOOLS = Asli Prep exclusive track)
  board: {
    type: String,
    enum: {
      values: ['ASLI_EXCLUSIVE_SCHOOLS', 'CBSE', 'STATE', 'SSC', 'ICSE', 'IB', 'CAMBRIDGE'],
      message: '{VALUE} is not a valid board'
    },
    uppercase: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS',
    required: false
  },
  // Curriculum alignment (used with isAsliPrepExclusive)
  curriculumBoard: {
    type: String,
    enum: {
      values: ['CBSE', 'STATE', 'SSC', 'ICSE', 'IB', 'CAMBRIDGE'],
      message: '{VALUE} is not a valid curriculum board'
    },
    uppercase: true,
    default: 'CBSE',
    required: false
  },
  isAsliPrepExclusive: {
    type: Boolean,
    default: false
  },
  // School name for admins
  schoolName: {
    type: String,
    trim: true,
    default: ''
  },
  // School logo URL for admins
  schoolLogo: {
    type: String,
    trim: true,
    default: ''
  },
  // Contact person for admins
  contactPerson: {
    type: String,
    trim: true,
    default: ''
  },
  secondaryContactPerson: {
    type: String,
    trim: true,
    default: ''
  },
  secondaryContactPhone: {
    type: String,
    trim: true,
    default: ''
  },
  // Place/City for admins
  place: {
    type: String,
    trim: true,
    default: ''
  },
  // PIN code for admins
  pin: {
    type: String,
    trim: true,
    default: ''
  },
  // Extended school profile (admin / school onboarding)
  schoolDetails: {
    type: {
      doorNo: { type: String, trim: true, default: '' },
      street: { type: String, trim: true, default: '' },
      area: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      district: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
      medium: { type: String, trim: true, default: '' },
      classesFrom: { type: String, trim: true, default: '' },
      classesTo: { type: String, trim: true, default: '' },
      totalStrength: { type: String, trim: true, default: '' },
      schoolType: { type: String, trim: true, default: '' },
      photos: { type: [String], default: [] }
    },
    default: () => ({})
  },
  // Overall progress for students (calculated from exam and learning path progress)
  overallProgress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  // Last time overall progress was updated
  overallProgressUpdatedAt: {
    type: Date
  },
  // Study streak (Phase 3.3d)
  studyStreak: {
    current: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
    lastActiveDate: { type: String, default: '' } // YYYY-MM-DD in IST
  }
}, {
  timestamps: true
});

// Pre-save hook to handle null board values (enum doesn't accept null)
userSchema.pre('save', function(next) {
  // Convert null/undefined/empty string to undefined so enum validation is skipped
  if (this.board === null || this.board === '' || this.board === undefined) {
    this.board = undefined;
  }
  next();
});

// Index for better performance
userSchema.index({ role: 1 });
userSchema.index({ assignedAdmin: 1 });
userSchema.index({ schoolId: 1 });
userSchema.index({ role: 1, assignedAdmin: 1 }); // Compound index for role + admin queries
userSchema.index({ board: 1 });
userSchema.index({ role: 1, board: 1 }); // Compound index for role + board queries
userSchema.index({ role: 1, isActive: 1 }); // For active user queries
userSchema.index({ role: 1, assignedAdmin: 1, isActive: 1 }); // Compound for admin's active students
userSchema.index({ assignedClass: 1 }); // For class-based queries
userSchema.index({ email: 1 }); // For email lookups

export default mongoose.model('User', userSchema);
