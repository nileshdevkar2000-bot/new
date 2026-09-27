# NEO Server-Backed Deployment

## Start

Requires Node.js 18+.

```bash
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

## Server-side access control

Private HTML pages and all NEO APIs are protected by the server. Sessions are held server-side and represented in an HttpOnly `neo_sid` cookie. The inactivity window is 3 minutes and is refreshed only by authenticated activity through `/api/touch`.

Demo accounts are created on first start only when no user store exists. Replace all demo passwords before production use.

## Google knowledge

NEO uses Google Programmable Search through the server. Set:

```env
GOOGLE_API_KEY=...
GOOGLE_CX=...
```

The browser never receives these credentials. The NEO Agent has a **Use Google web knowledge** control, and current/latest/web questions automatically request Google search when the connection is configured.

## Internal knowledge

Place approved `.md`, `.txt`, and `.json` sources in `knowledge/`. NEO searches these sources server-side and also indexes the NEO HTML workspace content. The `knowledge/` directory is not directly served to browsers.

## NEO answer engine

Set `NEO_CHAT_URL` to your approved server-side NEO/model gateway. NEO sends the authenticated user scope together with retrieved internal knowledge and Google results. The gateway should return one of `answer`, `output_text`, or `text`.

## Voice

The Agent includes:

- speech recognition when the browser supports Web Speech
- hands-free auto-send
- interrupt/stop listening
- spoken NEO responses
- stop speaking / Escape-to-stop
- voice selection and speed control
- optional Google/manual web-knowledge toggle
- optional provider-neutral server STT/TTS adapters

Configure optional adapters with `NEO_STT_URL` / `NEO_STT_AUTH` and `NEO_TTS_URL` / `NEO_TTS_AUTH`.

## Audit Command Center

The six workflows are server-backed:

1. Front-room request capture
2. Back-room evidence retrieval
3. Exact SOP references
4. Evidence-pack preparation
5. Human SME verification
6. Audit request history

Allowed transitions are enforced on the server. Evidence can only move to presentation after SME approval.

## Audit administration

Audit Administrators and System Administrators can create Front Room and Back Room profiles through the Audit Access Administration page. Credentials are stored as salted scrypt password hashes.

## QMS protections

QA/System Admin can review incidents across departments. QC is restricted to QC records. Locked deviations remain viewable, while the signed workflow step cannot be reopened. Signatures are recorded server-side and the signature modal closes automatically after success.

## Production hardening

This package is a server-backed prototype. For regulated production deployment, replace JSON persistence with a transactional database, use a durable/distributed session store, store secrets outside the filesystem, add centralized/WORM audit storage, enforce HTTPS, add CSP and operational monitoring, and perform your required validation and security assessment.


## Production checklist
1. Copy `.env.production.example` to `.env` and set `NEO_ADMIN_PASSWORD`, `PUBLIC_ORIGIN`, mail, Google/Gemini and connector credentials.
2. Run `npm install`. The release uses Node 18.18+; Node 22 is recommended.
3. Run `npm run check`.
4. Start with `npm start` or build/run the included Docker image.
5. Do not copy `.data` from a development environment into production. The server creates a fresh store.
6. In production, password recovery requires Resend or SMTP. In development only, the outbox fallback is used.
7. Use delegated/service credentials with least privilege for enterprise connectors and configure `NEO_CONNECTOR_SCOPES` where a connector should be limited to selected roles/departments.
8. For multi-instance deployments, replace the in-memory session store with a shared session store such as Redis before load balancing.

## 2.3.1 authentication and recovery fix

The session cookie is `Secure` only when NEO is actually served through HTTPS (including a reverse proxy that sends `X-Forwarded-Proto: https`). This prevents the production-mode cookie from disappearing when running a local or internal HTTP deployment.

A legacy System Administrator record without a `passwordSource` marker is synchronized once to `NEO_ADMIN_PASSWORD`; after a successful user-managed login or password reset it is marked user-managed.

Use **System Maintenance → Send test email** after configuring Resend or SMTP. In production, NEO returns a configuration error when no real provider is configured instead of pretending recovery mail was delivered.

## Gemini text + voice

Set `GOOGLE_GEMINI_API_KEY` to enable both Gemini Live and the direct text answer fallback. `NEO_TEXT_MODEL=gemini-3.8-flash` is the default text model. A custom `NEO_CHAT_URL` remains supported and takes precedence.

Google's current API documentation describes `generateContent` for standard text responses and the Live API for bidirectional real-time voice; NEO keeps the long-lived API key server-side and issues short-lived Live credentials to authenticated browsers.

## Local smoke test

```bash
npm install
npm run check
npm start
./scripts/smoke-test.sh
```

For production, run `./scripts/first-run.sh` once to create the administrator environment, then verify the email provider from **System Maintenance** before enabling user recovery.
