# Final Lap 2000: W·G ranking ✅

Status: **working** headless (2026-10-13; limits 2026-11-26): W·G RANKING shows per-course total time
and lap time (TIME TRYAL), the national #1, the rival just ahead of you, and your own entry, with the date.

How to reach it: title → RANKING → press **Y1, Y3, Y4, Y2** (sequence from [Keitai Archive's WS-WonderGate-Patches](https://github.com/Keitai-Archive/WS-WonderGate-Patches)) → WONDER GATE appears → A → phone
"##" OK (A) → NAME ENTRY (3 letters; A advances, START ends) → YES. Results: RANKING → W.G RANKING.
Saved states: `runs/final-lap/ranking.state`, `preconnect.state`.

## Exchange: four POSTs to `/service/swan-ranking/final-lap`

| # | Body | Meaning |
|---|---|---|
| 1 | `*=<id>&owner=<3 chars>&score=1..16|<time 5>|0|…&group=1&list=FLTOP|1|1` | upload total times, get #1 per course |
| 2 | `…&group=1&list=FLTOP|%2B1|1` | the entry 1 place ahead of you |
| 3 | `score=17..32|…&group=2&list=FLTOP|1|1` | lap times (courses 17-32) |
| 4 | `…&group=2&list=FLTOP|%2B1|1` | |

Times are 5 digits (m ss cc), `95999`/`09999` = no record; lowest first.

## Courses (upload order)

Course `n` (total time) and course `n + 16` (best lap) are the same circuit. The order is the game's own
course table (ROM `0x71341`, ASCII, repeated for each menu): the 15 World Tour circuits, then the special
course, which the menus show as `??????` until it's unlocked. The four EDIT courses (the course editor's
slots) come after it in the table and are never uploaded.

| Total | Lap | Course | Total | Lap | Course |
|---|---|---|---|---|---|
| 1 | 17 | England | 9 | 25 | Spain |
| 2 | 18 | France | 10 | 26 | Germany 1 |
| 3 | 19 | Italy 1 | 11 | 27 | Belgium |
| 4 | 20 | Brazil | 12 | 28 | Argentina |
| 5 | 21 | Austria | 13 | 29 | Monaco |
| 6 | 22 | Italy 2 | 14 | 30 | Germany 2 |
| 7 | 23 | Canada | 15 | 31 | Hungary |
| 8 | 24 | Australia | 16 | 32 | Special |

Confirmed with a real upload (2026-10-15): an England lap in Time Trial arrived as course 17 (`03572`,
0'35"72), with every other course `95999`/`09999`. The Swan Revival site names its boards from this table.

## Reply (parser at ROM `0x4ADC2`, keywords at `0x4952A`)

```
date=YYYYMMDD                      (required, else the whole parse fails)
course=<g>|<n>|<entrants>|x|x|<your rank, or a space = unranked>     ×16
FLTOP=<k>
<rank ≤3 digits>|<time ≤5 digits>|<name: exactly 3 chars>|<1 char>
```

## Limits (checked in the game, 2026-11-26)

Checked headless against seeded tables of 9 to 12,001 entrants and hand-made replies.

- **Your rank is one byte** (`0x4AEC3` stores it at RAM `0x17B6` + course). 255 shows as 255, 256 as
  0, 257 as 1, 1000 as 232. The server now stops at 255: anyone lower sees 255. A space (unranked)
  and 0 both show as `0`.
- **Entrants are one byte too** (RAM `0x17D6` + course) and the W·G RANKING screen never shows them.
  The server stops at 255.
- **A row's rank is 3 characters** (`0x4AF37` copies them to RAM `0x174B`, padding short ones with
  `0`). A 4-digit rank makes the padding count negative, the game fills memory with `0` and hangs
  on a striped screen in the middle of the exchange. This happened to any player ranked 1001 or
  lower (their rival's row is rank 1000+). The server now stops row ranks at 999.
- **A time is 5 digits**; a 6th does the same damage (`0x4AFB0`). The server already cut times to 5.
- The rival's rank is drawn by its own routine, which blanks a `0` in the tens place: 100 shows as
  `1 0`, 105 as `1 5`, 300 as `3 0` (110 and 254 are fine). This is in the game; the server can't
  change it.
- The third line of each block (you) is the game's own saved time, not a row from the server.
- Names are exactly 3 characters from the game's NAME ENTRY: A-Z, 0-9, space, `?`, `!`, `.`, sent
  as they are (a space is a space).
- A reply it can't read still ends with 通信が終了しました, but the W·G RANKING board is empty and has
  no date. No answer from the server gives エラーNo. 501.

Ours, not known from Bandai: stopping at 255 and 999, and ranking a fresh save's "no record" times
(`95999` / `09999`) like any other time.

## Adapter/emulator findings from this game

- Polled serial with a **1-byte receive buffer**: after power-on it waits only for "a byte
  arrived", then expects the rest of the reply to be lost (overrun), clears overrun by turning
  the port off and on, and reads the next reply fresh. The core now emulates overrun and the
  receiver reset (see `emu/comm.c`).
- The `55` check after power-on is dead code (it compares the status bit, not the byte).
