import express from 'express';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearSessionCookie,
  parseUsers,
  rateLimiter,
  requireUser,
  sessionMiddleware,
  setSessionCookie,
  verifyPassword,
} from './lib/auth.js';
import { checkDestination, normalizeNumber, parsePrefixList } from './lib/phone.js';
import { TelnyxClient } from './lib/telnyx.js';

const telnyxBundle = createRequire(import.meta.url).resolve('@telnyx/webrtc');

export function loadConfig(env = process.env) {
  const config = {
    apiKey: env.TELNYX_API_KEY,
    connectionId: env.TELNYX_CONNECTION_ID,
    callerId: env.CALLER_ID_NUMBER,
    users: parseUsers(env.USERS),
    sessionSecret: env.SESSION_SECRET,
    allowed: parsePrefixList(env.ALLOWED_PREFIXES ?? '+1'),
    blocked: parsePrefixList(env.BLOCKED_PREFIXES ?? '+1900,+1976'),
    defaultCountryCode: (env.DEFAULT_COUNTRY_CODE || '1').replace(/\D/g, ''),
    port: Number(env.PORT) || 3000,
    secureCookies: env.SECURE_COOKIES === 'true',
  };

  const missing = [];
  if (!config.apiKey) missing.push('TELNYX_API_KEY');
  if (!config.connectionId) missing.push('TELNYX_CONNECTION_ID');
  if (!config.callerId) missing.push('CALLER_ID_NUMBER');
  if (!config.users.size) missing.push('USERS');
  if (!config.sessionSecret || config.sessionSecret.length < 32) missing.push('SESSION_SECRET (32+ characters)');
  if (missing.length) throw new Error(`Missing or invalid settings: ${missing.join(', ')}. See .env.example.`);
  return config;
}

export function createApp(config, telnyx = new TelnyxClient(config)) {
  const app = express();
  const loginLimiter = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  const tokenLimiter = rateLimiter({ windowMs: 60 * 60 * 1000, max: 30 });
  const policy = { allowed: config.allowed, blocked: config.blocked };

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '10kb' }));
  app.use(sessionMiddleware({ secret: config.sessionSecret, users: config.users }));
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        'connect-src \'self\' wss://*.telnyx.com https://*.telnyx.com',
        "media-src 'self' blob:",
        "img-src 'self' data:",
        "style-src 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'microphone=(self), camera=()',
    });
    next();
  });

  app.post('/api/login', (req, res) => {
    if (!loginLimiter(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const { username, password } = req.body || {};
    if (!verifyPassword(config.users, username, password)) {
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    setSessionCookie(res, username, { secret: config.sessionSecret, secure: config.secureCookies });
    res.json({ user: username });
  });

  app.post('/api/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    res.json({
      user: req.user,
      callerId: config.callerId,
      allowedPrefixes: config.allowed,
      defaultCountryCode: config.defaultCountryCode,
    });
  });

  app.post('/api/token', requireUser, async (req, res) => {
    if (!tokenLimiter(req.user)) return res.status(429).json({ error: 'Too many sign-ins. Try again later.' });
    try {
      res.json({ token: await telnyx.loginTokenFor(req.user) });
    } catch (err) {
      console.error(err);
      res.status(502).json({ error: 'Could not get a calling token from Telnyx.' });
    }
  });

  // The browser checks every number here before dialing. Hard enforcement lives in the
  // Outbound Voice Profile's allowed destinations and spend limit (see README).
  app.post('/api/check-number', requireUser, (req, res) => {
    const number = normalizeNumber(req.body?.number, config.defaultCountryCode);
    const result = checkDestination(number, policy);
    if (!result.ok) return res.status(400).json({ error: result.reason });
    console.log(`[call] ${req.user} -> ${number}`);
    res.json({ number });
  });

  app.get('/vendor/telnyx-webrtc.js', (_req, res) => res.sendFile(telnyxBundle));
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  createApp(config).listen(config.port, () => {
    console.log(`Dialer running on http://localhost:${config.port}`);
  });
}
