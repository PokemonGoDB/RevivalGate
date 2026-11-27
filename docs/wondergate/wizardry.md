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
  - The score column draws seven digits and drops the ones above: 12345678 showed as 2345678 and
    10000000 as 0. From nine digits the number reader (`0x176D13`: digits buffered at RAM `0x120`,
    the sum kept at `0x128`, eight powers of ten in its table) goes wrong altogether: 4294967295
    showed as 5964233. So a score is sent as at most 9999999; places still go by the stored score.
- `^MSG` (a message) and `^ERR` (error 601) may also appear.

### Limits checked in the game (2026-11-26, seeded server)

Ranking, each through the `wizrank` route with `data/wizardry.json` seeded:

- **1st to 4th place:** the player's row is starred in place (`* 2ND ALICE 8500 *`, `* 3RD …`), and
  4th is a fourth row under the top three. From 5th the `⋮`, the place above and the player follow.
- **Ties:** equal scores keep the order they were registered in, so a new player with the same
  score ranks below (our choice).
- **Rank 254, 255, 256 and 300:** shown as `*254TH`, then `*255TH` for the rest, with the row above
  one less (the real place above is still the name shown).
- **Scores:** 9999999 is the most the screen shows right (see above); larger ones are sent as 9999999.

Downloads, with replies written by hand on a scratch server:

- **Maps:** flags and sets land as sent (flags `1 1 0 1 0 1 1 1 0 1` gave SRAM `0x40F2` = `EB 02`,
  sets 0 and 19 were taken). A set of 20 is error 600 and nothing is stored. Ten pairs with every
  flag 0 is "ついかマップはありませんでした". The parser reads pairs until `#` with no count check and
  always tests ten flags, so the reply must hold exactly ten pairs, as ours does. A fresh cartridge
  already holds sets 10–19 at `0x40F4` with no floor enabled.
- **Shop:** item 2 and item 121 are taken (marks at SRAM `0x42A7 + n`), and so is a list of all 120.
  Item 1, item 122 and an empty list are error 600, and the stock table is cleared before the list
  is read, so a refused list leaves the shop empty. Every month of our rotation is twelve numbers
  inside 2–121; the first (2–13) and last (110–121) were both taken.

Not checked: what Boltac's shop screen lists (it needs a party in town), and the names and scores
the ending itself sends (the replay writes the URL into RAM).

### What shows that the game took a reply (2026-11-26)

Each checked against a run whose reply bodies were replaced with `?` (the game then shows
エラーコード 600 データエラー):

- `wizardry`: SRAM `0x40F2` = `FF 03` after the map download (`00 00` otherwise), `expect:140F2=FF03`.
  The shop's marks depend on the month (November 2026: `0x42CD`–`0x42D8` = `FF`); its message
  "ざいこリストをダウンロードしました!" is the last screen.
- `wizrank`: the first slot and the player's slot hold name, score and rank:
  `expect:1411B=414C4943450087D6120001` and the same at `14147` (zeros otherwise).

## Ranking registration (end of the game)

The connect routine (ROM `0x13B92F`) picks the URL by `[0x1E2]`: 0 maps, 1 shop, otherwise the
string the ending builds at RAM `0x1EA` (`…wiz.cgi?nm=NAME&sc=SCORE`). The reply handler is
chosen by mode, and mode 2's handler (`0x13B81F`: checks, `^RNK` parse `7000:6AB0`, ranking screen
`7000:6E13`) only exists when bit 15 of `[0x178]` is set (the ending context); afterwards the game
resets to the title. Headless, the `wizrank` replay opens WONDER GATE → ダウンロード, then sets
`[0x1E2]` = 2, `[0x179]` = 0x80 and writes the URL at `0x1EA` before せつぞく.
