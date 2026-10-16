# Ring Infinity and Terrors 2: accsess.cgi check-ins ✅

Both are by the same developer and share a serial/HTTP library that reads **exactly 7 lines**
(status and headers, contents ignored) and then one block of up to 127 bytes. A reply with
fewer lines leaves the cartridge waiting for the server to hang up. The server
([`server/access.py`](../../wondergate/server/access.py)) sends 7 lines and closes.

## Ring Infinity ✅ (2026-10-13)

`GET /ring/cgi-bin/accsess.cgi?RING=666` on `wgg02.channel.or.jp`. Title (vertical): Y_LEFT →
ワンダーゲート, DOWN → 通信しますか はい → "メールを受信しました". The menu gains メールを読む. The
**mails are in the ROM**: after a successful check-in the cartridge picks a hint mail from story
progress and chance (ROM `0x34C47C`, chapter `[0xC14]`). The body is not used. First mail:
件名「井戸の中からこんにちは!」 from ジジ.

### There was no scenario download

Fan sources mention an "additional scenario" over WonderGate. There never was one to download:
the game has no way to receive one. Its only network string is this check-in URL, and the reply
body (it lands at RAM `0x9C8`, cut to 22 bytes) is never read after it arrives (checked with a
marker body and a read watch). What a connection unlocks is the **event mails**. Mails
`0x16–0x1D` are picked among unset bits 6–13 of `[0xC10]`, side-event flags the story scripts
set, so each one points the player to a side event they haven't found yet. Those mails were
always on the cartridge, waiting for a connection. At the time they most likely felt like new
scenarios, since without them most players would have missed those side events. So the
WonderGate feature is fully working on our server; nothing is missing.

## Terrors 2 ✅ (2026-10-13, connection, data and in-game effect verified)

`GET /cgi-bin/accsess.cgi?T2=www.sign-eight.co.jp` on `terrors2.wgg.channel.or.jp`. Title
(vertical): Y_LEFT ×4 → ワンダーゲート → DOWN → Y_UP (はい) → DOWN → "データを受信しました".
After the 7 lines it reads **raw body bytes 2, 3, 4** (ROM `0x34E4D0`): `[0xAA5]` = byte 2, a
half-day 1/2 that the game flips every 720 minutes; `[0xAA7]` = byte 3 · 60 + byte 4, minutes into
that half-day. That is the "real-time campaign" clock. We send `T2` + `{1|2, hour%12, minute}`
in Japan time. The game keeps that clock running, and when a story starts it copies the half-day
to `[0xBF8]`: **script variable 15** (the script VM keeps variables 14+ at `0xBF6 + 2·(n − 14)`,
read at ROM `0x343849`). 黒い影 tests it 38 pages in and branches: in the morning the friend
scolds "真っ昼間から よくもまあ グーグーと…", in the afternoon/evening "いつでもどこでも寝るんだから".
怨霊郷 and 闇夜 didn't read it within 3,000 pages. `T2_TIME=HH:MM` on the server fixes the clock
for testing.
