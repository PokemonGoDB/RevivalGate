# Digimon Tamers: Brave Tamer: online ranked battles ✅*

Status (2026-10-14): **shortcut-verified** headless. Signup, ranking battle (as #1: "げんざいあなたが
トップです！"; as a challenger: VS screen, the battle, the ranking), the ranking view with the server's
news, and the hall-of-fame battle (でんどうバトル: list, VS screen, battle, WIN) all run against our
server. The one shortcut is the party: the WonderGate needs a save with a Digimon in it, and we poke
one into RAM instead of playing to the first partner (see [Reaching it](#reaching-it)). Server:
[`server/digimon.py`](../../wondergate/server/digimon.py) (shared with D1 Tamers), data in
`data/digimon-b.json`.

Found by scanning ROMs for WonderGate code.

## The original service

- Bandai, 2001-12-29 (SWJ-BANC1D). The product page mentions only D-Ark link play.
- A 2002 forum post says the game does have WonderGate but is missing from the official list
  ([swanlog post 515](http://wsc.s201.xrea.com/x/swanlog/dat/1026807611.dat)).
- Its server `digi_b.wgg.channel.or.jp` was archived in Nov–Dec 2002, titled "Mobile Wonder Gate",
  with admin pages: user info, banned handle names (デジモンワンダーゲート禁止ハンドルネーム), a
  weekly-ranking hall of fame, ranking entry faking, NG words, ranking-battle debug pages
  ([capture](https://web.archive.org/web/20021108141507/http://digi_b.wgg.channel.or.jp/)). Some pages
  say "DIGIMON4", example ID "d4000001".

## In the ROM

The ROM (revision 1; SHA-1 in `wondergate/games.tsv`), 4 MB, 2 KB cartridge **EEPROM** (header save
type `0x20`; D1 Tamers has SRAM). At `0x3ABD26`: `http://digi_b.wgg.channel.or.jp/cgi-bin/` with
`dmBsignup.cgi`, `dmBlogin.cgi`, `dmBrankbtl.cgi`, `dmBrankdl.cgi`, `dmBidupld.cgi`, `dmBidsrch.cgi`,
`dmBidbtl.cgi`; `User-Agent: SWAN/1.0 DIGIMON-0B`; `application/x-www-from-urlencoded` (sic, as in
D1 Tamers); dial string `##` (`0x3ABD16`). Also a literal `http://192.0.2.156` (`0x3ABDF6`), unused
as far as we saw. Same engine and request set as D1 Tamers ([digimon-d1-tamers.md](digimon-d1-tamers.md)).

Addresses: CPU addresses are `SEG:OFF` with linear bank 3 (ROM offset = `0x300000` + linear). The game
runs with DS = SS = `0C00`, so a variable `DS:x` is console RAM `0xC000 + x` (what `drive.py ram:`
takes). Buffers addressed through segment 0 (`0000:3000` …) are RAM at that address.

- **Game modes**: 12-byte entries (init, update, exit far pointers) at `9000:0000` (ROM `0x390000`).
  Current mode `DS:0A82`, next `DS:0914`. `ChangeMode` variants at `B4D3:01CB/01DB/01EB/01FB`.
- Mode **8** (`DD4E:0257`/`DD4E:0428`): the title menu はじめから / つづきから / つうしんたいせん /
  ディーアーク / **ワンダーゲート**. The fifth item calls `BDD2:0439` (load the EEPROM save into RAM; fails
  without a save) and needs a party (`DS:0A7A` ≠ 0), then switches to mode `0x2F`; otherwise a buzz.
- Mode **0x2F** (`F770:0001`/`F770:00E2`): the WonderGate menu. Unregistered (`DS:3A0C` = 0):
  とうろく / TELナンバー. Registered: ランキングバトル / ランキング / でんどうバトル / データ / TELナンバー /
  データしょうきょ. B returns to the title. The choice goes to the command byte `DS:3B76` and mode
  **0x30** (`F770:0FFB`/`F770:12C4`, the session; state byte `DS:3918`).

| Command | Menu item | Session | Requests |
|---|---|---|---|
| 0 | とうろく (handle, then region) | state 0 | signup |
| 1 | ランキングバトル | state 9 | login, rankbtl, rankdl, then the battle |
| 2 | ランキング | state 0xC | login, rankdl |
| 3 | でんどうバトル | state 0x1B: key = `FD`×8 | login, idsrch; pick a tamer: idbtl, battle |
| 4 | none (leftover name search; its entry screen is garbled) | state 0x1C | login, idsrch |
| 5 | none (leftover ID upload) | state 0x18 | login, idupld |
| 6 | データ | local: the last downloaded ranking | none |
| 7 | TELナンバー | local: dial number | none |
| 8 | データしょうきょ | local: clears the WonderGate data | none |

Commands 4 and 5 (D1 Tamers' IDサーチ / IDアップロード) are still in the session code but no menu
item leads to them. The WonderGate data (`DS:39FC`, `0x23` bytes: dial number, registered flag
`3A0C`, handle `3A0D`, region `3A16`, ID `3A17`) is saved with the game (save + `0x65E`).

### Requests

`POST /cgi-bin/dmB<name>.cgi`, binary bodies. The sender `F770:063D` (ROM `0x3F7D3D`) copies the body
to `0000:3202` (length at `0000:3200`), posts via `B000:0621` into `0000:3000`, and leaves a far
pointer to the reply body in `DS:3810` and its first byte (result code) in `DS:3814`.

Data units:

- **profile** (26 bytes, as D1 Tamers): ID[8], handle[8], region (0 北海道 … 7 九州), party size, three
  Digimon numbers (LE words, party slot +1; `FFFF` = empty), a word (the server puts the rank there).
- **record** (55 bytes, built by `C9F7:3F97` from a 0x6D-byte party slot at `DS:0932`): +0 present
  (1, `FF` = empty slot), +1 Digimon number, +4 nickname[6], +0x0A..0x11 caps HP, DP, AP, PP (words),
  +0x12..0x19 caps SP, LP, PAPP, TAPP, SCPP, PCPP, EXPP, YPPP (bytes; the レーダーチャート values),
  +0x1A form count, +0x1B five form numbers (words), +0x25.. more slot bytes. Current HP etc. are not
  sent; the battle recomputes them (`C9F7:4319`).
- **block** (191 bytes, built at `DS:3818`): the profile, then three records.

| CGI | Builder | Body | Reply |
|---|---|---|---|
| `dmBsignup` | `F770:074A` | handle[8] region | `00` ID[8] → `DS:3A17`, registered, saved; `01`/`FF` = "このハンドルネームは しようできません" |
| `dmBlogin` | `F770:07D6` | ID[8] command | any byte, then a message (game text, `FF`-terminated, ≤ 0x80) → `DS:3A20`, shown before the ranking and under データ. Default "ジョウホウがありません。" |
| `dmBrankbtl` | `F770:084F` | block | `00` seed profile party(165) my-rank opp-rank; `01` = "ほかのテイマーがバトルしています"; `02` = "げんざいあなたがトップです！…デジモンはコウシンされました" |
| `dmBrankdl` | (same) | ID[8] | count (`00`/`FF` = "データがみつかりません", max 8), 8 profiles (0xD0 bytes) → `DS:3AA0`, count `DS:3B70` |
| `dmBidsrch` | `F770:09F5` | ID[8] key[8] (`DS:39EC`) | count (0 = not found), 8 profiles → `DS:391C`, count `DS:37BE` |
| `dmBidbtl` | `F770:0A7C` | ID[8] target-ID[8] target's rank word | as rankbtl with `00`; ranks ignored; non-zero = not found |
| `dmBidupld` | `F770:0B40` | block | `00`; `01` = handle taken |

The battle reply is parsed by `F770:0C47`: the seed goes to `0000:3400` and from there to the battle's
random generator `DS:2CF0` (`C2BE:07CC`; `x = 5x + 0x3573`, `C2BE:000E`); the opponent's profile to
`DS:37E4`; their party to `0000:34A6`, after the player's own party at `0000:3401`; the ranks to
`DS:380C`/`DS:380E` (command 1 only; 0-based, the challenger's 0 reads "ランクがい"). Unlike D1
Tamers there is no stage byte. As in D1 Tamers, the ranking battle sends login, rankbtl and rankdl
**before** the fight; the cartridge then fights it out (mode `0x19`, battle type `DS:2AF4` = 4) and
shows the downloaded ranking. Nothing is reported back.

## Our server

[`server/digimon.py`](../../wondergate/server/digimon.py) serves both games from one handler; a
`Game` entry gives Brave Tamer its record size (55), battle header (the seed only), strength formula
and data file.

- IDs are eight digits, stored as bytes 0–9. Handles are unique per game.
- Ladder as in D1 Tamers: a challenger fights the player one place above, and since the result is
  decided in the cartridge after the reply, the server ranks by party strength from the record caps
  (HP + DP + 4 × (AP + PP + SP)). The animation can disagree: in our test two identical parties tied,
  the server kept the order and the cartridge showed WIN.
- **でんどうバトル (hall of fame)**: the game searches with a blank key (`FD`×8). Bandai's hall of fame
  (a weekly-ranking hall of fame, per the archived admin pages) is lost. Ours enshrines each week's
  ladder leader (ISO weeks) and also lists the current leader, newest first, at most 8. The battle
  uses the tamer's current party.
- Login news is our own message ("ワンダーゲート サーバー ふっかつ！ ランキングバトル かいさいちゅう。").
- Unknown IDs: rankbtl/idupld answer `01`; idbtl answers "not found".

## Reaching it

The WonderGate needs a save whose party is not empty. A new game starts with an empty party (status
screen shows three blank slots) in an isometric maze; we did not play to the first partner.
Instead, in the field we poke one party slot into RAM and save with the game's own menu:

1. New game: from a blank EEPROM the intro starts at once; about ten A presses reach the field (mode `0x1C`).
2. Poke party slot 0 (`0xC932`..`0xC99E`, 77 non-zero bytes) and the party count `0xCA7A` = 1. The bytes
   are what the game's leftover debug routine `BAB1:03DD` (ROM `0x3BAEED`: new game, money 500, items and a
   three-Digimon test party; entered at `BAB1:03E3` to skip the new-game reset) writes for its first
   Digimon, a セントガルゴモン nicknamed モノドラ.
3. A → セーブ → OK; reset; START → ワンダーゲート. Everything from here is normal play.

For `braverank`/`bravehall` the replay also pokes the registered flag `0xFA0C` = 1 and an ID
(`0xFA17`.. = 0 0 0 0 0 0 0 1) before saving, so the menu opens registered.

## Verified (2026-10-14)

Headless, against our server (captures committed): signup of two tamers (and "handle taken" for a
duplicate), ranking battle as #1, ranking battle as a challenger played to the end, ranking view,
hall-of-fame search and battle played to WIN, local data deletion and re-signup. Commands 4 (name
search) and 5 (ID upload) were exercised by poking `0xFB76` during the menu transition; the server
answers them, but the game never offers them.

Regression (`emu/replays.txt`): `bravetamer` (signup), `braverank` (login + rankdl), `bravehall`
(login + hall-of-fame idsrch); all pass on an empty and a populated database.

## Open

- Normal-play route: play (or obtain a real save) to the first partner, then replace the party poke.
- The hall of fame is our rule (weekly leaders); Bandai's list and exact rule are lost.
