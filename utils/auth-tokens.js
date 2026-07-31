import jwt from 'jsonwebtoken';
import {
  RefreshToken,
  PasswordResetToken,
  hashOpaqueToken,
  generateOpaqueToken,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_DAYS,
  RESET_TOKEN_TTL_MINUTES,
} from '../models/AuthSession.js';

const JWT_SECRET = process.env.JWT_SECRET;

export function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
    algorithm: 'HS256',
  });
}

export async function issueRefreshToken({ userId, role, userAgent = '', ip = '' }) {
  const raw = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await RefreshToken.create({
    userId,
    role,
    tokenHash,
    expiresAt,
    userAgent: String(userAgent || '').slice(0, 300),
    ip: String(ip || '').slice(0, 80),
  });
  return { refreshToken: raw, expiresAt };
}

export async function rotateRefreshToken(rawRefresh, meta = {}) {
  if (!rawRefresh) return null;
  const tokenHash = hashOpaqueToken(rawRefresh);
  const existing = await RefreshToken.findOne({ tokenHash, revokedAt: null });
  if (!existing || existing.expiresAt.getTime() < Date.now()) {
    return null;
  }
  existing.revokedAt = new Date();
  await existing.save();
  const next = await issueRefreshToken({
    userId: existing.userId,
    role: existing.role,
    userAgent: meta.userAgent || existing.userAgent,
    ip: meta.ip || existing.ip,
  });
  return { userId: existing.userId, role: existing.role, ...next };
}

export async function revokeRefreshToken(rawRefresh) {
  if (!rawRefresh) return;
  const tokenHash = hashOpaqueToken(rawRefresh);
  await RefreshToken.updateOne({ tokenHash }, { $set: { revokedAt: new Date() } });
}

export async function createPasswordResetToken({ email, role, userId }) {
  const raw = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(raw);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
  await PasswordResetToken.create({
    email: String(email).toLowerCase().trim(),
    role,
    userId,
    tokenHash,
    expiresAt,
  });
  return { resetToken: raw, expiresAt };
}

export async function consumePasswordResetToken(raw) {
  if (!raw) return null;
  const tokenHash = hashOpaqueToken(raw);
  const doc = await PasswordResetToken.findOne({ tokenHash, usedAt: null });
  if (!doc || doc.expiresAt.getTime() < Date.now()) return null;
  doc.usedAt = new Date();
  await doc.save();
  return doc;
}
