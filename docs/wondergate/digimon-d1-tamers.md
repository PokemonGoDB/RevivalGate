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
  attack +13, P +15, speed +17, D +19, …). The whole record is laid out under "The battle" below.

| CGI | Body | Reply |
|---|---|---|
| `dm4signup` | handle[8] region | `00` ID[8]; `01`/`FF` = handle taken |
| `dm4login` | ID[8] command | `00` message (game text, `FF`-terminated, ≤ 0x80; shown under データ and before the ranking) |
| `dm4rankbtl` | block | `00` stage seed profile party(117) my-rank opp-rank; `01` = another tamer is battling; `02` = you are #1 ("デジモンはコウシンされました") |
| `dm4rankdl` | ID[8] | count, 8 profiles (0xD0 bytes) → SRAM `0x48B8` |
| `dm4idupld` | block | `00`; `01` = handle taken |
| `dm4idsrch` | ID[8] key[8] | count, 8 profiles → `0x47B4` (count 0 = not found). IDサーチ sends the handle typed in; IDバトル (command 3) sends a blank key, `FD`×8 (E000:381C), and lists what comes back as opponents |
| `dm4idbtl` | ID[8] target-ID[8] word (the rank word of the list entry picked) | as rankbtl with result `00`; non-zero = not found |

A ranking battle sends login, then rankbtl, then rankdl, all **before** the battle, and hangs up.
The cartridge then simulates the fight from both parties (E000:28BC sets it up; stage → `0x4CC0`,
seed → `0x4A22`) and shows the downloaded ranking. Ranks in the battle reply are 0-based: the VS
screen shows the number + 1 ("2" against "1" for the words 1 and 0, "12" against "11" for 11 and
10), and the challenger's 0 reads "ランクがい" (unranked). In the lists the number in front of each
name is the rank word of that profile, as sent (an unranked tamer in the ID BATTLE list shows "0").

### The battle result never reaches the server (checked in the game, 2026-11-26)

- Nobody plays the battle: it is announced as one to watch ("あつきたたかいを みまもりましょう！") and
  runs with or without button presses. The outcome depends only on the two parties, the stage and
  the seed: the same seed gave the same battle (same turn count, same HP left) at three different
  timings, for a win (seed `41`) and for a loss (seed `1C`); other seeds gave other outcomes.
- After WIN!! or LOSE the cartridge shows the ranking it downloaded before the fight and returns
  to the title. It sends nothing. The next ranking battle's login, rankbtl and rankdl bodies were
  byte for byte the same after a win and after a loss as before the first battle.
- An ID battle is login + idsrch, hang up, dial again, idbtl, hang up, the battle, then the title.
  Nothing follows, both rank boxes on its VS screen are blank, and our server's data is unchanged.
- The cartridge keeps no rank of its own: every rank it shows came from the server (the VS screen
  from the battle reply, the list from rankdl).
- SRAM `0x0938` holds the last battle's result: `00` win, `01` lose, `FF` before any battle (and
  again after the return to the title).

So the server has to decide the ladder without being told who won. It holds everything the
outcome depends on that comes from the players (both parties, and it picks the stage and the
seed), so Bandai's server could have run the same battle itself; whether it did is not known. To
run it, a server also needs numbers that only the cartridge holds (next section).

## The battle (mapped 2026-11-27)

The owner asked for the game's own battle to run on the server so that the ladder always agrees
with the screen. The battle was mapped for that. It was **not ported**: it cannot be rebuilt from
the uploaded blocks and code-derived rules alone, because every action looks its numbers up in
the cartridge's technique table, and this repo keeps no ROM tables. The `outcome` hook of the
`dm4` game in `digimon.py` / `digimon.ts` is therefore still unset and the strength guess still
decides. What was found, for whoever continues:

### Where it is

- Mode `0x15` (init F000:3B2F, update F000:44A4, a state machine of 111 states in SRAM `0x4FCA`)
  is the battle; mode `0x0F` (B592:5FA3) is the attack picture shown for each action. The rules
  are in segment E43E (0000–52D8, about 21 KB of code); F000:44A4–8960 (17.6 KB) mixes the turn
  logic with the display. A mirror battle of the starting party went through 36 of the 111 states.
