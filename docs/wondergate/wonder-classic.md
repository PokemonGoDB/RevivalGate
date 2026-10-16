# Wonder Classic: Net Tour 🔁

Status (2026-10-13): **the Net Tour works** headless. エントリー shows the bulletin (第1回, this
month's dates, top 100 qualify, free entry) and downloads the round, which uses the 18 holes of a
built-in course. That round is a **test round** (course 0, with weather and wind that change every Monday), not a designed
tour; see the plan below. ネットツアー then appears in the game menu and plays. Finished rounds are
entered from エントリー and ranked: ワールドランキング, あなたの順位 ("1位"), 前回の入賞者 and
歴代ワールドランキング are built from the entries. 新製品開発情報 gives one item a month
("パワークラブセットを てにいれた！"). スーパースーパーショット works as store-and-forward: エントリー
uploads a player's super shot, and VTR lists the uploaded shots and replays them.
Server: [`server/nclassic.py`](../../wondergate/server/nclassic.py) on port 10000.

## The game

ナムコワンダークラシック, published by Bandai on 2001-01-18 (SWJ-BANC06, ¥4,500), supervised by
Namco; WonderSwan Color, also runs on mono; played vertically.
- **Courses:** 4 courses, 72 holes:
  - ワンダーゴルフコース (grassland)
  - アルプスゴルフクラブ (mountain)
  - ココナツゴルフリゾート (tropical, the hard one)
  - ナムコカントリークラブ (tricky)

  Which built-in course index is which needs the ROM.
- **Modes:** キャラゲット, ストローク, マッチ, ミニバトル (ドラコン/ニアピン), ミニコース (9 par 3s),
  ツアー (32 players), ネットツアー, トレーニング.
- **Players and items:**
  - 12 characters, plus 12 Neo characters unlocked through 耳寄り情報.
  - 4 caddies.
  - Equipment comes in 4 kinds (club set, ball, glove, shoes), パワー or コントロール; 16 items in all.
- Training sets **weather (晴れ/雨), wind direction (360°) and wind strength (0–15 m)**.

Sources: the [manual](https://gamemanual.midnightmeattrain.com/entry/ナムコワンダークラシック) (pp. 14, 26–32),
[Bandai's product page](http://web.archive.org/web/20011101004836/http://www.swan.channel.or.jp/swan/software/line_up/wonder_classic/index.html).

## The original Net Tour (manual pp. 26–32)

- **A month per tour.**
  - Weeks 1–3 are the 予選 (qualifier); week 4 is the 決勝 (final).
  - **Weather and wind change every week**, and the final is played in harder conditions.
- **Entering:**
  - You must have downloaded 今回のコース and played every hole during the event.
  - Each entry must beat your own previous one, with unlimited retries in the qualifier.
  - Best score ranks first; ties go to whoever entered first.
- **Rankings and the final:**
  - ワールドランキング shows the top 32, and あなたの順位 your rank among all entrants.
  - Results come out on the qualifier's last day. The **top 100** can then download a separate
    決勝コース, and the final takes two score uploads.
  - 歴代ワールドランキング ranks best final scores.
  - Prize winners (入賞者) got real prizes from a 冠 (title) sponsor. Paid entries used a prepaid
    card's scratch number.
- **Bulletin:** the manual's sample reads "第1回 … よせん 01/02/01–01/02/08 … よせんの100いまでが
  けっしょうに すすめます … 協賛バンダイ". So type 6 probably has text fields for the stage and the
  sponsor that we haven't decoded.
- **新製品開発情報:** a new item **every Monday**, and the download carries every item released so far.
- **History:** the Net Tour site ([wonderclassic.adm.ne.jp, June 2001](http://web.archive.org/web/20010521160145/http://wonderclassic.adm.ne.jp/index.html))
  said no tour had been held yet. Its super-shot ranking already had 92 entries. **There's no
  evidence any tour round was ever held**, so no original round exists to recover.
- **The replays attached to a round (types 20/21):** nothing public explains them. The manual says
  a Net Tour means downloading a course and entering "that course's ツアー", and tour mode has 32
  players. So they are probably scripted rivals' or demo rounds bundled with each month's course
  (inference). They are not player uploads: the cart only uploads final scores and 0x25-byte shot
  headers.

## Plan: our Net Tours

- **Conditions: decoded and live** (2026-10-15, see the round layout below). Each week's round
  now carries its own weather and wind: rain on every hole or none (a 25% chance a week, 50% in
  the final), wind 0–6 m in the qualifying weeks and 6–14 m in the final, from one prevailing
  direction that shifts by up to 22.5° per hole. They're seeded by month and week, so every
  player gets the same round (`week_conditions` in `server/nclassic.py`: SHA-256 of the month and
  week, so the Worker port gives the same bytes). Pins stay at each
  hole's default until we pick our own.
- **The course list.** With the ROM, list every hole: course, number, par, length, hazards. That
  gives us themed tours, since holes can be mixed across courses. For example:
  - all par 3s ("short game")
  - the longest par 5s
  - a windy month, a rain month
  - one course's back nine against another's front nine
  - the hardest holes of ココナツ

  Each gets its own name.
- **Structure as in the manual:**
  - A monthly tour with fixed holes.
  - Each Monday the round is re-issued with that week's weather and wind; the bulletin shows the
    stage and that week's dates.
  - After week 3, the top 100 (ties to the earlier entry) get the harder final.
  - New equipment every Monday, cumulative.
- **Leaderboards on our site:** the current tour's qualifier and final, past tours (歴代), and a
  super-shot ranking like the original site's. The sponsor field credits our project, not Bandai.
- **Demos.** Find out what the type 20/21 trajectories are and who reads the slots at `[0x50A8]`.
  If the format can be recorded from our own play in the emulator, each tour ships with demos of
  its holes. Until then the slots stay empty, which the game handles.
- **Preservation.** Every tour we run is committed to the repo:
  - its definition (holes, weekly conditions, dates, name and theme)
  - its demos
  - its final standings

  Past tours are listed on the site, so ours aren't lost the way Bandai's were.

## Check your cartridge

A downloaded round is kept in the tour save (SRAM 0xACF). No tour is known to have run, but if you own Wonder Classic and its save mentions a ネットツアー, please send us
the save.

## Reaching it

Vertical. Main menu: Y_LEFT ×2 → 通信, **DOWN confirms**. The first visit opens the メンバーズ
カード form (handle, name, postal code, prefecture, address, TEL, mail). Kana keyboard: Y_LEFT
enters the grid, DOWN types, Y_RIGHT ×2 → OK!. Digit pads: DOWN types, Y_RIGHT → OK!. Then OK! →
はい → phone screen はい. The communication menu: ネットツアーワールドランキング (エントリー,
ワールドランキング, あなたの順位, 今回のコース, 歴代ワールドランキング), スーパースーパーショット,
新製品開発情報, 耳寄り情報, 前回の入賞者, メンバーズカードの変更.

After a successful download the game menu gains ネットツアー. Every message box with ▼ needs a
DOWN; the download itself starts after the "通信中は…電源を切らないで" box is dismissed. In the
communication sub-menu LEFT goes back.

## Adapter fix it needed

The game polls an idle socket before the server has spoken. A real adapter answers "0 bytes";
we used to answer "closed" after 30 s. wgcore now waits ≤ 2 s and answers count 0.

## Protocol (port 10000, binary; library at ROM `0x361460`..`0x362A00`, buffers in SRAM)

```
server → WSR\r st n  rec×n      on connect (hello: st 0, n 0) and after each request
client → WGS\r <10-byte user ID>             login (zeros before registration)
client → WSC\r <type> <params…>              request; reply records have a fixed size per type
record  = WSD\r <data>                       size (incl. WSD\r) from the table at ROM A000:0382
```

`st` 0 = OK (other values map to errors 0x2C5..0x2CC). `n` × size must be ≤ 0x900. The game is driven by a
bytecode script (ops at ROM `0x3628E1`..). Op `0x290D` sets the expected reply type and appends
it as the request's 5th byte.

| Type | Record | Use | Status |
|---|---|---|---|
| 1 | 0x16 | register member card → member ID (10) + 8 bytes. Card: handle +0 (8 two-byte characters), name +16, postal code +46, prefecture +54; we keep the handle and prefecture for the rankings | ✅ |
| 6 | 0xCC | tour bulletin (body after `WSD\r`): round (word +0), qualifier cutoff rank (word +6), entry fee in yen (word +10; 0 = free, otherwise a prepaid card is asked for), start/end dates yyyymmdd text at +168/+176 (shown yy/mm/dd) | ✅ |
| 5 | 0x111 | the Net Tour round, downloaded by 今回のコース with params `<round word> 00 00 00 00` (parser `6000:4F8E`, unpacked into the tour save at SRAM 0xACF; see below) | ✅ |
| 4 | 0x12 | server clock before an entry, `yyyymmddhhmmss` (JST); after the round's end date → すでに しめきりが すぎていました 707 | ✅ |
| 9 | 0x14 | the entry: params round(4) 00 00 score (signed word, strokes over par). An empty reply completes it (エントリーした スコアデータは メモリーから さくじょしました) | ✅ |
| 7 | 0x14 | あなたの順位, params round(4): rank word +2 | ✅ |
| 18 | 0x0E | スーパースーパーショット エントリー: uploads the 0x25-byte shot header (below). An empty reply completes it | ✅ |
| 16 | 0x1B | VTR's shot list (params 4 constant bytes): word 1 (0 ends), 4-byte ID, 16 bytes shown (we send the uploader's handle), 1 byte; up to 20 (`6000:51CF`) | ✅ |
| 15 | 0x29 | one shot (params its 4-byte ID): the uploaded 0x25-byte header; the game re-simulates the shot ("SCENE 1 ホールインワン … 2ホール") | ✅ |
| 20, 21 | 0x262, 0x480 | replays attached to a Net Tour round: after type 5, the game fetches up to 5 by the IDs in the round's word list at +0xC (type-5 procedure, `A000:1455`). Full 0x6A8-byte trajectories, not player uploads; the originals are lost and our rounds list none, so none are requested. Also sent with ID 0 (after type 19) only from the hidden communication test menu (`0x341300`), not by any player menu. Bodies (after a 0x1C-byte header) fill up to 5 slots of 0x6A8 bytes at `[0x50A8]` (0x242 + 0x460 bytes, count at 0x9DD+0x87E; `6000:54C6`, `6000:5529`). Empty → スーパーショットのデータが みつかりません | content lost |
| 8 | 0x26 | this round's world ranking (ワールドランキング; params round(4) 00 00 start(2) count(2)): name +0 (8 two-byte characters), score +0x20 (signed word, strokes over par). Rank = list position, equal neighbours get "T"; HOLE shows F | ✅ |
| 14 | 0x24 | 歴代ワールドランキング: round +2 (word), name +6, score +0x16 | ✅ |
| 13 | 0x08 | 前回の入賞者: previous round (word +0). Round 0 → だい1かいのネットツアーが しゅうりょうしていません | ✅ |
| 11 | 0x45 | previous winners, params = type 13's 4 bytes + start + count: name +0, prefecture +0x10 (JIS 1–47), score +0x37 | ✅ |
| 22 | 0x08 | 新製品開発情報: an item, bytes [club set, ball, glove, shoes], 1 = パワー, 2 = コントロール; the first record is shown and unlocked | ✅ one a month |

## The Net Tour round (type 5)

```
+0     round (word); 0 = no tour, and the game menu has no ネットツアー
+2..   5 words (+0x0A = entry fee in yen, as in the bulletin; non-zero opens the paid
       サービスメニュー), then a word list from +0xC ending in 0
+0xB2  start date, +0xBA end date: "yyyymmdd" text (shown yy/mm/dd; the entry deadline)
+0xC2  18 hole indexes: built-in course * 18 + hole (table 6000:50FE)
+0xD4  18 bits (MSB first): rain on that hole
+0xD7  18 nibbles (high first): wind strength, 0–15 m
+0xE0  18 nibbles: wind direction, 16 steps of 22.5° clockwise from straight up the hole screen
+0xE9  18 (x, y) byte pairs: pin position; (0, 0) = the hole's default pin
```

How the parser (`6000:4F8E`) stores them in the tour save at SRAM `0xACF` and where the hole
loader (`5000:2C78`) puts them in the hole state at `0x33A7`:

| Field | Tour save | Hole state | Checked on the hole screen (hole 1, course 0) |
|---|---|---|---|
| +0xD4 bit | `+0x5C` byte | `+0x08` | 1: the weather icon turns to rain and rain falls |
| +0xD7 nibble n | `+0x6E` word `n·0x101` | `+0x10` | 5 → "5m", 15 → "15m" |
| +0xE0 nibble n | `+0x92` word `1 << n` (`5000:64CF`) | `+0x0E` | with 10 m: 0 ↑, 2 ↗, 4 →, 8 ↓, 12 ←, 15 one step left of ↑ |
| +0xE9 (x, y) | `+0xB6` / `+0xDA` words | `+0x0A` / `+0x0C` | (0x20, 0x20): REST 389 → 410 y; (0x90, 0x60): 362 y |

With zeros the game fills in the hole's own pin (e.g. `0x60, 0x38` for course 0 hole 1). The
words read as (min, max) pairs set to one value, which suggests the game can vary conditions
within a range; the round format only sets fixed values. A round saved by an old probe with
out-of-range values reset the game after character select; our generated values stay in
range.

The per-hole values go into the hole state at 0x33A7 (loader `5000:2C78`); zeros play the
hole normally. The parser sets the stored best score (0xACF+0xFE) to `0x7FFF` (no record);
finishing the round fills it, and エントリー offers it (このスコアで エントリーしますか？).
Our round uses one built-in course (`NC_ROUND_COURSE`, default 0), with this week's weather and
wind. Verified 2026-10-15 through a download: hole 1 showed that week's conditions (sunny, 3 m from
direction 13, the arrow pointing up and to the left).
In this vertical game DOWN is the confirm/swing button. Verified end to end headless: download,
18 holes played with repeated swings (+144), reset, エントリー → type 9 with that score.

Server data (members, entries per round) is in `data/nclassic.json`. Member IDs are now unique
per registration (they used to all be `WC00000001`).

## Super shots

A super shot is recorded (`5000:2800`) when a hole is finished by holing out (`[player] & 4`
sets bit 3 of the flag word at `player+0xFD`) in tour, stroke or Net Tour play (mode word
`0x346+0x18` & `0x287` ≠ 0): 1 stroke → ホールインワン (kind 3), par − 3 → kinds 1/2, par − 2 → 4/5,
par − 1 → 6/7 (bit 2 of the player's flags picks which of each pair). Up to 20
records of 0x3C bytes live at SRAM 0xD6F (tour save + 0x392); kind at +6. エントリー packs one
(`6000:534E`) into the header: kind, course × 18 + hole, conditions, and four 6-byte
shot-parameter blocks; type 15's reply is unpacked into the same layout (`6000:522C`).

Verified headless: a tour round with the stroke counter (player + 0xC3 = SRAM 0x1FF) reset
before every shot recorded a "hole-in-one" when a putt dropped. エントリー uploaded it (type 18),
and VTR listed it (16), fetched it (15) and replayed it on the cartridge.

Names in the rankings are 2-byte characters (ASCII letters as `0x41 00`…). The HOLE column
always shows F: entries are finished rounds (type 9 carries only the final score), and no
row field changes it. あなたの順位's first word is not displayed.

## 耳寄り情報

Offered once all 12 characters are cleared (bits 0–11 of the word at tour save +4, SRAM
0x9E1; otherwise まだ ぜんキャラを クリアしてません). Its submenu: **ネオキャラ** runs
command 23: a type-4 request (the server clock), then `6000:5D74` sets bit 12 of that word,
which unlocks the Neo characters (message at `A000:46CE`). お好みキャディさん is the offline
caddie select. Verified with the 12 character bits set in the save: the menu appeared, the
clock was fetched and the bit was set (0x0FFF → 0x1FFF).

The menu sets the command number at SRAM 0x3941 (handlers `0x36D6E5…`); `6000:58E3` runs the
procedure from the table at `A000:12AF`.

Probe hooks in the server (environment): `NC_REC=type=hexbody|hexbody,...` answers exact
records, `NC_PROBE=type:count` marker records, `NC_ZERO`/`NC_COURSE` zeroed rounds,
`NC_ROUND_PATCH=OFF:hex,...` patches the round.

Also present: `POST /cgi-bin/kakin.cgi` and the charge layer (service `BAN00C01`) for paid
entries, with HTTP on port 80.

Regression: `wclassic` in `emu/replays.txt`. From boot it types a member card (handle あ,
Tokyo), registers, and downloads the round. The member-card typing steps are in the replay;
in the kana grid DOWN types and Y_RIGHT ×2 reaches OK!. `wcshot` continues from there: it writes
a super-shot record the game recorded (60 bytes at SRAM 0xD6F), uploads it with エントリー and
replays it through VTR (types 18, 16, 15).
