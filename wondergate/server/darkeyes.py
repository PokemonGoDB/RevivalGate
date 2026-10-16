"""Dark Eyes: Battle Gate (Bandai 2001): online battles on battleg1.dark-eyes.com.

    POST /cgi-bin/dark/nph-<name>.cgi      fields in X-SWAN-<NAME> headers (ROM 0x359380..)
Every reply carries <GROUP>-RETCD. Lines end in a bare LF: the game reads a
number up to a space or LF, so "0\\r" would parse as 0xDD (the original nph
scripts printed "\\n").

Flow (title → 対戦 → ワンダーゲート → マッチング実行 → party → サーバー接続):
    nph-login     SRVC-ID REQ-SERIAL          -> SRVC-RETCD SRVC-TIME
    nph-account   ACNT-ID ACNT-SID ACNT-CMD   -> ACNT-RETCD [body: message]   (prepaid "service")
    nph-reqmatch  MTCH-ID NAME LVL PASS RETRY -> MTCH-RETCD 0/1 = keep polling (POLINT, TIMEOUT
                  in seconds), 9 = error, 2 = matched: MTCH-ID NAME LVL (opponent),
                  SEED, MATCH (side), HOST, PATH (where nph-match lives), ACOUNT BCOUNT COUNT
    nph-match     MTCH-ID OID NAME CMD + body -> cmd 0 = post my battle data (RETCD 0 ok, 1 retry)
                                                 cmd 1 = fetch the opponent's (2 + body, 1 = not yet)
                                                 cmd 2 = post my turn (3)
                                                 cmd 3 = fetch the opponent's turn (5 + body, 4 = not yet)
The server pairs two players polling reqmatch (same PASS, if one is set) and
relays party and turn data between them (two queues per side); the battles run in the cartridges.

Story mode, a guild's 傭兵の登録と雇用 (mercenaries) and 世界情勢 (world market):
    nph-upmrcnry  MCUP-ID PAY NAME CLASS LVL EXP STR DEX INT ATR EM RY SK0-3 IT0-3 HP
                  -> MCUP-RETCD, MCUP-MID (8 chars; the cart keeps it at SRAM 0x6070)
    nph-listmrcnry MCDL-ID CLASS LVL -> MCDL-RETCD, MCDL-NO n, body n x 49-byte records (MERC)
    nph-downmrcnry MCDN-ID MID       -> MCDN-RETCD (the cart copies the record from the list)
    nph-worldinfo WINF-ID NAME MID MRID0 MRID1 + body (market block etc.) -> WINF-RETCD + body
Errors: RETCD != 0 with an SJIS message as the body. Data in data/darkeyes.json.
See docs/wondergate/dark-eyes.md.
"""
import datetime
import json
import pathlib
import random
import struct
import threading
import time
import urllib.parse

DB = pathlib.Path(__file__).resolve().parent.parent / "data" / "darkeyes.json"
MAX_LIST = 40          # the cart's list arrays hold 40 entries (SRAM 0x3DA9, 40 x 47 bytes)
MARKET = 0x3C0         # 15 towns x 64 goods, price level per byte; bit 7 = changed locally
# A list record (parser 5900:2AC1) -> the cart's 47-byte roster record:
#   +0 year (word)  +2 month  +3 day  (shown as the registration date)
#   +4 MID (8 chars)  +12 PAY (word)  +14 name (16, space padded)
#   +30.. the uploaded fields below, one byte each, then HP (word)
STATS = ["class", "lvl", "exp", "str", "dex", "int", "atr", "em", "ry",
         "sk0", "sk1", "sk2", "sk3", "it0", "it1", "it2", "it3"]


def load():
    return json.loads(DB.read_text()) if DB.exists() else {"mercs": {}, "next": 1, "market": None, "earned": {}}


def save(db):
    DB.parent.mkdir(exist_ok=True)
    DB.write_text(json.dumps(db, indent=1, ensure_ascii=False))


def num(h, key, default=0):
    try:
        return int(h.get(key, default))
    except ValueError:
        return default


def sjis(text):
    return text.encode("cp932")


# Who is on each connection: worldinfo (sent before an upload in every session)
# carries the player's ID and hero name; uploads don't. Keyed by client address.
SESSIONS = {}


def owner_of(h):
    return SESSIONS.get(h.get("x-wg-peer", ""), "")


def owner_name(owner):
    """The hero name part of an owner key, as cartridge bytes (half-width kana)."""
    return urllib.parse.unquote_to_bytes(owner.partition("/")[2]).hex() if owner else ""


