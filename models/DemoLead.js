import mongoose from 'mongoose';

const demoLeadSchema = new mongoose.Schema(
  {
    leadId: { type: String, required: true, unique: true, index: true },
    role: {
      type: String,
      enum: ['school_admin', 'teacher', 'student_parent'],
      required: true,
      index: true,
    },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    sourcePage: { type: String, default: '/book-a-demo' },
    campaign: { type: String, default: '' },
    status: {
      type: String,
      enum: ['new', 'contacted', 'closed'],
      default: 'new',
      index: true,
    },
  },
  { timestamps: true },
);

export default mongoose.model('DemoLead', demoLeadSchema);
