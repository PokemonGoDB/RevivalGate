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
  +0x1A form count, +0x1B five form numbers (words; Digimon numbers, the first its own: in battle
  each one gives that form's technique), +0x25 item count, +0x26 four item numbers, +0x2A twelve
  percent bytes (a stat is its cap × percent / 100; all 100 in the test party), +0x36 a class byte
  (0–3). Current HP etc. are not sent; the battle recomputes them (`C9F7:4319`, see
  [The battle](#the-battle-mapped-2026-11-27)).
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

Checked in the game (2026-11-26):

- The fight runs by itself, with or without button presses, and its outcome depends only on the two
  parties and the seed: seed `05` gave LOSE and seed `41` WIN at two different timings each (against
  an opponent with ×3 caps). `DS:0920` (RAM `0xC920`) is `00` after WIN and `01` after LOSE.
- After the ranking battle the cartridge shows the ranking it downloaded before the fight; B returns
  to the WonderGate menu. No request follows. The next ranking battle's login, rankbtl and rankdl
  bodies were byte for byte the same after a win and after a loss as before the first battle.
- でんどうバトル is login + idsrch, hang up, dial again, idbtl, hang up, the battle, then the menu.
  No request follows, and both rank boxes on its VS screen are blank.
- The cartridge keeps no rank of its own. The VS screen shows the battle reply's rank words + 1
  ("12" against "11" for 11 and 10; the challenger's 0 reads "ランクがい"), the lists show each
  profile's rank word as sent.

The server holds everything the outcome depends on (both parties, and it picks the seed), so Bandai's
server could have run the same battle itself; the archived admin pages list ranking-battle debug
pages. Whether it did is not known.

## Our server

[`server/digimon.py`](../../wondergate/server/digimon.py) serves both games from one handler; a
`Game` entry gives Brave Tamer its record size (55), battle header (the seed only), strength formula
and data file.

- IDs are eight digits, stored as bytes 0–9. Handles are unique per game.
- Ladder as in D1 Tamers: a challenger fights the player one place above, and since the result is
  decided in the cartridge and never sent, the server guesses it from party strength, from the record
  caps (HP + DP + 4 × (AP + PP + SP)). Since 2026-11-27 a tie goes to the challenger in this game
  (before, a tie left the order; D1 Tamers still does). This is our rule, and the ranking shown
  right after the battle is already the server's guess. The servers have a hook for the real
  outcome (`outcome` in the game's entry); for Brave Tamer it is not set, see
  [The battle](#the-battle-mapped-2026-11-27).
- **The guess is often wrong for this game** (measured in the game, 2026-11-26, with the one party we
  can build, against a copy of it with the HP, DP, AP and PP caps scaled, four seeds each): the
  challenger won on screen 4 of 4 times against an opponent at ×0.5, ×0.9, ×1 and ×1.5, 3 of 4 at ×2
  and ×2.5, 2 of 4 at ×3 and ×4, and lost at ×5 and ×30. Two identical parties gave WIN for the
  challenger with all nine seeds tried, and the server left them one place below the tamer they had
  just beaten (seen on the list that follows the fight). The server says "win" only for a weaker opponent, so
  it agreed at ×0.5 and ×0.9 and in 6 of the other 24 battles. One Digimon against its copy is a
  narrow test; agreeing in general needs the cartridge's battle code run on the server. The
  2026-11-27 mapping explains the numbers (the challenger wins unless its whole party is knocked
  out within 10 rounds) and why the port was not written (the battle needs tables from the ROM).
- **でんどうバトル (hall of fame)**: the game searches with a blank key (`FD`×8). Bandai's hall of fame
  (a weekly-ranking hall of fame, per the archived admin pages) is lost. Ours enshrines each week's
  ladder leader (ISO weeks) and also lists the current leader, newest first, at most 8. The battle
  uses the tamer's current party. The week is checked on every Brave Tamer request, before the
  ladder can change: the first request of a new week puts whoever leads the ladder into the hall for
  the week that ended. Until 2026-11-26 this happened only when someone opened the hall, with
  whoever had led at the previous opening, so a leader nobody looked at was never recorded. Checked
  in the game with data dated one week back (ライバル leading): the player won a ranking battle,
  took first place and opened the hall; before the change the list was "1 あい", after it
  "1 あい / 2 ライバル". The current leader is listed even when it is the player asking; the
  list then starts with the player's own entry.
- Lists hold 8 entries. The ranking reply is the top 8, so a tamer ranked 9th or lower does not see
  their own row. What Bandai sent then is not known.
- A handle stays taken after データしょうきょ: signing up again with the same handle is refused. The
  game's own warning before deleting says so ("トウロクされている ハンドルネームは シヨウできなくなります。").
- Login news is our own message ("ワンダーゲート サーバー ふっかつ！ ランキングバトル かいさいちゅう。").
- Unknown IDs: rankbtl/idupld answer `01`; idbtl answers "not found".

## The battle (mapped 2026-11-27)

The owner chose to run the game's own battle on the server, so that the ladder follows the screen.
Mapping the battle showed that it cannot be rebuilt from its code and the two uploaded parties alone:
it looks up each Digimon's technique, and more, in tables in the ROM, and this repo holds no ROM
data. The port was therefore not written, `outcome` is not set for Brave Tamer, and the ladder still
moves by the strength guess (with ties now going to the challenger). What was found is kept here.

### Who wins

Read in the code (`C2BE:67A8`, state `0x9F`, and `C2BE:665E`, state `0x9A`) and seen in the game:

- LOSE (`DS:0920` = 1) only when every Digimon of the challenger is knocked out.
- WIN (`DS:0920` = 0) when every Digimon of the opponent is knocked out, and also **when the tenth
  round ends with the challenger still standing**. The round limit `DS:2DA6` is 10 for battle type 4
  and 99 for the others; at the limit the other types set LOSE, type 4 sets WIN.

So the challenger wins unless the opponent knocks the whole party out within 10 rounds. Seen: a
challenger cut to HP 300 against the standard test party ended round 10 with 21 HP against 495 and
the screen said WIN; with another seed it was knocked out in round 10 and the screen said LOSE. This
is why equal parties gave WIN with every seed tried, and why an opponent with two to four times
the stats still lost half the time or more.

### How it runs

| What | Where |
|---|---|
| Mode `0x19`: init, update, exit | `C2BE:1ED4`, `C2BE:25F0`, `C2BE:6C93`. Update is one switch over about 160 states (`DS:2DB0`); most are animation and text |
| Result screen, mode `0x1A` | update `C2BE:688C` |
| Units | `DS:285E`, `0x6E` bytes each, the challenger's first: +0 side, +1 state (1 fighting), +3 Digimon number, +0x10 stat block (HP, DP, AP, PP as current/maximum words from +0x10; SP at +0x20), +0x2E form count, +0x2F form numbers, +0x39 items, +0x63 status bits |
| Set-up for type 4 | `C2BE:06DF` (from `07CC`): the seed byte at `0000:3400` goes to `DS:2CF0` as a word; `C2BE:0644` builds each side from its three records (`0000:3401` + 55 × n, own party first; flag `FF` ends a side) with `C9F7:4319`; `DDC1:0B67` sets each stat to cap × percent / 100 plus item bonuses, HP at most 9999, the other three at most 999 |
| Random numbers | `C2BE:000E`: x = 5x + `0x3573` (16 bits), result = (x × n) >> 16 for a range n. 28 call sites: 22 in `C9F7`, 6 in `C2BE`. The other generator (`C2BE:004A`, `DS:2CF2`) is used by the field code only |
| A round | State 4 goes to `0x1E` for type 4: `C9F7:4BB5` picks an action for every Digimon of **both** sides (control bytes `DS:2832`/`2833` are both 1; no input is read): attack, a technique it has the DP for, or guard, with rolls of the random generator. Actions are in `DS:2BB4` (10 bytes per unit: kind, target class, target, technique word at +8). `C2BE:0B93` orders the actors by SP, highest first; at equal SP the challenger's Digimon comes first. States `0x30`/`0x34` resolve each action in turn: `C9F7:011A` (attack: hit roll, damage), `C9F7:54E1` (technique), then `C9F7:08D0` applies a technique's effect and `C9F7:03DE` counts the timed statuses down at the end of the round |
| Damage | `C9F7:000E`: attacker's AP (+ the technique's power) − target's PP, plus a quarter for each point the attacker's items have against the target's class (`C000:0C55`), × 8 / 10 if the target guards, at least 1. An attack hits with (100 − target's SP) %, a technique with its own hit rate minus one of the target's stats |

Seen in the game: battle type 4, both control bytes 1 and limit 10 in memory during a WonderGate
battle; plain attacks doing AP − PP (13 with the test party) and techniques AP + power − PP; the
same parties and seed giving the same battle twice, turn by turn.

### What it reads

- From the server's reply: the seed byte and the opponent's three records. From the cartridge:
  its own three records, built the same way as the upload. Every field of a record is used except
  the nickname.
- Nothing else of the save was found to matter: with the saved party wiped from memory
  (`0xC932`.. and the count `0xCA7A`) after the reply, three battles ran turn by turn as before.
- From the ROM, for the fight itself (sizes and contents described, nothing copied):

| Table | Where | Size | What it holds | Used by |
|---|---|---|---|---|
| Techniques, one per Digimon number | `923B:000A` (ROM `0x3923BA`) | 310 × 25 bytes | target kind (+0), effect class (+1; 24 classes, about half the entries are plain damage), DP cost (+2, word), power (+7, word), hit rate (+9), and amounts and chances for the effects (+4, +6, +0xA to +0x18) | the action choice (cost, class, target kind), the hit and damage rolls, the effect code. `C9F7` reads it in 115 places, `C2BE` in 25; nearly every byte is used |
| Digimon | `9030:0008` (ROM `0x390308`) | 310 × 27 bytes | per Digimon: an attribute (+7), base stats (+0xC on), other bytes | `DDC1:0531`, which rebuilds a stat block from a Digimon number and is called from the effect code (`C9F7:1E87`); also the form change of a played battle, rewards and display |
| Item bonuses | `9984:0000` (ROM `0x399840`) | 52 bytes | stat bonus by item class and grade, for items `0x00`–`0x2F` | `C000:0864`, when the stats are built |
| Target map | `A04E:0004` | one byte per target kind (13 used) | target kind → the action's target class | the action choice |
| One byte | linear `0xA23A2` | 1 byte | read as the effect class of "technique `FFFF`", which is how a plain attack is stored | `C9F7:4FBE` |

  Watching the ROM during three battles (one Digimon each, and three against three with other
  Digimon numbers poked in) showed the technique table read at +0 to +4 and +7 to +0x13, the target
  map and the one byte; the Digimon table was read only by display code in those, and the item
  table not at all (the test party's items are numbered above `0x2F`). The other uses are from the
  code.
- None of these values are in what a cartridge uploads: a record carries the form numbers, not
  the techniques behind them.

Seen in the game that the tables decide the result: with the same stats and seed, changing only
the opponent's form numbers changed WIN to LOSE or back in five of six seeds tried.

### Size of a port

The fight is spread over `C2BE` (29.6 KB; the logic is a minority of its 160 states) and
`C9F7:0000`–`5870` (about 22 KB: hit and damage rolls, 12 KB of effect code for the 24 effect
classes, the action choice, end-of-round effects), with stat helpers in `DDC1` and `C000`. It is
unoptimised compiled C; an estimate is 1,500 lines per language, plus the two tables above (about
16 KB) from somewhere.

### Checking a port against the game

A battle can be run headless from a save state, without a server: play `braverankbtl` up to the VS
screen of the second tamer's ranking battle (mode `0x30`, both replies in) and save a state. For each
battle load it, write the seed to RAM `0x3400`, the challenger's three records to `0x3401` and the
opponent's to `0x34A6` (an unused slot is `FF` and 54 zero bytes), press A, run until the mode
(`0xCA82`) leaves `0x19` and read `0xC920`. A fight of one Digimon each that goes ten rounds is about
10,000 frames (two seconds); three against three took 23,000 to 26,000. Units are at RAM `0xE85E`
(HP at +0x10), the state at `0xEDB0`, the round at `0xE858`; a breakpoint at `C2BE:000E` gives every
random call with its caller. The game accepted records with other Digimon and form numbers poked in
(tried: 0, 2, 3, 5, 6, 7, 8, `0x60`, `0xB3`, `0xFD`, `0x107`, `0x12C`, `0x131`, `0x135`), stats up to
the limits, and parties of one, two and three on either side.

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

Headless, against our server: signup of two tamers (and "handle taken" for a duplicate), ranking
battle as #1, ranking battle as a challenger played to the end, ranking view, hall-of-fame search and
battle played to WIN, local data deletion and re-signup. Commands 4 (name search) and 5 (ID upload)
were exercised by poking `0xFB76` during the menu transition; the server answers them, but the game
never offers them.

The requests of that session that are in `wondergate/captures/` (16 files, all named
`20261014-1157…` or `20261014-1158…` `-http-digi_b.wgg.channel.or.jp_cgi-bin_dmB<name>.cgi.bin`;
each holds the request only):

| Flow | Files (time part of the name) |
|---|---|
| Signup, tamer 1 and tamer 2 | `115724-551` signup, `115748-834` signup |
| Ranking battle as #1 (tamer 1) | `115731-811` login, `115731-824` rankbtl, `115731-831` rankdl |
| Ranking view | `115732-222` login, `115732-231` rankdl |
| Ranking battle as a challenger (tamer 2), twice | `115756-947` login, `115756-956` rankbtl, `115756-967` rankdl; `115834-093`, `115834-101`, `115834-113` |
| Hall-of-fame search and battle | `115822-663` login, `115822-689` idsrch (blank key), `115823-355` idbtl |

Not among the captures: the refused duplicate signup and the re-signup after deletion, command 4
(an idsrch with a typed key) and command 5 (idupld). Until 2026-11-26 this page said all of it was
captured.

## Checked in the game (2026-11-26)

Headless, against the reference server; the party poke of [Reaching it](#reaching-it) is the only
shortcut, the other tamers were written into the server's data.

- Ranking with 8 entries: 8 rows, 8-character handles fit, the cursor starts on the last row, the
  player's own row is drawn in red, A shows the entry's handle, region and Digimon. With 12 on the
  ladder and the player 12th: the top 8, no own row; the VS screen shows "12" against "11" and an
  8-character handle in full.
- Hall of fame with the leader and 10 past leaders: 8 rows (the leader and the newest 7), cursor on
  the first; the number in front of each is that tamer's current rank.
- Nobody ranked (ranking and hall): "データがみつかりません。", then the news, then the menu. Alone on
  the ladder: "げんざいあなたがトップです！ バトルのヒツヨウはありません。 デジモンはコウシンされました。".
- Duplicate signup: "このハンドルネームは しようできません。 ちがうハンドルネームを トウロクしてください。", also
  after データしょうきょ and a new とうろく with the old handle.
- Command 5 (poke `0xFB76` = 5 right after pressing A on the menu): login, idupld,
  "トウロクされました。". Command 4 could not be driven this time: the garbled entry screen took the
  keys of the signup screen but no request followed.
- Two tamers from one cartridge, all by menu after the party poke: とうろく, ランキングバトル (first
  place), データしょうきょ, とうろく with another handle, ランキングバトル (VS screen, the fight, the
  list), でんどうバトル against the first tamer.
- A reply that is not ours: HTTP 404 gives "サーバとのコウシンでエラーがハッセイしました。" with "エラー 499"; no
  server gives "ワンダーゲートがセツゾクされていないか、デンチがありません。" with "エラー 1".

Regression (`emu/replays.txt`): `bravetamer` (signup), `braverank` (login + rankdl), `bravehall`
(login + hall-of-fame idsrch). How the game's memory tells an accepted reply from an error (each
seen both ways, against the server and against a 404 or no server):

| Replay | After success | After a refusal or error |
|---|---|---|
| `bravetamer` | RAM `0xFA0C` = `01`, ID at `0xFA17` | `0xFA0C` = `00` (also when the handle is taken, so it fails on a database that already has あい) |
| `braverank`, `bravehall` | news at RAM `0xFA20` = `85 87 92 AB 8B AB`…, mode `0xCA82` = `30` | `0xFA20` = `8E A8 5C 77 5C 38`… (the built-in text), mode back to `2F` (menu) |

On an empty server `braverank` and `bravehall` end on "データがみつかりません。" and the news: the replies
are taken, but there is no list to show. After a battle reply the opponent's profile is at RAM
`0xF7E4`; the last ranking is at `0xFAA0` (count `0xFB70`), the last search list at `0xF91C`.

## Checked in the game (2026-11-27)

Headless; the party poke is the shortcut as before.

- Tie rule: `braverankbtl` (two tamers with the same party; the second challenges the first) ends
  with WIN on screen (RAM `0xC920` = `00`) and the list that follows shows the challenger first
  (`0xFAA0` = its ID). With the server's old rule the same replay left the challenger second
  (`0xFAA0` = the first tamer's ID); with every reply corrupted the checks fail.
- A battle the challenger loses: with ライバル leading at the game's stat limits
  (`emu/seeds/braveranklose/`), the ranking battle ends with LOSE on screen (`0xC920` = `01`) and the
  list unchanged (ライバル first, the player second). Here screen and guess agree because the
  parties are far apart; the guess is still a guess.
- Python server and Worker gave the same replies to a made-up series of 25 requests (four signups,
  eight ranking battles with ties, wins and losses by the guess, the lists after each, the hall
  search and battle), the ranking battles' seeds included.
- After the tie rule, `bravehallbtl`'s tamer leads the ladder when it opens the hall, so the hall
  holds only its own entry and the replay's hall battle is against its own party.
- The battle findings above (who wins, the 10 rounds, the tables' effect, the save not mattering)
  were each seen in battles run from a save state with records written into memory; that is the
  game's own battle code, but not a party the game built itself.

## Open

- Normal-play route: play (or obtain a real save) to the first partner, then replace the party poke.
- The hall of fame is our rule (weekly leaders); Bandai's list and exact rule are lost.
- The ladder moves by a strength guess that the game's own WIN/LOSE often contradicts (see
  [Our server](#our-server)). Running the real battle on the server needs the ROM's technique and
  Digimon tables ([The battle](#the-battle-mapped-2026-11-27)); how to supply them, or whether to keep
  the guess, is the owner's decision. Until then the guess is wrong whenever the stronger opponent
  fails to knock the challenger out in 10 rounds, and whenever a weaker one manages to.
- Not checked: any party the game built itself other than the debug party's one Digimon (the
  WonderGate needs a save we do not have; parties of two and three and other Digimon were only
  written into memory); the week change on the Worker (the same rule, read from the code); the
  parts of the battle map marked as read from the code; anything on a real console.
