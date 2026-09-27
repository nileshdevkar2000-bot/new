#!/bin/sh
cd "$(dirname "$0")"
"$PWD/start-neo.sh" &
server_pid=$!
sleep 2
open "http://localhost:${PORT:-3000}/"
wait "$server_pid"
