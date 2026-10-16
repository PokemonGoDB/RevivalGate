# Uchuu Senkan Yamato: national ranking and crew logs ✅*

Status (2026-10-14): **working headless, from a poked CLEAR save.** One upload POSTs the
player's ヤマト指数 (Yamato index) and gets back the server date and the national top 50.
The date unlocks the 30 crew logs (航海日誌), which are **all in the ROM**: the original
server only released them on a schedule. With today's date all 30 open. Server:
[`server/swan_ranking.py`](../../wondergate/server/swan_ranking.py) (`yamato`). Replay: `yamato`.

Found by scanning ROMs for WonderGate code.

## The original service

- Bandai (Wikipedia: Bandai Visual), 2001-02-08 (SWJ-BANC09), runs on mono and Color.
- **Never advertised:** every product-page capture (2000-12 to 2001-12) says "通信 不可".
- But its server existed: `yamato.wgg.channel.or.jp` appears in the Wayback Machine in 2002-11
  (root 403, a password-protected admin/wwwstat), set up like the other live hosts.
- The log schedule in the ROM (below) runs from 2001-02-15 to 2001-05-01, starting a week after
  release.

## Reaching it

The title menu gains **通信** (and オマケ) once a save file is marked cleared. The game says so
itself (ROM `0x3C010D`): saving after the ending creates a CLEAR file, and then "タイトル画面に
「オマケ」「通信」が出現します".

- Title menu builder: ROM `0x3D06BD` (CS `D000:06BD`). Item flags at SRAM `0x3CA7`+:
  1 ロード and 5 自由演習 need a valid save; 4 **通信** and 6 オマケ need a valid save whose
  clear flag is set; 2 新規 and 3 各種設定 always; 7 シューティング when `[ss:0x300]` ≠ 0.
- Save files (check at ROM `0x3CCAC6`, write at `0x3CCB3D`): file 1 at SRAM `0x10`, file 2 at
  `0x1B5`, each `[xor byte][sum byte]` over the next 0x1A3 bytes, then `YAMATO`, a 0xF9-byte
  image of SRAM `0x13DF`… and a 0xA4-byte image of `0x14D8`…; backups at `0x35A` / `0x4FF`.
- **Clear flag:** SRAM `0xE5` (file 1) / `0x28A` (file 2), i.e. working SRAM `0x14AC`.

**We did not finish the game.** The replay writes a file 1 that is all zeros except `YAMATO`,
the clear flag, the four result fields below (100 kills, crew 50 %, mods 100, 20 days) and the
checksum (`0x28 0xDA`), then resets:

```
w300 poke:10=28 poke:11=DA poke:12=59 poke:13=41 poke:14=4D poke:15=41 poke:16=54 poke:17=4F
poke:E5=1 poke:F6=64 poke:F8=32 poke:F9=64 poke:10D=14 reset
```

Then title → START → 通信 (3× DOWN from ロード) → A. The WONDER GATE menu (module in ROM bank
`0x39`, CS `9000`) lists 航海日誌, ランキング, 番号設定 (dial number), アップロード, 終了. The cursor
skips 航海日誌 and ランキング until an upload succeeds during this visit (SRAM `0x5D4C`, set by the
upload, cleared on entering the menu, check at ROM `0x399158`). The last server date stays in
SRAM and shows at the top (`----.--.--` before the first connection).

## Upload (アップロード)

ファイル1/2 → confirm → name entry (8 chars, default `NO NAME `; UP/DOWN change a letter,
RIGHT moves on) → "以上ノ内容デアップロードシマスカ" → A. The screen shows ヤマト指数 and the
results it comes from.

`POST http://yamato.wgg.channel.or.jp/swan-ranking HTTP/1.1`, form body (builder ROM `0x39F4F7`):

```
*=<id>&owner=<8 chars>&score=1|<5 digits>|&list=yamato|1|50\r\n
```

- `<id>`: 6 hex digits from the console's internal EEPROM words 0x3C/0x3D (ROM `0x3C2374`);
  `00FFFF` in the emulator.
- Score: ヤマト指数, 0 to 65535, zero-padded (ROM `0x35CB00`, CS `5000`), from the chosen file:

  | Save offset (file 1) | Shown as | Term |
  |---|---|---|
  | word `0xF6` | 撃破 N隻 (kills) | min(N, 608) × 0x6FFF / 608 |
  | byte `0xF8` | 乗員 N% (crew) | N × 0x2000 / 99 |
  | 20 bytes `0xF9` | 改造 N% (sum of mod levels) | sum × 0x4000 / 160 |
  | word `0x10D` | あと N日 (days left) | N × 0x3000 / 32 |

  Our test file gives 4715 + 4137 + 10240 + 7680 = **26772**, shown and uploaded as `26772`.
  Out-of-range values crash the game (days = 500 → "ZERO DIVIDE 5000:CDF8").

