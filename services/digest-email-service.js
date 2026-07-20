/**
 * Optional SMTP email for weekly digests.
 * If SMTP is not configured, digests remain in-app (WeeklyDigest) with emailStatus=skipped.
 */
import WeeklyDigest from '../models/WeeklyDigest.js';

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      (process.env.SMTP_PASS || process.env.SMTP_PASSWORD),
  );
}

async function getTransport() {
  if (!smtpConfigured()) return null;
  try {
    const nodemailer = await import('nodemailer');
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === '1',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
      },
    });
  } catch (err) {
    console.warn('[digest-email] nodemailer unavailable:', err.message);
    return null;
  }
}

function digestHtml(digest, user) {
  const lines = (digest.highlights || []).map((h) => `<li>${h}</li>`).join('');
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#1e293b">
  <h2 style="color:#FF6B35">${digest.title || 'Weekly AsliLearn report'}</h2>
  <p>${digest.summary || ''}</p>
  <p>Hi ${user?.fullName || 'there'},</p>
  <ul>${lines}</ul>
  <p style="color:#64748b;font-size:13px">Open AsliLearn.ai to see your full dashboard.</p>
  </body></html>`;
}

export async function sendDigestEmail(digest, user) {
  if (!user?.email) {
    await WeeklyDigest.updateOne(
      { _id: digest._id },
      { $set: { emailStatus: 'skipped', emailError: 'No email on user' } },
    );
    return { sent: false, reason: 'no-email' };
  }

  const transport = await getTransport();
  if (!transport) {
    await WeeklyDigest.updateOne(
      { _id: digest._id },
      { $set: { emailStatus: 'skipped', emailError: 'SMTP not configured' } },
    );
    return { sent: false, reason: 'no-smtp' };
  }

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: digest.title || 'Your weekly AsliLearn report',
      html: digestHtml(digest, user),
      text: [digest.summary, ...(digest.highlights || [])].filter(Boolean).join('\n'),
    });
    await WeeklyDigest.updateOne(
      { _id: digest._id },
      { $set: { emailStatus: 'sent', emailedAt: new Date(), emailError: '' } },
    );
    return { sent: true };
  } catch (err) {
    await WeeklyDigest.updateOne(
      { _id: digest._id },
      { $set: { emailStatus: 'failed', emailError: err.message || 'send failed' } },
    );
    return { sent: false, reason: err.message };
  }
}

export async function deliverPendingDigestsForWeek(weekStart, { limit = 500 } = {}) {
  const User = (await import('../models/User.js')).default;
  const pending = await WeeklyDigest.find({
    weekStart,
    emailStatus: { $in: ['pending', 'failed'] },
  })
    .limit(limit)
    .lean();

  const results = { sent: 0, skipped: 0, failed: 0 };
  for (const d of pending) {
    const user = await User.findById(d.userId).select('fullName email').lean();
    const r = await sendDigestEmail(d, user);
    if (r.sent) results.sent += 1;
    else if (r.reason === 'no-smtp' || r.reason === 'no-email') results.skipped += 1;
    else results.failed += 1;
  }
  return results;
}
