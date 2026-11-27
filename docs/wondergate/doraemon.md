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
like `<BR>10/13 火 12:34`. Month/day are matched against the table at
`0x3D7308` (5-byte entries: month, from-day, month, to-day, mail id); the hour stamps the mail.

The ROM also has `nph-gettime`, `www.gwp3d.com/chater.asis`, `www.swan.channel.or.jp` and
developer test URLs (`homepage2.nifty.com/migaka/…`); this path doesn't use them.

## Checked in the game (2026-11-26)

DORA MAIL only receives: its menu is メールじゅしん / じゅしんずみメール / でんわばんごうへんこう / もどる.
There is nothing to send, and every subject and body is in the ROM, so the server has no mail
lengths to get wrong. What the page can change is the date, and these were tried with a test page:

| Reply | What the game shows |
|---|---|
| 200, `<BR>11/27 …` (first connection of a new game) | 「1けんのメールをうけとりました」: Dorami's first mail 「???」 |
| 200, `<BR>12/24 …` | 2 mails: 「???」 and the seasonal 「ふゆやすみ」 |
| 200, `<BR>05/20 …` | 2 mails: 「???」 and 「しずかさん!」 |
| the same day again (second and third connection) | 「しんちゃくメールは、ありません。」: the empty mailbox |
| 200 with no `BR>` anywhere (every body byte `?`) | **the game hangs** on 「つうしんをおわります。」 |
| 404 or 500 | 「499 WEBサーバとのつうしんでエラーがはっせいしました。」, back to the menu |

- **No `BR>` is a hang, not an error.** The search loop (ROM `0x3DF988`) starts at RAM `0x1CDB` and
  has no end: its "not found" branch can't be reached. (This page used to say error 400.) Our page
  always has the `BR>`, and a non-200 reply is refused before the search, so only a 200 page
  without it can do this.
- **Page size:** a page with 1,100 bytes before the `BR>` and one with 3,000 bytes after it both
  parsed. Ours is 87 bytes.
- **The parsed date** is kept at RAM `0xEBA` (month), `0xEBB` (day), `0xEBC` (hour); all 0 before a
  page has been read. The digits are not range-checked.
- **Eight of the 39 seasonal mails can't arrive.** The matcher (ROM `0x3D6ECB`) compares only the
  entry's first month, wants from-day ≤ day ≤ to-day, and stops at the first entry that fits. So the
  four ranges that cross a month end never fit (1/29–2/2, 2/27–3/2, 8/28–9/2, 11/27–12/1; tried
  11/28, 12/01 and 02/29: only 「???」 came), and four one-day mails sit behind a longer range that
  comes first in the table (5/20, 7/7, 11/2, 12/24; tried 12/24 and 05/20: the range's mail came).
  This is the cartridge's own logic and no date we could send changes it.

Not verified: the other dates in the table one by one, and the mails that story progress adds.
