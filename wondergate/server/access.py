"""accsess.cgi check-ins: Ring Infinity and Terrors 2 (same developer, same library).

Ring Infinity: wgg02 /ring/cgi-bin/accsess.cgi?RING=666.

Ring Infinity only needs the connection to succeed: it reads 7 lines (status and
headers, contents ignored) and one block, then picks the hint mail itself from
story progress and chance (ROM 0x34C47C). A reply shorter than 7 lines would
leave it waiting for the server to hang up, so we send 7 lines and close.
"""
import datetime
import os

JST = datetime.timezone(datetime.timedelta(hours=9))


def ring(body):
    # status, Server, Date-less padding, Connection, Content-Type, Content-Length, blank = 7 lines
    body = os.environ.get("RING_BODY", "OK").encode() + b"\r\n"   # probe hook
    return (200, "text/plain", body, "ring infinity check-in", "close",
            {"Server": "wgserver", "Cache-Control": "no-cache"})


def terrors2(body):
    """Terrors 2 (terrors2.wgg /cgi-bin/accsess.cgi?T2=www.sign-eight.co.jp).

    After the same 7 lines it reads raw body bytes 2, 3, 4 (ROM 0x34E4D0):
    [0xAA5] = byte 2, the half-day (1 = a.m., 2 = p.m.; the game flips it every
    720 minutes), [0xAA7] = byte 3 * 60 + byte 4, minutes into that half-day.
    That is the real-time campaign clock; we send Japan time.
    """
    now = datetime.datetime.now(JST)
    if os.environ.get("T2_TIME"):                       # test override, HH:MM
        h, m = map(int, os.environ["T2_TIME"].split(":"))
        now = now.replace(hour=h, minute=m)
    clock = bytes([1 if now.hour < 12 else 2, now.hour % 12, now.minute])
    return (200, "application/octet-stream", b"T2" + clock + b"\r\n",
            f"terrors2 clock {now:%H:%M} JST", "close",
            {"Server": "wgserver", "Cache-Control": "no-cache"})
