# Tare Panda no GunPey (たれぱんだのぐんぺい): national rankings ✅

Status: **working**, all four modes verified headless (2026-10-13).

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

Scores are fixed 10-character fields: echo them as uploaded. Puzzle (course 3): the 5-digit time is a
complement, shown as `(99 - TTT):(60 - ss)` (`0x9C9CA`; when the seconds come to 0 the minute
goes up by one), so a plain higher-is-better sort is right, as in GunPey EX. A fresh save
uploads `10060` (0:00).