def drop_owned(db, owner, keep=None):
    """The cart holds one registered mercenary (MID at SRAM 0x6070): any other
    one from the same owner is stale (withdrawn or replaced)."""
    if not owner:
        return []
    gone = [mid for mid, m in db["mercs"].items() if m.get("owner_key") == owner and mid != keep]
    for mid in gone:
        del db["mercs"][mid]
    return gone


def upmrcnry(h):
    db = load()
    owner = owner_of(h)
    drop_owned(db, owner)
    mid = f"{db['next']:08d}"
    db["next"] += 1
    name = urllib.parse.unquote_to_bytes(h.get("x-swan-mcup-name", "")).split(b"\0")[0]
    today = datetime.date.today()
    db["mercs"][mid] = {"owner": h.get("x-swan-mcup-id", ""), "owner_key": owner, "owner_name": owner_name(owner), "pay": num(h, "x-swan-mcup-pay"),
                        "name": name.hex(), "hp": num(h, "x-swan-mcup-hp"),
                        "date": [today.year, today.month, today.day],
                        **{k: num(h, "x-swan-mcup-" + k) for k in STATS}}
    save(db)
    return ({"X-SWAN-MCUP-RETCD": "0", "X-SWAN-MCUP-MID": mid}, b"",
            f"upmrcnry: registered {mid} (class {db['mercs'][mid]['class']}, lv {db['mercs'][mid]['lvl']}, "
            f"pay {db['mercs'][mid]['pay']})")


def record(mid, m):
    y, mo, d = m["date"]
    name = bytes.fromhex(m["name"])[:16].ljust(16, b" ")
    return (struct.pack("<HBB", y, mo, d) + mid.encode()[:8].ljust(8, b"0") + struct.pack("<H", m["pay"])
            + name + bytes(m[k] & 0xFF for k in STATS) + struct.pack("<H", m["hp"] & 0xFFFF))


def listmrcnry(h):
    db = load()
    cls, lvl = num(h, "x-swan-mcdl-class", -1), num(h, "x-swan-mcdl-lvl", 1)
    found = sorted(((mid, m) for mid, m in db["mercs"].items() if m["class"] == cls),
                   key=lambda e: (abs(e[1]["lvl"] - lvl), e[0]))[:MAX_LIST]
    if not found:
        # MCDL-NO 0 makes the cart say 選択したクラスの傭兵が1人もいません; it wants a body.
        return {"X-SWAN-MCDL-RETCD": "0", "X-SWAN-MCDL-NO": "0"}, b"\0", f"listmrcnry: class {cls}: none"
    body = b"".join(record(mid, m) for mid, m in found)
    return ({"X-SWAN-MCDL-RETCD": "0", "X-SWAN-MCDL-NO": str(len(found))}, body,
            f"listmrcnry: class {cls} lv {lvl}: {len(found)}")


def downmrcnry(h):
    db = load()
    mid = h.get("x-swan-mcdn-mid", "")[:8]
    m = db["mercs"].get(mid)
    if not m:
        return {"X-SWAN-MCDN-RETCD": "1"}, sjis("その傭兵は登録を解除されました"), f"downmrcnry {mid}: gone"
    m["hired"] = m.get("hired", 0) + 1
    db["earned"][mid] = db["earned"].get(mid, 0) + m["pay"]
    save(db)
    return {"X-SWAN-MCDN-RETCD": "0"}, b"", f"downmrcnry {mid}: hired (owner earns {m['pay']})"


