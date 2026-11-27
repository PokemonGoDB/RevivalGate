# Dark Eyes: Battle Gate — online battles, mercenaries, world market ✅

Status: **online battles work** headless (2026-10-13). Two emulated cartridges log in, take the
prepaid "service", find each other through matchmaking, exchange parties, load the same map and
pass turns through our relay. On 2026-11-26 battles were played to their end (a win, a loss, a
draw), followed by a second battle between the same two cartridges. In story mode, the guild (ジュリア) registers characters as mercenaries
on the server and hires other players' mercenaries, and every connection syncs the shared market
prices (世界情勢) and pays mercenary owners their fees. Server: [`server/darkeyes.py`](../../wondergate/server/darkeyes.py).

## Reaching it

Title → 対戦 → ワンダーゲート → マッチング実行 → pick 4 characters → サーバー接続. 対戦 needs a save
with more than four characters (script at ROM `0x20D7AE`: `34 b4 88 02 04 04 00 3b d8` jumps to the
versus menu when word `[0x88B4]` > 4). Headless, the replay pokes five copies of a new game's hero
into the roster (SRAM `0x514E`, 18 × 47 bytes; name at +0x10, half-width katakana) and sets the
title script pointer (RAM `0x01CB`) to `0xD83B`, the versus menu. Then: プリペイド → 決済カード (any
16 characters) → 電話番号確認 → デフォルトに戻す, and サーバー接続 → サービスを受けますか？ はい.

The game's script VM: bytecode pointer at `SS:0x1CB`, handler table `CS:0x2491` in segment
`4000`; op `09 xxxx` calls `4000:xxxx`, op `34 addr size op value target` is a conditional jump.
The network screens are native code (`4000:CEE5` state table for the connect menu,
`F000:BB..` battle controller, `5900:` HTTP library and request builders).

## Protocol (`battleg1.dark-eyes.com`, dial `##`)

`POST /cgi-bin/dark/nph-<name>.cgi`, `User-Agent: SWAN/1.0`. Fields travel as `X-SWAN-<NAME>:`
request and reply headers (names at ROM `0x359380..0x3596B0`); every reply has `<GROUP>-RETCD`.

Two quirks of the cartridge's parser (bank `0x35`, `5900:1E49..1FDB`), which tell us how the
original nph scripts wrote their replies:

- Numbers are read up to a **space or LF**: `RETCD: 0\r\n` parses as `0xDD`. Lines end in bare LF.
- The body is found by searching `\n\n` starting **just after the Content-Length line**, so
  Content-Length must come before the other headers.

