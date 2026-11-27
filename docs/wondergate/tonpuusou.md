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
The keypad takes an ID of up to 8 digits (the letters are drawn but the cursor stays on the
digits) and a password of up to 12 letters and digits. Checked 2026-11-26: ID `55555555` with
password `444444ggguuu` reached the server as typed, in both requests.

**Emulator fix needed:** every menu choice plays a voice sample and waits for it to end.
The voice driver sets the HBlank timer reload to 1 but never sets the timer-enable bit. On
hardware a counter holding 1 fires every line even with countdown disabled
([ws.nesdev.org/wiki/Timers](https://ws.nesdev.org/wiki/Timers)); Mednafen didn't do this, so
the game hung on its first menu. `emu/build_core.sh` now patches `gfx.c` to match the hardware.

## Exchange (`tongpuso.wgg.channel.or.jp`, form-encoded, HTTP/1.1)

| Request | Body | Reply |
|---|---|---|
| `POST /cgi-bin/getrate.cgi` | `c=<ID>&d=<password>` | `c=1\r\ne=<rate×100, three digits or more>\r\nf=<games>\r\n` |
| `POST /cgi-bin/setrate.cgi` | `c=<ID>&d=<password>&e=<new rate×100>&f=<games>&g=<games − 1>` | `c=1\r\n` (we also echo e/f) |

Parser (segment `A000` = ROM `0xA0000`, at `0x2C30`): `c=` one digit, must be `1` (else
"にんしょうにしっぱいしました", authentication failed); `e=` digits with the last two as
decimals (≤ 4 integer digits); `f=` ≤ 5 digits. `d=` is never read. The cartridge computes
the new rate itself. Our server registers an unknown ID on first use with its password,
starts it at R1500.00, and answers `c=0` to a wrong password.

Limits of what the cartridge takes back, tried in the game with a seeded server (2026-11-26):

- **`e=` needs at least three digits.** With one or two (a rate under R1.00) the parser skips the
  integer part and then reads the decimals, and the rest of the reply, from stray RAM: `e=0` with
  `f=0` showed "1500.9, 1 game". We send `e=` zero-padded to three digits (`e=005` shows R0.05).
- **R2500 or more is refused.** After the download the game checks the integer part against 2500
  (`A000:3866`) and shows "レートのあたいがいじょうです。" instead of starting. The ID could then never
  play again, so we send at most `e=249999` (R2499.99 downloads and plays). The stored rate is kept as
  uploaded. More than four integer digits read as 65535, which is refused the same way.
- **The game count is a 16-bit word.** `f=65535` shows 65535; `f=99999` reads as 34463. We send at
  most 65535. After a match at 65535 games the cartridge uploads `f=0&g=65535` (its count wraps),
  which our server takes as a normal result (`g` matches) and stores 0 games.
- Seen working: R2499.99 with 65535 games downloaded, one auto-played match, upload
  `c=55555555&d=444444ggguuu&e=249696&f=0&g=65535`, "レートのこうしんがしゅうりょうしました。 2496.96 / 0".

Not checked in the game: a match that would lift the rate to R2500 or more (whether the cartridge
caps its own result). From the ROM only (not run): cart EEPROM word `0x1E` is set while a ranked
match is on, and the boot code (`0x40D6D`) takes 30 off the saved rate when it finds it still set.

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
- The counters live in the cartridge's 1 kbit EEPROM (there is no SRAM): words `0x0C`–`0x1A`, read
  into RAM `0x6C4` by the loader at ROM `0x40C62` each time they are needed, which is why writing
  RAM `0x6C4` did nothing. From the ROM: words 0–7 hold the signature `TONPUSOU`, written on first
  boot (`0x40B43`; without it the EEPROM is wiped), and words `0x1B`–`0x1D` the last rate. Headless, a
  cart gets counts with `cartee:18=<15 words, low byte first>` after a first boot, then `reset`.

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
1回, 地和 1回 and 字一色 1回 in the right places.

Checked in the game on 2026-11-26, with counts written to the cart's EEPROM:

- **Upload.** A cart holding 1–15 of the fifteen kinds sent `&score=1%7C1%7C&score=2%7C2%7C…&score=15%7C15%7C`
  (Content-Length 287), and its own やくまんかいすうをみる screen showed 役満トータル回数 120回. A count
  of 65535 goes up as `score=1%7C65535%7C`. The server stored all of them.
- **All 15 tables**, three rows each, with 16-letter names: 天和, 地和, 字一色, 四暗刻, 緑一色, 小四喜和,
  大三元, 九蓮宝燈, 清老頭, 国士無双, 四槓子, 九蓮9面待ち, 大四喜和, 国士13面待ち, 四暗刻単騎. Names use
  the console's owner-name codes plus `0x41` (`A` space, `B`–`K` 0–9, `L`–`e` A–Z).
- **Ties** keep the order the players were first stored in (our choice), numbered 1, 2, 3.
- **Counts are drawn with three digits**, and the digits above are dropped: 1000 showed as 0回, 12345
  as 345回, 65535 as 535回 (the cart's own count screen does the same). So a row's count is sent as
  at most 999, and the total's as at most 9999 (its screen draws four digits). Places still go by
  the real counts.
- **Table 0 (the total) is never shown.** The viewer steps the table number with UP/DOWN and holds
  it between 1 and 15 (ROM `0x4ED24`: on reaching 0 it is set back to 1). With a read watch on
  table 0 (RAM `0x1480`, 0x36 bytes) nothing read it while browsing every kind, pressing past both
  ends, the other buttons, leaving, or on the cart's own count screen. The screen exists: forcing
  the table number to 0 in RAM draws it under the title 役満トータル回数. We keep sending table 0,
  because a reply with no line is error 599.

Regression: `tonyakuman` in `emu/replays.txt`. What shows that the game took a reply
(2026-11-26; each checked against a run whose reply bodies were replaced with `?`):

- `tonpuusou`: RAM `0x355` holds the rate (word, then the hundredths byte) and `0x365` the game
  count; after them the game sets the three opponents' rates at `0x359`. Fresh server:
  `355=DC0500`, `365=0000`, `359=04060000280600001C06`. After a corrupted reply the game shows
  エラーコード 599, `0x365` holds `0100` and `0x359` zeros. `0x355` holds 1500 either way, so it only
  proves anything with a seeded rate (R1876.54, 321 games: `355=540736`, `365=4101`).
- `tonyakuman`: the replay ends back on the service menu, which looks the same after an error, and
  a cart with no yakuman gets no rows. The word at RAM `0x713` is the error code: `0000` after a
  good reply, `5702` (599) after a corrupted one. To make the reply's content count, give the cart
  one 天和 (`w300 cartee:18=0100 reset` first), send `score=1%7C1%7C`, and stop on the ranking
  screen (drop the last `A w300`): tables 0 and 1 then hold the count and the owner,
  `1480=0100413D4042403E403E403E403E403E403E` and the same at `14B6`. Leaving the screen
  overwrites that memory.
