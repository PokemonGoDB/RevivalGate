#!/bin/sh
# Build a headless WonderSwan core with our WonderGate adapter on its serial port.
#
# Starts from the translation project's wscli core checkout (Beetle WonderSwan +
# its debugger bridge), copied into wondergate/local/ so that project is never
# modified, then swaps in emu/comm.c, links core/wg.c + core/wg_posix.c (+ the
# Bluetooth tunnel, core/wg_tunnel.c + core/wg_tunnel_stream.c), and makes
# the serial transmit-empty interrupt level-triggered.
#
#   emu/build_core.sh [path/to/wscli-core]
#
# Output: wondergate/local/wscli-core-wg/mednafen_wswan_libretro.dylib
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
SRC=${1:-"${WSCLI_HOME:?set WSCLI_HOME to the headless emulator host (see README.md), or pass its wscli-core path}/local/wscli-core"}
DST="$DIR/local/wscli-core-wg"

[ -f "$SRC/Makefile.common" ] || { echo "no wscli core checkout at $SRC"; exit 1; }
mkdir -p "$DIR/local"
rsync -a --delete --exclude '*.o' --exclude '*.dylib' --exclude '*.so' "$SRC/" "$DST/"

W="$DST/mednafen/wswan"
cp "$DIR/emu/comm.c" "$W/comm.c"
for f in wg wg_posix wg_tunnel wg_tunnel_stream; do cp "$DIR/core/$f.c" "$DIR/core/$f.h" "$W/"; done
grep -q 'wg_tunnel_stream.c' "$DST/Makefile.common" || \
  sed -i '' 's|\t\$(CORE_EMU_DIR)/comm.c \\|\t$(CORE_EMU_DIR)/comm.c \\\n\t$(CORE_EMU_DIR)/wg.c \\\n\t$(CORE_EMU_DIR)/wg_posix.c \\\n\t$(CORE_EMU_DIR)/wg_tunnel.c \\\n\t$(CORE_EMU_DIR)/wg_tunnel_stream.c \\|' "$DST/Makefile.common"
grep -q 'wg_tunnel_stream.c' "$DST/Makefile.common" || { echo "couldn't add wgcore to Makefile.common"; exit 1; }
# Transmit-empty is level-triggered on hardware (see emu/comm.c).
sed -i '' 's|LevelTriggeredMask = (1U << WSINT_SERIAL_RECV);|LevelTriggeredMask = (1U << WSINT_SERIAL_RECV) \| (1U << WSINT_SERIAL_SEND);|' "$W/interrupt.c"
grep -q '(1U << WSINT_SERIAL_SEND);' "$W/interrupt.c" || { echo "couldn't patch interrupt.c"; exit 1; }

# A timer whose counter holds 1 fires every line even with its countdown disabled
# (ws.nesdev.org/wiki/Timers). Tonpuusou's voice driver sets HBlank reload = 1 and
# never sets the enable bit; without this its menus wait forever for a voice to end.
grep -q 'HBCounter == 1 && !(BTimerControl & 0x01)' "$W/gfx.c" || \
  perl -0pi -e 's|(\n   if\(HBCounter && \(BTimerControl & 0x01\)\)\n)|\n   if(HBCounter == 1 && !(BTimerControl & 0x01))\n      WSwan_Interrupt(WSINT_HBLANK_TIMER);\n$1|' "$W/gfx.c"
grep -q 'HBCounter == 1 && !(BTimerControl & 0x01)' "$W/gfx.c" || { echo "couldn't patch gfx.c"; exit 1; }

make -C "$DST" -j4 >"$DIR/local/build-core.log" 2>&1 || { tail -30 "$DIR/local/build-core.log"; exit 1; }
ls -la "$DST"/mednafen_wswan_libretro.*
