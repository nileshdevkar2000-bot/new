# NEO 2.2.0 — Deployment Release Notes

## Fixed
- Server-side login/signup flow is now the source of truth.
- Protected workspace pages redirect to login until authentication succeeds.
- Login includes show/hide password and forgot-password recovery.
- Public signup supports every NEO department and department-specific role selections.
- Every signup is routed to System Administrator approval before login is enabled.
- System Maintenance is System-Administrator-only and hidden from other users.
- Deviation creation uses canonical department names server-side, fixing the prior create/load failure path.
- Locked deviations remain viewable.
- Audit trail has no clear/delete endpoint or UI action.

## Enterprise AI
- Server-side enterprise connector layer for Google Drive, Microsoft 365/SharePoint, Salesforce, Slack, ServiceNow, Jira and Confluence.
- Connector scope controls via `NEO_CONNECTOR_SCOPES`.
- NEO Agent combines permission-scoped internal knowledge, configured enterprise sources, optional Google web search and an optional server-side model gateway.

## Conversational Voice
- Replaced the large voice-engine control panel with a compact Gemini-style NEO conversation surface. Voice stays attached to the current department context and can use authorized internal knowledge, enterprise connectors and Google search when configured.
- Gemini Live uses short-lived ephemeral tokens issued by the authenticated NEO server.
- Clinical Trial voice workflows: feasibility, protocol, startup, safety handoff.
- Pharmacovigilance voice workflows: intake, signal, literature, narrative.
- Department context is enforced server-side before a voice session token is created.

## Deployment
- Production mode seeds only the System Administrator account.
- Demo credentials are available only when `NEO_DEMO_MODE=true`.
- `.data/` is intentionally excluded from the release archive so deployment starts clean.
- Configure `NEO_ADMIN_PASSWORD`, `PUBLIC_ORIGIN`, mail delivery, Google/Gemini credentials, connector credentials and optional NEO gateway settings before production launch.
- Use a shared session store before multi-instance load balancing.
