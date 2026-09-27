#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
if [ ! -d node_modules ]; then npm install; fi
export NODE_ENV=${NODE_ENV:-development}
export NEO_DEMO_MODE=${NEO_DEMO_MODE:-true}
export PORT=${PORT:-3000}
exec node server.js
