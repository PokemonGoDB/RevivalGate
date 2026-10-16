Swan Revival Link __VERSION__

Puts WonderSwan WonderGate games online with RevivalGate, for Mednafen and for a real console
with an ExtFriend-compatible cable. It stands in for the 2001 WonderGate adapter and phone.
Your game and console stay as they are: no patches.

Needs Node.js 22 or newer (https://nodejs.org/).

Keep this folder somewhere it can stay, such as ~/swan-link, then:

  Mednafen:      ~/swan-link/swan-link --setup-mednafen   (once, with Mednafen closed),
                 then open any game in Mednafen. Or each time:
                 mednafen -wswan.excomm 1 -wswan.excomm.path ~/swan-link/swan-link "game.wsc"
  Real console:  ~/swan-link/swan-link --serial /dev/cu.usbmodem1101
  Your name on your scores (optional, code from swanrevival.com/account/):
                 ~/swan-link/swan-link --link ABCD2345

The full guide: https://swanrevival.com/revival-gate/play/
What happens is logged to ~/.swanrevival/link.log.

bin/wgcore-host is the adapter, built __BUILT__.
NOTICE-wonderfence.txt covers the adapter's protocol handling (MIT).
