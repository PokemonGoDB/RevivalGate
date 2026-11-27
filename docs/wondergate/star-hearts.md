# Star Hearts — Gate Bazaar ✅

Status: **all four requests work** headless (2026-10-13). Title → ワンダーゲート → the BAZAR
room. The shopkeeper connects and issues a member card with a member number
("会員証を手に入れた！"). Two greeters count visitors ("あなたは…今日 6人目のお客様じゃ！")
and give an item on round numbers. The server keeps both counts. The shops and the other
rooms are part of the game itself; their doors open later in the game ("時間が経たないと開かない"). Server: [`server/starhearts.py`](../../wondergate/server/starhearts.py).

## Reaching it

The title's ワンダーゲート (and つづきから) are selectable only with a valid save: SRAM `0x128E`
bit 6 set and the word at `0x282D` equal to the negated byte sum of `0x128E..0x282C`
(`A000:ADE2`). Headless, the replay starts a new game and far-calls the game's own save routine
(`A000:AE06`, `drive.py farcall:A000:AE06`), resets, and picks ワンダーゲート (UP, RIGHT, A).

## Requests (`s_hearts.wgg.channel.or.jp`, dial `##`)

`GET /cgi-bin/starhearts.cgi?000NFFFF`, one routine per N in bank `0x3A` (`A000:33A0` N=2,
`33DE` 3, `343E` 4, `349E` 5). The body lands at RAM `0x295D`. For N=3..5 the routine reads a
number (`A000:3534`, `34FE`):

```
body[0..2]  digit count + 4, three hex digits, least significant first
body[3..4]  ignored
body[5..]   the number, hex, most significant first (32 bits; read wrongly from 0x10000 up, see below)
```

and stores it: N=3 → SRAM `0x500E`, N=4 → `0x5012`, N=5 → `0x5000`. Script commands in bank
`0x39` (`9000:CAE0`, `CB30`, `CC70`, `CAA0`) return it to the script (`[0xC07E]`, −1 on error).
Map scripts are word opcodes run through the handler table at `9000:317A` (bank `0x39`). Opcode
20 (`0x14`, handler `9000:338C`) runs event N: entry N of the table at `2000:0002` in bank `0x21`,
a short list of `9000:` routine addresses. The event numbers below are those arguments.

The bazaar is map 19 of bank `0x20` (map number `0x1D4`; the per-bank map counts are at `9000:3A20`).
Its block is at ROM `0x205B7E`: a count, then 6-byte entries `(type, room<<8 | object, offset)`
(lookup `9000:3A86`). Room `0x0F` is the entrance hall: object 2 is the greeter モモ, `0x0B` the
membership shopkeeper, and 6 and 7 the visitor counters (scripts `0x20776C` and `0x207EB8`).
The counters aren't standing in the hall in a fresh save. To test them, a scratch copy of the ROM
pointed モモ's entry at their scripts.

| N | Event | Use |
|---|---|---|
| 2 | 22 | connection check |
| 5 | 21 | membership: the member number on the card (shown in decimal) |
| 3 | 23 | today's visitor count (JST day): "あなたは…今日 N 人目のお客様じゃ！"; a gift on multiples of 10, 100 and 1000 |
| 4 | 29 | all-time visitor count: "ここがはじまって以来… N 人目"; a gift on multiples of 100 and 1000 |

Each `0003`/`0004` request counts as one visit (`data/starhearts.json`).

## Numbers past 65535, and the display's width (2026-11-26)

The number reader (`A000:350C`) takes one hex digit at a time, but it *rotates* its low word left
four bits (`rol dx,1` / `rcl bp,1`, four times) where it should shift it. Each digit pushed out of
the top of the low word goes into the high word and also comes back in at the bottom, where the
next digit is added to it. Plain hex is therefore read right only below `0x10000`:

- Seen in the game: the body `C000000010000` (65536) was stored as `0x00010001` and the greeter
  said 65537人目. A member number sent as `031C69E0` (52193760) was stored, and written out for the
  card, as 52194556.
- `number()` now works back from the value to the eight digits the game reads as that value (for
  each digit of the high word, lowest first, it takes away what the rotation adds). Below `0x10000`
  the reply is the same plain hex as before. A Python copy of the reader agreed with the game on
  every body tried, and with `number()` on 200,000 random values.
- Checked in the game with the fix: a seeded count of 65536 reads 65536人目; the member card shows
  the number the server logged (95721962) and SRAM `0x5000` holds it.

What the dialogue can show, with the counts seeded in `data/starhearts.json` (the counters were
reached with the scratch ROM described above):

- 0 shows as 0人目 (we never send 0: a visit is counted first). 10, 100, 1000, 10000, 65535, 99999,
  999999, 9999999, 99999999 and 999999999 all show in full.
- With a tenth digit the first digit comes out as a stray character (1000000000 showed
  000000000, 2147483648 showed E47483648), and `FFFFFFFF` is the game's error value ("うまく調べる
  ことができなんだぞい"). So `number()` stops at 999,999,999.
- After the card is issued the requests still end in `FFFF`: the member number is never sent back.

The game does not check a reply. With the body replaced by `?` bytes it still hands out a card,
with whatever its reader makes of the bytes (SRAM `0x5000` = `BF 5D BF 5D`).

Not checked: the gifts on round numbers, and what the original server's numbers looked like.

Regression: `starhearts` in `emu/replays.txt`. The member number is random, so there are no fixed
bytes to expect at `0x5000`, only "not `BF5DBF5D`", and the replay's last screen is the same either
way. Far-calling the two counter routines after it gives fixed values on a fresh server
(`farcall:A000:33DE w600 farcall:A000:343E w600`): today's count `1500E=01000000`, the all-time
count `15012=02000000`; after corrupted replies they held `3A0A3A0A` and `C9C9C9C9`.
