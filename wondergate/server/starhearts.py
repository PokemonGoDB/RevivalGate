"""Star Hearts (Bandai 2001): the Gate Bazaar, s_hearts.wgg.channel.or.jp.

    GET /cgi-bin/starhearts.cgi?000NFFFF      N = 2..5, one request routine each (A000:33A0..349E)

The body lands at RAM 0x295D. Routines 3..5 read a number from it (A000:34FE):
    body[0..2]  digit count + 4, three hex digits, least significant first
    body[3..4]  not read
    body[5..]   the number in hex, most significant first (32 bits)
and store it in SRAM: 0003 -> 0x500E, 0004 -> 0x5012, 0005 -> 0x5000. The
script commands (bank 0x39, 9000:CAA0..CC70) hand it to the bazaar script.

    0002  connection check (body not read)
    0005  membership: the member number on the card (shown in decimal)
    0003  bazaar visitor count today (JST): "you are today's Nth customer"
          (script bank 0x20, 0x207F16); gifts at multiples of 10, 100, 1000
    0004  bazaar visitor count since opening (0x2077CA); gifts at multiples
          of 100 and 1000
Each 0003/0004 request counts as a visit.
"""
import datetime
import json
import pathlib
import random

JST = datetime.timezone(datetime.timedelta(hours=9))

DB = pathlib.Path(__file__).resolve().parent.parent / "data" / "starhearts.json"


def number(value):
    """The reply the cartridge reads as value. Its hex reader (A000:350C) rotates the low
    word left a digit at a time where it should shift it, so each digit pushed out of the
    top comes back in at the bottom and is added to the next one: plain hex is read right
    only below 0x10000 (it read 00010000 as 65537, seen in the game). So for the high
    word's digits, lowest first, take back what the rotation adds. Below 0x10000 this is
    plain hex.
    The dialogue draws nine digits: with a tenth the first comes out as a stray character
    (seen in the game), so the number stops at 999,999,999."""
    value = min(value, 999_999_999)
    x, low = value & 0xFFFF, ""
    for shift in (16, 20, 24, 28):
        d = (x - (value >> shift)) & 0xF
        low = f"{d:X}" + low
        x = (x - d) & 0xFFFF
        x = x >> 4 | (x & 0xF) << 12
    digits = f"{x:04X}{low}"
    count = f"{len(digits) + 4:03X}"[::-1]
    return f"{count}00{digits}".encode()


def load():
    return json.loads(DB.read_text()) if DB.exists() else {"members": []}


def save(db):
    DB.parent.mkdir(exist_ok=True)
    DB.write_text(json.dumps(db, indent=1))


def visit(db):
    """Count a bazaar visit; returns (today's count, all-time count)."""
    today = datetime.datetime.now(JST).strftime("%Y-%m-%d")
    if db.get("day") != today:
        db["day"], db["today"] = today, 0
    db["today"] = db.get("today", 0) + 1
    db["visitors"] = db.get("visitors", 0) + 1
    save(db)
    return db["today"], db["visitors"]


def handle(path, query, body):
    q = query.upper()
    db = load()
    if q.startswith("0005"):
        member = random.randrange(10_000_000, 99_999_999)
        db["members"].append(member)
        save(db)
        return 200, "text/plain", number(member), f"starhearts: new member {member}"
    if q.startswith("0002"):
        return 200, "text/plain", number(0), "starhearts: connection check"
    if q.startswith("0003") or q.startswith("0004"):
        today, total = visit(db)
        n = today if q.startswith("0003") else total
        what = "today's" if q.startswith("0003") else "all-time"
        return 200, "text/plain", number(n), f"starhearts: visitor {n} ({what})"
    return 404, "text/plain", b"not found\r\n", f"starhearts: unknown ?{query}"
