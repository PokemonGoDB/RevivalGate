# Wonder Classic: Net Tour 🔁

Status (2026-10-13): **the Net Tour works** headless. エントリー shows the bulletin (第1回, this
month's dates, top 100 qualify, free entry) and downloads the round, which uses the 18 holes of a
built-in course. That round is a **test round** (course 0, with weather and wind that change every Monday), not a designed
tour; see the plan below. ネットツアー then appears in the game menu and plays. Finished rounds are
entered from エントリー and ranked: ワールドランキング, あなたの順位 ("1位"), 前回の入賞者 and
歴代ワールドランキング are built from the entries. 新製品開発情報 gives one item a month
("パワークラブセットを てにいれた！"). スーパースーパーショット works as store-and-forward: エントリー
uploads a player's super shot, and VTR lists the uploaded shots and replays them.
Checked in the game on 2026-11-26 (see "Stage word, weekly re-issue and the final" and the notes
marked with that date): a new week's conditions now download, メンバーズカードの変更 works, and VTR
with no shots on the server shows データがありません.
Since 2026-11-27 the month ends with a **final** (けっしょう), run by rules of our own: see
"The final: our rules, not Bandai's". It was played through in the game on both sides of the
cutoff; 前回の入賞者 and 歴代ワールドランキング now show final results.
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
  now carries its own weather and wind: rain or none (a 25% chance a week, 50% in
  the final; in a rain week holes 9 and 18 stay dry, because the cart cannot store rain for
  them, see the round layout), wind 0–6 m in the qualifying weeks and 6–14 m in the final, from one prevailing
  direction that shifts by up to 22.5° per hole. They're seeded by month and week, so every
  player gets the same round (`week_conditions` in `server/nclassic.py`: SHA-256 of the month and
  week, so the Worker port gives the same bytes). Pins stay at each
  hole's default until we pick our own. The final (from the fourth Monday) keeps one set of
  conditions to the end of the month.
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
    stage and that stage's dates.
  - After week 3, the top 100 get the harder final (built 2026-11-27: see "The final: our
    rules, not Bandai's").
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
we used to answer "closed" after 30 s. wgcore now waits as long as the game asks (its receive
command says 10) and then answers count 0.

## Protocol (port 10000, binary; library at ROM `0x361460`..`0x362A00`, buffers in SRAM)

```
server → WSR\r st n  rec×n      on connect (hello: st 0, n 0) and after each request
client → WGS\r <10-byte user ID>             login (zeros before registration)
client → WSC\r <type> <params…>              request; reply records have a fixed size per type
record  = WSD\r <data>                       size (incl. WSD\r) from the table at ROM A000:0382
```

`st` 0 = OK (other values map to errors 0x2C5..0x2CC; `st` 1 showed しばらくたってから
やりなおしてください 711 on 2026-11-26). `n` × size must be ≤ 0x900. The game is driven by a
bytecode script (ops at ROM `0x3628E1`..). Op `0x290D` sets the expected reply type and appends
it as the request's 5th byte.

| Type | Record | Use | Status |
|---|---|---|---|
| 1 | 0x16 | register member card → member ID (10) + 8 bytes. Card: handle +0 (8 two-byte characters), name +16, postal code +46, prefecture +54; we keep the handle and prefecture for the rankings | ✅ |
| 2 | 0x0E | メンバーズカードの変更: the card again, in type 1's layout (0xED bytes). The cart needs one record with 10 bytes; it compares them with its member ID but ignores the result (script op `0x16`, `6000:2AEC`). With no record: きたいしたデータを うけとれませんでした 705. We send the member ID and keep the new handle and prefecture; what Bandai sent is not known | ✅ 2026-11-26 |
| 6 | 0xCC | tour bulletin (body after `WSD\r`): round (word +0), stage (word +4, see below), qualifier cutoff rank (word +6), entry fee in yen (word +10; 0 = free, otherwise a prepaid card is asked for), the qualifier's start/end dates yyyymmdd text at +168/+176 (shown yy/mm/dd). Shown only when the stage is 4 (the final): prize cutoff rank (word +8, "32い までに はいれば にゅうしょうと なります"), the final's start/end dates at +184/+192 | ✅ (final: 2026-11-27) |
| 5 | 0x111 | the Net Tour round, downloaded by 今回のコース with the bulletin's first 6 bytes as params: `<round word> 00 00 <stage word>` (parser `6000:4F8E`, unpacked into the tour save at SRAM 0xACF; see below) | ✅ |
| 4 | 0x12 | server clock before an entry, `yyyymmddhhmmss` (JST); after the round's end date → すでに しめきりが すぎていました 707 | ✅ |
| 9 | 0x14 | the entry in the qualifier: params round(4), the stage word, score (signed word, strokes over par). An empty reply completes it (エントリーした スコアデータは メモリーから さくじょしました). Outside this month's qualifier we answer status 2 (712) and keep nothing | ✅ |
| 7 | 0x14 | あなたの順位 in the qualifier, params round(4): rank word +2. Equal scores share a rank, as in the cart's own list | ✅ |
| 18 | 0x0E | スーパースーパーショット エントリー: uploads the 0x25-byte shot header (below). An empty reply completes it | ✅ |
| 16 | 0x1B | VTR's shot list (params 4 constant bytes): word 1 (0 ends), 4-byte ID, 16 bytes shown (we send the uploader's handle), 1 byte; up to 20 (`6000:51CF`). The cart needs at least one record (script op `0x14`, `6000:2A24`; none gives error 705), so with no shots we send one zero record and the VTR screen says データがありません | ✅ 2026-11-26 |
| 15 | 0x29 | one shot (params its 4-byte ID): the uploaded 0x25-byte header; the game re-simulates the shot ("SCENE 1 ホールインワン … 2ホール") | ✅ |
| 20, 21 | 0x262, 0x480 | replays attached to a Net Tour round: after type 5, the game fetches up to 5 by the IDs in the round's word list at +0xC (type-5 procedure, `A000:1455`). Full 0x6A8-byte trajectories, not player uploads; the originals are lost and our rounds list none, so none are requested. Also sent with ID 0 (after type 19) only from the hidden communication test menu (`0x341300`), not by any player menu. Bodies (after a 0x1C-byte header) fill up to 5 slots of 0x6A8 bytes at `[0x50A8]` (0x242 + 0x460 bytes, count at 0x9DD+0x87E; `6000:54C6`, `6000:5529`). Empty → スーパーショットのデータが みつかりません | content lost |
| 8 | 0x26 | this round's world ranking (ワールドランキング; params round(4) 00 00 start(2) count(2)): name +0 (8 two-byte characters), score +0x20 (signed word, strokes over par). Rank = list position, equal neighbours get "T"; HOLE shows F | ✅ |
| 14 | 0x24 | 歴代ワールドランキング: round +2 (word, the TOUR column), name +6, score +0x16. We send the best final totals of past rounds | ✅ 2026-11-27 |
| 13 | 0x08 | 前回の入賞者: previous round (word +0). Round 0 → だい1かいのネットツアーが しゅうりょうしていません | ✅ |
| 11 | 0x45 | a round's final ranking, params round(4) start(2) count(2). Asked by 前回の入賞者 (round from type 13; parser `6000:4EC6` shows name +0, prefecture +0x10 (JIS 1–47), score +0x37) and by ワールドランキング during the final (parser `6000:4DAC` shows name +0 and word +0x17 plus word +0x27). We fill all of them: the two scores at +0x17 and +0x27, their total at +0x37 | ✅ 2026-11-27 |
| 22 | 0x08 | 新製品開発情報: an item, bytes [club set, ball, glove, shoes], 1 = パワー, 2 = コントロール; the first record is shown and unlocked | ✅ one a month |
| 12 | 0x14 | the entry in the final (stage 4), same params as type 9 (`0C 02 00 00 00 04 00 <score>`). An empty reply completes it; an error status leaves the score on the cart. See the final's rules below for who is refused | ✅ 2026-11-27 |
| 10 | 0x2E | あなたの順位 in the final, params round(4): rank word +2; word +0x1E = 0 shows "5位（ざんてい）" (provisional), not 0 the rank alone (screen `6000:43C0`). The cart reads 0x2A bytes and shows nothing else of them | ✅ 2026-11-27 |

## The Net Tour round (type 5)

```
+0     round (word); 0 = no tour, and the game menu has no ネットツアー
+2..   5 words (+4 = stage, as in the bulletin; +0x0A = entry fee in yen, as in the bulletin;
       non-zero opens the paid サービスメニュー), then a word list from +0xC ending in 0
+0xB2  start date, +0xBA end date: "yyyymmdd" text (shown yy/mm/dd). The cart refuses an entry
       when the server clock (type 4) is before the start (706, from the code) or after the
       end (707, seen; `6000:18B3`), so each stage's round carries that stage's own dates
+0xC2  18 hole indexes: built-in course * 18 + hole (table 6000:50FE)
+0xD4  rain: byte +0xD4 = holes 1-8, byte +0xD5 = holes 10-17 (MSB first); holes 9 and 18
       are always dry, and byte +0xD6 is not used (see below)
+0xD7  18 nibbles (high first): wind strength, 0–15 m
+0xE0  18 nibbles: wind direction, 16 steps of 22.5° clockwise from straight up the hole screen
+0xE9  18 (x, y) byte pairs: pin position; (0, 0) = the hole's default pin
```

How the parser (`6000:4F8E`) stores them in the tour save at SRAM `0xACF` and where the hole
loader (`5000:2C78`) puts them in the hole state at `0x33A7`:

| Field | Tour save | Hole state | Checked on the hole screen (hole 1, course 0) |
|---|---|---|---|
| +0xD4 bit | `+0x5C` byte per hole | `+0x08` | 1: the weather icon turns to rain and rain falls |
| +0xD7 nibble n | `+0x6E` word `n·0x101` | `+0x10` | 5 → "5m", 15 → "15m" |
| +0xE0 nibble n | `+0x92` word `1 << n` (`5000:64CF`) | `+0x0E` | with 10 m: 0 ↑, 2 ↗, 4 →, 8 ↓, 12 ←, 15 one step left of ↑ |
| +0xE9 (x, y) | `+0xB6` / `+0xDA` words | `+0x0A` / `+0x0C` | (0x20, 0x20): REST 389 → 410 y; (0x90, 0x60): 362 y |

**Rain, holes 9 and 18 (2026-11-26).** The parser's rain loop (`6000:503A`) takes 9 holes from
each byte (it counts `ch` from 8 down to 0), shifting one bit out per hole, so the 9th hole of
each byte reads a bit that was never there: holes 9 and 18 are always stored dry, and the third
byte is never read. Seen in the game: rounds with +0xD4 = `FF FF C0` (what the server sent
before) and `FF FF 00` both stored `01×8 00 01×8 00` at tour save +0x5C, and `80 80 40` stored
rain for holes 1 and 10 only. Playing a rain week's round (`FF FF 00`), holes 1-8 and 10-13
showed the rain icon and rain, hole 9 the sun (holes 14-18 were not played; hole 18 is from the stored bytes). The server
used to put hole 9's bit where the cart reads hole 10's (and so on up to hole 17), which made no
difference while rain is all or nothing. It now writes the bits where the cart reads them. No
reply can make it rain on holes 9 and 18.

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

## Stage word and weekly re-issue (2026-11-26, the final 2026-11-27)

Word +4 of the bulletin and of the round is the tour's stage. Read from the ROM and then checked
in the game:

- **Download check** (`6000:1946`): 今回のコース fetches the bulletin and compares its round (+0)
  and stage (+4) with the saved round (tour save +0, +4). Both equal: あたらしい データは
  ありませんでした 708, and nothing is downloaded. So a new week's conditions only reach a cart
  that already has this month's round if the stage word changes.
- **Qualifier or final**: the cart reads the word as signed. Below 4: qualifier (the bulletin
  says よせん; requests 8, 7, 9). Exactly 4: the final (けっしょう; requests 11, 10, 12). Above 4:
  ワールドランキング fails with 705 (`6000:197E`) and エントリー with 704 (`6000:19AD`); these two
  errors are from the code, the game was only tried with 5 on the bulletin screen (よせん).
  ワールドランキング goes by the bulletin it has just fetched; エントリー and あなたの順位 go by the
  round saved on the cart.
- The server sends the week of the month (`stage_word`): 0 before the first Monday, then 1, 2
  and 3, and 4 from the fourth Monday to the end of the month, fifth Monday included. That the
  word counts weeks is our reading (4 = the final fits the manual's "week 4 is the final");
  what Bandai sent is not known. Until 2026-11-26 it sent 0 every week (so a cart answered 708
  until the next month), and on 2026-11-26 0xFFFF and 0xFFFE for weeks 4 and 5 to keep the cart
  out of the final, which was not served then. Negative values were seen to work as the
  qualifier; they are no longer sent.
- A download for a new stage of the same round keeps the cart's entry counts (tour save +0x102
  qualifier, +0x104 final) but clears an unsent score (+0xFE back to 0x7FFF) and the last
  entered score (+0x106 back to 0, parser `6000:50F1`).
- **A side effect of the weekly re-issue, not fixed (2026-11-27).** The entry screen
  (`6000:42DB`) refuses a qualifier score that is worse than the last one entered (+0x106) once
  the cart has entered (+0x102 not 0): いぜんより きろくが わるくなっています / こんかいの エントリーは
  ちゅうししました, and nothing is sent. Because a download sets +0x106 to 0, a cart that has
  entered this month and then downloads a new week's round can only enter ±0 or better. Seen in
  the game: entered +5, downloaded another week's round, +3 was refused and −2 was offered. No
  reply of ours changes this; only keeping the stage word the same through the qualifier would
  (and then a new week's conditions would not reach a cart that has the round). The final is
  not affected: its entries are not compared.

## The final: our rules, not Bandai's (2026-11-27)

No Net Tour is known to have been held, and nothing survives of how Bandai's server ran a
final: who exactly qualified, what a player who did not was told, how two rounds were ranked,
the dates. **The rules below are ours.** They are the plainest reading we could find of the
manual and of what the cartridge itself shows and says, which is listed after them.

1. **Each month is one tour.** The qualifier (よせん) runs from the 1st to the day before the
   fourth Monday, with new weather and wind every Monday; the final (けっしょう) runs from the
   fourth Monday to the last day of the month, in one set of harder conditions.
2. **The 100 best qualifying scores may enter the final.** A player's best entry of the month
   counts, whichever week it was made in; players level on the 100th place all get in.
3. **The final is ranked by the total of two rounds.** A player with one round in is on the
   ranking with that score, provisionally, and is dropped when the month ends; the finished
   ranking is what 前回の入賞者 and 歴代ワールドランキング show.

The details, and why:

- **Fourth Monday, not "the last week".** The cart takes stage 4 and only 4 as the final and
  refuses anything above (see the stage word), and the manual has weeks 1 to 3 as the qualifier
  and week 4 as the final. Counting weeks from each Monday, as the round's conditions already
  did, puts the final on the fourth Monday in every month. **A month with five Mondays** just
  has a longer final: the fifth Monday changes nothing (the stage stays 4, the round and its
  conditions stay, a second download answers 708). Starting the final on the fifth Monday
  instead would leave it one to three days long. The final is as long as the month allows:
  8 days in November 2026 (23rd to 30th), 4 in December 2026 (28th to 31st), 10 at most. The
  shortest are Februaries that begin on a Tuesday: 28 and 29 February 2028, and the 28th alone in 2033.
- **Which qualifying score counts.** The player's best entry of the month, whichever week's
  conditions it was played in. One score per player that only gets better is the cart's own
  model: with a round on it, it sends a new score only if it beats the last one it entered
  (see the stage word section). After a new week's download it can send a worse one, so the
  server keeps the best.
- **Ties.** The cart's ranking list gives equal scores the same rank ("2T", "2T", then 4; seen
  in the game). The server ranks the same way everywhere: あなたの順位 shows the shared rank, and
  everyone whose rank is 100 or better may enter the final. Inside a tie the earlier entry is
  listed first (the manual's rule); for a player who improved, that is the time of the better
  score, and in the final the time the total was reached.
- **Who turns a player away.** The cart tells everyone the same thing. Its final bulletin says
  ただいま けっしょうせんを おこなっております / よせんを つうかしないと エントリーは できませんので /
  あらかじめ「あなたのじゅんい」を ごかくにんください, then warns that a download replaces the old
  tour data and offers it. So the bulletin and the final round are the same for every player, and
  the download is not refused (a failed download also wipes the round the cart holds:
  `6000:59E4` zeroes it after any error in command 5; seen with a status-2 reply to type 5,
  after which the saved round number was 0). A player who kept the qualifier's round
  still sees the qualifier rank (type 7) during the final, as the bulletin asks.
  - A cart that never entered the qualifier refuses the entry by itself: よせんに
    エントリーしていないと けっしょうに さんかできません / じかいの ネットツアーに ごさんかください. Nothing
    is sent.
  - A cart that entered but is outside the 100 sends its score (type 12). **The server
    refuses it** with status 7, which the cart shows as うけつけにんずうを こえたため とうろくが
    できません 715 ("more than the number accepted, it cannot be registered"). It is the
    closest of the cart's server errors; no status says "not qualified". The cart keeps the
    score and its counters.
  - The cart stops a third entry itself (けっしょうせんのエントリーは 2かいだけしか できません); the
    server answers one the same way, with 715.
- **One round entered.** Before each final entry the cart says けっしょうは 2かいのスコアの
  ごうけいで きそいます / 1かい だけでは しっかくとなります / また 2かい いじょうは エントリーできません.
  After one entry its あなたの順位 screen shows "5位（ざんてい）" and もういちど エントリーすれば
  せいしきじゅんいと なります when word +0x1E of the type-10 record is 0; after two, the rank
  alone. So a player with one round has a rank, called provisional. We rank everyone by strokes
  over par so far, the way a golf leaderboard does during play: the ranking list (type 11)
  holds one-round players with their one score, and the rank in type 10 is the place in that
  list. When the month ends, the players with one round are left out (しっかく).
- **The bulletin.** In the final it shows the final's dates (+184/+192) and "32い までに はいれば
  にゅうしょうと なります" (word +8). There are no prizes. 32 is what 前回の入賞者 lists the month
  after (the cart asks for 32 rows), so that is what にゅうしょう means here. The qualifier
  bulletin and round now end the day before the final instead of at the end of the month; a
  qualifier score entered later is refused by the cart itself (すでに しめきりが すぎていました 707).
- **Results.** A round's result is its final ranking: the players with both scores, by total.
  前回の入賞者 (type 13, then 11) lists last month's, numbered 1位, 2位, … with prefecture;
  歴代ワールドランキング (type 14) lists the 32 best final totals of all past rounds with the round
  in its TOUR column (the manual says it ranks final scores). A round nobody finished the final
  of has no result: 前回の入賞者 shows an empty list for it. That includes rounds 1 and 2 if they
  end before this is deployed. Their qualifier entries stay in the server's data but are no
  longer listed (until now both lists showed qualifier scores).
- **Refusals with no screen of their own.** A final entry when no final is running, a qualifier
  entry after the qualifier has closed (only a cart holding a round with other dates can send
  one), and あなたの順位 for a player the server has no final score from are answered with
  status 2: もくてきの データが みつかりませんでした 712.
- **Worker only:** a final takes at most 200 players (more than 100 can only qualify through a
  tie; beyond 200 the answer is 715), and a final entry over the per-address write limit is
  answered with status 3 (サーバーが こんざつしています), so the cart keeps the score.

What the server keeps: `scores` (round → member → best qualifier score, in entry order) and
`finals` (round → member → the one or two final scores, in the order the totals were reached)
in `data/nclassic.json`, the same in the Worker's state row.

Status replies seen in the game (2026-11-27, as the reply to type 12): 1 データベースに エラーが
はっせいしました, 2 もくてきの データが みつかりませんでした 712, 3 サーバーが こんざつしています,
4 メンバーかくにんが できませんでした 709, 5 きたいしたデータを うけとれませんでした, 6 この
ハンドルネームでは うけつけられませんでした, 7 うけつけにんずうを こえたため とうろくが できません 715,
8 and 9 as 5. (Where no number is given, the screenshot was taken before it appeared.)

**Seen in the game (2026-11-27)**, with the server's date fixed by `NC_TODAY`:

- One cart across the two stages: on 2026-11-17 it registered, downloaded the round, entered +5
  (a score written into the save, as in `wcentry`) and was shown 6位 among five seeded players.
  With the server moved to 2026-11-24 and the same save: あなたの順位 still 6位 (type 7);
  ワールドランキング the final's list (type 11); 今回のコース the final bulletin (けっしょう,
  26/11/23~26/11/30, 32い…), the three warnings and the download (`05 02 00 00 00 04 00`);
  エントリー with +3 (types 4, 12), then あなたの順位 "5位（ざんてい）" (type 10); a second entry
  of −1, then "3位" and a ranking of 1 C −3, 2 B +1 (one round), 3T A +2, 3T E +2, 3T あ +2;
  the cart's own total (+0x106) was +2 and it refused a third entry.
- A cart ranked 101st of 101 (100 seeded players ahead): 101位 in the qualifier week and again
  in the final week, the final round downloaded, the entry refused with 715, the score still
  on the cart (+0xFE) and no final entry counted (+0x104 = 0).
- A cart with no qualifier entry: refused by the cart, no request (server log).
- A cart with the qualifier's round and a new score on 2026-11-24: 707 from the cart (only the
  clock was asked). With the round's end date changed in the save to the 30th it sent type 9
  and got 712.
