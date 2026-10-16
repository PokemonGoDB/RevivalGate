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
