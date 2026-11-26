"""Tonpuusou: R (rate) shared with the PC version, on tongpuso.wgg.channel.or.jp.

    POST /cgi-bin/getrate.cgi   c=<ID>&d=<password>
    POST /cgi-bin/setrate.cgi   c=<ID>&d=<password>&e=<rate×100>&f=<games>&g=<games before>
Reply lines (the cartridge parses c=, e=, f=; d= is never read):
    c=1            1 = OK, anything else = "にんしょうにしっぱいしました" (authentication failed)
    e=150000       rate with two implied decimals (≤ 4 integer digits)
    f=0            games played (≤ 5 digits)
The cartridge computes the new rate itself after a ranked match and uploads it,
with g = f - 1 (ROM 0x4F7F2): the game count its new rate was computed from, so
the server can tell a fresh result from a resent or out-of-order one.
An unknown ID is registered on first use with the password it came with; new
players start at R1500.00 (the PC version's starting rate).

The 全国ヤクマンランキング is a separate request, in Bandai's swan-ranking style
(builder ROM 0x4EA13, reply parser 0xA1D4D):

    POST /swan-ranking   *=<serial, 6 hex>&owner=<16 bytes>[&score=<n>%7C<count>%7C]...&list=BEST3%7C1%7C3
        owner   the player's name, 16 bytes, each sent + 0x41; echoed back as sent
        score   one per yakuman kind n = 1..15 the player has made (RAM 0x6C4, a word each)
    Reply, read a line at a time (each at most 127 bytes with its CRLF) to Content-Length:
        course=<g>|<nn>|...     picks a table and clears it: g = 2 is table 0 (the total),
                                otherwise nn, exactly two digits at this column, is the table
         BEST3=<k>              k rows follow, one digit, never 0 (the row loop would run 65,536
                                times); this line and the rows start with a space
         <r>|<count>|<owner>|   r = 1..3, count up to 5 digits, owner up to 16 bytes ending in '|'
    Tables with no line in the reply stay empty; a reply with no line at all is error 599
    (その他のエラー). See docs/wondergate/tonpuusou.md.
"""
import json
import pathlib
import re
import time
import urllib.parse

DB = pathlib.Path(__file__).resolve().parent.parent / "data" / "tonpuusou.json"
YAKUMAN_DB = DB.with_name("tonpuusou-yakuman.json")
START_RATE = 150000
KINDS = 15              # yakuman kinds the cart counts and uploads
CONTENT_TYPE = "application/x-swan-ranking-response"


def load():
    return json.loads(DB.read_text()) if DB.exists() else {}


def save(players):
    DB.parent.mkdir(exist_ok=True)
    DB.write_text(json.dumps(players, indent=1))


def digits(v, n):
    return v.isdigit() and 0 < len(v) <= n


def yakuman(body):
    """The national yakuman ranking: keep this player's counts, send back the top 3 of each
    kind and of the total."""
    db = json.loads(YAKUMAN_DB.read_text()) if YAKUMAN_DB.exists() else {"players": {}}
    players = db["players"]
    serial = re.match(rb"\*=([0-9A-Za-z]{1,8})", body)
    at = body.find(b"&owner=")
    owner = body[at + 7:at + 23] if at >= 0 else b""
    scores = {int(n): int(c) for n, c in re.findall(rb"&score=(\d{1,2})%7[Cc](\d{1,5})%7[Cc]", body[at + 23:])}
    scores = {n: min(c, 0xFFFF) for n, c in scores.items() if 1 <= n <= KINDS and c}
    note = "no yakuman yet"
    # The owner goes back to every player inside a '|'-separated line: one that would break
    # the line isn't kept.
    if serial and len(owner) == 16 and scores and not any(b < 0x20 or b == 0x7C for b in owner):
        key = serial.group(1).decode().upper() + ":" + owner.hex()
        p = players.setdefault(key, {"owner": owner.hex(), "counts": [0] * KINDS})
        for n, c in scores.items():
            p["counts"][n - 1] = max(p["counts"][n - 1], c)     # the cart's counts only grow
        p["updated"] = time.strftime("%Y-%m-%d %H:%M:%S")
        YAKUMAN_DB.parent.mkdir(exist_ok=True)
        YAKUMAN_DB.write_text(json.dumps(db, indent=1))
        note = f"{sum(p['counts'])} yakuman of {sum(1 for c in p['counts'] if c)} kinds"
    out = []
    for table in range(KINDS + 1):
        count = (lambda p: sum(p["counts"])) if table == 0 else (lambda p: p["counts"][table - 1])
        top = sorted((p for p in players.values() if count(p)), key=lambda p: -count(p))[:3]
        # The total's course line always goes, rows or not: an empty reply is error 599.
        if not top and table:
            continue
        head = "course=2|01" if table == 0 else f"course=1|{table:02d}"
        out.append(f"{head}|{sum(1 for p in players.values() if count(p))}|{count(top[0]) if top else 0:05d}".encode())
        if not top:
            continue
        out.append(f" BEST3={len(top)}".encode())
        out += [f" {r}|{min(count(p), 0xFFFF):05d}|".encode() + bytes.fromhex(p["owner"]) + b"|"
                for r, p in enumerate(top, 1)]
    return (200, CONTENT_TYPE, b"".join(line + b"\r\n" for line in out),
            f"tonpuusou yakuman ranking: {note}; {len(out)} lines")