- The battle type is SRAM `0x4CAE`; a WonderGate battle is type 4 (story battles 0 and 1, link
  battle 2, type 3 another built-in kind). F000:139F loads a type-4 battle: stage `0x4D46` →
  `0x4CC0`, seed `0x4D47` → the word `0x4A22`, and F000:1230 turns each 39-byte record into a
  79-byte unit (E43E:5526) at `0x4AD2 + 79 × n`, units 0–2 the challenger, 3–5 the opponent.
- Both sides are loaded from 39-byte records: E000:28BC rebuilds the player's own three records
  from the save with the same routine that builds the upload (E43E:5329) into `0x4D48`, and copies
  the reply's party to `0x4DBD`. That happens when the reply arrives, before the VS screen.
- Both sides are played by the same built-in chooser (`0x4AA6` = `0x4AA7` = 1).

### The record (39 bytes), as the battle reads it

| Offset | Size | What the battle does with it |
|---|---|---|
| +0 | 1 | 1 = present, `FF` = empty slot (not loaded) |
| +1 | 2 | Digimon number |
| +3, +4 | 1, 1 | place in the line-up: +3 is the column 0–2, +4 the row (0 = front; some techniques hit one row, and the chooser aims plain attacks at the front row first) |
| +5 | 6 | name |
| +11 | 2 | HP (also the maximum) |
| +13 | 2 | attack: added to a technique's power |
| +15 | 2 | P: subtracted from the damage taken |
| +17 | 1 | subtracted from an attacker's chance to hit (the doc's "speed") |
| +18 | 1 | turn order: higher acts first |
| +19 | 2 | D: spent by techniques that have a cost |
| +21 | 1 | carried item (`FF` = none) |
| +22 | 1 | number of techniques, up to 5 |
| +23 | 5 × 2 | technique numbers, indexes into the cartridge's technique table (a Digimon has one of its own and keeps those of its earlier forms) |
| +33 | 2 | technique number of the carried item (`FFFF` = none) |
| +35 | 3 | up to three things the Digimon resists: an element (its damage is quartered) or a kind of effect (it fails) |
| +38 | 1 | ability 0–6 (0 = none), acting at the end of a turn with chance 24 in 100: 1 and 4 set a status, 2, 3 and 5 raise attack, P or the +17 value by half its base, 6 heals a quarter of the HP |

### Random numbers

One routine, E43E:56EF: `seed = seed × 5 + 0x3573` (16 bits), result `(seed × n) >> 16` for a
draw below `n`. The seed starts as the reply's seed byte (0–255). A mirror battle of the starting
party made 412 draws, all from this routine, and every stored value followed the formula. The
console's hardware random number (A000:036F, port `0x92`) is called during a battle only for the
screen shake and to pick a line of commentary; one technique effect (number `0x16`) would use it
for the rules, but no entry of the technique table has that effect.

### Rules read from the code

- Each turn: the chooser picks a technique and a target for every unit (among its techniques that
  are not sealed, that it can pay for, and that have a target; plain attacks are entered three
  times in the draw; the target of a plain attack is drawn among the enemy's front row if
  anyone stands there). A unit with nothing to use guards. Units then act in the order of +18,
  highest first.
- A single attack hits when a draw below 100 is less than `accuracy − target's +17 value + the
  attacker's hit rate − 100` (hit rate starts at 100; at least 1).
- Damage = `attack + power − target's P + attack × (draw below 10) / 100`; a quarter of that if
  the target resists the element; × 8 / 10 if the target is guarding; at least 1.
- There are about 30 technique effects besides plain damage (swap or copy stats, raise or lower
  them, heal, revive, three timed statuses, seal or remove a technique, armor evolution with the
  carried item, and more), each driven by fields of the technique's table entry.
- The challenger wins when no opponent is left standing and loses when none of their own is.
  **A WonderGate battle lasts at most 10 turns (`0x4FC2` = 10 for types 2–4); when the tenth turn
  ends with both sides standing, the result is LOSE.** So a challenger who is only a little
  stronger usually loses on time.

Checked in the game, on the first turn of a mirror battle of the starting party (seed `DA`), from
the logged draws: the turn order, four hit rolls (misses at 71 against a chance of 70 and at 80
against 80, two hits), two damage amounts (36 and 59 HP) and the D spent. Also the 10-turn LOSE:
that battle ended after turn 10 with both sides standing and `0x0938` = `01`. The other effects
and the statuses were read, not exercised.

### What it needs that the blocks do not carry

