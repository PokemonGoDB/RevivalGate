#!/bin/sh
# Mednafen runs this as wswan.excomm.path (with a dummy argument): blesim is the adapter,
# stdin/stdout are the emulated console's serial line. Trace: logs/blesim.log.
#   mednafen -wswan.excomm 1 -wswan.excomm.path "$PWD/tools/blesim/mednafen-blesim.sh" game.wsc
DIR=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$DIR/logs"
exec "$DIR/tools/blesim/blesim" --config "${BLESIM_CONFIG:-$DIR/dev.conf}" --log "$DIR/logs/blesim.log" --quiet
