"""Wizardry Scenario 1 (Bandai 2001): www2.sting.co.jp/cgi-bin/wg/wiz.cgi.

    ?mp=kure            additional maps (ダウンロード)
    ?it=kure            Boltac's stock list (ネットショッピング)
    ?nm=NAME&sc=SCORE   high-score registration
Reply body (parsers at ROM 0x176A0B..0x176D13, buffer SRAM 0x5800):
    #SUMxxxx #WIZ^XXX... #SUMxxxx
    xxxx = 16-bit sum of the bytes between the markers, lowercase hex, the same
    in both. "#WIZ" must sit in the first 0x80 bytes and the section tag must
    follow it immediately:
      ^MAP f v f v ...     10 pairs: enabled flag, encounter set (< 20) per extra floor
      ^SHP n n ...         item numbers 2..121 to stock
      ^RNK r name_score r name_score r name_score r name_score
    A list ends at the next '#'. ^MSG text and ^ERR (error 601) may appear anywhere.
Numbers are decimal; the reader skips exactly one character after each number.

The additional floors and every item are in the ROM; the server only switches
them on. We enable all 10 floors with the harder encounter sets 10-19, rotate a
monthly shop selection, and keep a real high-score table.
"""
import datetime
import json
import pathlib
import urllib.parse

DB = pathlib.Path(__file__).resolve().parent.parent / "data" / "wizardry.json"
ITEMS = range(2, 122)
PER_MONTH = 12


def wrap(section):
    data = b"#WIZ" + section
    mark = f"#SUM{sum(data) & 0xFFFF:04x}".encode()
    return mark + data + mark + b"\r\n"


def maps():
    pairs = " ".join(f"1 {10 + i}" for i in range(10))
    return f"^MAP{pairs} ".encode()


def shop(day=None):
    day = day or datetime.date.today()
    n = (day.year * 12 + day.month) * PER_MONTH
    ids = sorted(ITEMS[(n + i) % len(ITEMS)] for i in range(PER_MONTH))
    return ("^SHP" + " ".join(map(str, ids)) + " ").encode(), ids


def ranking(name, score):
    scores = json.loads(DB.read_text()) if DB.exists() else {}
    if name and score >= 0 and score > scores.get(name, -1):
        scores[name] = score
        DB.parent.mkdir(exist_ok=True)
        DB.write_text(json.dumps(scores, ensure_ascii=False, indent=1))
    table = sorted(scores.items(), key=lambda kv: -kv[1])
    top = [(i + 1, n, s) for i, (n, s) in enumerate(table[:3])]
    while len(top) < 3:
        top.append((len(top) + 1, "", 0))
    mine = next(((i + 1, n, s) for i, (n, s) in enumerate(table) if n == name), (0, name, score))
    body = "".join(f"{r} {n}_{s} " for r, n, s in top + [mine])
    return ("^RNK" + body).encode("latin-1", "replace"), mine[0]


def handle(path, query, body):
    # Names are the cartridge's own bytes (spaces sent as '+'): keep them raw.
    q = dict(urllib.parse.parse_qsl(query, keep_blank_values=True, encoding="latin-1"))
    if "mp" in q:
        data, note = maps(), "wizardry maps: 10 floors"
    elif "it" in q:
        data, ids = shop()
        note = f"wizardry shop {ids}"
    elif "nm" in q:
        score = int(q.get("sc", "0")) if q.get("sc", "0").isdigit() else 0
        data, rank = ranking(q["nm"], score)
        note = f"wizardry ranking {q['nm']} {score} -> #{rank}"
    else:
        data, note = b"^ERR", f"wizardry: unknown query {query!r}"
    return 200, "text/plain", wrap(data), note
