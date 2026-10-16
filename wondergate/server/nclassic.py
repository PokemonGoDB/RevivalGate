"""Wonder Classic: nclassic.wgg.channel.or.jp port 10000 (binary, server speaks first). WIP.
See docs/wondergate/wonder-classic.md.

Observed so far (library at ROM 0x361460..0x362060):
  server -> "WSR\\r" + status(1) + count(1) + count records    (hello, count 0)
  client -> "WGS\\r" + 10 bytes                                  (request)
  server -> "WSR\\r" + status + count + records                  (reply)
status 0 = ok; record size depends on the request type (table at ROM A000:0382).

Probe hooks (environment, for reverse-engineering): NC_MARK=1|tens|units fills
the type-6 bulletin with markers, NC_BULL_PATCH=OFF:text patches it,
NC_COURSE_MARK=1 marks types 5/20/21, NC_ZERO=1 zero-fills them.
"""
import asyncio
import json
import pathlib

DB = pathlib.Path(__file__).resolve().parent.parent / "data" / "nclassic.json"


def load():
    return json.loads(DB.read_text()) if DB.exists() else {"next": 1, "members": {}, "scores": {}}


def save(db):
    DB.parent.mkdir(exist_ok=True)
    DB.write_text(json.dumps(db, indent=1))


def log(msg):
    import datetime
    print(datetime.datetime.now().strftime("%H:%M:%S"), "nclassic:", msg, flush=True)


# Record size per request type (ROM A000:0382); 0xFFFF = no records allowed.
SIZES = [0x1F, 0x16, 0x0E, 0x0E, 0x12, 0x111, 0xCC, 0x14, 0x26, 0x14, 0x2E, 0x45, 0x14,
         0x08, 0x24, 0x29, 0x1B, 0x10, 0x0E, 0x20, 0x262, 0x480, 0x08]


def bulletin(size, today=None):
    """Type 6: this month's Net Tour round (body after WSD\\r): round number
    (word +0), qualifier cutoff rank (word +6), entry fee in yen (word +10),
    start and end dates as yyyymmdd text (+168, +176; shown as yy/mm/dd), course id (+0x96)."""
    import calendar
    import datetime
    today = today or datetime.date.today()
    body = bytearray(size - 4)
    rnd = tour_round(today)
    last = calendar.monthrange(today.year, today.month)[1]
    body[0:2] = rnd.to_bytes(2, "little")
    body[6:8] = (100).to_bytes(2, "little")
    body[10:12] = (0).to_bytes(2, "little")
    body[168:176] = today.strftime("%Y%m01").encode()
    body[176:184] = today.replace(day=last).strftime("%Y%m%d").encode()
    body[0x96] = course_of(today)
    import os
    for patch in filter(None, os.environ.get("NC_BULL_PATCH", "").split(",")):
        off, _, text = patch.partition(":")       # probe hook: OFF:ascii
        body[int(off):int(off) + len(text)] = text.encode()
    return b"WSD\r" + bytes(body)


def course_of(day):
    return day.month % 4 + 1


def tour_round(day=None):
    import datetime
    day = day or datetime.date.today()
    return max((day.year - 2026) * 12 + day.month - 9, 1)      # Oct 2026 = round 1


# 新製品開発情報 (type 22): one new product a month. Body = [club set, ball,
# glove, shoes] item kinds, 1 = パワー, 2 = コントロール; the game shows and
# unlocks the first record ("パワークラブセットを てにいれた！").
PRODUCTS = ["01000000", "00010000", "00000100", "00000001",
            "02000000", "00020000", "00000200", "00000002"]


def new_product(day=None):
    return bytes.fromhex(PRODUCTS[(tour_round(day) - 1) % len(PRODUCTS)])


