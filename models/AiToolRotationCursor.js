import mongoose from 'mongoose';

const aiToolRotationCursorSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    cursor: { type: Number, default: 0 },
    lastServedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const AiToolRotationCursor =
  mongoose.models.AiToolRotationCursor ||
  mongoose.model('AiToolRotationCursor', aiToolRotationCursorSchema);

export default AiToolRotationCursor;