| CGI | Request | Reply |
|---|---|---|
| `nph-login` | SRVC-ID, REQ-SERIAL | SRVC-RETCD, SRVC-TIME, and **SRVC-ID** for a cart that sent `00000000` (see Customer IDs) |
| `nph-account` | ACNT-ID, ACNT-SID (`BAN00E01` + ID + card blob), ACNT-CMD | ACNT-RETCD; body = message |
| `nph-reqmatch` | MTCH-ID, NAME (SJIS, URL-encoded), LVL, PASS, RETRY | MTCH-RETCD 0/1 = keep polling every POLINT s (TIMEOUT s); 9 = error; **2 = matched**: MTCH-ID, NAME, LVL (opponent), SEED, MATCH (side), HOST, PATH (of nph-match), ACOUNT, BCOUNT (the opponent's wins and losses, see Records), COUNT (stored, never read) |
| `nph-match` | MTCH-ID, OID, NAME, CMD + body | cmd 0 post party (RETCD 0; 1 = retry) · cmd 1 fetch the opponent's party (2 + body; 1 = not yet) · cmd 2 post my turn (3) · cmd 3 fetch the opponent's turn (5 + body; 4 = not yet) · cmd 4 I won (6; anything else but 9 = ask again) |
| `nph-upmrcnry` | MCUP-ID, PAY, NAME, CLASS, LVL, EXP, STR, DEX, INT, ATR, EM, RY, SK0-3, IT0-3, HP | MCUP-RETCD, MCUP-MID (8 chars) |
| `nph-listmrcnry` | MCDL-ID, CLASS (race × class code), LVL | MCDL-RETCD, MCDL-NO n; body n × 49 bytes |
| `nph-downmrcnry` | MCDN-ID, MID | MCDN-RETCD |
| `nph-worldinfo` | WINF-ID, NAME, MID, MRID0/1 + 984-byte body | WINF-RETCD + 968-byte body |

The party is four 90-byte character records, base64-encoded by the cartridge (480 bytes);
after decoding, `6800:16BA` checks every name byte against the allowed katakana (anti-cheat;
a mismatch shows LOST). A turn is 20 bytes: 16 characters of base64 (12 bytes) and 4 more
bytes, NULs or `////`. Battles run in the cartridges; the server only relays.

Every wait is counted in frames by the cart (`5900:36B0`–`3B1A`: one small state machine per
request): it asks again every POLINT seconds and gives up when TIMEOUT seconds have passed since
the wait began. Both are read from **every** reply that carries them (`5900:35D6`) and kept as
frames in 16-bit words (RAM `0x398`, `0x39A`; × 75), so TIMEOUT can be at most 873. Until a reply
sets them the cart uses 10 and 180 (`5900:3693`). A request whose reply never arrives (or isn't
the code it expects) is sent again after POLINT, body and all.

### Customer IDs (お客様ＩＤ)

A new cartridge logs in with `X-SWAN-SRVC-ID: 00000000`. The login reply parser (`5900:20D6`)
looks for `X-SWAN-SRVC-ID` in the **reply** when SRVC-RETCD is 0, 1 or 2, copies its value up to
the LF to RAM `0x4759` and SRAM `0x6067`, and saves (`4000:D212`). The value must be 8 characters:
the copy has no length check and the mercenary's MID starts at `0x6070`. Every later request
carries it (ACNT-ID, MTCH-ID, MCUP-ID, MCDL-ID, MCDN-ID, WINF-ID).

Seen in the game (2026-11-26): the connect menu (サーバー接続 / プリペイド / 電話番号確認) of a new
cartridge has no ID line; from the first login on it shows `お客様ＩＤ` followed by the issued ID
(the same 8 characters as SRAM `0x6067` and the later requests' MTCH-ID). The record screen after
a battle shows both players' IDs (`ID:` after the name and level). A second connection logs in
with the stored ID and the reply carries no SRVC-ID.

Until 2026-11-25 we never sent one, so every cartridge stayed `00000000` and a player was known by
hero name alone: two players with the same hero name could not be matched, and one's mercenary
upload replaced the other's. Now a login with the blank ID gets 8 random hex digits (Bandai's
format is lost). Checked in the game: the cart sent `ACNT-ID` and `MTCH-ID` with the new ID for the
rest of the session, SRAM `0x6067` held it afterwards, and two carts with the same hero name
(ｱｱ) were matched and exchanged parties. A mercenary registered before then (owner
`00000000/<hero>`) passes to the cart's new ID the first time its worldinfo names that MID.

### End of a battle (`nph-match` cmd 4)

Played out with two cartridges on 2026-11-26 (how: see Playing a battle headless):

- **Only the winner sends cmd 4**, once, straight after the last turn; it took RETCD 6, hung up
  and showed VICTORY. The loser collected the last turn (cmd 3), hung up without another request
  and showed LOSE. Both then showed item rewards, saved, showed the record screen and went back
  to the title.
- **A draw sends nothing.** When the count limit (制限カウント 2000) runs out both carts hang up
  after the last turn and show DRAW, also with 4 units against 3.
- A cart whose wait runs out (TIMEOUT), or that is answered 9, hangs up and shows LOST, then the
  title; no cmd 4. (9 on a cmd 3 poll: LOST within two seconds.)

From the ROM: the end-of-battle controller (`0x35E516`) sends cmd 4 only when the result byte at
SRAM `0x4A0A` is `0xFD` (this side met the victory condition, `F000:1C94`); `0xFE` (lost, or the
count ran out) goes straight to the hang-up. `5900:3A60` repeats cmd 4 every POLINT until the
answer is 6 (9 = error). So cmd 4 is how the original server learned who won: the winner's
MTCH-ID and the loser's MTCH-OID.

We answer 6. The battle is then over for the winner; the loser's side is kept only while the
last turn is still waiting to be collected. Before 2026-11-25 cmd 4 was answered 9; until
2026-11-26 the server waited for a cmd 4 from both sides, which never comes, and kept every
finished battle (the Worker for ten minutes).

### Records (対戦成績)

The record screen after a battle shows あなたの対戦成績 and 相手の対戦成績: name, LV, ID, WIN, LOSE,
VP. The opponent's line starts from the matched reply's **ACOUNT (wins) and BCOUNT (losses)**,
to which the cart adds this battle. Checked in the game with ACOUNT 7 / BCOUNT 3 sent to both
sides: the winner saw the loser as WIN 7 LOSE 4 VP 3, the loser saw the winner as WIN 8 LOSE 3
VP 5 (their own lines: WIN 1 LOSE 0 VP 1 and WIN 0 LOSE 1 VP 0, so VP looks like wins minus
losses, not below 0). COUNT is parsed into RAM `0x447`, but from the ROM nothing uses it: its
getter (`4000:F9B6`, bank `0x34`) isn't in the function table the others are called through.

We always send 0 / 0, so an opponent's record shows only the battle just played. Keeping real
records would mean counting cmd 4 per customer ID (wins for MTCH-ID, losses for MTCH-OID); that
isn't built. Draws and LOST endings report nothing, so the original server can't have counted
them either.

## Mercenaries and the world market (story mode)

Headless: the replay's roster pokes, plus `poke:519E=82` (a registrable copy), then the title
script pointer set to `0x6C49` (ジュリア's "2. 傭兵の登録と雇用をする" in bank `0x20`; `0x6C0A` is
"1. 世界情勢を確認する"). A character can be registered when roster byte `+0x21` has bit 7 set,
`0x10` (leader), `0x20` (registered), `0x08` and `0x04` (hired) clear, and `+0x2E` = `0xFF`
(`F000:1A7A`). Menu (UP/DOWN): 雇用 / 登録 / 解除. Hiring needs エルド (word at SRAM `0x5FF6`).

- **Register** (登録): pick a character, set PAY, はい, connect. The cart stores the returned MID
  at SRAM `0x6070` and flags the character (`+0x21 |= 0x20`).
- **List** (雇用 → race → class): records (parser `5900:2AC1`, up to 40; the cart's arrays
  at SRAM `0x3DA9`):

  ```
  +0  year (word) +2 month +3 day     shown as the registration date
  +4  MID (8 chars)  +12 PAY (word)  +14 name (16, space padded)
  +30 CLASS LVL EXP STR DEX INT ATR EM RY SK0..3 IT0..3 (bytes), HP (word)
  ```

  The stats are copied into a 47-byte roster record in upload order (`+0x22 +0x23 +0x24 +0x26
  +0x27 +0x28 +0x2B +0x2C +0x2D`, skills `+0x0C`, items `+0x08`, HP `+0x06`). MCDL-NO 0 makes
  the cart say 選択したクラスの傭兵が1人もいません.
- **Hire**: the cart sends the MID, keeps it at `0x6079`/`0x6082`, and pays PAY. The server
  credits the owner.
- **Deregister** (解除) is offline: the cart flags its MID, and the next worldinfo sends
  WINF-MID `00000000`, which doesn't say which one. Every session runs login → account →
  worldinfo → upload, so the server remembers who is on each client address (worldinfo's ID +
  hero name) and owns uploads by that. `00000000` then removes that owner's mercenary, and a new
  upload replaces their old one (the cart holds one, at `0x6070`). Unpaid fees are paid out.
  Verified on the cart: register, 解除, reconnect → the list is empty.
- **worldinfo** runs on every connection. Request body: 21 bytes of player state (16 + 4 = the battle counters below, 1 more byte), the market
  (`0x3C0` bytes at SRAM `0x6278`: 15 towns × 64 goods, a price level per byte, default
  `0x30`; bit 7 = changed locally by buying or selling, `4000:80F0`), a word, a checksum
  (byte sum). Reply body (`5900:30C0`): 2 bytes (`0x6032`), the market, a word **added to
  the player's money** (the owner's fees), 1 byte (`0x6031`), the word, the checksum. With
  `0x3F8`+ bytes, three 16-byte names follow. Our server keeps one shared market (entries flagged
  by bit 7 overwrite it) and fills the rest:
  - **C1** (`0x6031`), the world event: after a guild connection ジュリア's script
    (`0x20CDB6`) applies event 0–9 (0–2 are messages; 3–9 also change the map, op `65`, and
    set bit n of the word at `0x602F`, shown once per save); scripts in bank `0x27`
    (`0x277ACD`…) switch map flags for the larger values 0x21–0x73. We step through them
    weekly from 2026-10-05 (`DE_EVENT` overrides). Verified: event 3 set bit 3.
  - **C2 / C3** (`0x6032/33`): the region with the **most** and the **fewest** random battles,
    for battle earnings (not shop prices; `0xFF` = none, as in a new save):
    - **The cart counts every random battle per region.** Walking the field map counts down a
      step counter (`0x49F7`); at zero a random-encounter check (`4000:61A4`) can start a battle
      flagged `[0x298]` = `0xFF` (story battles use `0xC7`–`0xC9`). Starting one adds 1 to that
      region's word at `0x601B + 2·[0x274]` (8 regions) and `[0x48EC]` to a dword at `0x602B`
      (`0x3F574A`). They are running totals kept in the save (loaded at `0x34F493`, never
      cleared), and the **first 16 + 4 bytes of every worldinfo upload are these counters**.
    - **The guild reports the result.** ジュリア's 世界情勢 script has "最近の戦闘発生状況は・・・
      最も多いのが[X]部、少ないのは[Y]部です" ("recent battle activity: most in region X, fewest
      in region Y", ROM `0x27D46D`). The text never displayed in our tests: the script goes from
      "あなたのアクセスをお待ちしております" straight to the next scene, so that block may be
      switched off in this build.
    - **The effect.** When a random battle starts, `0x368A20` copies C2/C3 to `0x4A90/91`.
      Earnings build up at `0x4A08` (`add` at `0x3F12B1`). In the result step (`0x3F57C9`) they
      are **halved** in region C2 and **raised by a quarter** in region C3 (`6800:06A7` = ROM
      `0x3686A7`). Hired mercenaries' pay owed (`0x4A0C`) is then settled from them
      (`0x3F584C`), and the amount is shown as a number with no explanation (`0x3F34AE`).
      Story and quest battles are unaffected.
    - So the original server pooled every player's counts: the most-farmed region paid half and
      the quietest paid a quarter more, spreading players over the map. Townspeople's lines fit
      ("不景気だから… 何処かに貰いのいい仕事ってないかしらねぇ"). Which byte means "most" is
      inferred from the order of the report's two names and from halving the busy one.
    - **Our server does the same, sized for a small community** (`record_battles`,
      `battle_regions` in `server/darkeyes.py`). Each upload adds the player's new battles since
      their last upload (a smaller total = a new save). The pick uses the 30 days before today,
      so it holds all day and sparse play still adds up. The two sides switch on separately:
      - the **bonus region** (+25 %) once there are 20 battles in the window, from anyone: the
        least-fought region among those someone fought in, never the busiest (an unreached
        late-game region would make the bonus useless);
      - the **halved region** only once 3 different players and 50 battles are in the window,
        so nobody's pay is cut for where they alone play.

      Until then that byte is `FF`. `DE_REGIONS=c2,c3` forces a pair for tests.

      **Still being balanced:** the window and thresholds are first guesses for a small
      community. We'll revisit them once we see how many people play and where they fight.
    - Checked: the reply bytes land in SRAM (a new game holds `FF FF FF` at `0x6031`). Counters
      poked into the save arrived in the upload (5 in region 0, 12 in region 3). A shop
      (ジェンキン道具店 in the first town) shows the same prices with C2 or C3 set to that
      region. Not yet watched: a random battle's earnings changing.
  - **Names** (`+0xC4`): players whose names go on places: with slot n set, script op `0x74`
    shows "<name>の沼 / 村 / 洞窟" instead of ピラニアンの沼, 忍者の隠里, サンドシップの巣.
    We send the three owners whose mercenaries were hired most. Verified received (`0x6034`).

