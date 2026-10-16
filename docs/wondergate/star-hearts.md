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
body[5..]   the number, hex, most significant first (32 bits)
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

Regression: `starhearts` in `emu/replays.txt`.
