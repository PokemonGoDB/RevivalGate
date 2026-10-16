# Mobile Suit Gundam Vol. 2: Jaburo: side stories ✅

Status: **working** headless (2026-10-14), verified from a save marked as cleared (see below).
Sayla: "私やカイ君の、サイドストーリーを見ることができるらしいの" ("it seems you can see side
stories about Kai and me"). Pick 『セイラの回想』 or 『カイの回想』, the game dials, and the chosen
story plays straight away. Both stories are complete in the cartridge (art, script, text) and play
to the end, then the game returns to the title.

**No server at all**, as in [Vol. 3](gundam-vol3.md): the game dials (number pad prefilled with
`##`, any number works with our adapter), waits for the line, hangs up and plays the story. The
HTTP templates at `0x7B2A8A` (`POST`/`GET … User-Agent: SWAN/1.0`) belong to the shared Bandai
library and are never called. That's why no hostname was found.

## The original service

- Bandai, 2001-08-16 (SWJ-BANC17). The June 2001 product page listed "ワンダーゲート対応/カラー専用".
- **Announced as cut before release:** by August 2001 the page carries an apology: "［お詫び］この度予定して
  おりました「ワンダーゲート対応仕様」ですが、あいにく対応不可となりました"
  ([capture](https://web.archive.org/web/20010810022921/http://www.swan.channel.or.jp/swan/software/line_up/gundamvol2/index.html)).
- **The code was not removed.** The title menu, Sayla's dialogue, the dial and both stories are
  all wired up, and the menu item appears once the game has been cleared (below). The stories have
  no other way in: the main game and Bonus Mode skip them. As far as we know, nobody has seen them
  before.

## How to reach it

Title menu (segment `FA57`, file `0x7FA570`): items New Game / Load / **Wonder Gate** / Bonus,
built at `FA57:0428` (file `0x7FA998`). Wonder Gate is shown when SRAM `[0x1110]` is set; Bonus
when `[0x1576]` is set. `FA57:0566` (file `0x7FAAD6`) sets them at boot:

- it reads the console's **internal EEPROM** record with id `0x8000` (B400:19B6, the Vol. 1/2/3
  record, layout in [gundam-vol3.md](gundam-vol3.md)) into SRAM `0x278E`;
- if the read succeeds and SRAM `0x37 == 1`: Wonder Gate if record byte 4 ≠ 0, Bonus if byte 7 ≠ 0.

The game's own ending writes both. Clearing the last stage (`[0x1105] == [0x1106] == 0x1E` sets
`[0x1114]`, B63C:06BA) and then saving runs `FA57:05B9` (file `0x7FAB29`). It writes record
bytes 4/5/6 = three stats (`[0x0CF6]`, `[0x0CFA]`, `[0x0CFE]`) / 100, at least 1, so byte 4 is
never 0. Byte 7 = 1 only if a completion check over stages `0x0D…0x1E` passes. After a successful
EEPROM write (B400:19DA) it sets save byte 7, SRAM `0x37 = 1`. So on real hardware, clearing the
game and saving should be enough to show Wonder Gate.

The title's choice goes to `[0x110A]`. The main loop `B63C:0C50` (file `0x7B7010`) switches on
it: 0 New Game (`F4BA:0CE3`), 1 Load (`F791:2C4F`), **2 → `call far EA37:029D`** (file
`0x7B70A3`), 3 Bonus (`BD0B:0AFE`). After the WonderGate call returns, if `[0x27C2] ≠ 0`, it plays
that event (`B63C:043E`).

The regression replay `gundam2` fakes a cleared game with `poke:37=1` and the record as the ending
writes it: LRU bytes 0–7 = 0, slot 1 id `0x8000` (`eeprom:C=0 eeprom:D=80`), bytes 4/5/6 = 1
(`eeprom:12=1 eeprom:13=1 eeprom:14=1`), then a reset. Then: Wonder Gate (DOWN, A), six lines of
Sayla, A on the story list (『セイラの回想』), はい, 決定 on the pad, はい → dial → the story.

## Exchange (dial only)

Segment `EA37` (file `0x7EA370`, texts from `EA37:000A`). Entry `EA37:029D`. State byte
`[0x27BE]`, jump table at `EA37:0E9E`:

| State | Code | What |
|---|---|---|
| 3–4 | `EA37:0B77`, `0BBE` | "イベントを選択して下さい": `[0x27C2]` = **0x18** (Sayla) or **0x9F** (Kai) |
| 5–6 | `0BDF`, `0C21` | "ダウンロードしますか？" はい → dial pad (7–9); いいえ → 0x11 |
| A–B | `0C85`, `0CC7` | "接続するわね。よくって？" はい → C; いいえ → 0x11 |
| C | `0CE9` | B400:0018, "接続中です" |
| D | `0D36` | B400:004E (adapter check); error → 0x13 |
| E | `0D4D` | **B400:0071 dial** (number at SRAM `0x029D`, `##`); error → 0x13 |
| F–10 | `0D71`, `0D7F` | wait 150 frames, B400:0177 hang up, **SRAM `[0x46 + event] = 1`** |
| 0x11 | `0DE2` | if that flag is not 1, clear `[0x27C2]` (nothing plays) |
| 0x13 | `0DA3` | error message (`0x7EA37A…`), hang up, clear `[0x27C2]` |

Adapter trace: `01:08 (… 23 23)` dial `##`, line up, `01:0A` hang up. No TCP or HTTP.

SRAM `0x46…` is the save slot's copy of the event-seen table (`0x14BB…`, 0xB9 bytes, copied at
save time). Once a story has been downloaded (`0x5E` Sayla, `0xE5` Kai), answering いいえ replays
it without connecting (verified). Without the flag, いいえ goes back to the title.

## The side stories in the ROM

Events are played by `B63C:043E`: sets `[0x14BB + n]`, loads script `n + 0x320` (`C3E7:0774`).
- **Event 0x18, 『セイラの回想』** (script 0x338): Bright and Mirai on the bridge, then Sayla on
  Casval/Char, Garma, Ramba Ral and Ryu, launching with Amuro, and "私の今の居場所は、『ここ』なのだから".
  Text around `0x7CEF53…0x7CF5A0`.
- **Event 0x9F, 『カイの回想』** (script 0x3BF): Kai before launch, remembering Miharu Ratokie, from
  Belfast to her death, ending "俺はジオンを叩く！". Text from `0x7E4746`.

Nothing else plays them. The 74 event calls in `B63C` cover …0x17, 0x19… and …0x9E, 0xA0…, and
Bonus Mode's event list (141 entries at ROM `0x7412C0`) skips both too. Both stories were played to
the end headless.

## Verified (2026-10-14)

- `emu/regress.py gundam2`: PASS (dial `##`, hang up, final screenshot is Sayla's story,
  "【ミライ】いよいよ、宇宙ね・・・").
- Both stories played to the end by pressing A, then back to the title.
- Offline replay with the flag set (`poke:5E=1`, いいえ): story plays, no dial in the trace.
- Not verified: clearing the game by normal play to check that the ending writes the record (read
  from the code above).
