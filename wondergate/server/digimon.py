"""Bandai's Digimon WonderGate ladder, for two games that share one protocol:

    Digimon Adventure 02 D1 Tamers (2000): the net D-1 Grand Prix
        POST http://digi4.wgg.channel.or.jp/cgi-bin/dm4<name>.cgi    UA SWAN/1.0 DIGIMON-04
    Digimon Tamers Brave Tamer (2001)
        POST http://digi_b.wgg.channel.or.jp/cgi-bin/dmB<name>.cgi   UA SWAN/1.0 DIGIMON-0B

Binary bodies; the reply body's first byte is a result code. The games differ
only in the size of a Digimon record and in the battle reply's header (see
docs/wondergate/digimon-d1-tamers.md and docs/wondergate/brave-tamer.md):

    profile (26 bytes)  ID[8] name[8] region party-size digimon-id[3] (LE words) word
    block               profile + 3 Digimon records (the party)
                        D1 Tamers: 3 x 39 = 143 bytes; Brave Tamer: 3 x 55 = 191 bytes

    signup   name[8] region            -> 0 ID[8]     (1 or FF = handle taken)
    login    ID[8] command             -> 0 message   (game text, FF-terminated)
    rankbtl  block                     -> result ...  0 = battle follows:
             header profile(26) party my-rank opp-rank (LE words)
             header: D1 Tamers stage seed; Brave Tamer seed
                                          1 = another tamer is battling, 2 = you are #1
    rankdl   ID[8]                     -> count profile[8]   (ranking, 0xD0 bytes)
    idupld   block                     -> 0 (1 = handle taken)
    idsrch   ID[8] key[8]              -> count profile[8]   (0 = not found)
    idbtl    ID[8] target-ID[8] word   -> 0 header profile party 0 0  (1 = not found)

The battle itself is simulated by the cartridge from the two parties, so the
server only decides who moves up the ladder: the stronger party takes the
higher rank. IDs are eight digits, which the games' text encoding stores as
bytes 0-9. Each game keeps its own players and ladder (data/digimon*.json).
"""
import json
import pathlib
import random
import time

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
PROFILE = 26


def _word(rec, k):
    return int.from_bytes(rec[k:k + 2], "little")


class Game:
    def __init__(self, prefix, db, record, header, strength):
        self.prefix, self.db, self.record = prefix, DATA / db, record
        self.block = PROFILE + 3 * record
        self.header = header        # () -> bytes between the result code and the profile
        self.strength = strength    # one Digimon record -> number

    def power(self, block):
        total = 0
        for i in range(3):
            rec = block[PROFILE + self.record * i: PROFILE + self.record * (i + 1)]
            if len(rec) == self.record and rec[0] != 0xFF and rec[1:3] != b"\xff\xff":
                total += self.strength(rec)
        return total


GAMES = {
    # D1 Tamers record (39 bytes): name +5, HP +11, attack +13, P +15, speed +17 (byte), D +19.
    # Battle header: stage (0) then seed.
    "dm4": Game("dm4", "digimon.json", 39,
                lambda: bytes([0, random.randrange(256)]),
                lambda r: _word(r, 11) + _word(r, 19) + 4 * (_word(r, 13) + _word(r, 15) + r[17])),
    # Brave Tamer record (55 bytes, built by C9F7:3F97): flag (1, FF = empty slot), species
    # word, name[6] +4, stat caps HP +0x0A, DP +0x0C, AP +0x0E, PP +0x10 (words), SP +0x12.
    # Battle header: one byte, the battle's random seed (-> DS:2CF0).
    "dmB": Game("dmB", "digimon-b.json", 55,
                lambda: bytes([random.randrange(256)]),
                lambda r: _word(r, 0x0A) + _word(r, 0x0C) + 4 * (_word(r, 0x0E) + _word(r, 0x10) + r[0x12])),
}

