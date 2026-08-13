import mongoose from 'mongoose';

const schoolDetailsSchema = {
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
  photos: { type: [String], default: [] },
};

const schoolSchema = new mongoose.Schema(
  {
    /** Display name of the school */
    name: {
      type: String,
      required: true,
      trim: true,
    },
    schoolLogo: { type: String, trim: true, default: '' },
    contactPerson: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    secondaryContactPerson: { type: String, trim: true, default: '' },
    secondaryContactPhone: { type: String, trim: true, default: '' },
    place: { type: String, trim: true, default: '' },
    pin: { type: String, trim: true, default: '' },
    schoolDetails: {
      type: schoolDetailsSchema,
      default: () => ({}),
    },
    /** Stored board code (ASLI_EXCLUSIVE_SCHOOLS or curriculum) */
    board: {
      type: String,
      uppercase: true,
      default: 'ASLI_EXCLUSIVE_SCHOOLS',
    },
    curriculumBoard: {
      type: String,
      uppercase: true,
      trim: true,
      default: 'CBSE',
    },
    isAsliPrepExclusive: {
      type: Boolean,
      default: false,
    },
    /** Assigned IIT / product tracks (Alpha, Beta, Gamma, or Super Admin custom codes). */
    iitCategories: {
      type: [{ type: String, uppercase: true, trim: true }],
      default: [],
    },
    /**
     * Per-class IIT tracks, e.g. { "6": ["ALPHA"], "8": ["ALPHA","BETA"] }.
     * Empty / missing = legacy school-wide iitCategories apply to every class.
     */
    iitCategoriesByClass: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    /** Login user (admin) for this school */
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    /**
     * Subscribed / licensed account seats (manual Super Admin entry).
     * Live used counts come from registered teachers + students, not these fields.
     */
    licensedStudents: {
      type: Number,
      min: 0,
      default: 0,
    },
    licensedTeachers: {
      type: Number,
      min: 0,
      default: 0,
    },
    accountSeatsNotes: {
      type: String,
      trim: true,
      default: '',
    },
    /** School-wide Vidya usage policy (mirrors admin user). */
    vidyaUsageMode: {
      type: String,
      enum: ['unlimited', 'limited'],
      default: 'unlimited',
    },
    vidyaLimitChatbot: {
      type: Boolean,
      default: false,
    },
    vidyaLimitTools: {
      type: Boolean,
      default: false,
    },
    vidyaChatPerDay: {
      type: Number,
      min: 1,
      default: 10,
    },
    vidyaGenerationsPerDay: {
      type: Number,
      min: 1,
      default: 10,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

schoolSchema.index({ name: 1 });
schoolSchema.index({ adminUserId: 1 }, { unique: true, sparse: true });
schoolSchema.index({ isActive: 1 });
schoolSchema.index({ curriculumBoard: 1 });
schoolSchema.index({ 'schoolDetails.state': 1 });

export default mongoose.model('School', schoolSchema);
