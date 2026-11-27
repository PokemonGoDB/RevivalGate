# Tare Panda no GunPey (たれぱんだのぐんぺい): national rankings ✅

Status: **working**, all four modes verified headless (2026-10-13; puzzle rows and limits 2026-11-26).

How to reach it (vertical game): hold **A+B+Y1+Y4 at power-on** (combo from [Keitai Archive's WS-WonderGate-Patches](https://github.com/Keitai-Archive/WS-WonderGate-Patches)) (adds わんだーげーと to the
title menu) → START ×2 → わんだーげーと (2× Y_LEFT, DOWN) → 接続する (DOWN) →
"すたーとぼたんを押してください" → START. Pages: Y_DOWN.
Replay: `emu/drive.py "tare panda" 'A+B+Y_UP+Y_LEFT*300' w600 START w300 START w300 Y_LEFT Y_LEFT DOWN w300 DOWN w300 START w1800`.

## Exchange

`POST http://wgg01.channel.or.jp/service/swan-ranking/tarepang`, one body:

```
*=<id>&owner=<16 chars>&score=1|<10>|<panels 4>&score=2|<10>&score=3|<10>&score=4|<10>&list=TARE|1|3
```

Courses: 1 とりあえず (endless, score + panels), 2 かんさつで (stage: 3-digit stage + 7-digit
score), 3 ぱずるで (puzzle: 3-digit stage, 2 unused, 5-digit time), 4 つみかさねて (score + stage).
Courses 2 and 4 are both a 3-digit stage, then a 7-digit score: the game shows a course-4 row of
`1234567890` as すこあ 4567890, すてーじ 123 (seeded reply, 2026-10-15).

The game reads to end-of-connection, so the server must close after the reply.

## Reply (parser at ROM `0x9C784`, found by watching reads of the reply buffer at RAM `0x3000`)

```
course=<g>|<n>|<entrants ≤4>|<ignored>|<ignored>|<your rank ≤4>
TARE=<k: one digit>
<rank>|<score: exactly 10 chars>|<name: skipped>|<≤4 digits>   (field 4 read for course 1 only)
```

Scores are fixed 10-character fields: echo them as uploaded, except puzzle rows 2 and 3 (below).
Puzzle (course 3): the 5-digit time is a complement, shown as `(99 - TTT):(60 - ss)` (`0x9C9CA`; when
the seconds come to 0 the minute goes up by one), so a plain higher-is-better sort is right, as in
GunPey EX. A fresh save uploads `10060` (0:00).

## Puzzle board, rows 2 and 3 (2026-11-26)

The game works the time out for the first puzzle row only. Its row loop ends with `loop 0xCABF`
(ROM `0x9CA3F`), which is the top of the *next* course's row loop, not its own (`0x9C98D`). So rows
2 and 3 are read by the course-4 code, which stores the seven digits as they came. Seen in the game
with three seeded rows of 1:15, 3:20 and 12:05: the board showed `01:15`, `96:40`, `87:55`.

The server makes up for it: in a `tarepang` table, rows after the first of course 3 go out as
`SSS 00 0MMss`, with the time already worked out the same way the game does it for row 1. The board
then shows `01:15`, `03:20`, `12:05` (seen in the game; also `09960` as `01:00` in row 2, the same
as the game's own row 1 gives for those digits, and `00001` as `99:59`). Digits the game never uploads (a seconds
field of `00` or above `60`, a minutes field above `100`) go back unchanged.

Nothing else is changed by this: stored scores, the sort, the course line and row 1 are as before,
and the only code that reads those two rows is the board's draw routine (`0x9CFE1`-`0x9D086`,
found with a read watch on RAM `0x3959`-`0x396C` across all four pages and the way back to the
menu). The table is not saved; leaving the board drops it. This is our workaround for a fault in
the game. What Bandai's server sent is not known.

## Limits (checked in the game, 2026-11-26)

- The count line reads `<entrants> 人中 <your rank>`, 4 digits each (one digit per byte, RAM
  `0x3921`-`0x3928` for course 1). 3, 10, 100, 1000 and 9999 show correctly. Longer numbers are
  written backwards from the field's last digit with no length check: a rank of 12345 with 77
  entrants showed `0071 人中 2345`, and 12345 entrants showed `2345` (the extra digit lands in the
  third row's last digit). The server stops both at 9999.
- `TARE=<k>` is one digit and there is room for 3 rows per course; a 4th row overwrites the two
  counts. The game asks for 3 (`list=TARE|1|3`) and gets at most 3.
- Course 1 shows the last 7 digits of the score and 4 digits of panels: `9999999` and `9999` are
  fine.
- The owner name is the console's, form-encoded like Sennou Millennium's (`MEDNAFEN++++++++`). The
  game skips names in the reply and never shows one.
- A reply with no `course=` line leaves the game on 接続中… for good. No answer from the server
  gives 失敗 エラーコードNo. 005.
- RAM `0x208` is the WonderGate screen step: `1D` with the board up, `1E` on the failure screen.
