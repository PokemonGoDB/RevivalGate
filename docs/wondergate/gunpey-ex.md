# GunPey EX: national rankings ✅

Status: **working** for all five modes: Endless, Stage, Puzzle, Time attack 2 min / 5 min
(headless, 2026-10-13).

How to reach it (vertical game): title → WONDERGATE (4× Y_LEFT, then DOWN to select) → CONNECT
(DOWN) → "準備ができたらスタートボタンを押して下さい" → START. Pages: Y_DOWN / Y_UP.
Replay: `emu/drive.py "gunpey ex" w900 Y_LEFT Y_LEFT Y_LEFT Y_LEFT DOWN w300 DOWN w300 START w3000`.

## Exchange

One POST to `http://gunpeyex.wgg.channel.or.jp/swan-ranking` with all five courses:

```
*=<id>&owner=<16 chars, + padded>&score=1|<10 digits>|<panels 4>&score=2|…&score=3|<8 digits>
&score=4|…&score=5|…&list=RANK|1|3
```

Courses: 1 Endless, 2 Stage, 3 Puzzle, 4 Time attack 2 min, 5 Time attack 5 min.

- The 10 score digits are `000` + six digits + `0` (builder ROM `0xFD9DF`). The game keeps a score as
  those six digits and shows it with `00` after them (own-score line, ROM `0xFCAF4`): the saved
  value 123 uploads as `0000001230` and shows as `00012300`.
- The owner is the console's owner name through a table at ROM `0xFD993`: space and `+` both go out
  as `+`, ♥ as `@`, ♪ as `!`, the rest as themselves (`0-9 A-Z - ? .`). Seen with the owner name set
  to `A B♥♪+-?0123456.`: `owner=A+B@!+-?0123456.` (2026-11-26). Names are stored but never shown.

## Reply (parser at ROM `0xFBF47`, found with a read-watchpoint on the reply buffer at RAM `0xD000`)

```
course=<g>|<n>|<entrants ≤4 digits>|<ignored>|<ignored>|<your rank ≤4 digits>
RANK=<k: ONE digit>
<rank>|<score>|<name: skipped>|<4 digits>      courses 1, 2, 4, 5
<rank>|<score ≤9 digits>[...]                   course 3 (rest of line ignored)
```

- A course block is found as "the next line starting with lowercase `c`", so header lines
  (`date…`, `info=…`, `group=…`) are optional and ignored.
- Courses 1/2/4/5: the score is right-aligned into a 7-digit field; **7+ characters zero it** (a
  `loop` with CX = 0 shifts 65536 times). A row shows the first six digits of that field and then
  `00` (ROM `0xFCB80`), the same way as your own score. So the row needs the uploaded number as it
  came, in 6 characters: `0000001230` goes back as `001230` and shows as `00012300`.
  **Fixed 2026-11-26:** we used to send it ÷ 10, and every national score showed ten times too
  small with its last digit dropped (own score `00012300`, the same player's 1st-place row
  `00001200`; seen in the game with scores poked into the save, see below).
- **Limit:** the six digits of a score of 10,000,000 points or more would need a 7th character,
  which the parser can't take. We send `999999`, shown as `09999900`. Ranking still uses the real
  score. Seen with saved scores 12345600 and 99999900.
- The 4-digit field shows next to the score (PANEL / STAGE count). Names aren't shown. Seeded
  rows (2026-10-15): Endless and both time attacks label it PANEL (4 digits), Stage mode STAGE (3).
- "<entrants> 人中 <rank>" = "rank among entrants".
- The ROM's built-in sample reply (`0xFDC69`, fed to the parser by test code at `0xFDF94`)
  does **not** match this parser (course 2 rows lack the 4th field, 10-digit scores);
  it's from an older format.

## Puzzle mode score (course 3)

The parser (`0xFC043`) right-aligns course 3 into a 9-digit field; the game uploads 8 digits:

```
SSS T TT ss     stage (3), T TT = 100 - minutes (3 digits), ss = 60 - seconds
```

The row display (`0xFCD22`) shows the stage, then `(100 - TT):(60 - ss)`. If the three T
digits are all 0 it shows `--:--`. The time is stored as a complement, so a plain
higher-is-better sort is right (more stages first, then the faster time). A fresh save uploads
`00010060` (0:00 with a blank minute). We send it back as `00000000`, which shows `--:--`.
Example: `01219045` = stage 12, 10:15.

## Limits, checked in the game (2026-11-26)

Seeded straight into a scratch server's table, then read off the five pages of the real game:

| Field | Width | Past it |
|---|---|---|
| entrants, your rank | 4 digits each (12, 123, 1234 and 9999 shown as `0012 人中 0012` … `9999 人中 9999`) | The digits are copied backwards from the field's end with no check (ROM `0xFBF5A`, `0xFBF70`): a 5th rank digit lands on the last entrants digit, a 5th entrants digit on row 3's PANEL. We stop both at 9999. The overrun is from the code; we did not send one. |
| `RANK=<k>` | one character, and the game only has room for 3 rows per course (11 bytes each, then entrants and rank) | It asks for 3 (`list=RANK|1|3`) and we never send more than asked. `k` = 0 would run the row loop 65536 times; an empty course gets one placeholder row. |
| row score | 6 characters (above) | 7+ zero the row |
| PANEL / STAGE | exactly 4 digits; STAGE shows the last 3 | Copied left-aligned up to CR, so a shorter one would shift every later row. The game always uploads 4. |
| Puzzle row | 8 digits into a 9-digit field | 9+ zero it. Stage 999 with 0:01 (`99910059`) and stage 12 with 10:15 show correctly. |

Rows were checked 1st to 3rd on every page, with the player 1st (empty course), last, and outside
the three rows shown (rank 12, 123, 1234, and 12345, which shows as 9999 of 9999).

Saved scores for testing are in the cartridge EEPROM (loader ROM `0xE4308`), with no checksum:
`0x10` Endless (4 bytes, the six digits as a number) and `0x14` panels (2), `0x30`/`0x34` Stage,
`0x50` Puzzle stage (2) with `0x52` seconds and `0x53` minutes, `0x70`/`0x74` Time attack 2 min,
`0x90`/`0x94` 5 min. Poke them once the title is up (the game formats an empty EEPROM first), e.g.
`w900 cartee:30=7B000000 cartee:34=0C00` for Stage 00012300 / 012.

Proof that a reply was taken (RAM, per course: 4 entrants digits then 4 rank digits, one byte
each): `0x14F1`, `0x151A`, `0x1543`, `0x156C`, `0x1595`. On a fresh server each holds
`00 00 00 01 00 00 00 01`; with the reply body replaced by `?` bytes they stay 0 and the game sits
on PLEASE WAITING (its scan for a line starting with `c` never ends). The rows are at `0x14D0`,
`0x14F9`, `0x1522`, `0x154B`, `0x1574`.

Not verified: real hardware, and what Bandai's server sent for scores (a 7-character score, which
is what the display code suggests it wanted, zeroes the row in this parser).
