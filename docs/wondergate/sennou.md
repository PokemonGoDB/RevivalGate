# Sennou Millennium (線脳 MILLENNIUM): net ranking ✅

Status: **working** headless (2026-10-13; names and limits 2026-11-26): "はてしなくツナゲル <date> の
ネットランキング", your rank of N entrants, rows with name, score and level.

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
  it waits for a nonzero `0B` (we send `0B F0`).
- **Close socket replies `<sock> 01`** (like connect); it checks for 1.
- Receive count `FF` or `00` = end of data. It reads to end-of-connection.
- Errors ≥ 100 display as 099; 499 = request/parse error.

## Exchange

`POST http://wgg01.channel.or.jp/service/swan-ranking/sen-know`:
`*=<id>&owner=<16 chars>&score=1|<8 digits>|<3-digit level>&list=ranking|10|%2b16`

**The owner is the console's owner name**, all 16 characters (short names are padded with spaces),
read from the console EEPROM (`0xCD97B`) and put through the game's own table (`0xCD94B`: space,
0-9, A-Z, ♥ as `[`, ♪ as `]`, `+`, `-`, `?`, `.`). The game then form-encodes it (`0xCE413`): a
space goes out as `+`, a plus as `%2b`, nothing else changes. So `MEDNAFEN` arrives as
`MEDNAFEN++++++++`, and a 16-character name can be up to 48 bytes.

**The game does not decode names in the reply.** It draws a row's name as it comes (`[` and `]` as
♥ and ♪). Echoed as uploaded, every name shorter than 16 showed a tail of plus signs. The server now
sends names back decoded (`+` to a space, `%2b` to `+`, cut to 16); it still stores them as uploaded.
Seen in the game 2026-11-26: `MEDNAFEN++++++++` before, `MEDNAFEN` after, and
`A B♥♪+-?0123456.` drawn as entered. Spaces inside names are safe: the parser reads a name up to
the next `|` before it looks for the next row's space.

## Reply (parser at ROM `0xCE160`; all three keys are required)

```
date=YYYYMMDDhhmm            (4 chars skipped, then month/day/hour/minute)
course=<g>|<n>|<entrants ≤8 digits>|<top>|<yours>|<your rank ≤8 digits>
ranking=<k>
 <rank>|<score ≤8 digits>|<name ≤16, decoded>|<level ≤255>      ← each row found by scanning for a SPACE
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

## Limits (checked in the game, 2026-11-26)

- Entrants, your rank, each row's rank and the score are 32-bit and drawn as 8 digits: 100000 and
  99999999 show correctly. A reply with 9-digit numbers left a blank white screen, so the server
  stops entrants and rank at 99999999 (it used to stop at 9999, while row ranks were not cut).
- The level is one byte: 255 shows as 255, 256 as 000.
- The parser copies a name with no length check into a 26-byte record (17 for the name); the
  server's cut to 16 is what keeps it in bounds.
- `ranking=0` leaves old memory on the list. The player's own upload always gives at least one row.
- A reply it can't read gives エラーコード 499; no answer from the server gives 099.
- Y2 (`Y_RIGHT` in `emu/drive.py`) scrolls the list towards the top.

Not known: whether Bandai's server sent names padded to 16 or trimmed. We send the decoded name as
it is, spaces included.

**Headless core:** the game waits for bit 4 of port `0xBE` to clear after starting an EEPROM read
(`0xC1325`); this core never clears it, the read times out, and the game sends the leftover register
bytes as its name and id: `owner=G0G0G0G0G0G0G0G0`, `*=010111`. The checks above used a scratch copy
of the ROM with that wait's `jnz` (`0xC133A`) replaced by two `nop`s, which then sends the real
owner name. On hardware the unpatched game should behave like that copy; not checked on hardware.

Verified headless (2026-10-15) against 60 seeded entries, with the player at #61: rows 1–10,
then 53–61. It opens on #61 (♥アナタサマ), and Y_LEFT / Y_RIGHT scroll the list with no rows
past the end.
