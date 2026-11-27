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
outcome depends on (both parties, and it picks the stage and the seed), so Bandai's server could
have run the same battle itself; whether it did is not known.

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
  seed `41`). Agreeing every time needs the cartridge's battle code run on the server; not done.
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
part of this pass); anything on a real console.
