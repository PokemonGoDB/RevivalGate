# Another Heaven ~memory of those days~: quick-solve ranking ✅

Status: **working** headless (2026-10-13). Shows the top 5 names and your rank.

How to reach it (vertical): START ×2 → オプション (2× Y_LEFT, DOWN) → ワンダーゲート
(3× Y_LEFT, DOWN) → 電話番号入力画面 with "##" → 接続 (DOWN).
Replay: `emu/drive.py "another heaven" w600 START w300 START w300 Y_LEFT Y_LEFT DOWN w300 Y_LEFT Y_LEFT Y_LEFT DOWN w300 DOWN w2400`.

The manual (p. 12): 早解きランキング (quick-solve ranking); the player name is the console's
registered owner name; registration originally closed end of May 2001.

## Exchange

`POST /swan-ranking` (relative path), `Host: heaven.wgg.channel.or.jp`:
`*=<id>&owner=<owner name>&score=1|<6-digit time>&list=BEST|1|5`

The owner name is the console's, up to 16 characters, sent without form-encoding: a space goes as a
space, ♥ as `@`, ♪ as `$`, + as `,`; the letters, digits, `-`, `?` and `.` as themselves. The game
draws those same characters back as ♥ ♪ + on the board.

Reply, Raku Jongg layout, **lowest time first**:

```
course=1|1|<entrants>|<best>|<yours>|<your rank>
BEST=<k>
<rank>|<time>|<owner>|
```

**The 6 digits are a score, not a time** (ROM `0x346F9B`, 2026-10-15):
`3 × (9300 − min(progress, 8700)) + minutes`. Progress sums, over 92 story items, the percentage of
each item's 24 flags that are set (table at `5000:2F60`, routine `4200:2E00`); minutes is `[0x208]`,
which the frame interrupt bumps every 4500 frames while playing (`0x34ACFF`, capped at 5999). Lower is
better. A fresh save sends `027900` (no progress, 0 minutes); 27900 and up means no progress.

Header lines are read one at a time (adapter cmd `11:0D`), body by Content-Length.

## Limits (checked in the game, 2026-11-26)

Checked headless with the owner name set in the console EEPROM (`eeprom:360=…` in `emu/drive.py`;
this core keeps the name at byte `0x360`), a seeded table, and hand-made replies.

- **Names: 16 characters.** A full table of 16-character names fits the board exactly. A longer name
  in a reply is cut to 16 by the game. The server used to cut names to 8; it now keeps 16.
- **Your rank: 4 digits.** The board shows the rank's last four digits: 151 shows `0151`, 9999 shows
  `9999`, 10000 shows `0000`, 12345 shows `2345`. The server used to stop at 99, so anyone lower saw
  `0099`; it now stops at 9999. An empty rank field is error 0610.
- **Rows: at most 5.** `BEST=6` is error 0610. `BEST=0` shows an empty board. Rows fill the five
  slots in order; the rank at the start of a row is not used.
- The entrant count and the scores are not shown anywhere on this screen (6-digit entrants and
  8-digit scores were accepted).
- Errors: a reply it can't read gives `WONDERGATE ERROR CODE 0610`; no answer from the server gives
  `CODE 0001`.

Not known: how Bandai's server filled these fields. Rows uploaded before this fix are stored under
the 8-character name.
