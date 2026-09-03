import UploadAsset from '../models/UploadAsset.js';
import { roleMayAccessUpload, verifyUploadSignature } from './upload-access.js';
import { canAccessLegacyUpload } from './legacy-upload-access.js';

// Bearer links are issued by resource endpoints after their own authorization.
// A JWT role alone never grants access to another person's private file.
export async function canAccessPrivateUpload(absolutePath, user, query = {}, Asset = UploadAsset, legacy = canAccessLegacyUpload) {
  if (verifyUploadSignature(absolutePath, query.exp, query.sig)) return true;
  if (roleMayAccessUpload(absolutePath, user)) return true;
  const ownerId = user?.userId || user?.id;
  if (!ownerId) return false;
  if (await Asset.exists({ path: absolutePath, ownerId, ownerRole: user.role })) return true;
  return legacy(absolutePath, user);
}

export async function mayAttachUpload(raw, user) {
  let url;
  try { url = new URL(String(raw), 'https://upload.invalid'); } catch { return false; }
  if (!url.pathname.startsWith('/uploads/')) return true;
  // Do not turn an arbitrary stored filename into a fresh signed capability.
  return canAccessPrivateUpload(decodeURIComponent(url.pathname), user);
}
