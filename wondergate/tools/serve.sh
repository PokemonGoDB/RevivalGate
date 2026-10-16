#!/bin/sh
# (Re)start the dev game server in the background. Log: logs/server.log
DIR=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$DIR/logs"
pkill -f "$DIR/server/wgserver.py" 2>/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do
  lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 0.2
done
if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port 8080 is held by another process:"; lsof -nP -iTCP:8080 -sTCP:LISTEN; exit 1
fi
nohup python3 -I "$DIR/server/wgserver.py" >>"$DIR/logs/server.log" 2>&1 </dev/null &
sleep 0.5
lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1 || { echo "server failed to start; see logs/server.log"; tail -5 "$DIR/logs/server.log"; exit 1; }
echo "server running (pid $!)"
