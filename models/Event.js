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
  endDate: {
    type: Date,
    required: false
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

// Use existing model if it exists, otherwise create new one
const Event = mongoose.models.Event || mongoose.model('Event', eventSchema);

export default Event;