# 世界情勢, what the server announces each period (our schedule; the original's is lost):
#   C1 (SRAM 0x6031): the world event. ジュリア's script (ROM 0x20CDB6) runs event
#      0-9 once per save (marks bit n of the word at 0x602F); scripts in bank 0x27
#      (0x277ACD..) switch map flags for the larger values. We step weekly.
#   C2, C3 (0x6032/33): the region with the most and the fewest random battles.
#      Random-encounter earnings there are x1/2 and x5/4 (ROM 0x3686A7, on the ELD
#      at 0x4A08 when [0x298] = 0xFF, region [0x274] = 0-7); shop prices don't
#      change; 0xFF = none. The cart uploads its per-region battle counts with
#      every worldinfo, and ジュリア's 世界情勢 script has the report "最も多いのが
#      [X]部、少ないのは[Y]部です". We tally the counts from all players
#      (battle_regions): the bonus region from a small sample, the halved one only
#      once several players fight; FF until then.
#   names (+0xC4, 3 x 16 bytes): players whose names go on places ("@6の沼"
#      instead of ピラニアンの沼, op 0x74). We use the three most-hired mercenary owners.
WORLD_EVENTS = list(range(10)) + [0x21, 0x29, 0x33, 0x3B, 0x43, 0x51, 0x59, 0x6B, 0x6D, 0x73]
CAMPAIGN_START = datetime.date(2026, 10, 5)
REGIONS = 8               # battle counters: 8 words at SRAM 0x601B, region [0x274]
# Few people play this game, so the two sides switch on separately. The bonus region
# (+25%) only rewards, so it starts with a small sample from anyone; the halved region
# waits for a real crowd, so one player is never cut for where they alone play.
REGION_WINDOW = 30        # days of battles that pick the regions (the days before today)
BOOM_MIN_BATTLES = 20     # battles in the window before a bonus region is named
SLUMP_MIN_PLAYERS = 3     # different players in the window before a halved region is named
SLUMP_MIN_BATTLES = 50


def record_battles(db, owner, counts, today=None):
    """Add a player's new random battles per region (the cart's counters are running
    totals kept in the save; a smaller total means a new save, counted from zero)."""
    today = today or datetime.date.today()
    last = db.setdefault("battle_counts", {}).get(owner)
    if last is None or sum(counts) < sum(last) or any(c < l for c, l in zip(counts, last)):
        last = [0] * REGIONS
    new = [c - l for c, l in zip(counts, last)]
    db["battle_counts"][owner] = counts
    if any(new):
        day = db.setdefault("battle_days", {}).setdefault(today.isoformat(), {"regions": [0] * REGIONS, "players": []})
        day["regions"] = [a + b for a, b in zip(day["regions"], new)]
        if owner not in day["players"]:
            day["players"].append(owner)
    cutoff = (today - datetime.timedelta(days=REGION_WINDOW + 1)).isoformat()
    for d in [d for d in db.get("battle_days", {}) if d < cutoff]:
        del db["battle_days"][d]
    return sum(new)


def battle_regions(db, today):
    """(most, fewest) random battles by region over the REGION_WINDOW days before
    today; 0xFF where there isn't enough to go on (see BOOM_* / SLUMP_*). The fewest
    is picked among regions someone fought in, never the busiest one. Ties go to the
    lower region number."""
    days = [db.get("battle_days", {}).get((today - datetime.timedelta(days=n)).isoformat())
            for n in range(1, REGION_WINDOW + 1)]
    days = [d for d in days if d]
    totals = [sum(d["regions"][r] for d in days) for r in range(REGIONS)]
    players = {p for d in days for p in d["players"]}
    fought = [r for r in range(REGIONS) if totals[r]]
    if not fought:
        return 0xFF, 0xFF
    most = max(fought, key=lambda r: (totals[r], -r))
    quiet = [r for r in fought if r != most]
    fewest = min(quiet, key=lambda r: (totals[r], r)) if quiet and sum(totals) >= BOOM_MIN_BATTLES else 0xFF
    if len(players) < SLUMP_MIN_PLAYERS or sum(totals) < SLUMP_MIN_BATTLES:
        most = 0xFF
    return most, fewest


