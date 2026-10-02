// Minimal Telnyx REST client for issuing WebRTC login tokens.
// Docs: https://developers.telnyx.com/docs/voice/webrtc/auth/jwt

const API = 'https://api.telnyx.com/v2';

export class TelnyxClient {
  constructor({ apiKey, connectionId, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.connectionId = connectionId;
    this.fetch = fetchImpl;
    this.credentialIds = new Map();
  }

  async request(method, path, body) {
    const res = await this.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Telnyx ${method} ${path} failed with ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return text;
  }

  credentialName(username) {
    return `dialer-${username}`;
  }

  // One telephony credential per dialer user, reused across sessions and server restarts.
  async credentialIdFor(username) {
    if (this.credentialIds.has(username)) return this.credentialIds.get(username);
    const name = this.credentialName(username);

    const query = new URLSearchParams({ 'filter[name]': name, 'page[size]': '25' });
    const existing = JSON.parse(await this.request('GET', `/telephony_credentials?${query}`));
    let credential = (existing.data || []).find((c) => c.name === name && !c.expired);

    if (!credential) {
      const created = JSON.parse(
        await this.request('POST', '/telephony_credentials', { connection_id: this.connectionId, name }),
      );
      credential = created.data;
    }
    this.credentialIds.set(username, credential.id);
    return credential.id;
  }

  // Returns a short-lived JWT the browser SDK uses as `login_token`.
  async loginTokenFor(username) {
    const id = await this.credentialIdFor(username);
    try {
      return (await this.request('POST', `/telephony_credentials/${id}/token`)).trim();
    } catch (err) {
      // The credential was deleted in the portal; forget it and create a fresh one.
      if (err.status === 404 || err.status === 422) {
        this.credentialIds.delete(username);
        const freshId = await this.credentialIdFor(username);
        return (await this.request('POST', `/telephony_credentials/${freshId}/token`)).trim();
      }
      throw err;
    }
  }
}
