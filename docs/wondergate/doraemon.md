# Pocket no Naka no Doraemon: DORA MAIL ✅

Status: **working** headless (2026-10-13). DORA MAIL "receives" mail: the game fetches a web
page only to learn **today's date**, then delivers the matching ones of its **39 seasonal mails
stored in the ROM** (New Year, Setsubun, Valentine's, Tanabata, Christmas, …), plus Dorami's
first mail and the "おしえてあげる" tips. Nothing was lost on the server side.
Server: [`server/doraemon.py`](../../wondergate/server/doraemon.py) (serves the current JST date).

## Reaching it

Title → つうしんせってい sets WonderGate ON (default). In play, the menu (B, mode 9 state 8)
→ third item (only when WonderGate is ON, `[0xEB9]`) → the WonderGate menu (mode 9 state 20)
→ first item → DORA MAIL connects. The replay skips the long opening by writing RAM
`[0x770]=9 [0x771]=8` (the in-game menu) right after starting a new game.

## Exchange

`GET /log_inguz_1999/index.shtml HTTP/1.1`, `Host: www.bea.hi-ho.ne.jp` (a fan's diary page,
the "log_inguz_1999" in the URL). Parser at ROM `0x3DF974`: find the first `BR>`, then fixed
columns `+3 MM / +6 DD, +9..10 weekday (2 bytes, ignored), +12 HH`. That is an SSI date
like `<BR>10/13 火 12:34`. No `BR>` gives error 400. Month/day are matched against the table at
`0x3D7308` (5-byte entries: month, from-day, month, to-day, mail id); the hour stamps the mail.

The ROM also has `nph-gettime`, `www.gwp3d.com/chater.asis`, `www.swan.channel.or.jp` and
developer test URLs (`homepage2.nifty.com/migaka/…`); this path doesn't use them.
