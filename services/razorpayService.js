import axios from 'axios';
import crypto from 'crypto';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

function cleanCredential(raw) {
  let v = String(raw || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function getRazorpayKeyId() {
  return cleanCredential(process.env.RAZORPAY_KEY_ID);
}

export function getRazorpayKeySecret() {
  return cleanCredential(process.env.RAZORPAY_KEY_SECRET);
}

/**
 * Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server .env (Dashboard → API Keys).
 */
export function isRazorpayConfigured() {
  return !!(getRazorpayKeyId() && getRazorpayKeySecret());
}

export function describeRazorpayConfig() {
  const keyId = getRazorpayKeyId();
  const secret = getRazorpayKeySecret();
  const mode = keyId.startsWith('rzp_live_')
    ? 'live'
    : keyId.startsWith('rzp_test_')
      ? 'test'
      : 'unknown';
  return {
    configured: !!(keyId && secret),
    mode,
    keyIdLength: keyId.length,
    secretLength: secret.length,
    looksSwapped: secret.startsWith('rzp_'),
    keyIdOk: mode !== 'unknown',
  };
}

function razorpayRequestConfig(extraHeaders = {}) {
  const keyId = getRazorpayKeyId();
  const secret = getRazorpayKeySecret();
  if (!keyId || !secret) {
    throw new Error('Razorpay credentials not configured');
  }
  return {
    auth: { username: keyId, password: secret },
    timeout: 25000,
    headers: {
      Accept: 'application/json',
      ...extraHeaders,
    },
  };
}

/**
 * @param {number} count
 */
export async function fetchRazorpayPayments(count = 50) {
  const { data } = await axios.get(`${RAZORPAY_API}/payments`, {
    ...razorpayRequestConfig(),
    params: { count },
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
    ...razorpayRequestConfig(),
    params: { count },
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

/**
 * @param {string} customerId
 */
export async function fetchRazorpayCustomer(customerId) {
  if (!customerId || customerId === '—') {
    return { id: '', email: '', name: '', contact: '' };
  }
  const { data } = await axios.get(`${RAZORPAY_API}/customers/${customerId}`, {
    ...razorpayRequestConfig(),
    timeout: 15000,
  });
  return {
    id: data.id,
    email: data.email || '',
    name: data.name || '',
    contact: data.contact || '',
  };
}

/**
 * Razorpay payments + subscriptions tied to a school admin email (payments by email; subs by customer email).
 * @param {string} adminEmail
 */
export async function fetchBillingForAdminEmail(adminEmail) {
  const normalized = String(adminEmail || '').toLowerCase().trim();
  if (!normalized) {
    return {
      razorpayConfigured: isRazorpayConfigured(),
      razorpayError: null,
      payments: [],
      subscriptions: [],
    };
  }

  if (!isRazorpayConfigured()) {
    return {
      razorpayConfigured: false,
      razorpayError: null,
      payments: [],
      subscriptions: [],
    };
  }

  let payments = [];
  let subscriptions = [];
  try {
    [payments, subscriptions] = await Promise.all([
      fetchRazorpayPayments(100),
      fetchRazorpaySubscriptions(100),
    ]);
  } catch (err) {
    const msg =
      err.response?.data?.error?.description ||
      err.response?.data?.message ||
      err.message ||
      'Razorpay request failed';
    return {
      razorpayConfigured: true,
      razorpayError: msg,
      payments: [],
      subscriptions: [],
    };
  }

  const filteredPayments = payments.filter(
    (p) => String(p.email || '').toLowerCase() === normalized
  );

  const uniqueCustomerIds = [
    ...new Set(
      subscriptions.map((s) => s.customerId).filter((id) => id && id !== '—')
    ),
  ];

  const customerCache = new Map();
  await Promise.all(
    uniqueCustomerIds.map(async (cid) => {
      try {
        const c = await fetchRazorpayCustomer(cid);
        customerCache.set(cid, c);
      } catch {
        customerCache.set(cid, { email: '' });
      }
    })
  );

  const filteredSubs = subscriptions.filter((s) => {
    const c = customerCache.get(s.customerId);
    return c && String(c.email || '').toLowerCase() === normalized;
  });

  return {
    razorpayConfigured: true,
    razorpayError: null,
    payments: filteredPayments,
    subscriptions: filteredSubs,
  };
}

export async function createRazorpayOrder({ amountPaise, receipt, notes, customer }) {
  const payload = {
    amount: amountPaise,
    currency: 'INR',
    receipt: String(receipt || '').slice(0, 40),
    notes: notes || {},
  };
  if (customer?.name) payload.notes.customer_name = String(customer.name).slice(0, 100);
  if (customer?.email) payload.notes.customer_email = String(customer.email).slice(0, 100);

  const stringNotes = {};
  for (const [k, v] of Object.entries(payload.notes || {})) {
    if (v == null || v === '') continue;
    stringNotes[k] = String(v).slice(0, 256);
  }
  payload.notes = stringNotes;

  const { data } = await axios.post(`${RAZORPAY_API}/orders`, payload, {
    ...razorpayRequestConfig({ 'Content-Type': 'application/json' }),
  });
  return data;
}

export function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  const secret = getRazorpayKeySecret();
  if (!secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature || ''), 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
