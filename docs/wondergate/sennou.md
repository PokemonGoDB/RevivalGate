# Sennou Millennium (線脳 MILLENNIUM): net ranking ✅

Status: **working** headless (2026-10-13): "はてしなくツナゲル <date> のネットランキング",
your rank of N entrants, rows with name, score and level.

How to reach it (vertical): hold **A+B+Y1+Y4 at power-on** (combo from [Keitai Archive's WS-WonderGate-Patches](https://github.com/Keitai-Archive/WS-WonderGate-Patches)) (adds センノーツウシン) → START ×2 →
センノーツウシン (5× Y_LEFT, DOWN) → セツゾク (DOWN). A state at the title menu is saved as
`runs/sennou/menu.state`.

## Adapter behaviour this game pinned down

Sennou drives the serial port by interrupt and checks replies strictly (state machine at ROM
`0xCE5DE`, frame reader `0xCBD02`):

- **Frames are `[type][len hi][len lo][cmd][params]`**: the "always 0" byte is the high byte of
  a 16-bit length.
- **Wake-up**: power-on first; if that fails it sends `00` ×10 and expects `55` ×5, then power-on
  again expecting a cmd-`02` reply. So the `55` burst answers a `00` burst, not power-on.
- **`0B` is call-state news**: first byte `00` = connected, nonzero = line down. After hang-up
  it waits for a nonzero `0B` (we send `0B 01 00 00 00`).
- **Close socket replies `00 01`** (like connect); it checks for 1.
- Receive count `FF` or `00` = end of data. It reads to end-of-connection.
- Errors ≥ 100 display as 099; 499 = request/parse error.

## Exchange

`POST http://wgg01.channel.or.jp/service/swan-ranking/sen-know`:
`*=<id>&owner=<16 chars>&score=1|<8 digits>|<3-digit level>&list=ranking|10|%2b16`

## Reply (parser at ROM `0xCE160`; all three keys are required)

```
date=YYYYMMDDhhmm            (4 chars skipped, then month/day/hour/minute)
course=<g>|<n>|<entrants>|<top>|<yours>|<your rank>
ranking=<k>
 <rank>|<score>|<name ≤16>|<level>      ← each row found by scanning for a SPACE
```

## What `ranking|10|+16` asks for

The list parameter is a constant in the ROM (`0xCE3AF`). We read it the way Final Lap's `+1`
works ("N places ahead of you"): **the top 10, then the places just ahead of the player down to
the player's own row**. The game supports this reading:

- Each row carries its own rank (stored per row, 26-byte records from `0x14A6`), so a jump
  from 10 to 53 displays correctly.
- The screen opens on the player's own row, framed and marked ♥アナタサマ, so the design
  expects that row in the list.
- The whole HTTP response must fit **0x37F = 895 bytes** (receive call at `0xCE98E`, header
  included). 26 rows don't fit: a 27-row test reply was cut off after row 21, and the rest
  showed rank 0 and garbage names. So the server drops the rows farthest ahead of the player
  until the body is ≤ 740 bytes. With 16-character names that is the top 10 plus about 9 rows.

Verified headless (2026-10-15) against 60 seeded entries, with the player at #61: rows 1–10,
then 53–61. It opens on #61 (♥アナタサマ), and Y_LEFT / Y_RIGHT scroll the list with no rows
past the end.