def world_state(db, today=None):
    import os
    today = today or datetime.date.today()
    days = (today - CAMPAIGN_START).days
    c1 = WORLD_EVENTS[(days // 7) % len(WORLD_EVENTS)]
    if os.environ.get("DE_EVENT"):                      # test override
        c1 = int(os.environ["DE_EVENT"], 0)
    c2, c3 = battle_regions(db, today)
    if os.environ.get("DE_REGIONS"):                      # test override: "c2,c3"
        c2, c3 = (int(v, 0) for v in os.environ["DE_REGIONS"].split(","))
    fame = {}
    for m in db["mercs"].values():
        if m.get("owner_name"):
            fame[m["owner_name"]] = fame.get(m["owner_name"], 0) + m.get("hired", 0)
    names = [bytes.fromhex(n) for n, c in sorted(fame.items(), key=lambda kv: -kv[1]) if c > 0][:3]
    return c1, c2, c3, names


def worldinfo(h, body):
    """Request body (5900:2F83): 16 + 4 + 1 bytes of player state, the market block
    (SRAM 0x6278), a word (SRAM 0x602F), a checksum byte (sum of the rest).
    Reply body (5900:30C0): 2 bytes (0x6032/33), the market block, a word added to
    the player's money (0x5FF6, saturating), 1 byte (0x6031), the word, three
    16-byte names (read when the body is 0x3F8+ bytes), the checksum."""
    db = load()
    market = bytearray(bytes.fromhex(db["market"])) if db.get("market") else bytearray([0x30] * MARKET)
    note = []
    word = b"\0\0"
    if len(body) >= 21 + MARKET + 3 and (sum(body[:-1]) & 0xFF) == body[-1]:
        mine = body[21:21 + MARKET]
        word = body[21 + MARKET:23 + MARKET]
        changed = [i for i, b in enumerate(mine) if b & 0x80]
        for i in changed:
            market[i] = mine[i] & 0x7F
        note.append(f"{len(changed)} prices changed")
        counts = list(struct.unpack("<8H", body[:16]))
        owner_key = h.get("x-swan-winf-id", "") + "/" + h.get("x-swan-winf-name", "")
        battles = record_battles(db, owner_key, counts)
        if battles:
            note.append(f"{battles} new battles")
    elif body:
        note.append(f"bad body ({len(body)} bytes)")
    db["market"] = market.hex()
    owner = h.get("x-swan-winf-id", "") + "/" + h.get("x-swan-winf-name", "")
    SESSIONS[h.get("x-wg-peer", "")] = owner
    mid = h.get("x-swan-winf-mid", "")[:8]
    gone = []
    if "x-swan-winf-mid" in h:
        # 00000000 = the player withdrew their mercenary (解除, offline); a real
        # MID is their current one, so any other of theirs is stale.
        gone = drop_owned(db, owner, keep=None if mid == "00000000" else mid)
        if gone:
            note.append(f"withdrawn {', '.join(gone)}")
    pay = sum(db["earned"].pop(m, 0) for m in [mid] + gone if m and m != "00000000")
    pay = min(pay, 0xFFFF)
    if pay:
        note.append(f"pays {pay}")
    for k in ("x-swan-winf-mrid0", "x-swan-winf-mrid1"):
        if h.get(k):
            note.append(f"contract over: {h[k]}")
    save(db)
    c1, c2, c3, names = world_state(db)
    data = bytes([c2, c3]) + bytes(market) + struct.pack("<H", pay) + bytes([c1]) + word
    data += b"".join(n[:16].ljust(16, b"\0") for n in (names + [b""] * 3)[:3])
    note.append(f"event {c1}, regions {c2:02X}/{c3:02X}, names {len(names)}")
    return {"X-SWAN-WINF-RETCD": "0"}, data + bytes([sum(data) & 0xFF]), "worldinfo: " + ", ".join(note)

GROUPS = {"nph-login.cgi": "SRVC", "nph-account.cgi": "ACNT", "nph-upmrcnry.cgi": "MCUP",
          "nph-listmrcnry.cgi": "MCDL", "nph-downmrcnry.cgi": "MCDN", "nph-worldinfo.cgi": "WINF",
          "nph-reqmatch.cgi": "MTCH", "nph-match.cgi": "MTCH"}
HOST, PATH = "battleg1.dark-eyes.com", "/cgi-bin/dark/nph-match.cgi"
POLL, TIMEOUT, STALE = 1, 60, 10

LOCK = threading.Lock()
WAITING = {}   # key -> {"id", "name", "lvl", "pass", "seen"}
MATCHES = {}   # key -> {"opp": key, "seed", "side", "inbox": [bytes], "sync": bool, "synced": bool}


def key_of(h):
    return h.get("x-swan-mtch-id", ""), h.get("x-swan-mtch-name", "")


def reqmatch(h):
    me = key_of(h)
    now = time.time()
    with LOCK:
        m = MATCHES.get(me)
        if m and not m.get("announced"):
            m["announced"] = True
            return matched(m), f"reqmatch {me}: matched with {m['opp']}"
        MATCHES.pop(me, None)
        for k in [k for k, w in WAITING.items() if now - w["seen"] > STALE]:
            del WAITING[k]
        pw = h.get("x-swan-mtch-pass", "")
        other = next((k for k, w in WAITING.items() if k != me and w["pass"] == pw), None)
        mine = {"id": me[0], "name": me[1], "lvl": h.get("x-swan-mtch-lvl", "1"), "pass": pw, "seen": now}
        if other is None:
            WAITING[me] = mine
            return {"X-SWAN-MTCH-RETCD": "1", "X-SWAN-MTCH-POLINT": str(POLL),
                    "X-SWAN-MTCH-TIMEOUT": str(TIMEOUT)}, f"reqmatch {me}: waiting"
        them = WAITING.pop(other)
        WAITING.pop(me, None)
        seed = random.randrange(65536)
        MATCHES[other] = {"opp": me, "info": mine, "seed": seed, "side": 0, "inbox": [], "turns": []}
        MATCHES[me] = {"opp": other, "info": them, "seed": seed, "side": 1, "inbox": [], "turns": [], "announced": True}
        return matched(MATCHES[me]), f"reqmatch {me}: matched with {other} (seed {seed})"


def matched(m):
    o = m["info"]
    return {"X-SWAN-MTCH-RETCD": "2", "X-SWAN-MTCH-ID": o["id"], "X-SWAN-MTCH-NAME": o["name"],
            "X-SWAN-MTCH-LVL": o["lvl"], "X-SWAN-MTCH-SEED": str(m["seed"]),
            "X-SWAN-MTCH-MATCH": str(m["side"]), "X-SWAN-MTCH-HOST": HOST, "X-SWAN-MTCH-PATH": PATH,
            "X-SWAN-MTCH-ACOUNT": "0", "X-SWAN-MTCH-BCOUNT": "0", "X-SWAN-MTCH-COUNT": "0",
            "X-SWAN-MTCH-POLINT": str(POLL), "X-SWAN-MTCH-TIMEOUT": str(TIMEOUT)}


def match(h, body):
    me = key_of(h)
    cmd = h.get("x-swan-mtch-cmd", "")
    poll = {"X-SWAN-MTCH-POLINT": str(POLL), "X-SWAN-MTCH-TIMEOUT": str(TIMEOUT)}
    with LOCK:
        m = MATCHES.get(me)
        opp = MATCHES.get(m["opp"]) if m else None
        if not m or not opp:
            return {"X-SWAN-MTCH-RETCD": "9"}, b"", f"match {me} cmd {cmd}: no match"
        if cmd == "0":
            opp["inbox"].append(body)
            return {"X-SWAN-MTCH-RETCD": "0", **poll}, b"", f"match {me} cmd 0: posted {len(body)} bytes"
        if cmd == "1":
            if m["inbox"]:
                data = m["inbox"].pop(0)
                return {"X-SWAN-MTCH-RETCD": "2", **poll}, data, f"match {me} cmd 1: delivered {len(data)} bytes"
            return {"X-SWAN-MTCH-RETCD": "1", **poll}, b"", f"match {me} cmd 1: nothing yet"
        if cmd == "2":
            opp["turns"].append(body)
            return {"X-SWAN-MTCH-RETCD": "3", **poll}, b"", f"match {me} cmd 2: turn posted ({len(body)} bytes)"
        if cmd == "3":
            if m["turns"]:
                data = m["turns"].pop(0)
                return {"X-SWAN-MTCH-RETCD": "5", **poll}, data, f"match {me} cmd 3: turn delivered ({len(data)} bytes)"
            return {"X-SWAN-MTCH-RETCD": "4", **poll}, b"", f"match {me} cmd 3: nothing yet"
    return {"X-SWAN-MTCH-RETCD": "9"}, b"", f"match {me}: unknown cmd {cmd}"


def handle(path, headers, body):
    name = path.rsplit("/", 1)[-1]
    got = {k[7:]: v for k, v in headers.items() if k.startswith("x-swan-")}
    data = b""
    if name == "nph-reqmatch.cgi":
        h, note = reqmatch(headers)
    elif name == "nph-match.cgi":
        h, data, note = match(headers, body)
    elif name == "nph-upmrcnry.cgi":
        h, data, note = upmrcnry(headers)
    elif name == "nph-listmrcnry.cgi":
        h, data, note = listmrcnry(headers)
    elif name == "nph-downmrcnry.cgi":
        h, data, note = downmrcnry(headers)
    elif name == "nph-worldinfo.cgi":
        h, data, note = worldinfo(headers, body)
    else:
        group = GROUPS.get(name)
        if not group:
            return 404, "text/plain", b"not found\n", f"darkeyes: unknown {name}", "lf"
        h = {f"X-SWAN-{group}-RETCD": "0"}
        if name == "nph-login.cgi":
            h["X-SWAN-SRVC-TIME"] = time.strftime("%Y%m%d%H%M%S")
        note = f"{name} {got}"
    name_txt = urllib.parse.unquote(got.get("mtch-name", ""), encoding="cp932", errors="replace")
    return 200, None, data, f"darkeyes {note} {name_txt}".strip(), h, "lf"
