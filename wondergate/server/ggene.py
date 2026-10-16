"""SD Gundam G Generation Gather Beat 1 & 2: WonderGate shop lists, wgg02.channel.or.jp.

    GET /download/ggene_gb/gggbgate.txt    Gather Beat (1)
    GET /download/ggene_gb/gggbgate2.txt   Gather Beat 2

Both games read the body by Content-Length and parse lines "T" + 3-digit id +
4-digit price in supply points (補給ポイント). docs/wondergate/gather-beat.md has the
parsers, the id tables and the source of every entry and price.

GB2 (parser ROM 0x7AEF00): lines grouped by type in order 1 unit, 2 part, 3 pilot,
4 scenario (1-based); any other first character ends the list.
GB1 (parser ROM 0x3AA44D): 1 unit, 2 character (skipped if already owned), 3 part;
a line "0" ends the list, which replaces the backstage shop's stock.

GB2 is Bandai's lineup as players recorded it, at the recorded prices. GB1 is
Bandai's cumulative "ALL 配信データ" list (April 2001); its prices are lost, so the
GB1 prices below are OUR ESTIMATES (method in the docs), not Bandai's.
"""

# (type, id, price, name). Names as Bandai/players wrote them; ids from the ROM.
GB2 = [
    (1, 53, 1200, "ガトー専用ゲルググ"),
    (1, 148, 1500, "ライデン専用ゲルググ"),  # ROM name: J・ライデン専用ゲルググ
    (1, 138, 1500, "マツナガ専用ゲルググ"),
    (1, 88, 1500, "シャア専用ゲルググ"),
    (1, 89, 1000, "シャア専用ズゴック"),
    (1, 167, 6500, "α・アジール"),
    (1, 114, 4200, "ナイチンゲール"),
    (1, 168, 5000, "Ξガンダム"),
    (1, 169, 6000, "クロスボーンガンダムＸ１"),
    (1, 170, 6000, "クロスボーンガンダムＸ２"),
    (2, 9, 1000, "サイココントローラー"),
    (2, 10, 2000, "サイコフレーム"),
    (2, 15, 750, "ハイメガキャノン"),
    (2, 25, 500, "アップグレードパーツ"),
    (3, 75, 1500, "シン＝マツナガ"),
    (3, 111, 1500, "ノリス＝パッカード"),
    (3, 114, 1500, "サウス＝バニング"),
    (4, 1, 1000, "逆襲のシャア"),
    (4, 2, 1000, "戦士再び"),
]

# ESTIMATED prices: units and parts = 2 x the ROM catalogue price, rounded half up
# to 100 (GB2's distributed/in-game ratio, median 2.0), except the most expensive
# units (catalogue 2700 and up, GB2's ナイチンゲール tier) at 1.5 x, as GB2 discounted
# its biggest machines (1.41-1.53 x); characters 1500 (GB2's flat pilot price);
# ハイメガキャノン has no GB1 price, so GB2's 750 for the same part.
GB1 = [
    (1, 237, 4900, "ガンダム☆"),  # Bandai lists it twice; the ROM has one ☆ Gundam
    (1, 224, 2000, "ジム・ジャグラー"),  # ROM name: NT試験用ジム ジャグラー
    (1, 241, 4100, "ザク☆"),
    (1, 238, 4500, "ガンキャノン☆"),
    (1, 240, 3600, "旧ザク☆"),
    (1, 242, 4800, "ゲルググ☆"),
    (1, 239, 4500, "ガンタンク☆"),
    (1, 225, 1700, "エルメス2号機"),
    (1, 47, 2600, "イーゲル"),
    (1, 65, 2800, "ウォドム"),
    (1, 149, 2600, "Ez8改"),
    (1, 245, 4100, "ガンダムシュピーゲル☆"),
    (1, 246, 4100, "ライジングガンダム☆"),
    (1, 243, 4100, "シャイニングガンダム☆"),
    (1, 244, 4100, "クーロンガンダム☆"),
    (1, 34, 2200, "モビルフラット"),  # MS form (33 is the MA form)
    (2, 109, 1500, "チャップ・アデル"),
    (2, 104, 1500, "ベイト"),
    (2, 111, 1500, "モンシア"),
    (2, 87, 1500, "ランバ・ラル"),
    (2, 81, 1500, "マ・クベ"),
    (2, 62, 1500, "コレン・ナンダー"),
    (2, 76, 1500, "ノリス"),
    (2, 34, 1500, "ハマーン"),
    (2, 86, 1500, "ララァ"),
    (3, 19, 200, "角飾り"),
    (3, 14, 1000, "シュツルムブースター"),
    (3, 38, 750, "ハイメガキャノン"),
]


def text(items, end=""):
    lines = [f"{t}{i:03d}{p:04d}" for t, i, p, _ in items] + ([end] if end else [])
    return "".join(line + "\r\n" for line in lines)


assert [t for t, *_ in GB2] == sorted(t for t, *_ in GB2), "GB2 lines must be grouped by type"

FILES = {
    "/download/ggene_gb/gggbgate.txt": ("gb1", text(GB1, end="0")),
    "/download/ggene_gb/gggbgate2.txt": ("gb2", text(GB2)),
}


def handle(path):
    game, data = FILES[path]
    return 200, "text/plain", data.encode(), f"ggene {game}: {data.count(chr(10))} lines"
