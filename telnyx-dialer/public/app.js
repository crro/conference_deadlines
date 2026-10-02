'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  loginView: $('login-view'),
  loginForm: $('login-form'),
  loginError: $('login-error'),
  dialerView: $('dialer-view'),
  who: $('who'),
  logout: $('logout'),
  status: $('status'),
  dialForm: $('dial-form'),
  number: $('number'),
  keypad: $('keypad'),
  call: $('call'),
  mute: $('mute'),
  backspace: $('backspace'),
  hint: $('hint'),
};

const ENDED_STATES = new Set(['hangup', 'destroy', 'purge']);
let me = null;
let client = null;
let currentCall = null;
let ready = false;
let timer = null;
let reconnectTimer = null;
let signingOut = false;

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') showLogin();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setStatus(text) {
  els.status.textContent = text;
}

function showLogin() {
  disconnect();
  me = null;
  els.dialerView.hidden = true;
  els.loginView.hidden = false;
  els.loginForm.username.focus();
}

function showDialer() {
  els.loginView.hidden = true;
  els.dialerView.hidden = false;
  els.who.textContent = `Signed in as ${me.user}`;
  els.hint.textContent = `Caller ID ${me.callerId} · calls to ${me.allowedPrefixes.join(', ') || 'any number'}`;
  els.number.focus();
}

function updateControls() {
  const inCall = Boolean(currentCall);
  els.call.disabled = !ready && !inCall;
  els.call.textContent = inCall ? 'Hang up' : 'Call';
  els.call.classList.toggle('hangup', inCall);
  els.mute.disabled = !inCall;
  if (!inCall) {
    els.mute.setAttribute('aria-pressed', 'false');
    els.mute.textContent = 'Mute';
  }
}

async function connect() {
  clearTimeout(reconnectTimer);
  ready = false;
  updateControls();
  setStatus('Connecting…');
  let token;
  try {
    ({ token } = await api('/api/token', {}));
  } catch (err) {
    setStatus(err.message);
    return;
  }

  client = new TelnyxWebRTC.TelnyxRTC({ login_token: token });
  client.remoteElement = 'remote-audio';
  client.enableMicrophone();
  client.disableWebcam();

  client.on('telnyx.ready', () => {
    ready = true;
    setStatus('Ready');
    updateControls();
  });
  client.on('telnyx.error', (event) => {
    console.error('Telnyx error', event);
    setStatus('Connection error. Retrying…');
  });
  client.on('telnyx.socket.close', () => {
    ready = false;
    updateControls();
    if (signingOut || !me) return;
    // Tokens are short-lived, so fetch a new one on every reconnect.
    setStatus('Disconnected. Reconnecting…');
    disconnect();
    reconnectTimer = setTimeout(connect, 3000);
  });
  client.on('telnyx.notification', (notification) => {
    if (notification.type === 'callUpdate') onCallUpdate(notification.call);
  });

  client.connect();
}

function disconnect() {
  clearTimeout(reconnectTimer);
  stopTimer();
  currentCall = null;
  ready = false;
  if (client) {
    const old = client;
    client = null;
    try { old.disconnect(); } catch { /* already closed */ }
  }
  updateControls();
}

function startTimer() {
  if (timer) return;
  const started = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    setStatus(`In call · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  };
  tick();
  timer = setInterval(tick, 1000);
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
}

function onCallUpdate(call) {
  if (currentCall && call.id !== currentCall.id) return;
  currentCall = call;
  switch (call.state) {
    case 'new':
    case 'requesting':
    case 'trying':
      setStatus('Calling…');
      break;
    case 'early':
    case 'ringing':
      setStatus('Ringing…');
      break;
    case 'active':
      startTimer();
      break;
    case 'held':
      setStatus('On hold');
      break;
    default:
      if (ENDED_STATES.has(call.state)) {
        stopTimer();
        currentCall = null;
        const reason = call.cause && call.cause !== 'NORMAL_CLEARING' ? ` (${call.cause.replaceAll('_', ' ').toLowerCase()})` : '';
        setStatus(`Call ended${reason}`);
        setTimeout(() => { if (!currentCall && ready) setStatus('Ready'); }, 3000);
      }
  }
  updateControls();
}

async function placeCall() {
  const raw = els.number.value.trim();
  if (!raw) return;
  els.call.disabled = true;
  try {
    const { number } = await api('/api/check-number', { number: raw });
    els.number.value = number;
    currentCall = client.newCall({
      destinationNumber: number,
      callerNumber: me.callerId,
      audio: true,
      video: false,
    });
    setStatus('Calling…');
  } catch (err) {
    setStatus(err.message);
  } finally {
    updateControls();
  }
}

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.loginError.textContent = '';
  const form = new FormData(els.loginForm);
  try {
    await api('/api/login', { username: form.get('username'), password: form.get('password') });
    els.loginForm.reset();
    await start();
  } catch (err) {
    els.loginError.textContent = err.message;
  }
});

els.logout.addEventListener('click', async () => {
  signingOut = true;
  if (currentCall) currentCall.hangup();
  disconnect();
  await api('/api/logout', {}).catch(() => {});
  signingOut = false;
  showLogin();
});

els.dialForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (currentCall) currentCall.hangup();
  else if (ready) placeCall();
});

els.keypad.addEventListener('click', (e) => {
  const key = e.target.closest('button')?.dataset.key;
  if (!key) return;
  if (currentCall?.state === 'active') currentCall.dtmf(key);
  else els.number.value += key;
});

// Long-press 0 for "+", like a phone keypad.
let zeroPress = null;
const zeroKey = els.keypad.querySelector('[data-key="0"]');
zeroKey.addEventListener('pointerdown', () => {
  zeroPress = setTimeout(() => {
    zeroPress = 'fired';
    if (!currentCall) els.number.value += '+';
  }, 600);
});
zeroKey.addEventListener('pointerup', () => { if (zeroPress !== 'fired') clearTimeout(zeroPress); });
zeroKey.addEventListener('click', (e) => {
  if (zeroPress === 'fired') {
    e.stopImmediatePropagation();
    zeroPress = null;
  }
}, true);

els.backspace.addEventListener('click', () => {
  els.number.value = els.number.value.slice(0, -1);
});

els.mute.addEventListener('click', () => {
  if (!currentCall) return;
  const muted = els.mute.getAttribute('aria-pressed') === 'true';
  if (muted) currentCall.unmuteAudio();
  else currentCall.muteAudio();
  els.mute.setAttribute('aria-pressed', String(!muted));
  els.mute.textContent = muted ? 'Mute' : 'Unmute';
});

window.addEventListener('beforeunload', () => {
  if (currentCall) currentCall.hangup();
});

async function start() {
  try {
    me = await api('/api/me');
  } catch {
    return; // api() already showed the sign-in form on 401
  }
  showDialer();
  connect();
}

start();
