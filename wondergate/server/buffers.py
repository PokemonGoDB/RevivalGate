"""Buffers Evolution: POST http://wgg01.channel.or.jp/service/buffersevolution (HTTP/1.0).

Request body (fixed Content-Length 1271):
    "BFEVSND=\\r\\n" + owner name (16) + " " + console code (6 hex) + " "
    + 36 course fields "MMSSHHXXXX " (18 Enduro courses, then 18 S.S. courses;
      MMSS + HH = best time in BCD, 000000 = no record; XXXX = a per-course word
      we keep but don't interpret) + "\\r\\n" + padding.
Reply body:
    "BFEVREC=\\r\\n" + YYYYMMDD + " " + 36 entries + " " + contest + "\\r\\n"
    entry   = rank (4 BCD, "AAAA" = none) + world record (MMSS HH) + time of the
              player one rank above (MMSS HH)
    contest = name (20, no separator after it) + start YYYYMMDD + " " + end YYYYMMDD + " "
              + 3 hex course words (12) + " " + this player's contest entry
See docs/wondergate/buffers-evolution.md.
"""
import datetime
import re

GAME = "buffers"
COURSES = 36
NONE = "AAAA000000000000"
# The contest from the ROM's own sample reply; nobody sends contest times, so
# every player's contest entry is "no rank".
CONTEST_NAME = "CONTEST NAME ARIOCH"  # 19 chars: the 20th is the space
CONTEST_COURSE = "00201000a8B4"


def parse(body):
    text = body.decode("latin-1")
    i = text.find("BFEVSND=\r\n")
    if i < 0:
        return None
    text = text[i + 10:]
    name, rest = text[:16], text[16:]
    m = re.match(r" ?([0-9A-Fa-f]{6}) ((?:[0-9A-Fa-f]{10} ){%d})" % COURSES, rest)
    if not m:
        return None
    return name.rstrip(), m.group(1).upper(), m.group(2).split()


def ranks(store, course, code, name):
    """(rank, world record, time of the player one rank above) for this player."""
    rows = store.db.execute(
        "SELECT player, owner, score FROM swan_ranking WHERE game=? AND course=? "
        "ORDER BY score, updated", (GAME, course)).fetchall()
    for n, (p, o, score) in enumerate(rows):
        if (p, o) == (code, name):
            above = rows[n - 1][2] if n else score
            return f"{n + 1:04d}"[-4:], rows[0][2], above
    return None


def handle(store, body):
    got = parse(body)
    if not got:
        return 400, "text/plain", b"bad request\r\n", "buffers: unparsed body"
    name, code, fields = got
    for course, f in enumerate(fields):
        if f[:6] != "000000":
            store.submit(GAME, course, code, name, f[:6], f[6:], key=lambda s: s)
    entries = []
    for course in range(COURSES):
        r = ranks(store, course, code, name)
        entries.append(f"{r[0]}{r[1]}{r[2]}" if r else NONE)
    today = datetime.date.today()
    start = today.replace(day=1)
    end = (start + datetime.timedelta(days=32)).replace(day=1) - datetime.timedelta(days=1)
    contest = (f"{CONTEST_NAME:<20.20}{start:%Y%m%d} {end:%Y%m%d} {CONTEST_COURSE} {NONE}")
    line = f"{today:%Y%m%d} {' '.join(entries)} {contest}"
    played = sum(e != NONE for e in entries)
    return 200, "text/plain", f"BFEVREC=\r\n{line}\r\n".encode(), f"buffers {name}/{code}: {played} ranked"