- 2026-11-30 (a fifth Monday) with the final round of the 24th on the cart: 今回のコース → 708.
- あなたの順位 with a final entry on the cart but none on the server: 712. With none on the
  cart: げんざいのツアーには エントリーされていません (from the cart).
- 2026-12-08: 前回の入賞者 showed 第2回 1位 C −3 ほっかいどう, 2位 A +2 とうきょう, 3位 E +2 おきなわ
  (the player with one round was not listed), and 歴代ワールドランキング 1 A −5 (tour 1), 2 C −3
  (2), 3 D +1 (1), 4T A +2 (2), 4T E +2 (2).

Not known, and not needed for the above: what the other 0x26 bytes of the type-10 record and
the bytes of the type-11 record between the fields held (dates, a member ID?). The cart shows
none of them.

After every command the library leaves its result at SRAM 0x50B0 (word): 0 after success, else
the error number shown (0x2C1 = 705, 0x2C4 = 708, 0x2C7 = 711). SRAM 0x3941 holds the command.

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

VTR downloads every listed shot (one type-15 request each) before showing the list. With no
local super shot, エントリー says スーパーショットの データが みつかりません and sends nothing
(2026-11-26). If a listed shot is missing when it is fetched, the cart does not check for a
record and unpacks whatever its buffer holds (from the code, `6000:522C`; not tried).

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
`NC_ROUND_PATCH=OFF:hex,...` patches the round. Test hook (Python only): `NC_TODAY=yyyy-mm-dd`
fixes the server's date, for the tour's week and for the type-4 clock (the time of day stays
real). Without it the date is Japan's, as in the Worker (it used to be the machine's own date,
while the clock was already Japan time).