Tables in the cartridge (CPU addresses; the ROM is mapped at the top of the 1 MB space, so file
offset = address + `0x300000`):

| Table | Where | Size | Holds | Needed for |
|---|---|---|---|---|
| techniques | `81D8:0008` | 261 × 28 = 7,308 bytes | per technique: who it can target (+0), effect number (+1), element (+2), D cost (+3), chance of the effect (+5), power (+8), accuracy (+10), amounts for HP and the four stats (+11…+16), further effect settings (+17…+27) | every action. The code reads fields 1, 2, 3, 5, 7, 8, 10, 11, 13–17, 19, 20, 23–27 |
| target kind | `97FA:000A` | 13 bytes | technique target kind → one of 8 ways to pick targets | every action |
| stages | `8578:000A` | 11 × 4 bytes | per stage: picture, and three flags saying whether the stage-bound techniques work there | 5 techniques (table field +26 not 0) |
| armor evolutions | `97FB:0008` | 9 × 3 bytes | Digimon, item technique, armor form | the carried item |
| random Digimon list | `97FE:0006` | 191 bytes | Digimon numbers | technique effect `0x11` |
| Digimon | `8038:0000` | 238 × 28 = 6,664 bytes | per Digimon: growth, techniques, resistances, cost | not needed, as far as the code was read: the battle states read only its field +26, in the capture state `0x43`, which follows the "use an item" action that the automatic chooser never picks (it picks a technique or guards). The resistances and the ability are already in the record |

None of these values is uploaded: a block has the technique *numbers*, not their power, accuracy,
cost, element or effect. So the outcome cannot be worked out from the blocks alone.

From the save, outside the two parties' records, the battle states were seen to read only the
word `0x3874`, in that same capture state. Filling the save's own party (`0x979`…), the line-up
bytes (`0x3784`), `0x3874`, the handle and the opponent's profile with junk before the battle
left the battle unchanged (same turn count and HP left), and so did holding A throughout (which
only shortens it, 32,700 frames instead of 49,200). This was tried with the starting party only.

The stage byte: with the starting parties, stages 0–10 all gave the same battle (seed `41`), as
the code says they should (no stage-bound technique in those parties).

### A way to check a port against the game