def week_conditions(day):
    """This week's weather and wind for the 18 holes, as the manual describes the
    Net Tour: they change every Monday, and the final (from the round's fourth
    Monday) is played in harder conditions. Fixed per week (SHA-256 of the month
    and week, so the Worker port gives the same bytes), so every player gets the
    same round. Returns (rain, wind strength in m, wind direction) per hole."""
    import datetime
    import hashlib
    monday = day - datetime.timedelta(days=day.weekday())
    week = max(0, (monday - day.replace(day=1)).days // 7 + 1)   # 0 = days before the first Monday
    final = week >= 4
    seed = f"wclassic {day:%Y-%m} week {week}"
    a = hashlib.sha256((seed + " a").encode()).digest()
    b = hashlib.sha256((seed + " b").encode()).digest()
    rain = [a[31] < (128 if final else 64)] * 18                 # 50% / 25% of weeks
    base, spread = (6, 9) if final else (0, 7)                   # 6-14 m / 0-6 m
    strength = [min(15, base + a[h] % spread) for h in range(18)]
    prevailing = a[30] % 16
    direction = [(prevailing + (-1, 0, 0, 1)[b[h] % 4]) % 16 for h in range(18)]
    return rain, strength, direction


def net_round(size, day=None):
    """Type 5, the Net Tour round (parser 6000:4F8E, unpacked into the tour save
    at SRAM 0xACF). Body:
      +0     round (word; 0 = no tour: the game menu then has no ネットツアー)
      +2..   5 words, then a word list from +0xC ending in 0, 8 words at +0xB2
      +0xB2  start date, +0xBA end date, "yyyymmdd" text (the entry deadline)
      +0xC2  18 hole indexes, each a built-in course * 18 + hole (table 6000:50FE)
      +0xD4  18 bits, MSB first: rain on that hole
      +0xD7  18 nibbles, high first: wind strength in m (0-15)
      +0xE0  18 nibbles: wind direction, 16 steps of 22.5 deg clockwise from
             straight up the hole screen (the parser stores 1 << n)
      +0xE9  18 (x, y) byte pairs: pin position; 0, 0 = the hole's default pin
    We play one built-in course's 18 holes; the weather and wind change every
    Monday (week_conditions)."""
    import calendar
    import datetime
    import os
    day = day or datetime.date.today()
    body = bytearray(size - 4)
    body[0:2] = tour_round(day).to_bytes(2, "little")
    last = calendar.monthrange(day.year, day.month)[1]
    body[0xB2:0xBA] = day.strftime("%Y%m01").encode()
    body[0xBA:0xC2] = day.replace(day=last).strftime("%Y%m%d").encode()
    rain, strength, direction = week_conditions(day)
    for h in range(18):
        if rain[h]:
            body[0xD4 + h // 8] |= 0x80 >> (h % 8)
        shift = 0 if h % 2 else 4
        body[0xD7 + h // 2] |= strength[h] << shift
        body[0xE0 + h // 2] |= direction[h] << shift
    for patch in filter(None, os.environ.get("NC_ROUND_PATCH", "").split(",")):
        off, _, hexbytes = patch.partition(":")         # probe: OFF:hexbytes
        body[int(off, 16):int(off, 16) + len(hexbytes) // 2] = bytes.fromhex(hexbytes)
    course = int(os.environ.get("NC_ROUND_COURSE", "0"))
    for h in range(18):
        body[0xC2 + h] = course * 18 + h
    return b"WSD\r" + bytes(body)


def standings(db, rnd):
    """[(member id, score)] of a round, best first (scores are strokes over par)."""
    rows = db["scores"].get(str(rnd), {})
    return sorted(rows.items(), key=lambda kv: (kv[1], kv[0]))


def signed(v):
    return (v & 0xFFFF).to_bytes(2, "little")


def ranking_rows(kind, req, db):
    """Type 8: this round (params round(4) 00 00 start count), name +0, score +0x20.
    Type 11: previous winners (params round(4) start count), name +0,
    prefecture +0x10, score +0x37. Type 14: past rounds, round +2, name +6,
    score +0x16. Names are the member card's handle (8 two-byte characters)."""
    p = req[5:]
    size = SIZES[kind]
    out = []
    if kind in (8, 11):
        rnd = int.from_bytes(p[0:4], "little")
        at = 6 if kind == 8 else 4
        start = int.from_bytes(p[at:at + 2], "little") or 1
        count = int.from_bytes(p[at + 2:at + 4], "little") or 32
        for uid, score in standings(db, rnd)[start - 1:start - 1 + count]:
            m = db["members"].get(uid, {})
            body = bytearray(size - 4)
            body[0:16] = bytes.fromhex(m.get("handle", "00" * 16))
            if kind == 8:
                body[0x20:0x22] = signed(score)
            else:
                body[0x10] = m.get("pref", 0)
                body[0x37:0x39] = signed(score)
            out.append(b"WSD\r" + bytes(body))
    else:
        rows = [(score, rnd, uid) for rnd in db["scores"] if int(rnd) < tour_round()
                for uid, score in db["scores"][rnd].items()]
        for score, rnd, uid in sorted(rows)[:32]:
            m = db["members"].get(uid, {})
            body = bytearray(size - 4)
            body[2:4] = int(rnd).to_bytes(2, "little")
            body[6:22] = bytes.fromhex(m.get("handle", "00" * 16))
            body[0x16:0x18] = signed(score)
            out.append(b"WSD\r" + bytes(body))
    return out


def answer(req, session=None):
    """Reply to one client request. `session` holds the member ID from the
    connection's "WGS\r" login."""
    session = session if session is not None else {}
    if req.startswith(b"WGS\r"):
        session["user"] = req[4:14].decode("latin-1").strip("\0")
    if req.startswith(b"WSC\r") and len(req) > 4 and req[4] < len(SIZES):
        kind = req[4]
        size = SIZES[kind]
        if kind == 1:
            # Member-card registration: the new member's 10-byte ID (sent back in
            # every later "WGS\r" login) and 8 more bytes. Card: handle +0
            # (8 two-byte characters), name +16, postal code +46, prefecture +54.
            db = load()
            uid = f"WC{db['next']:08d}"
            db["next"] += 1
            card = req[5:]
            db["members"][uid] = {"handle": card[0:16].ljust(16, b"\0").hex(),
                                  "pref": card[54] if len(card) > 54 else 0}
            save(db)
            log(f"WSC type 1 (register): new member {uid}")
            return reply(0, [b"WSD\r" + uid.encode() + b"PASSWORD"], size)
        if kind == 9:
            # Net Tour entry (after the type-4 clock): round(4), 2 bytes, score
            # (signed word, strokes over par). An empty reply completes it.
            rnd = int.from_bytes(req[5:9], "little")
            score = int.from_bytes(req[11:13], "little", signed=True) if len(req) >= 13 else 0
            uid = session.get("user", "")
            db = load()
            best = db["scores"].setdefault(str(rnd), {})
            if uid not in best or score < best[uid]:
                best[uid] = score
            save(db)
            log(f"WSC type 9: entry round {rnd}, {uid} {score:+d}")
            return reply()
        if kind == 6 and not __import__("os").environ.get("NC_MARK"):
            log("WSC type 6: tour bulletin")
            return reply(0, [bulletin(size)], size)
        if kind == 6 and __import__("os").environ.get("NC_MARK"):
            mode = __import__("os").environ["NC_MARK"]
            body = bytes((48 + (i // 10) % 10) if mode == "tens" else (48 + i % 10) if mode == "units" else i
                         for i in range(size - 4))
            return reply(0, [b"WSD\r" + body], size)
        if kind == 5 and not any(__import__("os").environ.get(k) for k in ("NC_ZERO", "NC_COURSE_MARK", "NC_REC", "NC_PROBE")):
            log("WSC type 5: Net Tour round")
            return reply(0, [net_round(size)], size)
        if kind in (5, 20, 21) and __import__("os").environ.get("NC_ZERO"):
            body = bytearray(size - 4)
            if kind == 5 and __import__("os").environ.get("NC_COURSE"):
                body[0x7A] = body[0x96] = int(__import__("os").environ["NC_COURSE"])   # probe: course id only
            return reply(0, [b"WSD\r" + bytes(body)], size)
        if kind == 5 and __import__("os").environ.get("NC_COURSE_MARK"):
            body = bytes((i + 1) & 0xFF for i in range(size - 4))
            return reply(0, [b"WSD\r" + body], size)
        if kind in (20, 21) and __import__("os").environ.get("NC_COURSE_MARK"):
            # Probe: a recognisable pattern to find where course data lands.
            body = bytes((kind << 4 | (i // 256)) & 0xFF if i % 2 else i & 0xFF for i in range(size - 4))
            return reply(0, [b"WSD\r" + body], size)
        recs = dict(x.split("=", 1) for x in filter(None, __import__("os").environ.get("NC_REC", "").split(",")))
        if str(kind) in recs:
            # Probe: NC_REC=type=hexbody|hexbody,... answers exactly these bodies.
            bodies = [bytes.fromhex(h) for h in recs[str(kind)].split("|")]
            log(f"WSC type {kind}: probe records {[b.hex() for b in bodies]}")
            return reply(0, [b"WSD\r" + b for b in bodies], size)
        probe = dict(x.split(":") for x in filter(None, __import__("os").environ.get("NC_PROBE", "").split(",")))
        if str(kind) in probe:
            # Probe: NC_PROBE=type:count[,...] answers count marker records
            # (body byte i = record number * 0x20 + i + 1).
            n = int(probe[str(kind)])
            recs = [b"WSD\r" + bytes((r * 0x20 + i + 1) & 0xFF for i in range(size - 4)) for r in range(n)]
            log(f"WSC type {kind}: probe, {n} marker records")
            return reply(0, recs, size)
        if kind == 4:
            # Server clock, yyyymmddhhmmss (JST), checked against the tour dates
            # before an entry (a past date gives すでに しめきりが すぎていました 707).
            import datetime
            now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
            log(f"WSC type 4: clock {now:%Y%m%d%H%M%S}")
            return reply(0, [b"WSD\r" + now.strftime("%Y%m%d%H%M%S").encode()], size)
        if kind == 22:
            item = new_product()
            log(f"WSC type 22: new product {item.hex()}")
            return reply(0, [b"WSD\r" + item], size)
        if kind == 13:
            # 前回の入賞者: the previous round (word); round 0 makes the game say
            # だい1かいのネットツアーが しゅうりょうしていません. It then asks type 11
            # with these 4 bytes + start + count.
            prev = tour_round() - 1
            log(f"WSC type 13: previous round {prev}")
            return reply(0, [b"WSD\r" + prev.to_bytes(2, "little") + b"\0\0"], size)
        if kind == 18:
            # スーパースーパーショット エントリー: the 0x25-byte shot header
            # (packed from the super-shot record at SRAM 0xD6F, 6000:534E):
            # kind, course*18+hole, conditions and four shot-parameter blocks.
            # Viewers re-simulate the shot from it. An empty reply completes it.
            db = load()
            shots = db.setdefault("shots", [])
            sid = len(shots) + 1
            shots.append({"id": sid, "user": session.get("user", ""), "header": req[5:5 + 0x25].hex()})
            save(db)
            log(f"WSC type 18: super shot {sid} from {session.get('user', '')}, kind {req[5]}")
            return reply()
        if kind == 16:
            # Super-shot list (6000:51CF): word 1 (0 ends the list), 4-byte ID
            # (sent back with type 15), 16 bytes shown in the list (the
            # uploader's handle), 1 byte. Up to 20, newest first.
            db = load()
            rows = []
            for shot in reversed(db.get("shots", [])[-20:]):
                handle = bytes.fromhex(db["members"].get(shot["user"], {}).get("handle", "00" * 16))
                body = b"\1\0" + shot["id"].to_bytes(4, "little") + handle[:16].ljust(16, b"\0") + bytes(1)
                rows.append(b"WSD\r" + body)
            log(f"WSC type 16: {len(rows)} super shots")
            return reply(0, rows, size)
        if kind == 15:
            # One super shot (params: its 4-byte ID): the uploaded header.
            sid = int.from_bytes(req[5:9], "little")
            shot = next((x for x in load().get("shots", []) if x["id"] == sid), None)
            log(f"WSC type 15: super shot {sid}: {'found' if shot else 'missing'}")
            if not shot:
                return reply()
            return reply(0, [b"WSD\r" + bytes.fromhex(shot["header"])], size)
        if kind == 7:
            # あなたの順位 (params round(4)): rank word +2 (shown as "18位"); +0
            # is not shown (we put the number of entrants there).
            rnd = int.from_bytes(req[5:9], "little")
            table = [uid for uid, _ in standings(load(), rnd)]
            uid = session.get("user", "")
            rank = table.index(uid) + 1 if uid in table else 0
            log(f"WSC type 7: {uid} rank {rank} of {len(table)} in round {rnd}")
            body = len(table).to_bytes(2, "little") + rank.to_bytes(2, "little")
            return reply(0, [b"WSD\r" + body], size)
        if kind in (8, 11, 14):
            rows = ranking_rows(kind, req, load())
            log(f"WSC type {kind}: ranking, {len(rows)} rows")
            return reply(0, rows, size)
        # Other types (20/21 スーパースーパーショット replays) are not rebuilt:
        # answer an empty list.
        log(f"WSC type {kind} ({size}-byte records): not implemented, empty reply")
        return reply()
    return reply()


def reply(status=0, records=(), size=0):
    return b"WSR\r" + bytes([status, len(records)]) + b"".join(r.ljust(size, b"\0")[:size] for r in records)


async def conn(reader, writer):
    log("connect")
    session = {}
    writer.write(reply())
    await writer.drain()
    try:
        while True:
            data = await asyncio.wait_for(reader.read(4096), 60)
            if not data:
                break
            # A request arrives in adapter-sized chunks: gather until quiet.
            while True:
                try:
                    more = await asyncio.wait_for(reader.read(4096), 0.5)
                except asyncio.TimeoutError:
                    break
                if not more:
                    break
                data += more
            log(f"request {len(data)} bytes {data[:16]!r}...")
            writer.write(answer(data, session))
            await writer.drain()
    except (asyncio.TimeoutError, ConnectionError):
        pass
    log("closed")
    writer.close()
