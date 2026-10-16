#!/bin/sh
# Mednafen runs this as wswan.excomm.path (with a dummy argument).
# stdin/stdout are the emulated console's serial line; logs go to logs/.
DIR=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$DIR/logs"
exec "$DIR/host/wgcore-host" --config "$DIR/dev.conf" --log "$DIR/logs/adapter.log" 2>/dev/null
