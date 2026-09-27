#!/usr/bin/env bash
set -euo pipefail

read -r -s -p "NEO System Administrator password (min 12 chars): " P1; echo
read -r -s -p "Repeat password: " P2; echo
[ "$P1" = "$P2" ] || { echo "Passwords do not match"; exit 1; }
[ ${#P1} -ge 12 ] || { echo "Password too short"; exit 1; }

read -r -p "Public origin [http://localhost:3000]: " ORIGIN
ORIGIN=${ORIGIN:-http://localhost:3000}
read -r -p "Recovery email [metaneo0256@gmail.com]: " RECOVERY
RECOVERY=${RECOVERY:-metaneo0256@gmail.com}
read -r -p "Email provider (resend/smtp/none) [resend]: " PROVIDER
PROVIDER=${PROVIDER:-resend}

RESEND_API_URL="https://api.resend.com/emails"
RESEND_API_KEY=""
RESEND_FROM=""
SMTP_HOST=""
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""

case "$PROVIDER" in
  resend)
    read -r -s -p "Resend API key: " RESEND_API_KEY; echo
    read -r -p "Verified sender (for example NEO Security <no-reply@yourdomain.com>): " RESEND_FROM
    [ -n "$RESEND_API_KEY" ] && [ -n "$RESEND_FROM" ] || { echo "Resend API key and sender are required."; exit 1; }
    ;;
  smtp)
    read -r -p "SMTP host: " SMTP_HOST
    read -r -p "SMTP port [587]: " SMTP_PORT_IN; SMTP_PORT=${SMTP_PORT_IN:-587}
    read -r -p "SMTP secure? (true/false) [false]: " SMTP_SECURE_IN; SMTP_SECURE=${SMTP_SECURE_IN:-false}
    read -r -p "SMTP username: " SMTP_USER
    read -r -s -p "SMTP password: " SMTP_PASS; echo
    read -r -p "SMTP from (for example NEO Security <no-reply@yourdomain.com>): " SMTP_FROM
    [ -n "$SMTP_HOST" ] && [ -n "$SMTP_USER" ] && [ -n "$SMTP_PASS" ] && [ -n "$SMTP_FROM" ] || { echo "SMTP settings are incomplete."; exit 1; }
    ;;
  none)
    ;;
  *) echo "Choose resend, smtp or none."; exit 1 ;;
esac

cat > .env <<EOF
NODE_ENV=production
PORT=3000
NEO_DEMO_MODE=false
NEO_ADMIN_PASSWORD=$P1
RECOVERY_EMAIL=$RECOVERY
PUBLIC_ORIGIN=$ORIGIN
ALLOWED_ORIGINS=$ORIGIN
RESEND_API_URL=$RESEND_API_URL
RESEND_API_KEY=$RESEND_API_KEY
RESEND_FROM=$RESEND_FROM
GOOGLE_API_KEY=
GOOGLE_CX=
GOOGLE_GEMINI_API_KEY=
NEO_LIVE_MODEL=gemini-3.8-live
NEO_TEXT_MODEL=gemini-3.8-flash
NEO_CHAT_URL=
NEO_CHAT_AUTH=
NEO_CONNECTORS_ENABLED=true
NEO_CONNECTORS_AUTO=true
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_SECURE=$SMTP_SECURE
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_FROM=$SMTP_FROM
EOF
chmod 600 .env
echo "Configured NEO production environment."
echo "Run: npm install && npm run check && npm start"
