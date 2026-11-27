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
- `<k>`, `<your rank>` and `<stage>` are 1–2 characters ending in CR. At least one row is
  always parsed, even when `<k>` = 0.
- **`<your rank>` and `<k>` must be one character.** Their two-digit reads (`0xBF248`, `0xBF359`)
  do `mov ax,10 / mul bx / add ax,dx`, and `MUL` clears DX, where the units digit was: "15" reads
  as 10. A lone character is read as char − `'0'` whatever it is, so we send `'0' + n`
  (10 = `:`, 15 = `?`, 20 = `D`). The game announces ranks 1–20 only, so a lower rank goes as 21
  (`E`). Only `<stage>` (`0xBF566`, `add ax,bx`) reads two digits correctly. Checked in the game
  (2026-11-25) with 14 better scores on the server: "ストーリー戦は 15位です。おめでとう", and
  公的記録 lists all 16 rows; with decimal "15" and "16" it would say 10位 and stop at row 10.
- `<score>`: 2 to 6 digits; shown ×100 (`240450` → 24045000点, `999999` → 99999900点). The parser
  measures the field and has a case for each length from 2 to 6; any other length, 7 or more
  included, reads the first character only (`0xBF3AD`). We always send 6.
- `<stage>`: one or two digits. Story shows it +1 as 『N面』 up to `04`; `05` or more shows 『完勝』.
  Dan rank and Time attack show a grade instead: `02` 8級 … `09` 1級, `10` 初段, `11` 2段 … `19` 10段,
  `99` 雀聖 (seen 2026-11-26; values between 20 and 98 were not tried).
- `<owner>`: up to 8 chars, the low bytes of the game's 16-bit character codes (the cart EEPROM
  holds the default name あふろざむらい as `33 4E 5F 68 53 5B 34`). Echo it byte-exact. Table, read
  off 私的記録 with each code poked into the saved names (2026-10-15; symbols rechecked
  2026-10-16, each code between known kana):
  `20-29` 0-9 · `2A-2E` ぁぃぅぇぉ · `2F-32` ゃゅょっ · `33-62` あ…も や ゐ ゆ ゑ よ ら…ろ わ を ん ·
  `63-7B` が…ご ざ…ぞ だ…ど ば…ぼ ぱ…ぽ · `7C-84` ァィゥェォャュョッ · `85-CD` katakana, same
  layout as `33-7B` · `CE-DC` 、。！？ー～→←♪“”『』☆♥ · `DD` space. Any code below `20` or above
  `DD` ends the name: the game draws nothing after it. This came from the local records screen
  (私的記録); the downloaded tables are shown with the same font under 記録 → 公的記録 (20 slots
  per mode, your own row underlined).
- **Two of those codes are form and row separators**, because the name goes out as raw codes
  (seen 2026-11-26 with names poked into the save):
  - The digit 6 is `0x26`, `&`. A name あ6い is sent as `owner=3&4&score=…`, and a plain form
    split stored it as あ. The server now reads the name up to `&score=`.
  - The small ァ is `0x7C`, `|`. In a table row it ends the name early: the rest of the name is
    read as the stage and the next rows shift (with ァ in row 3, rows 3–7 showed digits as names
    and wrong scores). We send it back as the full-size ア (`0x85`): あァいう shows as あアいう.
    The stored name keeps the ァ. This stand-in is ours.

## 公的記録 at 20 rows (2026-11-26)

With 25, 19 and 19 other scores seeded on the three courses, the game said "ストーリー戦は 圏外です。
ざんねん" (26th, sent as 21), "段位認定戦は ２０位です。おめでとう" and "タイムアタックは 1位です", and 公的記録
(記録 → 公的記録 → mode; DOWN scrolls three rows) listed all 20 rows of each mode with the right
names, scores and stages, our own row underlined at 20位 and 1位 and absent from Story. Rows
used 8-character names of digits, kana, katakana, the symbols `CE`–`DC` and the space `DD`, a
one-character name, the score 999999 and the stage 99. The row is underlined by rank, not by
name.

