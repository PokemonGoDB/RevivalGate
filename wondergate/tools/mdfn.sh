#!/bin/sh
# Drive the running Mednafen: tools/mdfn.sh key[:ms] ...   (snap: tools/mdfn.sh snap)
# Keys: x=A  z=B  enter=Start  arrows=X-pad  esc=quit. "snap" saves a screenshot
# and prints its path. Brings Mednafen to the front before every call.
DIR=$(cd "$(dirname "$0")" && pwd)
PID=$(pgrep -x mednafen | head -1)
[ -n "$PID" ] || { echo "mednafen not running"; exit 1; }
[ -x "$DIR/mdfnkey" ] || cc -O2 -o "$DIR/mdfnkey" "$DIR/mdfnkey.c" -framework ApplicationServices
osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $PID) to true"
sleep 0.3
if [ "$1" = snap ]; then
  before=$(ls "$HOME/.mednafen/snaps" | grep -c png)
  "$DIR/mdfnkey" f9:150
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(ls "$HOME/.mednafen/snaps" | grep -c png)" -gt "$before" ] && break
    sleep 0.2
  done
  [ "$(ls "$HOME/.mednafen/snaps" | grep -c png)" -gt "$before" ] || { echo "snapshot failed"; exit 1; }
  echo "$HOME/.mednafen/snaps/$(ls -t "$HOME/.mednafen/snaps" | grep png | head -1)"
else
  "$DIR/mdfnkey" "$@"
fi