# Game text encoding: digits 0-9 are bytes 0-9, then hiragana and katakana in
# gojuon order (with the voiced kana after each set), FD = space, FF = end.
_HIRA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん" \
        "がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ"
_KATA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン" \
        "ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ"
CODE = {c: 0x0A + i for i, c in enumerate(_HIRA)}
CODE.update({c: 0x5A + i for i, c in enumerate(_KATA)})
CODE.update({str(d): d for d in range(10)})
CODE.update({"ー": 0xAB, " ": 0xFD, "\n": 0xFE, "ゃ": 0x56, "ゅ": 0x57, "ょ": 0x58, "っ": 0x59,
             "ィ": 0xA2, "ェ": 0xA4, "ュ": 0xA7, "ョ": 0xA8, "ッ": 0xA9,
             "D": 0xB7, "-": 0xEB, "！": 0xAC, "？": 0xAD, "、": 0xB0, "。": 0xB1})

# Our server's news (login reply), not Bandai's: shown under "データ" / before the ranking.
NEWS = {
    "dm4": "ワンダーゲート サーバー\nふっかつ！\nネット D-1 グランプリ\nかいさいちゅう。",
    "dmB": "ワンダーゲート サーバー\nふっかつ！\nランキングバトル\nかいさいちゅう。",
}


def encode(text):
    return bytes(CODE[c] for c in text if c in CODE) + b"\xff"


def load(game):
    if game.db.exists():
        return json.loads(game.db.read_text())
    return {"players": {}, "ranking": [], "next_id": 1}


def save(game, db):
    game.db.parent.mkdir(exist_ok=True)
    game.db.write_text(json.dumps(db, indent=1))


def hexid(b):
    return bytes(b[:8]).hex()


def profile(db, pid, rank=0):
    p = db["players"][pid]
    prof = bytearray(bytes.fromhex(p["block"])[:PROFILE]) if p.get("block") else \
        bytearray(bytes.fromhex(pid) + bytes.fromhex(p["name"]) + bytes([p["region"], 0]) + b"\xff" * 6 + b"\0\0")
    prof[0x18:0x1A] = rank.to_bytes(2, "little")
    return bytes(prof)


def rank_of(db, pid):
    return db["ranking"].index(pid) + 1 if pid in db["ranking"] else 0


def listing(db, ids):
    ids = ids[:8]
    body = b"".join(profile(db, pid, rank_of(db, pid)) for pid in ids)
    return bytes([len(ids)]) + body.ljust(PROFILE * 8, b"\0")


def hall_of_fame(db):
    """Brave Tamer's hall of fame (でんどう): each week's ladder leader is enshrined.
    Bandai's list is lost; ours starts empty and fills week by week. The current
    leader is shown too, so the list is never empty once someone is ranked.
    Newest first, at most 8 (the reply's size)."""
    week = time.strftime("%G-W%V")
    hall = db.setdefault("hall", [])            # [{"id", "week"}], oldest first
    ladder = db["ranking"]
    if ladder and db.get("leader_week") != week:
        # A new week: last week's standing leader goes into the hall.
        if db.get("leader") and db["leader"] in db["players"]:
            hall.append({"id": db["leader"], "week": db.get("leader_week")})
        db["leader_week"] = week
    if ladder:
        db["leader"] = ladder[0]
    ids = [ladder[0]] if ladder else []
    for h in reversed(hall):
        if h["id"] not in ids and db["players"].get(h["id"], {}).get("block"):
            ids.append(h["id"])
    return ids[:8]


def battle(game, db, opp, my_rank, opp_rank, result=0):
    block = bytes.fromhex(db["players"][opp]["block"])
    return (bytes([result]) + game.header() + profile(db, opp, opp_rank)
            + block[PROFILE:game.block] + my_rank.to_bytes(2, "little") + opp_rank.to_bytes(2, "little"))


