# Final Lap 2000: W·G ranking ✅

Status: **working** headless (2026-10-13): W·G RANKING shows per-course total time and lap time
(TIME TRYAL), the national #1, the rival just ahead of you, and your own entry, with the date.

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
<rank>|<time ≤5 digits>|<name: exactly 3 chars>|<1 char>
```

## Adapter/emulator findings from this game

- Polled serial with a **1-byte receive buffer**: after power-on it waits only for "a byte
  arrived", then expects the rest of the reply to be lost (overrun), clears overrun by turning
  the port off and on, and reads the next reply fresh. The core now emulates overrun and the
  receiver reset (see `emu/comm.c`).
- The `55` check after power-on is dead code (it compares the status bit, not the byte).
