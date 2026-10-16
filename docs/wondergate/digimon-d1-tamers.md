# Digimon Adventure 02: D1 Tamers — net D-1 Grand Prix ✅

Status: **working** headless (2026-10-13). Signup ("トウロクされました。"), ranking battle (VS screen,
the battle, the ranking list), the ranking view with the server's news message, ID upload, ID
search and ID battle all run against our server. Server:
[`server/digimon.py`](../../wondergate/server/digimon.py), data in `data/digimon.json`.

## Reaching it

In the story, the WonderGate floor is the 2nd floor of the D-1 tower ("D-1のとうの2かいに
ワンダーゲートのフロアが"), late in the game, and only for players with the adapter. The feature is
a separate game mode, and leaving it resets to the title.

- Game modes: a table of 12-byte entries (init, update, exit far pointers) at linear `0x80000`
  (ROM `0x380000`). The current mode is in SRAM `0x0EDE`, the next in `0x0928`. The game keeps
  DS = `1000` (cartridge SRAM) throughout.
- Mode **56** (`0x38`) is the WonderGate menu (ランキングバトル / ランキング / IDバトル / IDサーチ /
  IDアップロード / データ / ばんごう / もどる). It sets the command SRAM `0x4A0C` = 1..7 and switches to
  mode **55** (`0x37`), the WonderGate session (state byte SRAM `0x47B0`; code E000:2C64/2F27).
  Command 0 is signup (handle name, then region).
- `ChangeMode` (A000:6896) stores the next mode, clears `0x0926`, and puts a transition routine
  (`A667:0480`) into the running task's update slot (task table SRAM `0x0F32` + 32 × n). The mode
  task is task 2, so from the title or the field the replay pokes
  `0x4A0C`=command, `0x0928`=0x37, `0x0926`=0, `0x0F72..75`=`80 04 67 A6`.

## Requests (`digi4.wgg.channel.or.jp`, dial `##`)

`POST /cgi-bin/dm4<name>.cgi`, `User-Agent: SWAN/1.0 DIGIMON-04`, binary bodies. The request
builder is E000:22D4. The reply body lands at SRAM `0x4428`; the first byte is a result code.

Data units:

- **profile** (26 bytes): ID[8], handle[8], region (0 北海道 … 7 九州), party size, three Digimon
  numbers (LE words), a word (the server puts the rank there).
- **block** (143 bytes): the profile, then three 39-byte Digimon records (name at +5, HP +11,
  attack +13, P +15, speed +17, D +19, …).

| CGI | Body | Reply |
|---|---|---|
| `dm4signup` | handle[8] region | `00` ID[8]; `01`/`FF` = handle taken |
| `dm4login` | ID[8] command | `00` message (game text, `FF`-terminated, ≤ 0x80; shown under データ and before the ranking) |
| `dm4rankbtl` | block | `00` stage seed profile party(117) my-rank opp-rank; `01` = another tamer is battling; `02` = you are #1 ("デジモンはコウシンされました") |
| `dm4rankdl` | ID[8] | count, 8 profiles (0xD0 bytes) → SRAM `0x48B8` |
| `dm4idupld` | block | `00`; `01` = handle taken |
| `dm4idsrch` | ID[8] handle[8] | count, 8 profiles → `0x47B4` (count 0 = not found) |
| `dm4idbtl` | ID[8] target-ID[8] word | as rankbtl with result `00`; non-zero = not found |

A ranking battle sends login, then rankbtl, then rankdl, all **before** the battle. The
cartridge then simulates the fight from both parties (E000:28BC sets it up; stage → `0x4CC0`,
seed → `0x4A22`) and shows the downloaded ranking. Ranks are 0-based: the challenger's rank 0
reads "ランクがい" (unranked) on the VS screen.

## Our server

- IDs are eight digits, stored as bytes 0–9 (the game's encoding for digits). Handles are unique.
- The ladder is a list. A challenger fights the player one place above. Since the battle outcome is
  decided in the cartridge, the server ranks by party strength (HP + D + 4 × (attack + P + speed)):
  the stronger party takes the higher place. The animation can occasionally disagree.
- ID upload stores the party for ID battles; ID search matches a handle or an ID.
- The news message is game-encoded text: hiragana from `0x0A`, katakana from `0x5A`
  (gojūon, voiced after), small kana `0x56–0x59`/`0xA2–0xA9`, ー `0xAB`, space `0xFD`,
  newline `0xFE`, ！ `0xAC`, ？ `0xAD`, 、 `0xB0`, 。 `0xB1`, D `0xB7`, - `0xEB`.

Regression: `d1tamers` (signup) and `d1ranking` (login + ranking download) in
`emu/replays.txt`.