Proof that a reply was taken (RAM, cleared before each download): the tables are three blocks of
`0x232` bytes at `0xEF00`, `0xF132`, `0xF364`: 20 names of 9 words, then scores (`+0x168`: top two
digits as a word, then the low four as a word, then 0) and stages (`+0x1E0`, 4 bytes each), and
your rank in the block's last word (`0xF130`, `0xF362`, `0xF594`). For the replay on a fresh
server `0xEF00` holds `33 00 4E 00 5F 00 68 00 53 00 5B 00 34`, `0xF06A` = `E8 03` and the three
rank words are 1. With the table's body replaced by `?` bytes they stay 0 and the game sits on
通信中 (its scan for `course` never ends).

## One name per mode (2026-11-27)

The save has a record per mode, each with its own name (cartridge EEPROM `0x00`, `0x1E`, `0x3C`:
8 name words, the score as a 32-bit number at `+0x14`, the stage at `+0x18`), and each POST
carries its own mode's name. The table request is the third POST, so it only names the Time
attack record.

What the game sends, from the adapter log of a session with three names poked into the save
(あいう, かきくけ, たちつ) and from the code: one socket, then in this order

```
*=FFFFFF&owner=345&score=1|001000|02
*=FFFFFF&owner=89:;&score=2|000200|04
*=FFFFFF&owner=BCD&score=3|000200|04&list=rakujang|1|20
```

The request routine (ROM `0xCCA34`) sets the mode counter `[0xC110]` to 0 on entry, builds the body
for that mode (`0xCDC61`: name, score and stage of mode 0, 1 or 2; the `list` field only for mode
2), and after each reply adds 1 and sends again on the same socket until the counter is 2. Nothing
skips a mode, and an error on any request ends the session, so the table request never arrives
without the two uploads before it on the same connection.

Both servers now remember, for one connection only, the name each mode's score came with, and
look up the player's row in that mode under that name (and the same `*` id). A mode with no upload
on the connection is looked up under the table request's own name, as before. The memory is a dict
per connection (`swan_ranking.CONNECTION`, set by `wgserver.http_conn`; in the Worker
`ranking.CONNECTION`, set by `HttpSession`), gone when the connection closes. This is how we tell
which rows are the player's; what Bandai's server did is not known.

Seen in the game with the three names above and other players seeded (`emu/seeds/rakumodes/`: two
better Story scores, one better Dan score, three better Time attack scores): "ストーリー戦は 3位です。
おめでとう", "段位認定戦は 2位です。おめでとう", "タイムアタックは 4位です。おめでとう"; rank words `0xF130`,
`0xF362`, `0xF594` = 3, 2, 4; 公的記録 → 段位認定 underlines かきくけ at 2位. The same session against
a server without the memory says 圏外 for Story and Dan (rank words 0, 0, 4).

Checked on both servers with the same requests (byte for byte the same replies): the three
requests on three separate connections give ranks 0, 0 and the Time attack rank; two uploads on one
connection and the table request on another give 0, 0; a different `*` id on the same connection
is not matched; names holding `&`, `=` and `|` are matched.

Not looked at: how the game lets a player end up with different names (they were poked into the
save here). Not run: the Worker with the game itself (the Worker's replies were compared with the
Python server's for the game's recorded requests sent on one connection).

## Client details (HTTP lib at ROM `0xCC00`–`0xD1C2`)

- Status: char after the first space `2` → OK; `301`/`302` → follows `Location: http://`;
  anything else → error 499 ("リクエストエラーです"). Short status line → 400; socket error → 999.
- Header lines < 16 bytes are skipped; `Content-Length: N` is read at a fixed offset
  (exactly one space). A 2-byte line ends the headers. No Content-Length = no body read.
- Lines are read with adapter cmd `11:0D` (≤ 127 bytes), body with `11:0F`.
