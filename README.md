# NEO 2.3.1 — server-backed workspace build


This build includes:

- Server-side authentication with HttpOnly session cookies.
- Server-enforced role access on private HTML pages and APIs.
- 3-minute inactivity expiration without background polling extending the session.
- QA-wide incident review vs QC-only scope enforced on the server.
- Server-side NEO Agent orchestration using internal NEO knowledge and optional Google Programmable Search.
- Optional server-side chat, speech-to-text and text-to-speech provider adapters.
- Six Audit Command Center workflows with server-side state transitions:
  1. Front-room request capture
  2. Back-room evidence retrieval
  3. Exact SOP references
  4. Evidence-pack preparation
  5. Human SME verification
  6. Audit request history
- Append-only audit logging in the prototype server store (no clear endpoint / no clear UI action).
- NEO Agent voice UX: a single Gemini-style conversational surface with a compact NEO orb, continuous talk/listen mode, interruption handling, spoken answers and department-aware context.
- Browser speech is used by default; optional STT/TTS adapters can be enabled via `.env`.

## Run

Node.js 18+ is required.

```bash
cp .env.example .env
node server.js
```

Open `http://localhost:3000`.

## Demo accounts

- `neo.admin` / `Admin@123`
- `qa.user` / `QA@123`
- `qc.user` / `QC@123`
- `audit.front` / `Front@123`
- `audit.back` / `Back@123`
- `audit.admin` / `AuditAdmin@123`

Set the corresponding `NEO_*_PASSWORD` variables before the first server start for a non-demo deployment.

## Google knowledge

Set `GOOGLE_API_KEY` and `GOOGLE_CX` for Google Programmable Search. Credentials stay on the server; the browser calls `/api/google-search` through the authenticated session.

## Internal knowledge

Place approved `.md`, `.txt`, or `.json` knowledge sources in `knowledge/`. NEO indexes those files server-side and also indexes the site's own HTML page text.

## Optional live model / voice adapters

Set `NEO_CHAT_URL` for the server-side NEO chat gateway. The gateway receives the authenticated user scope plus internal knowledge and Google results.

Set `NEO_STT_URL` and/or `NEO_TTS_URL` for provider-neutral voice adapters. The browser voice experience works without these adapters where Web Speech APIs are available.

## Production note

For a validated regulated deployment, move the prototype JSON stores to a transactional database, add a durable distributed session store, rotate secrets, add centralized audit/WORM storage, harden CSP and CSRF defenses, and validate the full system according to your regulatory and security requirements.


See `DEPLOYMENT.md` for Google, internal knowledge, NEO gateway, voice and audit workflow configuration.

## QMS design refresh
The QMS entry experience is now a connected quality control room: quality signals, contextual AI, deviations, incidents, controlled knowledge, audit, and traceability appear as one system. This is an original NEO design informed by public product patterns from enterprise QMS vendors.

## Privacy / AI controls
Open `privacy.html` for the NEO privacy-by-design principles. Internal knowledge is permission-scoped. External Google search is optional. Voice recordings are not persisted by this prototype; browser speech mode is ephemeral unless you configure a server STT/TTS provider.

## Clinical / Pharmacovigilance expansion

NEO now includes department work surfaces for Clinical Trial, Pharmacovigilance, Regulatory Affairs, Medical Affairs, QA, QC, Manufacturing, Production, Supply Chain, R&D, Complaint Handling, Opex / Continuous Improvement and IT & Digital Operations.

The Clinical and Pharmacovigilance surfaces follow public patterns from current life-sciences AI products: study-centric intelligence and conversational assistance in clinical operations; safety intake, case processing, narrative support, signal detection and cross-functional connections in pharmacovigilance; and connected quality/regulatory workflows with human approval. The implementation is original NEO UX and does not copy third-party UI or text.

## Conversational Voice

When `GOOGLE_GEMINI_API_KEY` is configured, NEO can mint a short-lived Gemini Live ephemeral token from the authenticated server and use the Gemini Live WebSocket directly from the browser. This enables low-latency audio, live input/output transcription, interruption handling and Google Search/tool use without exposing the long-lived Gemini API key. The fallback browser voice mode remains available when Live Voice is not configured.

See `knowledge/benchmark-sources.md` for the public references used for the clinical, safety, quality, enterprise-agent and voice architecture.


## Release 2.1 operational notes
- Login is server-side and all workspace routes are protected by role.
- Public users see only the introduction, public company pages, login, signup and password recovery until authentication succeeds.
- Every signup is recorded as a pending request for the System Administrator.
- System Administrator maintenance is hidden from non-admin navigation and server-protected.
- Password recovery uses Resend first, SMTP second, and a local outbox fallback in development.
- Deviation creation is department-scoped by the server and the form automatically narrows the department selector to the current user's authorized scope.
- Enterprise connectors are server-side only: Google Drive, Microsoft 365/SharePoint, Salesforce, Slack, ServiceNow, Jira and Confluence.
- Clinical and Pharmacovigilance live voice sessions receive department-specific workflow tools.

## Direct Gemini answer engine

Set `GOOGLE_GEMINI_API_KEY` and `NEO_TEXT_MODEL=gemini-3.8-flash` to let NEO answer directly through Gemini when `NEO_CHAT_URL` is not configured. Google web search and enterprise connector results are supplied as controlled context.

## Production recovery

Configure Resend or SMTP. System Administrator recovery routes to `RECOVERY_EMAIL` (default `metaneo0256@gmail.com`). Use **System Maintenance → Send test email** before enabling production recovery.
