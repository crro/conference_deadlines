import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, loadConfig } from '../server.js';
import { TelnyxClient } from '../lib/telnyx.js';
import { createSessionToken, readSessionToken } from '../lib/auth.js';

const env = {
  TELNYX_API_KEY: 'KEYtest',
  TELNYX_CONNECTION_ID: '42',
  CALLER_ID_NUMBER: '+15550000000',
  USERS: 'alice:correct horse,bob:battery staple',
  SESSION_SECRET: 'x'.repeat(40),
};

// Fake Telnyx API that records requests.
const calls = [];
const credentials = [];
async function fakeFetch(url, init) {
  const { pathname, searchParams } = new URL(url);
  calls.push(`${init.method} ${pathname}`);
  assert.equal(init.headers.Authorization, 'Bearer KEYtest');
  if (init.method === 'GET' && pathname === '/v2/telephony_credentials') {
    const name = searchParams.get('filter[name]');
    return new Response(JSON.stringify({ data: credentials.filter((c) => c.name === name) }));
  }
  if (init.method === 'POST' && pathname === '/v2/telephony_credentials') {
    const body = JSON.parse(init.body);
    assert.equal(body.connection_id, '42');
    const cred = { id: `cred-${credentials.length + 1}`, name: body.name, expired: false };
    credentials.push(cred);
    return new Response(JSON.stringify({ data: cred }), { status: 201 });
  }
  const m = pathname.match(/^\/v2\/telephony_credentials\/(.+)\/token$/);
  if (init.method === 'POST' && m) return new Response(`jwt-for-${m[1]}\n`);
  return new Response('not found', { status: 404 });
}

let server;
let base;
before(async () => {
  const config = loadConfig(env);
  const app = createApp(config, new TelnyxClient({ ...config, fetchImpl: fakeFetch }));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function post(path, body, cookie) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
}

async function login(username, password) {
  const res = await post('/api/login', { username, password });
  return { res, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

test('loadConfig reports missing settings', () => {
  assert.throws(() => loadConfig({}), /TELNYX_API_KEY.*SESSION_SECRET/);
  assert.throws(() => loadConfig({ ...env, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
});

test('session tokens reject tampering and expiry', () => {
  const token = createSessionToken('alice', 'secret', 1000);
  assert.equal(readSessionToken(token, 'secret', 2000), 'alice');
  assert.equal(readSessionToken(token, 'other', 2000), null);
  assert.equal(readSessionToken(token.replace(/^./, 'A'), 'secret', 2000), null);
  assert.equal(readSessionToken(token, 'secret', 1000 + 13 * 3600 * 1000), null);
});

test('API requires sign-in', async () => {
  assert.equal((await fetch(`${base}/api/me`)).status, 401);
  assert.equal((await post('/api/token')).status, 401);
  assert.equal((await post('/api/check-number', { number: '5551234567' })).status, 401);
});

test('wrong password is refused', async () => {
  assert.equal((await login('alice', 'wrong')).res.status, 401);
  assert.equal((await login('mallory', 'correct horse')).res.status, 401);
});

test('signed-in user gets config, a reused credential and number checks', async () => {
  const { res, cookie } = await login('alice', 'correct horse');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/i);

  const meRes = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
  assert.deepEqual(await meRes.json(), {
    user: 'alice',
    callerId: '+15550000000',
    allowedPrefixes: ['+1'],
    defaultCountryCode: '1',
  });

  const first = await (await post('/api/token', {}, cookie)).json();
  const second = await (await post('/api/token', {}, cookie)).json();
  assert.equal(first.token, 'jwt-for-cred-1');
  assert.equal(second.token, 'jwt-for-cred-1');
  assert.equal(calls.filter((c) => c === 'POST /v2/telephony_credentials').length, 1);

  const ok = await post('/api/check-number', { number: '(555) 123-4567' }, cookie);
  assert.deepEqual(await ok.json(), { number: '+15551234567' });
  const premium = await post('/api/check-number', { number: '1-900-555-1234' }, cookie);
  assert.equal(premium.status, 400);
  const intl = await post('/api/check-number', { number: '+44 20 7946 0958' }, cookie);
  assert.equal(intl.status, 400);
});

test('a restarted server finds the existing credential instead of creating another', async () => {
  const config = loadConfig(env);
  const fresh = new TelnyxClient({ ...config, fetchImpl: fakeFetch });
  assert.equal(await fresh.loginTokenFor('alice'), 'jwt-for-cred-1');
  assert.equal(credentials.length, 1);
});

test('static page is served with a CSP', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self';/);
  assert.match(await res.text(), /Web Dialer/);
  const sdk = await fetch(`${base}/vendor/telnyx-webrtc.js`);
  assert.equal(sdk.status, 200);
  assert.match(await sdk.text(), /TelnyxWebRTC/);
});
