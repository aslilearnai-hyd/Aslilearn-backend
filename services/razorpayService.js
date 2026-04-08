import axios from 'axios';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

/**
 * Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server .env (Dashboard → API Keys).
 */
export function isRazorpayConfigured() {
  const id = process.env.RAZORPAY_KEY_ID?.trim();
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  return !!(id && secret);
}

function getAuthHeader() {
  const key = process.env.RAZORPAY_KEY_ID?.trim();
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!key || !secret) {
    throw new Error('Razorpay credentials not configured');
  }
  const token = Buffer.from(`${key}:${secret}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

/**
 * @param {number} count
 */
export async function fetchRazorpayPayments(count = 50) {
  const { data } = await axios.get(`${RAZORPAY_API}/payments`, {
    headers: getAuthHeader(),
    params: { count },
    timeout: 25000,
  });

  const items = data?.items || [];
  return items.map((p) => ({
    id: p.id,
    amount: typeof p.amount === 'number' ? p.amount / 100 : 0,
    currency: p.currency || 'INR',
    status: p.status,
    method: p.method || '—',
    email: p.email || '—',
    contact: p.contact || '—',
    createdAt: p.created_at
      ? new Date(p.created_at * 1000).toISOString()
      : null,
    description: p.description || '',
    orderId: p.order_id || null,
    international: Boolean(p.international),
  }));
}

/**
 * @param {number} count
 */
export async function fetchRazorpaySubscriptions(count = 50) {
  const { data } = await axios.get(`${RAZORPAY_API}/subscriptions`, {
    headers: getAuthHeader(),
    params: { count },
    timeout: 25000,
  });

  const items = data?.items || [];
  return items.map((s) => ({
    id: s.id,
    status: s.status,
    planId: s.plan_id || '—',
    customerId: s.customer_id || '—',
    shortUrl: s.short_url || null,
    currentStart: s.current_start
      ? new Date(s.current_start * 1000).toISOString()
      : null,
    currentEnd: s.current_end ? new Date(s.current_end * 1000).toISOString() : null,
    totalCount: s.total_count,
    paidCount: s.paid_count,
    remainingCount: s.remaining_count,
    quantity: s.quantity,
  }));
}
