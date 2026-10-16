"""Bandai "swan-ranking" service: national high-score tables.

Request (form POST, values not URL-encoded by the games we've seen):
    *=<id>&owner=<name>&score=<course>|<score>[|<extra>]...[&list=<name>|<start>|<count>]

One or more `score=` fields per body (GunPey EX sends all five courses at
once; Raku Jongg sends one POST per course on a keep-alive connection). Only a
body carrying `list=` expects a table back:

    [date<YYYYMMDDhhmmss>3            "bandai" style only: GunPey EX's sample
     info=<text>                       header, ROM 0xFDC69
     group=<g>|<from>|<to>|DEFAULT]
    course=<g>|<n>|<entrants>|<top score>|<your score>|<your rank>
    <listname>=<k>
    <rank>|<score>|<owner>[|<extra>]
    ...

One block per course, courses in order. Owner and score strings are stored
and echoed exactly as the game sent them. Per-game details are in
docs/wondergate/<game>.md.
"""
import sqlite3
import time

CONTENT_TYPE = "application/x-swan-ranking-response"

# Per game, from each game's parser (docs/wondergate/<game>.md):
#   courses     blocks in a table reply
#   max_rows    cap on rows per course (GunPey EX reads a 1-digit count)
#   name_max    owner length the parser has room for
#   header      False, True (GunPey EX's date/info/group lines, which its
#               parser skips) or f(game) -> header lines
#   row_prefix  text before each row (Sennou Millennium finds rows by a space)
#   count_max   cap for entrants / your rank in the course line
#   score       {course: (divisor, max digits)}, None key = default; the game
#               multiplies back when displaying
#   reply_fmt   {course: f(score digits) -> digits sent back}
#   rank_key    {course: f(score string) -> sort key, smaller = better};
#               default is the highest score first
#   course_fmt  course line layout (default: rank in field 6)
#   name_fmt    f(owner as uploaded) -> owner as sent back (default: unchanged)
#   empty_name  owner shown on the placeholder row of an empty course (default "-")
#   count_fmt   f(rows) -> the row count after "<listname>=" (default: decimal)
def higher_is_better(score):
    return -int(score or 0)


def lower_is_better(score):
    return int(score or 0)


def form_name(width):
    """Form-decode '+' to spaces and pad to a fixed width (D's Garage shows names)."""
    return lambda owner: owner.replace("+", " ")[:width].ljust(width)


def gunpey_puzzle(score):
    """GunPey EX Puzzle: SSS 1 MM ss = stage, a flag, 100 - minutes, 60 - seconds
    (row display ROM 0xFCD22), so a plain higher-is-better sort is right. A
    fresh save uploads 00010060 (100:00, "no record"); send it back as zeros so
    the game shows "--:--" instead of a blank-minute "0:00"."""
    return "00000000" if score[-5:] == "10060" and int(score[:-5] or 0) == 0 else score


def pocketf_content(fields):
    """Pocket Fighter: extras and digital cards are both requested with group=0
    and no list, and read the same info= line differently: extras (subtype 0C,
    ROM 0x1CFB61) take the first 6 chars as flags, cards (0B, 0x1CFAFB) skip 6
    and take the next 7. '1' unlocks; we unlock everything with 13 ones.
    `owner` is the player code: 3-letter name + character letter."""
    if fields.get("group") == "0" and "list" not in fields:
        return "info=" + "1" * 13 + "\r\n"
    return None