## Our server

Players are told apart by MTCH-ID and name. Mercenaries, earnings and the market are kept in
`data/darkeyes.json`; matchmaking and battles are kept in memory (the Worker: one D1 row).

**Search.** Two pollers with the same MTCH-PASS (empty = random match) are paired; each gets the
same seed and MATCH 0/1. The search can't be cancelled on the cart (B does nothing): it polls for
TIMEOUT seconds (we send 60), then says 対戦相手が見つかりません and stops without telling the server.
A waiting player is forgotten 10 s after their last poll. Because of that silence a pair is
confirmed in two steps: the player who was waiting is told on their next poll, the newcomer once
that has happened, and a newcomer whose partner never polls again goes back to waiting after
10 s. (Until 2026-11-26 the newcomer was told at once. Seen in the game: a cart that started
searching 3 s after another's search had run out was shown 対戦相手が見つかりました, waited a minute
for a party and got LOST; when the first cart searched again it was matched with that second
cart, long gone, received its old party, opened the battle and got LOST too. With the fix both
carts end with 見つかりません; that run was paced at real speed, since the 10 s are the server's
clock.) What's left: a newcomer that disappears in the second after it arrives still leaves the
waiting player with a battle nobody joins.

**Battle.** Each side has two queues: parties (cmd 0/1) and turns (cmd 2/3). A player belongs to
one battle; when they go back to the search, what their old opponent sends no longer reaches
them: the old opponent collects anything still queued and is then answered 9 (the cart shows
LOST at once). (Until 2026-11-26 a late turn from an abandoned battle was delivered into the
player's next battle. Seen in the game: the player's cart showed the new opponent's first unit
as done while the new opponent was still choosing its move.)

