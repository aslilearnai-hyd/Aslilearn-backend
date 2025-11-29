import mongoose from 'mongoose';

const streamSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  // Streamer (teacher or admin who is streaming)
  streamer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Can be admin
    required: true
  },
  streamerTeacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher', // Can be teacher
    default: null
  },
  // Subject for the stream
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true
  },
  // Board filter
  board: {
    type: String,
    enum: ['ASLI_EXCLUSIVE_SCHOOLS'],
    uppercase: true,
    required: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS'
  },
  // Class filter (optional - if null, all classes in board can see)
  classNumber: {
    type: String,
    trim: true,
    default: null
  },
  // Stream status
  status: {
    type: String,
    enum: ['scheduled', 'live', 'ended', 'cancelled'],
    default: 'scheduled'
  },
  // Scheduled start time
  scheduledStartTime: {
    type: Date,
    required: true
  },
  // Actual start time (when stream actually started)
  actualStartTime: {
    type: Date,
    default: null
  },
  // End time
  endTime: {
    type: Date,
    default: null
  },
  // Stream URL (RTMP, HLS, WebRTC, etc.)
  streamUrl: {
    type: String,
    default: ''
  },
  // Playback URL (for viewers)
  playbackUrl: {
    type: String,
    default: ''
  },
  // Stream key/token for authentication
  streamKey: {
    type: String,
    default: ''
  },
  // Thumbnail/preview image
  thumbnailUrl: {
    type: String,
    default: ''
  },
  // Viewers count
  viewerCount: {
    type: Number,
    default: 0
  },
  // Maximum viewers allowed (0 = unlimited)
  maxViewers: {
    type: Number,
    default: 0
  },
  // Is recording enabled
  isRecording: {
    type: Boolean,
    default: false
  },
  // Recording URL (if recorded)
  recordingUrl: {
    type: String,
    default: ''
  },
  // Is chat enabled
  isChatEnabled: {
    type: Boolean,
    default: true
  },
  // Admin who created/manages this stream (null for super admin)
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null
  },
  // Is stream active
  isActive: {
    type: Boolean,
    default: true
  },
  // Stream type (live, scheduled, recorded)
  streamType: {
    type: String,
    enum: ['live', 'scheduled', 'recorded'],
    default: 'live'
  }
}, {
  timestamps: true
});

// Indexes for better performance
streamSchema.index({ adminId: 1 });
streamSchema.index({ streamer: 1 });
streamSchema.index({ subject: 1 });
streamSchema.index({ board: 1 });
streamSchema.index({ status: 1 });
streamSchema.index({ scheduledStartTime: 1 });
streamSchema.index({ adminId: 1, status: 1 });
streamSchema.index({ board: 1, subject: 1, status: 1 });

export default mongoose.model('Stream', streamSchema);

