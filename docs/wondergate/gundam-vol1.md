# Mobile Suit Gundam Vol. 1: Side 7: missed weapons ✅

Status: **working** headless (2026-10-13). Sayla connects and unlocks the Gundam Hammer and
Javelin ("『ガンダムハンマー』『ジャベリン』が使用可能になったわ"), then returns to the title.

How to reach it: the title menu shows NEW GAME / CONTINUE / WONDERGATE once the game has
been cleared. The regression replay fakes a cleared save with SRAM `0x30=1`, `0x34=1`, then a
reset. Then WONDERGATE (DOWN, A) → Sayla's dialogue → "ゲート準備OK (接続します)".

## Exchange

Only `POST /service/charge/nph-gettime` (`Host: wgb01.channel.or.jp`) → `TIME-RET: 0`,
`TIME-NOW`. The ROM also has nph-srvcinfo / nph-session / nph-contents templates, but this
path doesn't use them.
