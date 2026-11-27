# Ring Infinity and Terrors 2: accsess.cgi check-ins ✅

Both are by the same developer and share a serial/HTTP library that reads **exactly 7 lines**
(status and headers, contents ignored) and then one block of up to 127 bytes. The server
([`server/access.py`](../../wondergate/server/access.py)) sends 7 lines and closes.

## The reply reader (disassembled and tested in both games, 2026-11-26)

Same code in both ROMs, in bank `0x34` (Ring Infinity / Terrors 2 ROM offsets):

- **Frame reader** (`0x34D03A` / `0x34EA72`): fills a buffer with `FF` (RAM `0x9C2` / `0xA1C`, 0x80
  bytes), then stores the adapter's frame there: type, length (2 bytes), command, socket, count,
  data from `+6`. It trusts the frame's length.
- **Line read** (`0x34CFA6` / `0x34E9DE`, adapter command `0D`) and **block read** (`0x34CFF0` /
  `0x34EA28`, command `0F`): ask for up to `0x7F` bytes and wait `0x177` timer ticks for the frame.
  A count of `FF` (connection closed) or no frame is a failure; a count of 0 is not.
- **Reply** (`0x34CA7E` / `0x34E47F`): seven line reads, then one block read, stopping at the first
  failure. Nothing looks at the status code, the headers or `Content-Length`.
- **The caller ignores the result** (`0x34C8B9` / `0x34E42D`): it goes on to shut the socket down
  and close it, and only those two steps (and the connect and send before) can fail the session.

So neither game can show an error for a bad reply. Each reply below was sent to the real games:

| Reply | Ring Infinity | Terrors 2 |
|---|---|---|
| ours (7 lines, short body) | メールを受信しました | データを受信しました, clock set |
| 404 with 7 lines | same | not tried: by the code, the clock comes from the body's bytes 2–4 whatever the status |
| fewer than 7 lines, then closed | same | same screen, **clock not set** (`[0xAA5]` stays 0) |
| fewer than 7 lines, connection left open | same, after 2 s per missing read | same screen, **wrong clock** (the block read comes back empty and the `FF` fill is used) |
| more than 7 lines (one extra header) | same | same screen, **wrong clock** (bytes 2–4 of `CR LF T 2 …`) |
| nothing at all, then closed | same | same screen, clock not set |
| a line or body of 127 bytes or more | same | same screen; clock right if the 7 lines were right |
| server not reachable | 通信に失敗しました… | 「007: 通信が切断されました」 |

**127 bytes is one too many.** The buffer is followed by the library's socket number (RAM `0xA46` /
`0xAA0`), and the 127th data byte of a frame lands on it. With a 127-byte body the games then sent
shutdown and close for socket `0A` (the body's last byte); with a 200-byte header line the later
reads asked for socket `70` and failed. Our adapter answers those anyway and the session ends
normally, but the real socket is left to the hang-up. Keep every line and the body under 127 bytes
(ours: 40 bytes at most).

**Terrors 2 needs exactly six header lines and the blank line**, with the body arriving in the
eighth read. The Python server and the Worker both send status, `Server`, `Cache-Control`,
`Connection`, `Content-Type`, `Content-Length`, blank. A reply that starts more than 2 s after the
request also breaks it: our adapter answers a read with "nothing yet" after 2 s, the game counts
that as a line, and the clock is read one line early (tried with a 3 s delay: sent p.m. 11:59, the
game kept p.m. 2:02). The fix for that belongs in the adapter, not here.

How to tell from memory that a session went through:

- Ring Infinity: RAM `0xBA4` (the mail picked, 1–3 on a new game) is nonzero; 0 after a failed
  connection. Since the reply's content is never used, nothing can tell a good reply from a bad one.
- Terrors 2: RAM `0xAA5` (half-day, word) and `0xAA7` (minutes, word). With the server started as
  `T2_TIME=18:30` they hold `02 00 86 01`; a body of `?` bytes gives `01 00 F3 00`.

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
that half-day. That is the "real-time campaign" clock. Neither value is checked. The clock
routine (ROM `0x340785`) adds a minute every 4,500 frames and, while the minutes are 720 or more,
takes 720 off and flips the half-day (1 → 2, anything else → 1) once per call, so out-of-range
bytes settle into a valid time (a body of `?` bytes had become a.m. 4:03 by the end of the replay). Checked in the game at the edges with `T2_TIME`: 00:00 → `1`, 0;
11:59 → `1`, 719; 12:00 → `2`, 0; 23:59 → `2`, 719; and a.m. 11:59 turned into p.m. 0:00 (and p.m.
11:59 into a.m. 0:00) after the next minute. We send `T2` + `{1|2, hour%12, minute}`
in Japan time. The game keeps that clock running, and when a story starts it copies the half-day
to `[0xBF8]`: **script variable 15** (the script VM keeps variables 14+ at `0xBF6 + 2·(n − 14)`,
read at ROM `0x343849`). 黒い影 tests it 38 pages in and branches: in the morning the friend
scolds "真っ昼間から よくもまあ グーグーと…", in the afternoon/evening "いつでもどこでも寝るんだから".
怨霊郷 and 闇夜 didn't read it within 3,000 pages. `T2_TIME=HH:MM` on the server fixes the clock
for testing.
