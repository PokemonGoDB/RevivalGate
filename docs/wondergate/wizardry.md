# Wizardry Scenario 1: additional maps, net shopping, ranking ✅

Status: **working** headless (2026-10-13). WONDER GATE → ダウンロード → せつぞく: "あたらしいマップを
ダウンロードしました!", and the edge of town → スペシャル → ついかマップにはいる appears. ネット
ショッピング → せつぞく: "ざいこリストをダウンロードしました!". The extra floors and all items are
**in the ROM**; the server only switches them on. Server:
[`server/wizardry.py`](../../wondergate/server/wizardry.py).

## Requests (`www2.sting.co.jp`, dial `#9601`)

| Query | Feature |
|---|---|
| `GET /cgi-bin/wg/wiz.cgi?mp=kure` | additional maps |
| `GET /cgi-bin/wg/wiz.cgi?it=kure` | Boltac's stock list |
| `GET /cgi-bin/wg/wiz.cgi?nm=NAME&sc=SCORE` | high-score registration ("Do you register the record in the ranking?") |

The ROM also carries the charge-service URLs (`nph-srvccount/gettime/srvcinfo/session`); these
paths don't use them.

## Reply format (parsers ROM `0x176A0B`..`0x176D13`, body at SRAM `0x5800`)

```
#SUMxxxx#WIZ^MAP1 10 1 11 1 12 … 1 19 #SUMxxxx
```

- `xxxx` = 16-bit sum of the bytes between the two markers, **lowercase** hex, the same in both.
  A mismatch gives error 600 (データエラー).
- `#WIZ` must be in the first 0x80 bytes, and the section tag must follow it **immediately**.
- Numbers are decimal; the reader skips exactly one character after each. Lists end at `#`.
- `^MAP`: up to 10 pairs (enabled flag, encounter set < 20). New floors are OR'd into SRAM
  `0x40F2` and the sets copied to `0x40F4`. Sets index the 20 encounter tables at ROM `0x1EF50D`.
  We enable all ten with the harder sets 10–19.
- `^SHP`: item numbers 2–121, marked in the shop table (SRAM `0x42A7`). We rotate 12 a month.
- `^RNK`: entries `rank name_score`: the top 3, then the player, and when the player's rank is 5 or
  more a fifth entry, the place just above the player (parser `0x176AB0`: it reads the fifth into
  the slot before the player's). Without the fifth the player's row never appears. Kept in
  `data/wizardry.json`. Verified in-game: the cartridge shows RANK / NAME / SCORE with the player's
  row starred (`* 1ST ALICE 1234567 *`), and from 5th place down the top 3, `⋮`, the place above and
  the player (`5TH EEE 8996000`, `* 6TH ALICE 1234567 *`).
  - Each slot is 6 name bytes, the 32-bit score, then the rank as one byte. The name is copied up
    to `_` with no length check and the score lands on the sixth byte, so we send at most 5
    letters (a 6-letter name runs on into the score's bytes on screen, and two of them hung the
    ranking screen) and at most rank 255.
- `^MSG` (a message) and `^ERR` (error 601) may also appear.

## Ranking registration (end of the game)

The connect routine (ROM `0x13B92F`) picks the URL by `[0x1E2]`: 0 maps, 1 shop, otherwise the
string the ending builds at RAM `0x1EA` (`…wiz.cgi?nm=NAME&sc=SCORE`). The reply handler is
chosen by mode, and mode 2's handler (`0x13B81F`: checks, `^RNK` parse `7000:6AB0`, ranking screen
`7000:6E13`) only exists when bit 15 of `[0x178]` is set (the ending context); afterwards the game
resets to the title. Headless, the `wizrank` replay opens WONDER GATE → ダウンロード, then sets
`[0x1E2]` = 2, `[0x179]` = 0x80 and writes the URL at `0x1EA` before せつぞく.
