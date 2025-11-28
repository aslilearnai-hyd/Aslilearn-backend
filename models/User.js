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
  // Board assignment for admins and students
  board: {
    type: String,
    enum: {
      values: ['CBSE_AP', 'CBSE_TS', 'STATE_AP', 'STATE_TS'],
      message: '{VALUE} is not a valid board'
    },
    uppercase: true,
    default: null,
    required: false
  },
  // School name for admins
  schoolName: {
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
userSchema.index({ role: 1, assignedAdmin: 1 }); // Compound index for role + admin queries
userSchema.index({ board: 1 });
userSchema.index({ role: 1, board: 1 }); // Compound index for role + board queries

export default mongoose.model('User', userSchema);
