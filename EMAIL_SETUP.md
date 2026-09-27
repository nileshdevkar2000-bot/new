# NEO Production Email & Account Recovery

NEO sends System Administrator recovery mail to the `RECOVERY_EMAIL` address (default: `metaneo0256@gmail.com`). Approved-user recovery goes to the user's registered work email.

## Recommended provider: Resend

Set:

```env
NODE_ENV=production
RECOVERY_EMAIL=metaneo0256@gmail.com
RESEND_API_KEY=...
RESEND_FROM=NEO Security <no-reply@your-verified-domain.com>
```

## SMTP

Alternatively set:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=NEO Security <no-reply@your-domain.com>
```

The System Maintenance page has a **Send test email** action restricted to System Administrator. Use it after configuration before enabling recovery for users.

## Recovery behavior

- A recovery request generates a single-use, 15-minute token.
- System Administrator recovery is delivered to `RECOVERY_EMAIL` even when the stored administrator email is different.
- In production, recovery is rejected with a clear configuration error when no mail provider is configured; it does not silently pretend that an email was sent.
- In development/demo mode, a local preview link is returned so the flow can be smoke-tested without an email service.

## First-run setup

Run `./scripts/first-run.sh` on a new production deployment. It creates the production `.env`, prompts for the administrator password, recovery address, and either Resend or SMTP delivery settings, and keeps those secrets out of the ZIP.

## Production verification

NEO exposes **System Maintenance → Send test email** for System Administrators. In a real deployment, the endpoint uses the configured Resend HTTPS API or SMTP transport; SMTP is implemented with Nodemailer. Resend documents its Node.js email API, while Nodemailer documents authenticated SMTP and STARTTLS/TLS configuration.
