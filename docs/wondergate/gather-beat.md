# SD Gundam G Generation Gather Beat 1 & 2: WonderGate shop 🔁

Status (2026-10-14): both downloads **work** headless, and we now serve Bandai's documented lists.
[`server/ggene.py`](../../wondergate/server/ggene.py) holds both.

- **Gather Beat 2:** the list players recorded, at the recorded prices: 10 units, 4 parts, 3 pilots
  and the 2 bonus scenarios. Buying a scenario starts its stages.
- **Gather Beat (1):** Bandai's cumulative "ALL 配信データ" list (16 units, 9 characters, 3 parts).
  Its prices are lost: **the GB1 prices we serve are our estimates**, worked out below from GB2.

## The original service

A **post-game reward**. Once the game was cleared, WonderGate added new stock to the backstage supply
shop (補給), the points shop between stages. Normally its stock grows with the story, and units also
come from capturing enemies, combining parts (開発/合成) and events. Bandai: GB1 "ゲームクリア後に
ダウンロード可能", GB2 "全シナリオをクリアすることで". No Bandai fee is documented: players paid
docomo's call charges, and a download took about 10 seconds. Both games' service ended
**31 March 2003** ([notice](https://web.archive.org/web/20030405070742/http://www.swan.channel.or.jp/swan/software/r_gate.html)).

**Gather Beat (1)** ("rare data", "partially updated about once every two weeks"):

- Six rounds: round 5 on 2000-09-26/28, round 6 (the last) on 2000-10-27.
- Round 6 ([Bandai, captured Dec 2000](https://web.archive.org/web/20001214152800/http://www.swan.channel.or.jp/swan/software/r_gate.html)):
  - units ガンダム☆, ジャグラー, ザク☆, ガンタンク☆, シャイニングガンダム☆, クーロンガンダム☆
  - characters チャップ・アデル, ベイト, モンシア, ララァ
  - parts 角飾り, シュツルムブースター, ハイメガキャノン
- From April 2001 Bandai listed "ALL 配信データ" ([captured Apr 2001](https://web.archive.org/web/20010417233431/http://www.swan.channel.or.jp/swan/software/r_gate.html)):
  - units ガンダム☆, ジム・ジャグラー, ザク☆, ガンキャノン☆, 旧ザク☆, ゲルググ☆, ガンタンク☆,
    ガンダム☆ (a second time), エルメス2号機, イーゲル, ウォドム, Ez8改, ガンダムシュピーゲル☆,
    ライジングガンダム☆, シャイニングガンダム☆, クーロンガンダム☆, モビルフラット
  - characters チャップ・アデル, ベイト, モンシア, ランバ・ラル, マ・クベ, コレン・ナンダー, ノリス, ハマーン, ララァ
  - parts 角飾り, シュツルムブースター, ハイメガキャノン
- ☆ = "同じユニットでも通常のユニットよりも強力なパラメータ設定" (stronger stats than the normal unit).
  The ROM confirms it: the ten ☆ suits are separate ids (237–246) with their own records, names
  ending in ☆, and they are in no in-game shop ([hypplcs](https://www.hypplcs.com/2017/09/wsg-1-0e34.html)
  says the same).
- **Lost:** rounds 1–4 and every GB1 price.

**Gather Beat 2** (a [2002 player post](http://wsc.s201.xrea.com/x/swanlog/dat/992595563.dat), posts 87, 408, 448, 454, matched by a [fan blog with prices](https://www.hypplcs.com/2017/08/wscg-34-ca6d.html)):
10 units, 4 parts, 3 pilots and 2 scenarios, listed with prices in the table below. The scenarios
逆襲のシャア and 戦士再び lead on to メビウスの輪から, 忌まわしき記憶と共に and the Hathaway bonus
stage ([stages](https://www.hypplcs.com/2017/08/wscg-44-0d55.html)). The blog adds what they bring:

- Through the 逆シャア stage, ハサウェイ (ジェガン) and レディ (トールギスⅡ) join.
- Through the ZZ stage, プルツー and シーマ (バウンドドック) join.
- Either way キンケドゥ (クロボンX1) joins.
- ブライト's ship becomes the ラー・カイラム and シナプス's the ネェル・アーガマ.

The blog calls these scenarios the reason GB2 can't be completed (its encyclopedia keeps blanks)
without WonderGate. The lineup changed over time: two weeks after launch a player described modest
units and parts. We serve the list as recorded. No `gggbgate*.txt` was archived.

## What we serve

### Gather Beat 2: the documented list, and how its prices compare

Ids are the ones the game shows for each line (we served every id and read the names off the shop
screen). In-game price = the unit record's shop price (ROM tables below).

| Item | Line | WonderGate price | In-game price | Ratio |
|---|---|---|---|---|
| ガトー専用ゲルググ | `1053` | 1200 | 650 | 1.85 |
| ライデン専用ゲルググ (ROM: J・ライデン専用ゲルググ) | `1148` | 1500 | 725 | 2.07 |
| マツナガ専用ゲルググ | `1138` | 1500 | 725 | 2.07 |
| シャア専用ゲルググ | `1088` | 1500 | 750 | 2.00 |
| シャア専用ズゴック | `1089` | 1000 | 500 | 2.00 |
| α・アジール | `1167` | 6500 | 4625 | 1.41 |
| ナイチンゲール | `1114` | 4200 | 2750 | 1.53 |
| Ξガンダム | `1168` | 5000 | 2350 | 2.13 |
| クロスボーンガンダムＸ１ | `1169` | 6000 | 3075 | 1.95 |
| クロスボーンガンダムＸ２ | `1170` | 6000 | 3075 | 1.95 |
| サイココントローラー | `2009` | 1000 | none (0) | – |
| サイコフレーム | `2010` | 2000 | none (0) | – |
| ハイメガキャノン | `2015` | 750 | none (0) | – |
| アップグレードパーツ | `2025` | 500 | none (0) | – |
| シン＝マツナガ (ROM: シン・マツナガ) | `3075` | 1500 | no price field | – |
| ノリス＝パッカード (ROM: ノリス) | `3111` | 1500 | no price field | – |
| サウス＝バニング (ROM: バニング) | `3114` | 1500 | no price field | – |
| 逆襲のシャア | `4001` | 1000 | no price field | – |
| 戦士再び | `4002` | 1000 | no price field | – |

**The rule: there isn't a constant factor.** Units sold for 1.41–2.13× their in-game price, median
1.98. Eight of the ten are about double, rounded to a round figure (650 → 1200, 2350 → 5000,
3075 → 6000); the two large Neo Zeon NT machines were discounted (α・アジール 1.41×, ナイチンゲール
1.53×). The four parts have price 0 in the parts table (never sold in-game), and pilots and
scenarios have no price at all, so Bandai priced those freely: pilots a flat 1500, scenarios 1000.

### Gather Beat (1): the ALL list at estimated prices

**These prices are our estimates, not Bandai's.** Method:

- **Units and parts with an in-game price:** 2 × the ROM catalogue price, rounded half up to 100
  (GB2's median ratio; GB2 prices are multiples of 100). GB1's catalogue prices are on GB2's scale
  (ジム 285 vs 250, イーゲル 1313 vs 1325), so the factor carries over.
- **The most expensive units** (catalogue 2700 and up: the four ☆ G Gundam suits, the same tier as
  GB2's ナイチンゲール at 2750): 1.5 ×, since GB2 discounted its biggest machines (α・アジール 1.41 ×,
  ナイチンゲール 1.53 ×). Decided 2026-10-14. GB2's pattern isn't purely by price (クロスボーン at 3075
  still sold at 1.95 ×), so this is a judgement call, like every GB1 price.
  It leaves them below ガンダム☆ (4900); GB2 has the same kind of inversion (ナイチンゲール 4200, Ξガンダム 5000).
- **Characters:** GB1 never sells characters, so there is nothing to scale: 1500, GB2's flat pilot price.
- **ハイメガキャノン:** price 0 in GB1's parts table; 750, GB2's WonderGate price for the same part.


| Item | Line | In-game price | Estimate |
|---|---|---|---|
| ガンダム☆ | `1237` | 2450 | 4900 |
| ジム・ジャグラー (ROM: NT試験用ジム ジャグラー) | `1224` | 975 | 2000 |
| ザク☆ | `1241` | 2025 | 4100 |
| ガンキャノン☆ | `1238` | 2243 | 4500 |
| 旧ザク☆ | `1240` | 1785 | 3600 |
| ゲルググ☆ | `1242` | 2400 | 4800 |
| ガンタンク☆ | `1239` | 2255 | 4500 |
| エルメス2号機 | `1225` | 863 | 1700 |
| イーゲル | `1047` | 1313 | 2600 |
| ウォドム | `1065` | 1403 | 2800 |
| Ez8改 (ROM: Ez-8改) | `1149` | 1318 | 2600 |
| ガンダムシュピーゲル☆ | `1245` | 2700 | 4100 (1.5 ×) |
| ライジングガンダム☆ | `1246` | 2700 | 4100 (1.5 ×) |
| シャイニングガンダム☆ | `1243` | 2700 | 4100 (1.5 ×) |
| クーロンガンダム☆ | `1244` | 2700 | 4100 (1.5 ×) |
| モビルフラット (MS) | `1034` | 1114 | 2200 |
| チャップ・アデル, ベイト, モンシア, ランバ・ラル, マ・クベ, コレン・ナンダー, ノリス, ハマーン, ララァ | `2109` `2104` `2111` `2087` `2081` `2062` `2076` `2034` `2086` | none | 1500 each |
| 角飾り | `3019` | 100 | 200 |
| シュツルムブースター | `3014` | 500 | 1000 |
| ハイメガキャノン | `3038` | none (0) | 750 |

Choices where the list is ambiguous:

- **ガンダム☆ twice:** the ROM has one ☆ Gundam (237); Bandai likely listed it in two rounds. Served once.
- **ウォドム:** ids 65 and 171 point at the same record; we use 65. **マ・クベ:** 81 and 82 are the
  same character (the owned check compares the record's base word); we use 81.
- **モビルフラット:** a transforming unit with two ids, 33 (MA) and 34 (MS). We sell the MS form;
  which one Bandai sent is unknown. It hardly matters: both records have the same HP (1350) and price
  (1114), and each one's byte +0x0B names the other (33 → 0x22, 34 → 0x21). GB1 has 10 such
  reciprocal pairs, all with equal HP, so this is the transform link and either purchase gives the
  same unit (read from the ROM, not tested in play).
- Round 6's ジャグラー is ジム・ジャグラー: the ROM has only one.

## In the ROM

**Gather Beat 2** (ROM = CPU address with bank `C0 = 0x0F`):

- Units: `5000:2369` (ROM `0x752369`), `0x56`-byte records indexed by id (0 = the player's ∀99, 1–180
  suits, sorted by name). +2 name, +4 size (1 S, 2 M, 3 L), +8 HP, **+0x18 shop price**. Ids the
  encyclopedia hasn't met show as UNKNOWN.
- Shop build `7000:39A8` (ROM `0x7739A8`): if a WonderGate list is loaded (`AC08:2EF6`), the
  shop shows it instead. Otherwise units unlocked in RAM `0x102+id` at +0x18, the event units at
  `EEAE:0130` (ROM `0x7EEC10`, 8 bytes: id+1, from/until flags, price: their prices equal +0x18)
  and event parts at `EEAE:0160` (ROM `0x7EEC40`). Sell price = buy price / 5 (`7000:3D13`).
- Parts: `EECB:0420` (ROM `0x7EF0D0`), 4 bytes (price, name), ids 0–36. Only BWS, FAパーツ (500),
  アームドベース (2500), チョバムアーマー, メガバズーカランチャー (250) and Dディフェンサー (500) have a price.
- Pilots: `5000:66C7` (ROM `0x7566C7`), `0x9B`-byte records for ids 1–247 (stats, skills; no price).
- Scenarios: `F0EF:05FC` (ROM `0x7F14EC`), 6 bytes: far name pointer, event flag. The download id
  is 1-based (the parser subtracts 1): 1 = 逆襲のシャア (flag `0x81`), 2 = 戦士再び (flag `0x83`).
  Buying sets the flag (seen in RAM `0x574` bits 1 and 3); the shop shows a scenario as owned from
  the flag (`7000:3F26`).
- Next-stage choice `B000:1607` (ROM `0x7B1607`): after a post-clear stage (current stage, RAM
  `0x177C`, in 0x20–0x26 or ≥ 0x8C), flag `0x81` without `0xC1` (cleared) → stage 0x1E
  (逆襲のシャア, 地球衛星軌道3); flag `0x83` without `0xC4` → stage 0x21 (戦士再び, サイド3);
  else a random bonus stage 0x22–0x26 or the map select (0x8C).
- WonderGate shop rows: `7000:3FF1` units, `7000:4115` parts (owned count RAM `0x680+id`),
  `7000:4200` pilots, `7000:42A0` scenarios. Parsed list: ids RAM `0x404+`, prices `0x202+2i`.

**Gather Beat (1)** (bank `C0 = 0x0F`, 4 MB ROM):

- Units: index `B000:AE3B` (ROM `0x3BAE3B`, word per id → record), records `B000:6630`
  (ROM `0x3B6630`, `0x3C` bytes; the index word is the record number): +0 name, +2 HP (shop sort
  key), +4 graphics, +0x0B the other form of a transforming unit, **+0x10 price**. Ids from 193 on
  are mostly aliases of earlier records; the ☆ suits 237–246 have their own.
- **The ☆ stat boosts are in the cartridge.** Each ☆ suit is a separate, stronger record sharing its
  normal version's graphics: ガンダム☆ (237) HP 2000 vs ガンダム (16) 1300; ザク☆ (241) 1800 vs ザク (57)
  480; シャイニングガンダム☆ (243) 2000 vs (32) 1650; other stats raised too. The download only names
  the id, so serving 237–246 gives players exactly Bandai's boosted units; the server can't change
  stats.
- Parts: `B000:AB77` (ROM `0x3BAB77`), 4 bytes (name, price), ids 1–42.
- Characters: `B000:0000` (ROM `0x3B0000`), `0x46`-byte records, no price field.
- Default shop: `B000:A754` (ROM `0x3BA754`), 5-byte entries (kind, id, FF, price): 15 units and 29
  parts. `A000:AD1F` fills unit prices from +0x10 and part prices from the parts table (they match
  the entries' own prices).
- The downloaded list replaces it: `A000:A44D` writes 5-byte entries after a count word at SRAM
  `0x4082`. The shop (`A000:88E1`) sorts by kind, then HP, and prints the entry's price.
- A 683-byte body parsed; a 1003-byte one failed with error 6 ("データの読み込みに失敗"). Our list is 283 bytes.

## Check your cartridge

GB1 keeps the downloaded list in save memory (body at SRAM `0x79C`), so a cart that connected in
2000–2003 may still hold Bandai's last list, **with the real prices**. If you own Gather Beat
(especially a used copy), please dump its save and send it to us. GB2's list was read into RAM
(`0xE000`), so its saves probably don't keep it, but any GB2 save that bought WonderGate items is
still useful.

## Reaching it

Both need a cleared save, which the replays fake with valid checksums:

| | GB1 | GB2 |
|---|---|---|
| Slots | SRAM `0x5000/0x6000/0x7000` (4 KB) | SRAM `0x3000 + 0x1600·i` |
| Signature | `GV` at +0 | `MT` at +0, version `4` at +2 |
| Needed | backstage save (+3 = 0) with event flag 0x2D6 (+0x43A bit 6) | all-clear flag +0x13B7 bit 7 |
| Checksum | CRC-16 (table at `7000:1B98`) of +2..+0x7FD, stored at +0x7FE | same CRC over +0..+0x15FD, at +0x15FE |
| Menu | 通信 → ワンダーゲート (message "全面クリアのバックステージのデータが必要") | オプション → 通信 → ワンダーゲート |

Then: pick the save → phone number (標準設定 = "use standard number") → 接続する.

## Adapter: the dial reply must be long

GB1 treats a dial reply shorter than 24 bytes as no answer ("ワンダーゲートが応答しません", 99):
code at `8AE8:1A07` checks type 1, cmd `0B`, first param 0 and total length ≥ 0x18. wgcore now
pads the dial reply to 20 params (all other games still pass). The real adapter's call-state
record was evidently long.

## Downloads (HTTP/1.1, body read by Content-Length)

**GB1** `GET /download/ggene_gb/gggbgate.txt` (`wgg02.channel.or.jp`). Parser at ROM `0x3AA44D`
(`A000:A44D`), body in SRAM `0x79C`. One record per line, digits only:
`T III VVVV` = type, id, price. Type 1 → unit (shop kind 0), 3 → part (kind 1), 2 → character
(kind 2, only if not already owned, `7000:BAC6`). Lines that don't parse are skipped; a line `0`
ends the list.

**GB2** `GET /download/ggene_gb/gggbgate2.txt`. Parser at ROM `0x7AEF00` (`AC08:2F00`), body
in RAM `0xE000`. Same `T III VVVV` lines, grouped: all type-1 lines (units) first, then 2 (parts),
3 (pilots), 4 (scenarios). Any other first character ends the parse.

## Verified (headless, real game code)

With the replays' faked cleared saves and supply points poked into RAM/SRAM:

- GB2: the shop lists all 19 lines at the documented prices. Bought a unit (1200 deducted), a part,
  the three pilots (added to the roster) and both scenarios. Leaving the shop plays 逆シャア's opening
  (Char's speech). With the current stage set to a post-clear one, the next sortie is 地球衛星軌道3
  with the title "逆襲のシャア"; with 0xC1 set as if that were cleared, サイド3, "戦士再び". Without
  a purchase the same sortie goes to the map select.
- GB1: the shop lists all 28 lines at our prices; bought ガンタンク☆, イーゲル and ランバ・ラル (removed
  from the list once owned).
- Units show red in GB2 when the hangar is full (所有MS 120, as in the faked save).