GAMES = {
    "rakujang": {"courses": 3, "max_rows": 20, "name_max": 8, "header": False,
                 "count_max": 99, "score": {None: (1, 6)}, "group": 1},
    "gunpeyex": {"courses": 5, "max_rows": 9, "name_max": 16, "header": True,
                 "count_max": 9999, "score": {None: (10, 6), 3: (1, 8)}, "group": 1,
                 "reply_fmt": {3: gunpey_puzzle}},
    # Another Heaven: quick-solve (早解き) ranking, lowest time first.
    "heaven": {"courses": 1, "max_rows": 5, "name_max": 8, "header": False,
               "count_max": 99, "score": {None: (1, 6)}, "group": 1,
               "rank_key": {1: lower_is_better}},
    # D's Garage 21: Tane o Maku Tori. Rank is exactly 4 digits; one row per course with a
    # fixed 16-byte name (docs/wondergate/ds-garage.md).
    "tanetori": {"courses": 4, "max_rows": 1, "name_max": 16, "header": True,
                 "count_max": 9999, "score": {None: (1, 10)}, "group": 1,
                 "course_fmt": "course={g}|{n}|{entrants}|{top}|{mine}|{rank:04d}",
                 "name_fmt": form_name(16), "empty_name": "NO RANKING DATA."},
    # Sennou Millennium: needs date=, course= and ranking=; rows start with a space;
    # each row carries its own rank: the top 10, then the places just ahead of you
    # and your own row, trimmed to fit its 895-byte receive buffer (sennou.md).
    "sen-know": {"courses": 1, "max_rows": 10, "name_max": 16, "max_body": 740,
                 "header": lambda game: [time.strftime("date=%Y%m%d%H%M")],
                 "count_max": 9999, "score": {None: (1, 8)}, "group": 1,
                 "row_prefix": " "},
    # Final Lap 2000: 16 courses of best lap times (95999 = no record), lowest first.
    # First guess; verify (docs/wondergate/final-lap.md)
    "final-lap": {"courses": 16, "max_rows": 9, "name_max": 3,
                  "header": lambda game: [time.strftime("date=%Y%m%d")],
                  "count_max": 9999, "score": {None: (1, 5)}, "group": 1,
                  "rank_key": {c: lower_is_better for c in range(1, 33)},
                  "courses_per_group": True},
    # Pocket Fighter (after the charge-service handshake): tables 1 score, 2 total
    # points, 3-14 each fighter's points (docs/wondergate/pocket-fighter.md)
    "pocketf": {"courses": 1, "max_rows": 50, "name_max": 8, "header": False,
                "count_max": 50, "score": {None: (1, 8)}, "group": 1, "courses_on_upload": True,
                "table_per_group": True, "groups": range(1, 15),
                "content": pocketf_content},
    # Tare Panda no GunPey: fixed 10-char score fields, echoed as uploaded.
    # Puzzle times are stored as complements too (row display ROM 0x9C9CA), so
    # higher is better there as well.
    "tarepang": {"courses": 4, "max_rows": 9, "name_max": 16, "header": True,
                 "count_max": 9999, "score": {None: (1, 10)}, "group": 1},
    # Uchuu Senkan Yamato: ヤマト指数 (0-65535), top 50. The game reads only date= (which
    # also sets how many crew logs it shows) and the rows; its row-count parser drops a
    # second digit, so the count goes as one character, '0' + n (docs/wondergate/yamato.md).
    "yamato": {"courses": 1, "max_rows": 50, "name_max": 8,
               "header": lambda game: [time.strftime("date=%Y%m%d")],
               "count_max": 9999, "score": {None: (1, 5)}, "group": 1,
               "count_fmt": lambda n: chr(0x30 + n)},
}


def rank_key(cfg, course):
    return cfg.get("rank_key", {}).get(course, higher_is_better)


