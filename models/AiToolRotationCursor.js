import mongoose from 'mongoose';

const aiToolRotationCursorSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    cursor: { type: Number, default: 0 },
    /** Last delivered AiToolGeneration _id — next Generate must prefer a different row. */
    lastDocId: { type: String, default: '', index: true },
    /** Last delivered content fingerprint — skip look-alike variants when possible. */
    lastFingerprint: { type: String, default: '' },
    lastServedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const AiToolRotationCursor =
  mongoose.models.AiToolRotationCursor ||
  mongoose.model('AiToolRotationCursor', aiToolRotationCursorSchema);

export default AiToolRotationCursor;
