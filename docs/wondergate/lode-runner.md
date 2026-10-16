# Lode Runner for WonderSwan: extra stage downloads ❌

Status (2026-10-14): **protocol mapped, nothing to serve.** The download feature is worked out
end to end and our server answers it as a closed service (the game's own "no data list" error).
A local test with copies of built-in maps downloaded, played and saved a stage in the emulator.
The 50+ stages Bandai served are lost unless a cartridge's save still holds one (see below).

**Our addition: stage sharing over the link cable.** Bandai never took uploads. Our adapter can
also play the "other WonderSwan" of the game's DATA I/O menu: a player sends MAP1 or MAP2 to the
adapter exactly as to a friend's console, and the adapter uploads the stage to our server's review
queue. Nothing is published automatically; stages we publish later will be credited to the
player on the site. See [Link cable (DATA I/O)](#link-cable-data-io) and
[Sharing your stage](#sharing-your-stage-our-addition).

## The original service

- Banpresto, developer Aisystem Tokyo, 2000-04-20 (SWJ-BPR004).
- Bandai's product page: 120+ built-in maps, and "ワンダーゲートを使ってネットワークに接続すると、
  さらに50面以上の追加マップ" (50+ more maps over WonderGate)
  ([2001 capture](https://web.archive.org/web/20010112090700/http://www.swan.channel.or.jp/swan/software/line_up/road_runner/index.html)).
- Players used it: a 2002 post says one stage per connection, out of 50
  ([swanlog](http://wsc.s201.xrea.com/x/swanlog/dat/1008667445.dat)); another notes the game is
  missing from Bandai's official WonderGate list ([post 615](http://wsc.s201.xrea.com/x/swanlog/dat/983211119.dat)).
- The game matches that: it fetches a list, the player picks one stage, and each stage is a
  separate call. The list holds at most 50 entries, each with a date (作成日, "created"), so the
  stages were probably released over time. No list, stage or date survives.

## Check your cartridge

Lode Runner saves to a **2 KB serial EEPROM** in the cartridge (header save type `0x20`), not SRAM.
A downloaded stage is **not** saved automatically: it opens in the map editor, and it only
survives if the player then chose セーブ → MAP1 or MAP2. Those two editor slots are the only
places an original stage can still exist:

| EEPROM bytes | Content |
|---|---|
| `0x200`–`0x3FF` | MAP1 |
| `0x400`–`0x5FF` | MAP2 |

Each slot (written by `8000:61DA`, read by `8000:6229`; EEPROM word `0x100 + 0x100·slot`):
`+0x000` the 504-byte tile grid (the download format), `+0x1F8` a word with the music chosen in the
editor's サウンド設定, `+0x1FA` CRC-32 of `+0x000`–`+0x1F9` (zlib's; routine `8000:7AB4`),
`+0x1FE` `4C 97` when valid (`B3 96` = erased by one of the game's delete options, or a save that was interrupted).

Stages also travel over the link cable (DATA I/O sends MAP1/MAP2), so a friend's cartridge may
hold a copy. The data doesn't record where a stage came from: a slot can hold a player's own
stage, a built-in map loaded with 既存マップ参照 and saved, or a download.
[`tools/loderunner_save.py`](../../wondergate/tools/loderunner_save.py) checks a 2 KB EEPROM
dump, prints both slots and, given your ROM, names slots that are copies of built-in maps.
**If you own this game, especially a used copy, please dump its save and send it to us**: any
slot that isn't a built-in map could be one of the lost stages, or a fan stage from 2000.

## Reaching it

No button combo. Title → START → START → main menu (項目を選んで下さい): press DOWN to step
through STORY MODE, SELECT MODE, ORIGINAL MAP, MAP EDIT, DATA I/O, **DOWN LOAD**, OPTION.
DOWN LOAD → 通信 (connect; 電話番号設定 sets the number, the default dials `##`) →
通信準備をして下さい … Aボタンを押して下さい → A. Replay `loderunner` in `emu/replays.txt`.

## Protocol (`wgg01.channel.or.jp`, port 80)

Plain wgcore works: no adapter quirks. Headers are read with the adapter's line receive
(command `0D`, up to `0x7F` bytes a line), bodies with raw receive (`0F`, `0x7F` a chunk).

**Request.** `8000:B2E5` sends `GET /` + the path buffer at RAM `0x0742` + ` HTTP/1.1` CRLF
`Host: ` + host (RAM `0x06B6`, copied from ROM `0x0AA85`) CRLF CRLF (template at ROM `0x0B2CF`).
No User-Agent. The path buffer already starts with a slash (`/download/loadrunner/mapdata/` at
ROM `0x0A765`, then `filelist.txt` at `0x0A783` or a stage name), so the request line has a
**double slash**:

```
GET //download/loadrunner/mapdata/filelist.txt HTTP/1.1
Host: wgg01.channel.or.jp

```

**Reply** (`8000:B3C0`): the status line must start `HTTP/`, then the 3-digit code after the first
space. Header lines starting with `C` are matched against `CONTENT-LENGTH: ` and `L` against
`LOCATION: ` (both case-insensitive); others are skipped; a blank line ends the headers.
302 is followed: `LOCATION: http://host[:port]/path` replaces host, port and path, and the
request is sent again. Codes: 2xx = read the body by Content-Length; 404 = error 603 (list) or 601
(stage); 400, 500, 503 shown as such; other 401–499 = 499, other 500–599 = 599.

**1. The list** (call 1, `8000:A5DE`): `filelist.txt`, parsed line by line (`8000:B5B6`/`B5F2`).
Lines end in CRLF and are at most `0x7F` bytes. Leading bytes ≤ `0x20` are skipped; then
`NAME,` with NAME at most 12 characters (an 8.3 file name fits), then three decimal numbers
separated by any non-digits: year 1–9999, month 1–12, day 1–31. A line that breaks a rule is
dropped without an error. Up to 50 entries are kept at RAM `0x1000 + 0x10·i` (name, `+0x0C` year,
`+0x0E` month, `+0x0F` day). No valid entry = error 604. The screen shows only
「ステージ No. nn」 (the entry's position, not its name) and 「作成日 YY/MM/DD」; UP/DOWN browse,
A picks.

```
STAGE01.MAP,2000,7,14
```

(An example of the shape only: the real names and dates are unknown.)

**2. One stage** (call 2, `8000:A790`), after 「ダウンロードしたデータは MAP EDIT で表示されます
よろしいですか？」 → はい: `GET //download/loadrunner/mapdata/NAME`. The Content-Length must be
exactly **504** (`0x1F8`) and every byte ≤ `0x1E`, else error 602. The body goes to RAM `0x1600`,
which is the map editor's work buffer; the game sets the size to 28 × 18 (`[0x589]`, `[0x58A]`)
and opens the editor with it. From the editor menu (START) the player can プレイ (play) it or
セーブ it to MAP1/MAP2. The download itself writes nothing to EEPROM.

Errors (table at ROM `0x0A9C8`, code → message picture), the four checked in the emulator:

| Code | Message | Cause |
|---|---|---|
| 603 | データリストがありません | list: 404 (**what our server answers now**) |
| 604 | データリスト不具合のため認識できませんでした | list: no valid line |
| 601 | 面データがありません | stage: 404 |
| 602 | データ不具合のため認識できませんでした | stage: not 504 bytes, or a byte > `0x1E` |

## Stage format

One format everywhere: a **28 × 18 grid of tile bytes, row-major, values `0x00`–`0x1E`**.

- **Download:** the bare 504-byte grid.
- **Built-in maps:** `[1C 12]` (width, height) + the grid, 506 bytes apart from ROM `0x60000`
  (bank 6, `E000:0000`): 126 blocks up to `0x6F90B`. Pointer tables at ROM `0x10000` (125 far
  pointers to the grids) and `0x101F4` (125 to the headers), used by `8000:62BB`; the 126th block
  (`0x6F712`) is in neither. The editor's blank map is another block at ROM `0x6820`.
- **Editor save:** the grid + music word + CRC + magic (above).
- **Link cable (DATA I/O):** the whole `0x200`-byte slot record, received into `0x1600` (`8000:7F3B`);
  see below.

So a downloaded stage is byte for byte what the editor makes, and a built-in map minus its 2-byte
header. Tile codes seen in map 1-01 and the editor: `00` empty, `02` bar, `04` brick, `05` solid
block (also fills unused rows and columns), `08` ladder, `0E` gold; others (`0A`, `10`, `16`, `19`
…, presumably the hidden ladder, the runner and the guards) are not decoded here.

## Link cable (DATA I/O)

Main menu → DATA I/O (5th entry) → 「通信項目を選んで下さい」: データを送る (send) or データを受ける
(receive); sending then asks 「どのデータを送信しますか？」 MAP1 / MAP2. Worked out from the ROM and confirmed for the sending side
in the emulator against our link peer (below). Code addresses are `8000:xxxx` (= ROM offset `xxxx`).

**Port.** The EXT serial port, set up at `8000:0BAA` exactly like a WonderGate game: port `B3` =
`A0` (enabled, **9600 baud**, 8-N-1). Received bytes go through the receive interrupt
(`8000:0B4E`) into a 64-byte ring at RAM `0x155` (`[0x153]` read, `[0x154]` write); bytes are sent
one at a time, polling for transmit-empty (`8000:0AF0`). Same wire, same speed as the adapter.

**Sub-states** (`[0x102]`, table at `8000:7BA9`): 0 send/receive menu (`7BB7`), 1 slot menu
(`7C81`), 2 sender handshake (`7D5B`), 3 send the record (`7E9E`), 4 receiver handshake (`7D5B`),
5 receive the record (`7F14`), 6 result message, A/B to leave (`7FBC`).

**Handshake.** NUL-terminated ASCII words, table of pointers at `8000:7E06` → strings at
ROM `0x810A`: index 0 `SEND`, 1 `RECV`, 2 `OK`, 3 `NG`, 4 `SAME`. Each frame the game moves one
received byte into an 8-byte match ring at RAM `0x33C` (`8000:80E1`) and tries the five words
against it (`8000:8049`); a byte that starts none of them is dropped. Flags at `[0x339]`:
bit 0 = heard the other side's mode word, bit 1 = heard `OK`.

| Event | Sender (state 2, handlers at `7DD5`) | Receiver (state 4, handlers at `7DDF`) |
|---|---|---|
| enters the state | says `SEND` (`7E5E`) | says `RECV` (`7E64`) |
| hears the other's mode word | bit 0, says `OK` (`7E90`) | same |
| hears its own mode word | says `SAME`, error picture `0x8797` (`7E10`/`7E19`) | same, picture `0x8919` |
| hears `OK` | bit 1; if bit 0 is still clear, says `NG` (`7E7B`) | same |
| hears `NG` | says `SEND` again | says `RECV` again |
| hears `SAME` | error, as above | same |
| bits 0 and 1 set | → state 3 | → state 5 |

B cancels while waiting. So whichever console starts first, the pair ends up exchanging both mode
words and both `OK`s; the `NG` path repairs the case where an `OK` arrives before the mode word.

**The record.** Sender (`7E9E`): shows picture `0x830F` (too brief to capture), waits a frame, stops
storing received bytes (`[0x14C]` = 0), reads the chosen slot from EEPROM into `0x1600`
(`8000:6229`, the same loader the editor uses) and sends all **`0x200` bytes** of it as they are:
grid, music word, CRC-32, `4C 97`. No length, no framing, no checksum of its own and **no
acknowledgement**: it then shows 「送信を完了しました」 (picture `0x8553`) and A/B returns to the
main menu. Receiver (`7F14`/`7F3B`): reads exactly `0x200` bytes into `0x1600` (B aborts with the
error picture), copies the music byte (`+0x1F8`) to `[0x58D]`, shows picture `0x8675`, and A opens
the received stage in the map editor (it doesn't check the CRC; saving it is up to the player).
The sender only offers a slot whose `+0x1FE` word is `974C` (`8000:61C3`); an empty slot shows
picture `0x8A9B` instead.

**Timing (emulator).** The game handles one handshake byte per frame, so a word takes 3–5 frames
to be recognised. After its `OK` the sender spends about 130 ms (reading 256 EEPROM words) before
the first record byte, then streams the 512 bytes back to back (about 0.55 s at 9600 baud).

**The sender's screen can't report our server's verdict**: success is shown as soon as the
bytes are out, and nothing comes back afterwards.

### Our link peer (wgcore)

[`core/wg.c`](../../wondergate/core/wg.c) (`lr_*`), in every build that uses wgcore (PC host,
emulator core, MesenCE, module firmware). **Detection needs no switch:** WonderGate frames start
with a type byte `01 02 03 0F 11` followed by `00`, and the first byte of every DATA I/O word
(`S R O N`) is none of those. Between frames, wgcore watches for `53 45 4E 44 00` ("SEND" + NUL);
inside a frame body the same bytes are just data. Then:

1. It answers as a console in receive mode: `RECV` (its opening word) and `OK` (its answer to
   `SEND`). The sender hears both, says `OK`, and goes on to send. (`NG` → `RECV` again; a repeated
   `SEND` → `OK` again; anything else abandons the transfer.)
2. It takes the next `0x200` bytes as the record. A line pause (the platform's frame gap: 500 ms on
   the PC host, ~100 ms in the emulator core) drops a half transfer and frame parsing resumes; one
   pause is allowed before the first record byte, for the sender's EEPROM read.
3. It checks the record like the game's slot loader: `4C 97`, CRC-32 (zlib) of `+0..+0x1F9`,
   every grid byte ≤ `0x1E`. A bad record is logged and not uploaded.
4. It uploads through the adapter's normal network path (`wg_ops`), as HTTP/1.0:

```
POST /loderunner/stage HTTP/1.0
Host: link.swanrevival.com
Content-Type: application/octet-stream
Content-Length: 512

<the 0x200-byte record>
```

`link.swanrevival.com` is one of wgcore's default redirects, so in development it reaches the
configured `server` and port map like the game hosts. The server's status line and answer are
logged (`# Lode Runner link: upload accepted (HTTP 200): stage queued …`). A console that says
`RECV` (receive mode) gets no link answer: we only take stages.

## Sharing your stage (our addition)

What the player does, with the adapter plugged into the EXT port and online:

1. Make a stage in MAP EDIT and セーブ it to MAP1 or MAP2.
2. Main menu → DATA I/O → データを送る → MAP1 or MAP2.
3. The game shows 「接続準備をしています」 for a moment, then 「送信を完了しました」. Press A.

The stage then waits in our review queue. The game can't tell the player whether it was
accepted (see above); the result is in the adapter's log and, later, on the site.

**Server** ([`server/loderunner.py`](../../wondergate/server/loderunner.py)): checks the record
again (512 bytes, `4C 97`, CRC-32, tiles ≤ `0x1E`), then refuses exact copies of the game's own
126 maps and of the editor's empty map by SHA-1 of the grid
([`server/loderunner_builtin.txt`](../../wondergate/server/loderunner_builtin.txt): hashes only,
made from a dump by [`tools/loderunner_hashes.py`](../../wondergate/tools/loderunner_hashes.py)).
Everything else goes to the **pending queue** `data/loderunner.json`: id (first 12 hex digits of
the grid's SHA-1), full SHA-1, grid as hex, music word, time received (UTC), source
(`link-cable`), the uploader's address, `status: "pending"` and a count of times received.
Identical grids are stored once.

| Answer | Body | When |
|---|---|---|
| 200 | `stage queued <id>` | new, or the same grid already waiting |
| 409 | `stage refused: a copy of the game's own map` | built-in map or empty map |
| 409 | `stage refused: already received (<status>)` | grid already reviewed |
| 422 | `stage refused: <why>` | not a valid slot record |

**Nothing is published by this.** The download list (`filelist.txt` under
`server/content/loadrunner/`) is still served only from stages we publish, and there are none, so
DOWN LOAD still answers error 603. Publishing will be a manual step after review, with the
player credited on the site, and labelled as a player's stage, not Bandai's.

## Our server

[`server/static.py`](../../wondergate/server/static.py) routes
`wgg01.channel.or.jp` + `//download/loadrunner/mapdata/` to `server/content/loadrunner/`. That
directory doesn't exist, so the list request gets 404 and the game says 「データリストがありません」
(error 603): an honest "nothing here". Serving stages later needs only files there:
`filelist.txt` as above, and one 504-byte grid per entry.

## Verified (2026-10-14, emulator, real game code)

- Closed service: replay `loderunner`, 404 → error 603.
- Local test only: [`tools/make_loadrunner_test.py`](../../wondergate/tools/make_loadrunner_test.py)
  copies built-in maps 0 and 1 from your own dump into `local/loadrunner-test/` (gitignored, never
  deployed); a server started with `WG_STATIC_CONTENT=$PWD/local/loadrunner-test` serves it. The
  list showed ステージ No. 01 and 02 with their dates; No. 01 downloaded (504 bytes), opened in the
  editor, played from プレイ, and セーブ → MAP1 left the same 504 bytes at EEPROM `0x200` with a
  matching CRC-32. Errors 601, 602 and 604 were forced with a missing file, a 500-byte file and an
  empty list.

- Link cable (2026-10-14): replay `loderunner-link` preloads MAP1 with a synthetic test pattern
  (border, floor, one gold: test data, not a stage) and sends it from DATA I/O; the game shows
  「送信を完了しました」, wgcore logs the handshake and the upload, the server answers
  `stage queued <id>` and the queue holds it as pending. Locally (never committed) a copy of
  built-in map 0 was refused with 409 and the same map with three tiles changed was queued.
  The receiving side's code is read from the ROM, not run against a second console.

## Open

- **Decision:** whether to offer new stages, and how. They must be labelled as fan-made, but the
  game shows no title or author for a stage (only its number and date), so the labelling has to
  live on our site, next to the list; the date field could at least mark when we published each.
- Ask owners for EEPROM dumps (above). The originals can only come back from cartridges.
- Link-cable uploads: how players are credited (the game sends no name: an adapter-side
  player/account setting is needed), and how a refusal reaches the player (the game has already
  shown 送信を完了しました; the adapter LED or the site could say). Not yet tried on hardware.
