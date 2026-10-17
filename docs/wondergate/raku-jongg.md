# Raku Jongg (落雀): national rankings ✅

Status: **working end to end** (headless emulator + our adapter + `server/swan_ranking.py`),
2026-10-13. Ranks, tables, names and stages display correctly.

How to reach it: title menu → 記録 (5th tile) → ワンダーゲート (3rd item) → きめる.
Replay: `emu/drive.py "raku jongg" w600 RIGHT RIGHT RIGHT RIGHT A w180 DOWN DOWN A w120 A w1500`.

## Exchange

One TCP connection, three keep-alive POSTs to
`http://rakujang.wgg.channel.or.jp/swan-ranking` (form body, not URL-encoded):

| # | Body | Reply the game needs |
|---|---|---|
| 1 | `*=FFFFFF&owner=<name>&score=1\|<score>\|<stage>` | any 2xx, `Content-Length: 0` |
| 2 | same with `score=2\|…` | same |
| 3 | `score=3\|…&list=rakujang\|1\|20\r\n` | table, below |

Courses: 1 = Story (ストーリー戦), 2 = Dan rank (段位認定), 3 = Time attack.

Reply body, one block per course in order (parser at ROM `0xBF190`):

```
course=1|1|<entrants>|<top>|<your score>|<your rank>
rakujang=<k>
<rank>|<score>|<owner>|<stage>
```

- Only `<your rank>` is read from the course line ("N位です。おめでとう").
- `<k>`, rank and `<stage>` are 1–2 digits ending in CR. At least one row is
  always parsed, even when `<k>` = 0.
- `<score>`: up to 6 digits; shown ×100 (`240450` → 24045000点).
- `<stage>`: shown +1 as 『N面』.
- `<owner>`: up to 8 chars, the low bytes of the game's 16-bit character codes (the cart EEPROM
  holds the default name あふろざむらい as `33 4E 5F 68 53 5B 34`). Echo it byte-exact. Table, read
  off 私的記録 with each code poked into the saved names (2026-10-15; symbols rechecked
  2026-10-16, each code between known kana):
  `20-29` 0-9 · `2A-2E` ぁぃぅぇぉ · `2F-32` ゃゅょっ · `33-62` あ…も や ゐ ゆ ゑ よ ら…ろ わ を ん ·
  `63-7B` が…ご ざ…ぞ だ…ど ば…ぼ ぱ…ぽ · `7C-84` ァィゥェォャュョッ · `85-CD` katakana, same
  layout as `33-7B` · `CE-DC` 、。！？ー～→←♪“”『』☆♥ · `DD` space. Any code below `20` or above
  `DD` ends the name: the game draws nothing after it. The game never shows the downloaded table
  (only your rank), so this came from the local records screen, which uses the same font.

## Client details (HTTP lib at ROM `0xCC00`–`0xD1C2`)

- Status: char after the first space `2` → OK; `301`/`302` → follows `Location: http://`;
  anything else → error 499 ("リクエストエラーです"). Short status line → 400; socket error → 999.
- Header lines < 16 bytes are skipped; `Content-Length: N` is read at a fixed offset
  (exactly one space). A 2-byte line ends the headers. No Content-Length = no body read.
- Lines are read with adapter cmd `11:0D` (≤ 127 bytes), body with `11:0F`.