def handle(path, body):
    if path == "/swan-ranking":
        return yakuman(body)
    form = dict(urllib.parse.parse_qsl(body.decode("latin-1").strip("\r\n\x00")))
    pid, pw = form.get("c", ""), form.get("d", "")
    players = load()
    p = players.get(pid)
    if not pid:
        return reply(0, None, f"tonpuusou {path}: no ID")
    if p is None:
        p = players[pid] = {"password": pw, "rate": START_RATE, "games": 0}
    elif p["password"] != pw:
        return reply(0, None, f"tonpuusou {path}: wrong password for {pid}")
    if path.endswith("/setrate.cgi"):
        if not (digits(form.get("e", ""), 6) and digits(form.get("f", ""), 5)):
            return reply(0, None, f"tonpuusou setrate: bad values {form}")
        rate, games, before = int(form["e"]), int(form["f"]), form.get("g", "")
        if (games, rate) == (p["games"], p["rate"]):
            # The same result sent again (the reply was lost): nothing to change.
            return reply(1, p, f"tonpuusou setrate {pid}: resent, unchanged")
        if before.isdigit() and int(before) != p["games"]:
            # Computed from an older download (another console played in between, or
            # a reply was lost): keep the result, but never move the count backwards.
            games = max(games, p["games"] + 1)
            p["out_of_order"] = p.get("out_of_order", 0) + 1
        p.update(rate=rate, games=games, updated=time.strftime("%Y-%m-%d %H:%M:%S"))
        p.pop("g", None)
    elif not path.endswith("/getrate.cgi"):
        return 404, "text/plain", b"not found\r\n", f"tonpuusou: unknown {path}"
    save(players)
    return reply(1, p, f"tonpuusou {path} {pid}: R{p['rate'] / 100:.2f}, {p['games']} games")


def reply(ok, p, note):
    body = f"c={ok}\r\n"
    if p:
        body += f"e={p['rate']}\r\nf={p['games']}\r\n"
    return 200, "text/plain", body.encode(), note


def page(path):
    """The PC side: the original shared each ID's R with the Windows Tonpuusou.
    That client is gone, so a PC browser gets this table of the cartridge
    players instead (never the passwords)."""
    import html
    players = load()
    rows = sorted(players.items(), key=lambda kv: -kv[1]["rate"])
    body = "".join(
        f"<tr><td>{i}</td><td>{html.escape(pid)}</td><td>{p['rate'] / 100:.2f}</td>"
        f"<td>{p['games']}</td><td>{html.escape(p.get('updated', ''))}</td></tr>"
        for i, (pid, p) in enumerate(rows, 1))
    doc = f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>東風荘 R ranking</title>
<style>body{{font-family:sans-serif;margin:16px}}table{{border-collapse:collapse}}
td,th{{border:1px solid #999;padding:4px 8px;text-align:right}}</style></head><body>
<h1>東風荘 WonderSwan R</h1>
<p>Ratings uploaded from the WonderSwan cartridge's ランキング対戦 ({len(rows)} players).</p>
<table><tr><th>#</th><th>ID</th><th>R</th><th>Games</th><th>Updated</th></tr>{body}</table>
</body></html>"""
    return 200, "text/html; charset=utf-8", doc.encode(), f"tonpuusou page ({len(rows)} players)"
