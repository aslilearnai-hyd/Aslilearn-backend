import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  path: { type: String, required: true, unique: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  ownerRole: { type: String, required: true },
}, { timestamps: true });

export default mongoose.model('UploadAsset', schema);
