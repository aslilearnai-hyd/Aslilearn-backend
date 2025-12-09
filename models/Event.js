import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  date: {
    type: Date,
    required: true
  },
  photo: {
    type: String, // URL or path to the photo
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Index for better query performance
eventSchema.index({ date: 1 });
eventSchema.index({ createdBy: 1 });

export default mongoose.model('Event', eventSchema);

