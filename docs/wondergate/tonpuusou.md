# Tonpuusou: R (rate) shared with the PC version 🔁

Status: **working** headless (2026-10-13). Ranking Battle (ランキング対戦) downloads the player's
R before a match and uploads the new R afterwards. Verified: download "R 1500.0 / 0 games",
one auto-played East-round match, upload "R 1496.91 / 1 game", and the next download returns
1496.91. Server: [`server/tonpuusou.py`](../../wondergate/server/tonpuusou.py) (store:
`data/tonpuusou.json`).

## Reaching it

Mode select → ランキング対戦 → pick a parlor → "connect to WonderGate?" はい → enter the
Tonpuusou (PC) **ID** and **password** on the keypad (END confirms each) → phone number screen
(保存 → はい) → "connect to the network?" はい. The replay types ID `0000`, password `4444`.

**Emulator fix needed:** every menu choice plays a voice sample and waits for it to end.
The voice driver sets the HBlank timer reload to 1 but never sets the timer-enable bit. On
hardware a counter holding 1 fires every line even with countdown disabled
([ws.nesdev.org/wiki/Timers](https://ws.nesdev.org/wiki/Timers)); Mednafen didn't do this, so
the game hung on its first menu. `emu/build_core.sh` now patches `gfx.c` to match the hardware.

## Exchange (`tongpuso.wgg.channel.or.jp`, form-encoded, HTTP/1.1)

| Request | Body | Reply |
|---|---|---|
| `POST /cgi-bin/getrate.cgi` | `c=<ID>&d=<password>` | `c=1\r\ne=<rate×100>\r\nf=<games>\r\n` |
| `POST /cgi-bin/setrate.cgi` | `c=<ID>&d=<password>&e=<new rate×100>&f=<games>&g=<games − 1>` | `c=1\r\n` (we also echo e/f) |

Parser (segment `A000` = ROM `0xA0000`, at `0x2C30`): `c=` one digit, must be `1` (else
"にんしょうにしっぱいしました", authentication failed); `e=` digits with the last two as
decimals (≤ 4 integer digits); `f=` ≤ 5 digits. `d=` is never read. The cartridge computes
the new rate itself. Our server registers an unknown ID on first use with its password,
starts it at R1500.00, and answers `c=0` to a wrong password.

**`g=` is the game count the new rate was computed from** (builder ROM `0x4F7EF`: `f=` is the
word at RAM `0x365`, `g=` is the same word minus 1). It lets the server tell results apart:

- `g` = the games we hold: a normal result; store `e` and `f`.
- `e` and `f` equal what we hold: the same result sent again after a lost reply; change nothing.
- anything else: the rate came from an older download (the same ID played on another console
  in between). We keep the result, but the game count never goes backwards
  (`games = max(f, held + 1)`), and the player's `out_of_order` count goes up.

## The R formula (ROM `0x4E210`, pairwise term at `A000:3F6A`)

After a ranked match the cartridge updates every seat's R (rates at RAM `0x355 + 4i`: integer
word, hundredths byte; games at `0x365 + 2i`), comparing the player with each opponent:

- **Who won the pair:** the higher final score (`0x622 + 2i`); ties go by seat order from
  the dealer (`[0x406]`), and per-seat flags at `0x62A` override the score comparison.
- **Expected term** (16.16 fixed point): `D = |R_self − R_opp|`,
  `P = 1 / (1 + 10^(D / 2000))` (ln 10 = `0x2.4D75`, then `exp`). P is used as it is when
  you rate higher than the opponent, and as `1 − P` otherwise.
- **Change:** `4 × max(1, 5 − n / 100) × P`. On a win n = your games + 1, and it is added.
  On a loss n = the opponent's games + 1, and it is subtracted.
- The three changes are summed and **divided by 10 when `[0x6BB]` = 1**, which it was in our
  ranked match.

This is the FIBS backgammon rating (the 2000 scale, `4·√n` with n = 1, and the
`5 − experience/100` boost for new players). It matches 東風荘's Q&A, which said its rating
was "adapted from backgammon rating". Checked against our test match: from R1500.00, against
CPU opponents at 1612, 1742 and 1316 (all 0 games), finishing last gives
−10.62 − 11.36 − 8.93 = −30.91, then ÷10 = −3.09, so **R1496.91**: the uploaded value exactly.
So the cartridge carries the PC formula, and the server only stores what the cart computes.

## The PC side: 東風荘

**What it was.**
- A free online mahjong service for PC, written and run by one programmer, 東 (Katu Azuma, admin
  handle `mjman`), with Business Network Telecom (BNT) handling the business side, at
  `mj.giganet.net`. Not Bandai: the cartridge is "(C)BNT Corp. (C)BANDAI 2001".
- **Dates:** test service from December 1996, official 18 June 1997. The end was announced on
  2 November 2017 and it closed at the end of March 2018
  ([ja.wikipedia](https://ja.wikipedia.org/wiki/東風荘), [窓の杜](https://forest.watch.impress.co.jp/docs/news/1089547.html)).
- **Clients:** native Windows (`MJSETUP.exe`) and Mac OS 9, later Java (`mj.jar`). They log in with a
  numeric 会員番号 (member number) and password, which is why the cart's ID keypad is digits only.
  They speak TCP port 9007.
- **Tables:** human 4-player ランキング卓, split 一般 and 上級 (上級 needs R1600 and 100+ games),
  and a friends' table.
- **R:** starts at 1500. The rule is "adapted from backgammon rating": only finishing place counts,
  beating stronger tables gains more, and swings shrink as your game count grows. The exact
  formula was never published ([Q&A](https://web.archive.org/web/1998/http://mj.giganet.net/qa.htm)).
- **Rankings:** "第N回麻雀大会" periods of 4–5 weeks, 60+ ranked games to qualify, boards for
  総合得点 and 平均順位, top 200 shown
  ([example](https://web.archive.org/web/2002/http://mj.giganet.net/rank/rank52_rank.htm)).

**What the cartridge link did.**
- WonderSwan play is against the CPU; opponents get stronger as your R rises. There was no play
  against PC players.
- Its results updated the **same R** as the PC service ("その成績がＰＣと同期",
  [mail magazine #3](https://web.archive.org/web/2001/http://arwn.co.jp/tonpuu/mail3.html);
  "ウィンドウズ版と完全にリンク", [Bandai/ARWN](https://web.archive.org/web/2001/http://arwn.co.jp/tonpuu/wondergate.html)).
- Connecting also entered you in a **全国ヤクマンランキング**. That is its own request, not part of
  the rate exchange (see "Yakuman ranking" below).
- At the August 2001 Bandai Cup, 2 final seats went to WonderSwan players who had connected.

**What survives.**
- The Wayback Machine has the clients: `mj.giganet.net/MJSETUP.exe` (2001–2005) and `mj.jar`
  (2003–2015).
- No protocol documentation, open-source clone or fan server was found, and there is no official
  successor.

## Our plan

- **Now:**
  - A Tonpuusou leaderboard **on our site**, built from the rates our server keeps (R, games, last
    played; never passwords), in the style of the original ranking pages where it fits.
  - The server's own `/tonpuusou/` page is a last resort; the site's leaderboard replaces it.
- **Later, maybe: revive the PC side.**
  - Decompile `mj.jar` to recover the port-9007 protocol.
  - Write a lobby and table server; the real work is reimplementing 東風荘's rules and scoring,
    since the original server ran the game.
  - Players would fetch the archived clients themselves (they are BNT's code; we wouldn't
    redistribute them) and point them at our server.
  - PC and WonderSwan players would then share one R again.

## Yakuman ranking (全国ヤクマンランキング)

Mode select → オプション → あなたの成績 → 役満ランキング → サービスメニュー:
やくまんランキングにとうろく・えつらん (register and view), やくまんかいすうをみる (your own counts,
offline) and でんわばんごうのせってい. The first asks you to accept the service terms (どういする),
shows the phone number screen (保存 → はい), connects, and then shows the downloaded tables:
UP/DOWN steps through the yakuman kinds (天和, 地和, 字一色, …), three rows each, `------` for an
empty place. Until 2026-11-25 these notes said no code used the ROM's `/swan-ranking` strings and
the server answered 404.

Request (builder ROM `0x4EA13`), in Bandai's swan-ranking style:

```
POST http://tongpuso.wgg.channel.or.jp/swan-ranking
*=<serial, 6 hex>&owner=<16 bytes>[&score=<n>%7C<count>%7C]...&list=BEST3%7C1%7C3
```

- `owner` is the player's name, 16 bytes, each sent + `0x41` (a new cart sends
  `A=@B@>@>@>@>@>@>`). It can hold any byte, so we take the 16 bytes after `&owner=` as they
  are and echo them.
- One `score` per yakuman kind `n` = 1–15 the player has made (the counters are 15 words the
  builder reads at `0x6C4`); kinds with no yakuman are left out. `|` is sent as `%7C`.

Reply (parser `0xA1D4D`), read one line at a time (at most 127 bytes with its CRLF) until
Content-Length is used up:

```
course=<g>|<nn>|…        picks a table and clears it: g = 2 → table 0 (the total);
                          otherwise nn, exactly two digits at this column → table nn
 BEST3=<k>               k rows follow: one digit, never 0 (the row loop would run 65,536 times)
 <r>|<count>|<owner>|    r = 1–3, count up to 5 digits, owner up to 16 bytes, ending in `|`
```

The `BEST3=` line and the rows **start with a space**; `course=` does not. Tables with no line stay
empty. A reply with no line at all is エラーコード 599 (そのたのエラーです), so the total's `course=`
line is always sent.

Our server (`tonpuusou.py` `yakuman`, data in `data/tonpuusou-yakuman.json`; the Worker keeps it
in its `tonpuusou-yakuman` state) keeps each player's counts (by serial and name; a count only
goes up), and sends the top three of each kind and of the total. Checked in the game (2026-11-25):
the cart's request is as above; with four players seeded on the server it showed 天和 7回 / 2回 /
1回, 地和 1回 and 字一色 1回 in the right places. Not checked: an upload with `score=` fields from a
cart that has made a yakuman (the test cart had none), and where the game shows table 0.

Regression: `tonyakuman` in `emu/replays.txt`.
