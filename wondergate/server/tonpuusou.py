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
players start at R1500.00 (the PC version's starting rate). See
docs/wondergate/tonpuusou.md.
"""
import json
import pathlib
import time
import urllib.parse

DB = pathlib.Path(__file__).resolve().parent.parent / "data" / "tonpuusou.json"
START_RATE = 150000


def load():
    return json.loads(DB.read_text()) if DB.exists() else {}


def save(players):
    DB.parent.mkdir(exist_ok=True)
    DB.write_text(json.dumps(players, indent=1))


def digits(v, n):
    return v.isdigit() and 0 < len(v) <= n


def handle(path, body):
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