## Reply (parser ROM `0x39F337`, CS `9000:F337`)

```
date=YYYYMMDD
course=1|1|<entrants>|<top>|<yours>|<your rank>     (ignored)
yamato=<n>
<rank>|<score ≤5>|<owner ≤8>|
...
```

- It scans for `DATE=` (any case) and copies the next 8 bytes to SRAM `0x13D5`. **The scan has no
  bound:** without `date=` the upload hangs on "アップロード シテイマス" (seen with our first reply).
  The `YAMATO=` scan is the same.
- **Row count bug:** one character before CR gives n = char − `'0'`; with two characters the
  `mul` at ROM `0x39F496` overwrites DX, so the second digit is lost (`12` reads as 1, `50` as 5;
  seen). We send the count as **one character, `'0'` + n** (`:` = 10 … `b` = 50). Verified with
  12 and 50 rows. What Bandai's server sent is unknown.
- Each row: skip to `|`, score up to the next `|` (6-byte field), owner up to the next `|`
  (9-byte field). 15-byte records at SRAM `0x41D0`, 50 of them (to `0x44BE`). The rest of the
  line is skipped; the course line and your rank are never read.
- ランキング shows "ヤマト オブ ヤマト", ranks 001–050, five per page (DOWN/UP); rows past n keep
  what an earlier download left there.

We rank by highest index first (the debug table below counts down too), each player (`*` id +
name) keeping their best, and send the top 50.

## Crew logs (航海日誌): in the ROM

Thirty logs, 01–30, chosen from a 6×5 grid, then shown as the speaker's portrait, a scene and
text, e.g. 01 沖田十三 "十月六日", 30 古代進 "９月６日" (Yamato's return). Their text is in ROM bank
`0x15` (`0x15AFBF`–`0x15EDxx`, one dated entry each). **The server sends no log content.** It
only sends the date.

How many are readable: level 0–6 at SRAM `0x5D4F`, set by ROM `0x399C42` from the stored date
on entering the menu and the log list:

- year ≠ 2001 → **6, all logs**;
- in 2001, the number of these dates reached (table ROM `0x399D1E`): 02-15, 03-01, 03-16,
  04-01, 04-16, 05-01, i.e. five more logs every two weeks.

Messages (pointer table ROM `0x398C44`): どれも閲覧できません, １〜０５まで閲覧可能 … １〜２５まで閲覧可能,
全航海日誌が閲覧可能. Locked numbers are dimmed.

Verified: with our date (2026-10-14) "全航海日誌が閲覧可能", and logs 01 and 30 open and display.
Poking the stored date to 2001-02-14 / 03-01 / 04-30 gives "どれも閲覧できません", "１〜１０まで閲覧可能"
and "１〜２５まで閲覧可能", matching the table. We send the real current date, so every log opens;
replaying the 2001 schedule would only hide content.

## Other ROM notes

- HTTP templates at `0x39F690` (`POST`, `GET`, `User-Agent: SWAN/1.0`, form encoding); the
  adapter/socket code is just before (`0x39EEC0`–`0x39F1FA`). Also
  `http://sample.wgg.channel.or.jp/siplib302.asis`, a library sample URL, unused.
- Error texts at `0x39870D`: adapter, battery, phone, redial, "このサービスの提供は終了しました",
  charge/game server errors.
- A second, debug copy of the menu code in bank `0x3C` (CS `C000:5CFA`) fills the ranking with
  `TEST1`…`TEST50` (10000 down to 9755 in steps of 5, ROM `0x3C5D86`) and uploads `12345` as
  `TEST_ABC`. Not reachable in normal play.

## Verified

Headless (emulator + our adapter + server), 2026-10-14, from the poked CLEAR save:
upload → "アップロード 終了シマシタ", date 2026.10.14 shown, ランキング with our row, 航海日誌 with
all 30 available and log 01 shown (replay `yamato`, capture `20261014-114943-560`). Tables of 12
and 50 rows were checked with extra rows posted straight to the server (not committed).

Not verified: a CLEAR file from real play, and real hardware.
