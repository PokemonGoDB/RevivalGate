# Last Alive: leftover WonderGate code (no feature)

Found by scanning every ROM for WonderGate code (2026-10-14). Bandai, 2001-07-26 (SWJ-BANC15), the 4th
"Novel Theater" game after Terrors, Ring∞ and Terrors 2. Its product page says "通信 不可", and no
player post mentions WonderGate.

The ROM holds Terrors 2's exact check-in at `0x34E415`:
`GET /cgi-bin/accsess.cgi?T2=www.sign-eight.co.jp HTTP/1.1`, `Host: terrors2.wgg.channel.or.jp`,
`User-Agent: SWAN/1.0`. No WonderGate menu text was found. It is shared code carried over from
Terrors 2 (see [ring-terrors.md](ring-terrors.md)), and **nothing calls it** (static check, 2026-10-14).

## The code can't run

Both games keep the Novel Theater engine in ROM bank `0x34`, with the WonderGate module at the same
place (Last Alive's addresses are Terrors 2's minus `0x740`):

| | Terrors 2 | Last Alive |
|---|---|---|
| Strings (host, request) | `34:EB55`, `34:EB70` | `34:E415`, `34:E430` |
| Session routine (dial, DNS, request, hang-up) | `34:E348` | `34:DC08` |
| Entry wrapper (calls the session, stores its result) | `34:04CF` | `34:053B` |
| Caller of the wrapper | `34:DE9B`, the menu handler when `[0xAFF] = 2` and a button is pressed | **none** |

In Last Alive the strings are only used inside the module, the session routine's only caller is the
wrapper at `34:053B`, and nothing reaches the wrapper: a byte scan of the whole ROM finds no near
call or jump to it within bank `0x34`, no far call or jump (`9A`/`EA`) to it, no 16-bit copy of
`0x053B` anywhere in bank `0x34` (so no near pointer, e.g. for the engine's callback slot
`[0x447]`), and no far pointer `053B:2000/3000/4000` elsewhere; the Terrors 2 menu sequence that
calls it is absent. So Last Alive can never send the check-in. The
request would be answered anyway (`access.terrors2`), but no console will ask.

Note: sign-eight.co.jp belonged to a signage firm, not a game company. The archived
terrors2.wgg.channel.or.jp page says "TERRORS2(2000/08/09) Wander Gate Programed by fire mio".
