import crypto from 'node:crypto';

const COOKIE_NAME = 'dialer_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function parseUsers(value) {
  const users = new Map();
  for (const entry of (value || '').split(',')) {
    const idx = entry.indexOf(':');
    if (idx <= 0) continue;
    users.set(entry.slice(0, idx).trim(), entry.slice(idx + 1));
  }
  return users;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function verifyPassword(users, username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  const expected = users.get(username);
  // Compare against a dummy value for unknown users so timing doesn't reveal which usernames exist.
  const ok = safeEqual(password, expected ?? crypto.randomBytes(16).toString('hex'));
  return ok && expected !== undefined;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(username, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: now + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function readSessionToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof u === 'string' && exp > now ? u : null;
  } catch {
    return null;
  }
}

function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionMiddleware({ secret, users }) {
  return (req, _res, next) => {
    const user = readSessionToken(readCookie(req.headers.cookie, COOKIE_NAME), secret);
    // A user removed from USERS loses access on their next request.
    req.user = user && users.has(user) ? user : null;
    next();
  };
}

export function setSessionCookie(res, username, { secret, secure }) {
  res.cookie(COOKIE_NAME, createSessionToken(username, secret), {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

// Fixed-window counter per key; good enough for a single-process server.
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return function hit(key, now = Date.now()) {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}
