#!/bin/sh
# Play a WonderGate game in Mednafen with our adapter + server.
#
#   tools/play.sh "raku jongg"          # any part of the No-Intro file name
#   WS_ROMS=/path/to/roms tools/play.sh "star hearts"
#
# Adapter trace: logs/adapter.log    Server log: logs/server.log    Requests: captures/
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
ROMS=${WS_ROMS:-/Volumes/Games}
[ -n "$WS_ROMS" ] || [ -d "$ROMS/WonderSwan Color" ] || ROMS="$HOME/Documents"

[ -n "$1" ] || { echo "usage: $0 \"part of game name\""; exit 1; }
[ -d "$ROMS" ] || { echo "ROM folder $ROMS not mounted (set WS_ROMS)"; exit 1; }

ROM=$(find "$ROMS/WonderSwan Roms/Unzipped WS Roms" "$ROMS/WonderSwan Color/Unzipped Roms" \
        -type f \( -iname '*.ws' -o -iname '*.wsc' \) 2>/dev/null | grep -i -F -- "$1" | head -1)
[ -n "$ROM" ] || { echo "no ROM matching '$1' under $ROMS"; exit 1; }
echo "ROM: $ROM"

make -s -C "$DIR/host" wgcore-host
mkdir -p "$DIR/logs"

# Always run the current server code.
pkill -f "$DIR/server/wgserver.py" 2>/dev/null || true
python3 -I "$DIR/server/wgserver.py" >>"$DIR/logs/server.log" 2>&1 &
echo "server started (pid $!), log: logs/server.log"
sleep 0.5

echo "--- $(date) $(basename "$ROM")" >>"$DIR/logs/adapter.log"
exec mednafen -wswan.excomm 1 -wswan.excomm.path "$DIR/tools/mednafen-adapter.sh" "$ROM"
