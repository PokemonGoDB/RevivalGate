# D's Garage 21 Koubo Game: Tane o Maku Tori (たねをまく鳥): national best ✅

Status: **working** headless (2026-10-13): national #1 name and score per course, your rank
or ランク外 (unranked).

How to reach it: hold **X1+Y3 at power-on** (combo from [Keitai Archive's WS-WonderGate-Patches](https://github.com/Keitai-Archive/WS-WonderGate-Patches)) (adds ワンダーゲート to the title menu). The
screen is drawn rotated: the title menu reads おはなし / ずーっと / たいせん / ベストスコア /
ワンダーゲート; Y_RIGHT moves up (wraps to ワンダーゲート), Y_LEFT down, DOWN selects,
A goes back. Phone screen "##" → DOWN connects. The title falls into an attract demo when
idle; START returns to the menu (`runs/d-s-garage/menu.state` is saved at the menu).
Replay: `emu/drive.py "d's garage" 'UP+Y_DOWN*300' w600 START w300 START w300 DOWN w20 START w300 Y_RIGHT w20 DOWN w300 DOWN w1800`.

## Exchange

`POST http://wgg01.channel.or.jp/service/swan-ranking/tanetori`:
`*=<id>&owner=<16 chars, + padded>[&score=<course>|<10 digits>]&list=TANETORI|1|1`. A fresh
save sends no score. After a game, the best score goes up with its course number: 1 = おはなし,
2–4 = ずーっと 易/並/難. There is no extra field after the score.

**Verified with real play** (2026-10-15): a ずーっと 易 round played headless ended with a total
of 2180 (ゲーム結果: トータル得点 002180, プレイ時間 00344, 命中率 18 %, 咲かせた花の数 3). The
next connection uploaded `score=2|0000002180`, and 全国ベスト showed MEDNAFEN 002180 on
ずーっと・易 with あなたの順位 1位, and ランク外 on the other three. The state at the title
menu after that game is `runs/d-s-garage/played.state`.

## Reply (parser at ROM `0x42DD8`; reply buffer at RAM `0x3000`)

Exactly four course blocks (おはなし, ずーっと 易/並/難), each found by `cour`:

```
course=<g>|<n>|<x>|<x>|<x>|<your rank: exactly 4 digits, 0000 = ランク外>
TANETORI=1                 (our row count; the parser skips this line)
<r>|<10-digit score: first 4 skipped, 6 shown>|<name: exactly 16 bytes>|…
```

- If fewer than four blocks parse, every course shows NO RANKING DATA.
- Names are shown: decode `+` to spaces, pad to 16. Empty course: name "NO RANKING DATA."
  (the game's own default text).
- **Your rank is read wrong by the game** (ROM `0x42EC4`): it works out thousands, hundreds, tens
  and units from the four characters, but every `mul` clears DX, where the sum so far was kept, so
  only tens × 10 + units is left. With plain digits `0123` showed as 23位, `1234` as 34位 and `9999`
  as 99位 (seen 2026-11-26). Each character is taken as its code − `'0'`, so we send the tens as
  one character, `'0'` + rank ÷ 10: 100 is `00:0`, 2079 is `00\xFF9`. A `|` there would end the
  field, so 760–769 go as 75 tens and 10–19 units (`00{:` … `00{C`). That reaches 2079; a lower
  place goes as `0000`, which the game shows as ランク外. Seen in the game: 1位, 12位, 100位, 765位,
  2079位, and ランク外 for 2080th. What Bandai's server sent is unknown; this layout is ours.
- The national score is copied as 6 raw characters and the rank as 4, with no checks; neither can
  hang the game.

## Limits, checked in the game (2026-11-26)

- **Score:** the game keeps six digits per course and uploads `0000` + those six, so 999999 is the
  largest it can send; it showed correctly as a national best. A longer number can only come from
  a hand-made request; the game would show its last six digits.
- **Name:** the console's owner name, 16 characters, through a table at ROM `0x42B53`: space and
  `+` both go out as `+`, ♥ as `@`, ♪ as `!`, the rest as themselves. The game draws `@` as ♥ and
  `!` as ♪ again. With the owner name `A B♥♪+-?0123456.` the upload was `owner=A+B@!+-?0123456.`
  and the screen showed `A B♥♪ -?0123456.`: an owner's `+` comes back as a space, because the
  upload can't tell them apart. Sixteen `W` or `M` fit the box.
- **One row per course**, so "your place" is all a player outside 1st sees. Entrants are not read.

## Save (cartridge EEPROM, 128 bytes) and test pokes

The game keeps the EEPROM in RAM at `0x261` and writes it back after every download
(ROM `0x48891`):

| Offset | What |
|---|---|
| `0x00` | `TANETORI V003`, `0xFE` |
| `0x0E` | own best, 4 courses × (low four digits as a word, top two digits as a word) |
| `0x1E` | national best, same layout |
| `0x2E` | your rank, 4 × (word, word 0); `0x2710` = ランク外 |
| `0x3E` | national best's name, 4 × 16 bytes |
| `0x7E` | flags: `0x40` = ワンダーゲート is on the title menu (what the power-on combo sets) |
| `0x7F` | sum of bytes `0x00`–`0x7E` |

A whole image poked at power-on (`w2 cartee:0=<256 hex digits> reset`) stands in for played games
and for the combo: with own bests 1234 / 0 / 345678 / 999999 the game uploaded
`score=1|0000001234&score=3|0000345678&score=4|0000999999`. Without the header the game resets
the save to its defaults (seen); it checks the sum the same way (ROM `0x4886B`, from the code).

Proof that a reply was taken: RAM `0x6C7` holds the four own bests as digit values before the
call (0–9) and the four national bests as text after it. On a fresh server and a fresh save that
is 24 × `0x30`; with the reply body replaced by `?` bytes it stays 24 × `0x00`, **though the
screen is the same** (NO RANKING DATA either way). With scores uploaded, RAM `0x28F` (rank words)
and `0x29F` (names) change too.

Not verified: real hardware. A player whose owner name has a `+` and one with a space in the same
place share a name on the server.
