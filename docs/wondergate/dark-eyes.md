# Dark Eyes: Battle Gate — online battles, mercenaries, world market ✅

Status: **online battles work** headless (2026-10-13). Two emulated cartridges log in, take the
prepaid "service", find each other through matchmaking, exchange parties, load the same map and
pass turns through our relay. In story mode, the guild (ジュリア) registers characters as mercenaries
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
| `nph-login` | SRVC-ID, REQ-SERIAL | SRVC-RETCD, SRVC-TIME |
| `nph-account` | ACNT-ID, ACNT-SID (`BAN00E01` + ID + card blob), ACNT-CMD | ACNT-RETCD; body = message |
| `nph-reqmatch` | MTCH-ID, NAME (SJIS, URL-encoded), LVL, PASS, RETRY | MTCH-RETCD 0/1 = keep polling every POLINT s (TIMEOUT s); 9 = error; **2 = matched**: MTCH-ID, NAME, LVL (opponent), SEED, MATCH (side), HOST, PATH (of nph-match), ACOUNT, BCOUNT, COUNT |
| `nph-match` | MTCH-ID, OID, NAME, CMD + body | cmd 0 post party (RETCD 0; 1 = retry) · cmd 1 fetch the opponent's party (2 + body; 1 = not yet) · cmd 2 post my turn (3) · cmd 3 fetch the opponent's turn (5 + body; 4 = not yet) |
| `nph-upmrcnry` | MCUP-ID, PAY, NAME, CLASS, LVL, EXP, STR, DEX, INT, ATR, EM, RY, SK0-3, IT0-3, HP | MCUP-RETCD, MCUP-MID (8 chars) |
| `nph-listmrcnry` | MCDL-ID, CLASS (race × class code), LVL | MCDL-RETCD, MCDL-NO n; body n × 49 bytes |
| `nph-downmrcnry` | MCDN-ID, MID | MCDN-RETCD |
| `nph-worldinfo` | WINF-ID, NAME, MID, MRID0/1 + 984-byte body | WINF-RETCD + 968-byte body |

The party is four 90-byte character records, base64-encoded by the cartridge (480 bytes);
after decoding, `6800:16BA` checks every name byte against the allowed katakana (anti-cheat;
a mismatch shows LOST). Turns are about 20 bytes each. Battles run in the cartridges; the
server only relays.

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

Players are told apart by MTCH-ID and name (carts without a registered customer ID send
`00000000`). Two pollers with the same MTCH-PASS (empty = random match) are paired. Each side
gets the same seed, MATCH 0/1, and two queues: parties (cmd 0/1) and turns (cmd 2/3).

Mercenaries, earnings and the market are kept in `data/darkeyes.json`.

Regression: `darkeyes` in `emu/replays.txt` (one cart, from boot to matchmaking, then cancel) and
`demerc` (boot to the guild, register a mercenary).
A two-cart battle needs two emulators running at once (see the commit that added the relay).