Also present: `POST /cgi-bin/kakin.cgi` and the charge layer (service `BAN00C01`) for paid
entries, with HTTP on port 80.

Regression: `wclassic` in `emu/replays.txt`. From boot it types a member card (handle あ,
Tokyo), registers, and downloads the round. The member-card typing steps are in the replay;
in the kana grid DOWN types and Y_RIGHT ×2 reaches OK!. `wcshot` continues from there: it writes
a super-shot record the game recorded (60 bytes at SRAM 0xD6F), uploads it with エントリー and
replays it through VTR (types 18, 16, 15).

How to tell that the cart took the replies (2026-11-26, each also run with a failing reply):
after `wclassic`, SRAM 0x50B0 = `00 00`, SRAM 0xACF (the saved round) is not `00 00` and SRAM
0x36F8 holds the member ID (`WC00000001` on a fresh server); a refused registration leaves
0x36F8 zero, a failed download leaves 0xACF zero and the error number at 0x50B0. After `wcshot`,
SRAM 0x3945 = `80 00` (the list row's name) and SRAM 0x3B45 starts `84 21 24 B2 00 00 03 00`
(the unpacked shot); a failed list leaves 0x3945 zero, a failed fetch leaves 0x3B45 zero.

The final's replays (2026-11-27), each with a seed folder in `emu/seeds/` holding the server's
state and a `server.env` that fixes the date. All start from power-on:

- `wcfinal` (2026-11-30, a fifth Monday): registers, reads the final bulletin and downloads the
  final round, enters two scores (+3, −1), asks its rank after each and opens the ranking. The
  cart's record of a qualifier entry (tour save +0x102, +0x106) and the two scores are written
  into the save; the seed holds the matching qualifier score. Afterwards SRAM 0xBD1 =
  `01 00 02 00 02 00` (one qualifier entry, two final entries, total +2), 0x5203 = `03 00` and
  0x521F = `01 00` (rank 3, not provisional), and the ranking's rows are at 0x3B45.
- `wcfinalno` (2026-11-24): the same with 100 players ahead in the qualifier. The entry is
  refused: SRAM 0x50B0 = `CB 02` (715), the score still at 0xBCD, 0xBD3 = `00 00`.
- `wcwinners` (2026-12-08): 前回の入賞者 and 歴代ワールドランキング from the finals in the seed
  (the rows at 0x5201 and 0x3B45).

The five older replays have a `server.env` too (2026-11-10, a qualifying week): without it they
would run into the final on some days, where `wcentry`'s cart has no qualifier entry. With
corrupted replies, and against the server as it was before the final, the three new ones fail.

Nothing in `captures/` covers this protocol: the server does not save port-10000 traffic, so
the Python server and the Worker are not compared on it by the capture test. On 2026-11-26 the
two were compared by hand on 126 requests (the game's own from these sessions plus a few made
up) on six dates, and replied the same. On 2026-11-27 they were compared again with the
Worker's `NclassicSession` run under Node (its clock fixed, its D1 row held in memory) against
`nclassic.answer` with `NC_TODAY`: 1846 requests on 13 dates (qualifying weeks, the first and
last days of a final, a fifth Monday, a one-day final, the 1st of the next month) from three
starting states, covering every type the game sends and each refusal. The replies and the state
left behind were the same. The Worker's own limits (rate limit, 200 players in a final) were
not exercised.

Not verified: anything on a real console (the card change, the empty shot list, the final);
hole 18 on screen; error 706 (an entry before a stage's start date, from the code); a final
with more than a handful of players in the game (the 32-row lists were only seen with up to 6
rows); the Worker's final against the real D1.
