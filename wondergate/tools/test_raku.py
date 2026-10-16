#!/usr/bin/env python3
"""Raku Jongg against our server, modelled on the game's own code.

The client side mirrors what the ROM does (see docs in server/swan_ranking.py):
  - HTTP lib at ROM 0xCCA4-0xD1C2: three POSTs on one connection, status
    must start with '2', "Content-Length: N" read at a fixed offset, header
    lines and body appended to one buffer.
  - Table parser at ROM 0xBF190: ported below line by line.
"""
import asyncio
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import swan_ranking  # noqa: E402
import wgserver  # noqa: E402

HOST = "rakujang.wgg.channel.or.jp"


def request(body):
    return (f"POST http://{HOST}/swan-ranking HTTP/1.1\r\nHost: {HOST}\r\n"
            f"User-Agent: SWAN/1.0\r\nContent-Type: application/x-www-form-urlencoded\r\n"
            f"Content-Length: {len(body)}\r\n\r\n").encode() + body


async def game_exchange(reader, writer, body):
    """One request/response the way the game's HTTP lib reads it. Returns the
    buffer (header lines + body) or raises with the game's error code."""
    writer.write(request(body))
    await writer.drain()
    buf = b""
    status = await reader.readline()
    if len(status) < 12:
        raise RuntimeError("error 400 (short status line)")
    code = status.split(b" ", 1)[1]
    if code[:1] != b"2":
        raise RuntimeError(f"error 499 (status {status!r})")
    buf += status
    length = 0
    while True:
        line = await reader.readline()
        buf += line
        if len(line) == 2:          # "\r\n": end of headers
            break
        if len(line) >= 16 and line[:15].upper() == b"CONTENT-LENGTH:":
            length = int(line[16:].strip())   # number read at a fixed offset
    if length:
        buf += await reader.readexactly(length)
    return buf


def raku_parse(buf):
    """Port of ROM 0xBF190. Returns [(course_field, [(score, name, extra), ...])] x3."""
    up = bytes(c - 32 if 97 <= c <= 122 else c for c in buf)
    i, out = 0, []

    def two_digits(i):
        # reads buf[i], buf[i+1]; one digit if the second is CR. Leaves i on the second.
        a, b = buf[i], buf[i + 1]
        return (a - 48 if b == 13 else (a - 48) * 10 + (b - 48)), i + 1

    for _ in range(3):
        i = up.index(b"COURSE", i)
        pipes = 0
        while pipes < 5:
            i += 1
            if buf[i] == 0x7C:
                pipes += 1
        course_field, i = two_digits(i + 1)
        i = up.index(b"RAKUJANG=", i) + len(b"RAKUJANG=")
        k, i = two_digits(i)
        rows, bp = [], 0
        while True:
            i += 1
            while buf[i] != 0x7C:
                i += 1
            digits = b""
            i += 1
            while buf[i] != 0x7C:
                digits += bytes([buf[i]])
                i += 1
            assert 1 <= len(digits) <= 6, f"score field {digits!r}"
            d = [c - 48 for c in digits]
            hi = 0
            if len(d) >= 5:
                hi = (d[0] * 10 + d[1]) if len(d) == 6 else d[0]
                d = d[-4:]
            lo = sum(v * m for v, m in zip(d, (1000, 100, 10, 1)[4 - len(d):]))
            name = b""
            i += 1
            while buf[i] != 0x7C:
                name += bytes([buf[i]])
                i += 1
            assert len(name) <= 8, f"name {name!r} overflows the 9-word slot"
            extra, i = two_digits(i + 1)
            rows.append((hi * 10000 + lo, name.decode("latin-1"), extra))
            bp += 1
            if not k > bp:
                break
        out.append((course_field, k, rows))
    return out


async def session(port, player, owner, scores):
    """One WonderGate visit: courses 1, 2, then 3 with list=."""
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    try:
        for n, (score, extra) in enumerate(scores, 1):
            body = f"*={player}&owner={owner}&score={n}|{score}|{extra}"
            if n == 3:
                body += "&list=rakujang|1|20\r\n"
            buf = await game_exchange(reader, writer, body.encode("latin-1"))
        return raku_parse(buf)
    finally:
        writer.close()


FAILS = 0


def check(name, ok, detail=""):
    global FAILS
    FAILS += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"\n    {detail}" if not ok and detail else ""))


async def main():
    with tempfile.TemporaryDirectory() as tmp:
        wgserver.STORE = swan_ranking.Store(f"{tmp}/t.sqlite")
        srv = await asyncio.start_server(wgserver.http_conn, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]

        # Same bytes the real game sent in our Mednafen session.
        r = await session(port, "FFFFFF", "3N_hS[4", [("001000", "02"), ("000000", "00"), ("000000", "00")])
        check("first visit: three POSTs on one connection, table parses", len(r) == 3)
        check("course 1 has our score", r[0][2] == [(1000, "3N_hS[4", 2)], repr(r[0]))

        await session(port, "A1B2C3", "Bob", [("240450", "05"), ("000000", "00"), ("012345", "01")])
        r = await session(port, "FFFFFF", "3N_hS[4", [("000500", "02"), ("000000", "00"), ("000000", "00")])
        check("course 1 sorted best first", [x[0] for x in r[0][2]] == [240450, 1000], repr(r[0]))
        check("lower score doesn't replace a best score", r[0][2][1] == (1000, "3N_hS[4", 2), repr(r[0]))
        check("player rank (2nd, behind Bob) in course line", r[0][0] == 2 and r[0][1] == 2, repr(r[0][:2]))
        check("course 3 table", r[2][2][0] == (12345, "Bob", 1), repr(r[2]))

        # 25 players: the table is capped at the 20 rows the game asks for.
        for p in range(25):
            await session(port, f"P{p:05d}", f"N{p}", [(f"{p:06d}", "01"), ("000000", "00"), ("000000", "00")])
        r = await session(port, "FFFFFF", "3N_hS[4", [("001000", "02"), ("000000", "00"), ("000000", "00")])
        check("20-row cap, two-digit row count", r[0][1] == 20 and len(r[0][2]) == 20, repr(r[0][:2]))

        srv.close()
    print(f"\n{'ALL PASS' if not FAILS else f'{FAILS} FAILED'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
