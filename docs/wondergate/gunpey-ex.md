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

## Reply (parser at ROM `0xFBF47`, found with a read-watchpoint on the reply buffer at RAM `0xD000`)

```
course=<g>|<n>|<entrants ≤4 digits>|<ignored>|<ignored>|<your rank ≤4 digits>
RANK=<k: ONE digit>
<rank>|<score>|<name: skipped>|<4 digits>      courses 1, 2, 4, 5
<rank>|<score ≤9 digits>[...]                   course 3 (rest of line ignored)
```

- A course block is found as "the next line starting with lowercase `c`", so header lines
  (`date…`, `info=…`, `group=…`) are optional and ignored.
- Courses 1/2/4/5: score is read into a 7-digit field; **7+ characters zero it** (a `loop`
  with CX = 0 shifts 65536 times). We send score ÷ 10 in 6 digits; the game shows it ×10.
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