def reply_score(cfg, course, score):
    div, digits = cfg["score"].get(course, cfg["score"][None])
    v = min(int(score or 0) // div, 10 ** digits - 1)
    return cfg.get("reply_fmt", {}).get(course, str)(f"{v:0{digits}d}")


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute("""CREATE TABLE IF NOT EXISTS swan_ranking (
            game TEXT, course INTEGER, player TEXT, owner TEXT,
            score TEXT, extra TEXT, updated REAL,
            PRIMARY KEY (game, course, player, owner))""")
        self.db.commit()

    def submit(self, game, course, player, owner, score, extra, key=higher_is_better):
        """Keep each player's best score per course."""
        row = self.db.execute(
            "SELECT score FROM swan_ranking WHERE game=? AND course=? AND player=? AND owner=?",
            (game, course, player, owner)).fetchone()
        if row and key(row[0]) <= key(score):
            return
        self.db.execute("INSERT OR REPLACE INTO swan_ranking VALUES (?,?,?,?,?,?,?)",
                        (game, course, player, owner, score, extra, time.time()))
        self.db.commit()

    def table(self, game, course, start, count, player, owner, key=higher_is_better):
        """(entrants, rows start..start+count-1, this player's rank or 0, their score)."""
        rows = self.db.execute(
            "SELECT owner, score, extra, player, updated FROM swan_ranking WHERE game=? AND course=?",
            (game, course)).fetchall()
        rows.sort(key=lambda r: (key(r[1]), r[4]))
        rank, mine = 0, None
        for i, r in enumerate(rows, 1):
            if (r[3], r[0]) == (player, owner):
                rank, mine = i, r[1]
                break
        page = [r[:3] for r in rows[max(0, start - 1):max(0, start - 1) + count]]
        return len(rows), page, rank, mine


def parse_form(body):
    """Split a form body without URL-decoding (names are echoed back byte-exact).
    Returns a list of (key, value); keys can repeat."""
    out = []
    for part in body.decode("latin-1").strip("\r\n\x00").split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            out.append((k, v.strip("\r\n\x00")))
    return out


def handle(store, game, body):
    """Return (status, content_type, body_bytes, note)."""
    cfg = GAMES[game]
    fields = parse_form(body)
    first = {}
    for k, v in fields:
        first.setdefault(k, v)
    note = []

    player = first.get("*", "")
    owner = first.get("owner", "")[:cfg["name_max"]]
    group = int(first["group"]) if first.get("group", "").isdigit() else 1
    # Pocket Fighter: one table per group (1 score, 2 total points, 3-14 a fighter's
    # points). Downloads give the group; uploads name each table in the course field
    # (score=02|<points>&score=07|<points>: total and Morrigan's points).
    table_of = lambda g: f"{game}/{g}" if cfg.get("table_per_group") and g != 1 else game
    table_key = table_of(group)
    reply_key = None
    # Final Lap: group 2 asks for courses 17-32 (lap times; 1-16 are total times).
    course_base = (group - 1) * cfg["courses"] if cfg.get("courses_per_group") else 0
    width = {}
    for k, v in fields:
        if k != "score":
            continue
        parts = v.split("|")
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            course, score = int(parts[0]), parts[1]
            extra = parts[2] if len(parts) > 2 else ""
            width[course] = (len(score), len(extra))
            if cfg.get("table_per_group"):
                if course not in cfg["groups"]:
                    continue
                reply_key = reply_key or table_of(course)
                store.submit(table_of(course), 1, player, owner, score, extra, rank_key(cfg, 1))
            else:
                store.submit(table_key, course, player, owner, score, extra, rank_key(cfg, course))
            note.append(f"course {course}: {score}{'|' + extra if extra else ''}")

    special = cfg.get("content", lambda f: None)(first)
    if special is not None:
        return 200, CONTENT_TYPE, special.encode("latin-1"), f"content {first.get('owner')}"
    if "list" not in first and not cfg.get("courses_on_upload"):
        return 200, CONTENT_TYPE, b"", f"{owner!r} " + ", ".join(note)
    if "list" not in first:
        # Pocket Fighter reads "your rank" from the course line after an upload: the
        # first table it sent (score, or total points).
        out = []
        for course in range(1, cfg["courses"] + 1):
            total, rows, rank, mine = store.table(reply_key or table_key, course, 1, 1, player, owner,
                                                  rank_key(cfg, course))
            top = reply_score(cfg, course, rows[0][1] if rows else 0)
            out.append(f"course={cfg['group']}|{course}|{min(total, 9999)}|{top}|"
                       f"{reply_score(cfg, course, mine)}|{min(rank, cfg['count_max'])}")
        text = "\r\n".join(out) + "\r\n"
        return 200, CONTENT_TYPE, text.encode("latin-1"), f"{owner!r} " + ", ".join(note) + "; ranks"

    # list=<name>|<start>|<count>; a start of "+N" is relative to the player:
    # N places ahead of them (Final Lap "+1" = the rival just ahead; Pocket Fighter
    # "+0" = their own entry). A count of "+N" (Sennou Millennium's fixed
    # "ranking|10|+16") reads the same way from the other field: the top <start>
    # rows, then the N places ahead of the player down to the player.
    lp = first["list"].replace("%2b", "+").replace("%2B", "+").split("|")
    listname = lp[0]
    num = lambda v: int(v.lstrip("+")) if v.lstrip("+").isdigit() else None
    start = num(lp[1]) if len(lp) > 1 and num(lp[1]) is not None else 1
    relative = len(lp) > 1 and lp[1].startswith("+")
    near = num(lp[2]) if len(lp) > 2 and lp[2].startswith("+") else None
    count = num(lp[2]) if len(lp) > 2 and num(lp[2]) is not None else cfg["max_rows"]
    count = max(1, min(count, cfg["max_rows"]))
    g = cfg["group"]

    out = []
    if callable(cfg["header"]):
        out += cfg["header"](game)
    elif cfg["header"]:
        out += [time.strftime("date%Y%m%d%H%M%S") + "3",
                "info=www.bandai.co.jp:" + game,
                f"group={g}|20000101|20991231|DEFAULT"]
    for course in range(course_base + 1, course_base + cfg["courses"] + 1):
        first_row = start
        if relative:
            _, _, my_rank, _ = store.table(table_key, course, 1, 1, player, owner, rank_key(cfg, course))
            first_row = max(1, (my_rank or 1) - start)
        if near is not None:
            total, rows, rank, mine = store.table(table_key, course, 1, start, player, owner,
                                                  rank_key(cfg, course))
            ranked = list(enumerate(rows, 1))
            if rank > start:
                lo = max(start + 1, rank - near)
                _, more, _, _ = store.table(table_key, course, lo, rank - lo + 1, player, owner,
                                            rank_key(cfg, course))
                ranked += list(enumerate(more, lo))
        else:
            total, rows, rank, mine = store.table(table_key, course, first_row, count, player, owner,
                                                  rank_key(cfg, course))
            ranked = list(enumerate(rows, first_row))
        ew = width.get(course, (6, 2))[1]
        cap = cfg["count_max"]
        top = reply_score(cfg, course, rows[0][1] if rows else 0)
        fmt = cfg.get("course_fmt", "course={g}|{n}|{entrants}|{top}|{mine}|{rank}")
        out.append(fmt.format(g=g, n=course, entrants=min(total, cap), top=top,
                              mine=reply_score(cfg, course, mine), rank=min(rank, cap)))
        # Raku Jongg's parser always reads at least one row: never send an empty table.
        if not ranked:
            ranked = [(1 if near is not None else first_row, (cfg.get("empty_name", "-"), "0", "0" * ew))]
        out.append(f"{listname}={cfg.get('count_fmt', str)(len(ranked))}")
        name = cfg.get("name_fmt", lambda o: o)
        pre = cfg.get("row_prefix", "")
        rows_text = [f"{pre}{i}|{reply_score(cfg, course, sc)}|{name(o)}|{e}" for i, (o, sc, e) in ranked]
        if near is not None and "max_body" in cfg:
            # Drop the rows farthest ahead of the player until the reply fits the
            # game's receive buffer (the top rows and the player's own row stay).
            count_line = lambda: f"{listname}={cfg.get('count_fmt', str)(len(rows_text))}"
            size = lambda: sum(len(x) + 2 for x in out[:-1] + [count_line()] + rows_text)
            while size() > cfg["max_body"] and len(rows_text) > start + 1:
                del rows_text[start]
            out[-1] = count_line()
        out += rows_text
    text = "\r\n".join(out) + "\r\n"
    note.append(f"table {listname} {start}+{count}")
    # The table ends the exchange; Tare Panda reads until the connection closes.
    return 200, CONTENT_TYPE, text.encode("latin-1"), f"{owner!r} " + "; ".join(note), "close"
