# Web Dialer (Telnyx)

A small web app for calling regular phone numbers from the browser, a stand-in for Skype's old "call phones" feature. It uses [Telnyx WebRTC](https://developers.telnyx.com/docs/voice/webrtc): audio goes from the browser straight to Telnyx, and Telnyx connects the call to the phone network.

```
Browser (dial pad + @telnyx/webrtc) ──WebRTC──► Telnyx ──► phone network ──► the number you dialed
        │
        └─ sign-in, login tokens, number checks ──► this Node server ──► Telnyx REST API (holds the API key)
```

- Sign in with a username and password (accounts are set in `.env`).
- Dial pad with mute, keypad tones during calls (for menus like "press 1"), and long-press `0` for `+`.
- Numbers are converted to international format (E.164) and checked against an allowlist before dialing.
- Each user gets their own Telnyx telephony credential. The browser only ever receives a short-lived login token, never the API key.

## 1. Set up Telnyx (one-off, in the Mission Control portal)

1. **Buy a number** under *Numbers → Search & Buy*. It becomes the caller ID people see.
2. **Create an Outbound Voice Profile** under *Voice → Outbound Voice Profiles*. **This is your real protection against abuse**:
   - **Allowed destinations:** only the countries you want to call (e.g. just United States and Canada).
   - **Daily spend limit:** set one, e.g. $10/day.
3. **Create a Credential Connection** under *Voice → SIP Trunking → Add connection*, type **Credentials**.
   - On its *Outbound* tab, select the Outbound Voice Profile from step 2.
   - Assign your number from step 1 to this connection.
   - Copy the connection's **ID**.
4. **Create an API key** under *Account Settings → API Keys*.

## 2. Configure and run

Requires Node 20.6 or newer.

```bash
cd telnyx-dialer
npm install
cp .env.example .env    # then fill in the values
npm start               # http://localhost:3000
```

| Setting | What it does |
| --- | --- |
| `TELNYX_API_KEY` | API key from step 4. Server-side only. |
| `TELNYX_CONNECTION_ID` | Credential Connection ID from step 3. |
| `CALLER_ID_NUMBER` | Your Telnyx number in E.164, e.g. `+15551234567`. |
| `USERS` | `user:password` pairs separated by commas. Use long passwords. |
| `SESSION_SECRET` | 32+ random characters, e.g. `openssl rand -hex 32`. |
| `ALLOWED_PREFIXES` | Numbers users may dial, by prefix. Default `+1` (US and Canada). Use e.g. `+1,+44` to add the UK, or leave empty to allow anything the voice profile allows. |
| `BLOCKED_PREFIXES` | Always refused. Default `+1900,+1976` (US premium-rate numbers). |
| `DEFAULT_COUNTRY_CODE` | Country code for numbers typed without `+`. Default `1`. |
| `SECURE_COOKIES` | Set to `true` when served over HTTPS. |

Browsers only allow microphone access on `localhost` or over **HTTPS**, so deploy behind HTTPS: Render, Fly.io or Railway, or a VPS behind Caddy or nginx. Run a single instance, because sign-in rate limits are kept in memory.

## How the limits work

- The server checks every number before the browser dials it (`/api/check-number`), and logs each call as `[call] user -> number`.
- The browser places the call itself, so a signed-in user who modifies the page could skip that check. **The Outbound Voice Profile's allowed destinations and spend limit are what actually stop expensive calls**, so set them in step 2.
- Removing a user from `USERS` and restarting locks them out of the app. Their existing login token stays valid until it expires (Telnyx tokens last up to 24 hours). To cut them off right away, delete their `dialer-<username>` credential under *Voice → SIP Trunking → your connection*.

**Emergency calls:** this app is not set up for 911/112 and refuses short numbers. Tell users to call emergency services from a regular phone.

## Tests

```bash
npm test
```

They cover number formatting and the allowlist, sign-in and sessions, and the token flow (using a fake Telnyx API).