def handle(path, body):
    cgi = path.rsplit("/", 1)[-1]
    game = GAMES.get(cgi[:3])
    if not game:
        return 404, "text/plain", b"not found\r\n", f"digimon: unknown game {cgi}"
    name, tag = cgi[3:], "digimon" if game.prefix == "dm4" else f"digimon {game.prefix}"
    db = load(game)
    players = db["players"]
    pid = hexid(body)
    if name == "signup.cgi" and len(body) >= 9:
        handle_name = body[:8].hex()
        if any(p["name"] == handle_name for p in players.values()):
            return reply(b"\x01", f"{tag} signup: handle {handle_name} taken")
        new = bytes(int(d) for d in f"{db['next_id']:08d}")
        db["next_id"] += 1
        players[new.hex()] = {"name": handle_name, "region": body[8], "block": None,
                              "joined": time.strftime("%Y-%m-%d %H:%M:%S")}
        save(game, db)
        return reply(b"\x00" + new, f"{tag} signup: {handle_name} -> ID {new.hex()}")
    if name == "login.cgi":
        known = pid in players
        return reply(b"\x00" + encode(NEWS[game.prefix]),
                     f"{tag} login {pid} command {body[8:9].hex()} ({'known' if known else 'unknown'})")
    if name == "rankbtl.cgi" and len(body) >= game.block:
        if pid not in players:
            return reply(b"\x01", f"{tag} rankbtl: unknown ID {pid}")
        players[pid]["block"] = body[:game.block].hex()
        ladder = db["ranking"]
        newcomer = pid not in ladder
        if newcomer:
            ladder.append(pid)
        me = ladder.index(pid)
        if me == 0:
            save(game, db)
            return reply(b"\x02", f"{tag} rankbtl: {pid} is #1, party updated")
        opp = ladder[me - 1]
        mine, theirs = game.power(body), game.power(bytes.fromhex(players[opp]["block"]))
        # Ranks are 0-based on the wire; the challenger's 0 reads "ランクがい" (unranked).
        out = battle(game, db, opp, 0 if newcomer else me, me - 1)
        if mine > theirs:
            ladder[me - 1], ladder[me] = pid, opp
        save(game, db)
        return reply(out, f"{tag} rankbtl: {pid} (#{me + 1}, {mine}) vs {opp} (#{me}, {theirs}) -> "
                          f"{'win' if mine > theirs else 'lose'}")
    if name == "rankdl.cgi":
        return reply(listing(db, db["ranking"]), f"{tag} rankdl: {len(db['ranking'])} ranked")
    if name == "idupld.cgi" and len(body) >= game.block:
        if pid not in players:
            return reply(b"\x01", f"{tag} idupld: unknown ID {pid}")
        players[pid]["block"] = body[:game.block].hex()
        save(game, db)
        return reply(b"\x00", f"{tag} idupld: {pid} party stored")
    if name == "idsrch.cgi" and len(body) >= 16:
        key = body[8:16].hex()
        if game.prefix == "dmB" and key == "fd" * 8:
            # Brave Tamer's でんどうバトル searches with a blank key: the hall of fame.
            hall = hall_of_fame(db)
            save(game, db)
            return reply(listing(db, hall) if hall else b"\x00", f"{tag} idsrch hall of fame: {len(hall)}")
        hits = [k for k, p in players.items() if p.get("block") and (k == key or p["name"] == key)]
        return reply(listing(db, hits) if hits else b"\x00", f"{tag} idsrch {key}: {len(hits)} found")
    if name == "idbtl.cgi" and len(body) >= 16:
        target = body[8:16].hex()
        if not players.get(target, {}).get("block"):
            return reply(b"\x01", f"{tag} idbtl: {target} not found")
        return reply(battle(game, db, target, 0, 0), f"{tag} idbtl: {pid} vs {target}")
    return 404, "text/plain", b"not found\r\n", f"{tag}: unhandled {cgi} ({len(body)} bytes)"


def reply(data, note):
    return 200, "application/octet-stream", data, note
