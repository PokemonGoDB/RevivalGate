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
