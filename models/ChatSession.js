import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['user', 'assistant', 'system'],
      required: true,
    },
    content: { type: String, required: true },
    model: { type: String, default: '' },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    citations: {
      type: [
        {
          subject: String,
          classLabel: String,
          chapter: String,
          score: String,
          preview: String,
        },
      ],
      default: [],
    },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const chatSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['student', 'teacher', 'admin', 'super-admin', 'school-admin', 'unknown'],
      default: 'unknown',
      index: true,
    },
    title: {
      type: String,
      default: 'New conversation with Vidya',
      trim: true,
    },
    context: {
      currentSubject: { type: String, default: '' },
      currentTopic: { type: String, default: '' },
      currentClass: { type: String, default: '' },
      studentName: { type: String, default: '' },
      seedSource: { type: String, default: '' },
      meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    messages: {
      type: [chatMessageSchema],
      default: [],
    },
    messageCount: { type: Number, default: 0 },
    lastModelUsed: { type: String, default: '' },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

chatSessionSchema.index({ userId: 1, updatedAt: -1 });
chatSessionSchema.index({ userId: 1, archived: 1, updatedAt: -1 });

const TTL_DAYS = Number(process.env.CHAT_SESSION_TTL_DAYS || 180);
chatSessionSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: TTL_DAYS * 24 * 60 * 60 }
);

chatSessionSchema.methods.appendMessage = function appendMessage(message) {
  this.messages.push(message);
  this.messageCount = this.messages.length;
  if (this.messages.length > 200) {
    this.messages = this.messages.slice(-200);
    this.messageCount = this.messages.length;
  }
  if (message.model) this.lastModelUsed = message.model;
};

export default mongoose.model('ChatSession', chatSessionSchema);