Take a state on the VS-screen prompt of a ranking battle (the `d1rankbtl` replay up to the second
tamer's `dm4rankbtl`, about 590 frames after the command is poked). Write stage and seed to SRAM
`0x4D46`–`0x4D47`, the challenger's three records to `0x4D48` and the opponent's to `0x4DBD`
(117 bytes each), press A, and run until `0x0938` leaves `FF` (about 50,000 frames; 10–15 s
headless). Unit n's HP is the word at `0x4AD2 + 79 × n + 0x16`, the turn number is `0x4AC8`, and
a breakpoint at E43E:5715 sees every draw (`CX` = n, `BX` = result). This reproduced yesterday's
two examples: ×0.9, seed `1C` → LOSE (turn 9); ×1.0, seed `41` → WIN (turn 10).

Run that way on 56 battles (the starting party against its copy scaled ×0.8 to ×1.25, eight
seeds each): the challenger won 8, 6, 2, 1, 1, 1, 0 of 8 at ×0.8, ×0.9, ×0.97, ×1.0, ×1.03, ×1.1,
×1.25; 14 of the 37 losses were on time (turn 10, both sides standing); the strength guess agreed
with the game in 45 of the 56.

## Our server

- IDs are eight digits, stored as bytes 0–9 (the game's encoding for digits). Handles are unique.
- The ladder is a list. A challenger fights the player one place above. Since the battle outcome is
  decided in the cartridge and never sent, the server guesses it from party strength
  (HP + D + 4 × (attack + P + speed)): the stronger party takes the higher place, a tie leaves the
  order. This is our rule, and it can contradict the screen: the ranking shown right after the
  battle is already the server's guess. Measured in the game (2026-11-26) with the starting party
  against a copy of it with HP, attack, P and D scaled, eight seeds each: the guess matched the
  WIN/LOSE on screen in 7, 6, 5 of 8 battles for an opponent at ×0.8, ×0.9, ×0.97, in 6, 6, 7, 8 of
  8 at ×1.0, ×1.03, ×1.1, ×1.25 (45 of 56). Both kinds of mismatch were seen: LOSE on screen and
  then the list with the challenger at 1 (×0.9, seed `1C`), and WIN!! with the list unchanged (×1.0,
  seed `41`). Agreeing every time needs the cartridge's battle run on the server. That was tried on
  2026-11-27 and stopped: the battle needs the cartridge's technique table ("The battle" above).
- ID upload stores the party for ID battles; ID search matches a handle or an ID.
- IDバトル's blank-key search gets the newest eight tamers who have uploaded a party (IDアップロード or
  a ranking battle), without the caller. What Bandai listed there is lost; this is our choice.
  Until 2026-11-25 the blank key was answered "not found", so IDバトル always said
  データがみつかりません. Checked in the game with three uploaded tamers: the ID BATTLE list shows
  them, picking one sends `dm4idbtl`, and the VS screen and battle follow.
- Lists hold 8 entries (the reply's size). The ranking reply is the top 8, so a tamer ranked 9th or
  lower does not see their own row (they see their rank on the VS screen). What Bandai sent then is
  not known.
- The news message is game-encoded text: hiragana from `0x0A`, katakana from `0x5A`
  (gojūon, voiced after), small kana `0x56–0x59`/`0xA2–0xA9`, ー `0xAB`, space `0xFD`,
  newline `0xFE`, ！ `0xAC`, ？ `0xAD`, 、 `0xB0`, 。 `0xB1`, D `0xB7`, - `0xEB`.

## Checked in the game (2026-11-26)

Headless, against the reference server, the tamer signed up by the `d1tamers` replay and the other
tamers written into the server's data:

- Ranking with 8 entries: 8 rows, 8-character handles fit, the cursor starts on the last row, the
  player's own row is drawn in red (blinking), A shows the entry's handle, region and three Digimon. With 12 on the
  ladder and the player 12th: the top 8, no own row; the VS screen shows "12" against "11".
- ID BATTLE list with 11 uploaded tamers: the newest 8, cursor on the first. An 8-character handle
  on the VS screen is partly hidden behind the picture to its left (seen in the emulator only).
- Nobody ranked, or nobody uploaded: "データがみつかりません。", then the news, then the title.
  Alone on the ladder: "げんざいあなたがトップです！ バトルのヒツヨウはありません。 デジモンはコウシンされました。".
- The handle screen offers hiragana, katakana, ゛゜, small kana and ー, up to 8 characters. Digits
  cannot be typed.
- Row 7 of a list shows scrambled marks when the news page came just before it (its prompt line is
  left on screen); it is clean when the list follows a battle. Seen in the emulator, with any list
  contents, so it is not from our reply; whether a real console does it is not known.
- A reply that is not ours: HTTP 404 gives "サーバとのコウシンでエラーがハッセイしました。" with
  "エラー=499"; no server gives "ワンダーゲートがセツゾクされていないか、デンチがありません。".

The WonderGate data in SRAM: registered flag `0x48A4`, handle `0x48A5` (8 bytes, then `FF`), region
`0x48AE`, ID `0x48AF`–`0x48B6`, the last ranking's count `0x48B7` and profiles `0x48B8`, the last
search list `0x47B4`, the news `0x4988`, the opponent's profile for the battle `0x43FE`.

Regression (`emu/replays.txt`): `d1tamers` (signup), `d1ranking` (login + ranking download) and
`d1idbattle` (login + the blank-key search). How the game's memory tells an accepted reply from
an error (each seen both ways, against the server and against a 404 or no server):

| Replay | After success | After a refusal or error |
|---|---|---|
| `d1tamers` | SRAM `0x48A4` = `01`, ID at `0x48AF` | `0x48A4` = `00` (also when the handle is taken) |
| `d1ranking`, `d1idbattle` | news at SRAM `0x4988` = `85 87 92 AB 8B AB`…, mode `0x0EDE` = `37` | `0x4988` = `8E A8 5C 77`… (the built-in text), mode back to `26` (title) |

On an empty server both `d1ranking` and `d1idbattle` end on "データがみつかりません。" and the news:
the replies are taken, but there is no list to show.

Not checked: IDサーチ with a typed handle and IDアップロード beyond the request being answered (not
part of this pass); anything on a real console. Of the battle (2026-11-27): only parties of the
three starting Digimon were played, so the technique effects other than plain damage, the
statuses, items, empty slots and what `0x0938` holds when both sides fall in the same action are
known from reading the code at most; the battle was not ported, so nothing of it runs on the
server.