**Time to think.** Match replies carry TIMEOUT 180, the search's keep 60. The cart whose turn it
is sends nothing while the player thinks; the other cart polls cmd 3 and shows LOST when TIMEOUT
runs out, and the thinking player finds out only at their own next wait. With 60 on every reply
(until 2026-11-26) a player who thought for a minute ended the battle; seen in the game. 180 is
our choice (the cart's own value before a reply sets one); the original server's is unknown.
Checked in the game: a turn posted after two minutes went through; a wait that got no turn
ended in LOST after 120 polls (a 60-second wait is 40).

A battle neither side has polled for 10 minutes is forgotten (a draw, a LOST ending and a loser
who never comes back leave one behind).

**Known and not fixed: lost replies.** Turns carry no number and consecutive turns can be
byte-identical (four units defending in a row post the same 20 bytes), so the relay can't tell a
repeated turn from the next one. Seen in the game with the reply to one cmd 2 thrown away after
the server had handled it: the cart hung up, dialled again and posted the turn again; the other
cart received it twice and played it as two units' turns, and the two carts no longer agreed.
By the same reading (not tried): a lost cmd 3 reply loses the turn and both carts end in LOST,
and a repeated party (cmd 0) is harmless, because the extra copy is never collected. The
original server would have had the same problem.

## Playing a battle headless

Two emulators stepped in turn against one server (scratch tooling, not in the repo). Facts that
make it scriptable:

- With the same SEED and parties the map and start positions were the same every run. The
  battle's work area is SRAM `0x484E`:
  count `0x48EC` (word), cursor x, y `0x48F1`/`0x48F2`, unit positions x `0x48F5`+n and y
  `0x4905`+n (n = 0–7 one side, 8–15 the other; `0x40` = dead), result `0x4A0A`.
- On the active unit: A opens the menu (UP 移動, LEFT 防御 = defend and end the turn, DOWN 環境,
  RIGHT 行動); after moving, LEFT is 終了. Move: d-pad RIGHT/LEFT = x±1, DOWN/UP = y±1, A, then a
  facing, A. Attack: 行動 → 攻撃 → target → preview → A. 環境 → 勝利条件 shows the victory condition
  (敵を２体以下に減らせ and 制限カウント 2000 on the two maps we looked at).
- A roster record's HP is the word at +6; with HP 1 poked for all five (both carts) every hit
  kills, and with SEED 1 (a flat forest map) two units of one side can each reach an enemy in
  their first turn after the other side has walked two units forward. That battle is over in
  six turns. Defending every turn on both sides ends in DRAW after about 100 turns.

Regression: `darkeyes` in `emu/replays.txt` (one cart, from boot through the search until it
runs out) and `demerc` (boot to the guild, register a mercenary). What they leave behind when the
replies were accepted: `darkeyes`: SRAM `0x6067` holds the ID (zeros if the login failed), RAM
`0x398` = `4B 00` and `0x39A` = `94 11` (POLINT 1 and TIMEOUT 60 from the search replies; zeros
if it never got that far); `demerc`: SRAM `0x6070` = `00000001` in ASCII and roster byte `0x519E`
= `A2` (`82` if the upload failed).
