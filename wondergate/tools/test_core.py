#!/usr/bin/env python3
"""Byte-level tests for wgcore-host: feed console frames on stdin, check replies.

Usage: test_core.py path/to/wgcore-host
"""
import os
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zlib


def frame(t, cmd, params=b""):
    return bytes([t, 0, len(params) + 1, cmd]) + params


def run(host_bin, data, conf_text="", timeout=10):
    with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as f:
        f.write(conf_text)
        conf = f.name
    try:
        p = subprocess.run([host_bin, "ASDF", "--config", conf], input=data,
                           capture_output=True, timeout=timeout)
    finally:
        os.unlink(conf)
    return p.stdout, p.stderr.decode(errors="replace")


FAILS = 0


def lr_record(crc_ok=True):
    """A Lode Runner editor slot record (0x200 bytes) around a synthetic test grid: solid
    border, an empty room, a brick floor and one gold tile. Test data only, not a stage."""
    grid = bytearray(28 * 18)
    for r in range(18):
        for c in range(28):
            grid[28 * r + c] = 0x05 if r in (0, 17) or c in (0, 27) else 0x04 if r == 16 else 0x00
    grid[28 * 15 + 5] = 0x0E
    rec = bytes(grid) + struct.pack("<H", 2)
    crc = zlib.crc32(rec) ^ (0 if crc_ok else 1)
    return rec + struct.pack("<I", crc) + b"\x4c\x97"


def one_shot_server(reply):
    """Listen once; return (port, thread, seen) where seen["req"] gets the whole request."""
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    srv.settimeout(8)
    seen = {}

    def serve():
        try:
            c, _ = srv.accept()
        except socket.timeout:
            return
        c.settimeout(5)
        data = b""
        while b"\r\n\r\n" not in data or len(data.split(b"\r\n\r\n", 1)[1]) < 0x200:
            chunk = c.recv(4096)
            if not chunk:
                break
            data += chunk
        seen["req"] = data
        c.sendall(reply)
        c.close()

    t = threading.Thread(target=serve, daemon=True)
    t.start()
    return srv.getsockname()[1], t, seen


def truth(cond):
    return b"yes" if cond else b"no"


def check(name, got, want):
    global FAILS
    ok = got == want
    FAILS += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    if not ok:
        print(f"    got  {got.hex(' ')}\n    want {want.hex(' ')}")


def main(host_bin):
    poweron = frame(0x01, 0x02)

    out, _ = run(host_bin, poweron)
    check("power-on answers version '10'", out, frame(0x01, 0x02, b"10"))

    out, _ = run(host_bin, b"\x00" * 10 + poweron)
    check("00 wake burst answers 55 x5 once, then power-on version", out, b"\x55" * 5 + frame(0x01, 0x02, b"10"))

    out, _ = run(host_bin, poweron + b"\x00" * 3 + poweron)
    check("00s after power-on are just sync", out, frame(0x01, 0x02, b"10") * 2)

    out, _ = run(host_bin, poweron + frame(0x02, 0x01, b"\x03"))
    check("status after power-on = 2 (reply cmd 02)", out[6:], frame(0x02, 0x02, b"\x02"))

    out, _ = run(host_bin, b"\x00" * 10 + frame(0x02, 0x00, b"\x03"))
    check("02:00 (Gashapon Senki, no power-on) answers a bare 02:00 frame", out, b"\x55" * 5 + frame(0x02, 0x00))

    out, _ = run(host_bin, frame(0x01, 0x00), "reception 9\n")
    check("PDC ok before power-on, configured reception", out, frame(0x01, 0x00, b"\x00\x09"))

    out, _ = run(host_bin, poweron + frame(0x0F, 0xFF, b"\x55\xAA\x55\xAA"))
    check("power-off answers bare 0F 00 01 FF", out[6:], b"\x0F\x00\x01\xFF")

    out, _ = run(host_bin, poweron + frame(0x0F, 0xFF))
    check("power-off without 55 AA 55 AA: no reply", out[6:], b"")

    out, _ = run(host_bin, poweron + frame(0x01, 0x08, b"\x00\x01\x03\x04" + b"1234"))
    check("dial answers cmd 0B 00 + 19 zero bytes (connected; Gather Beat needs >= 24)", out[6:], frame(0x01, 0x0B, bytes(20)))

    out, _ = run(host_bin, poweron + frame(0x01, 0x0A, b"\x01"))
    check("hang-up answers cmd 0B 01 00 00 00 (line down)", out[6:], frame(0x01, 0x0B, b"\x01\x00\x00\x00"))

    out, _ = run(host_bin, poweron + frame(0x07, 0x42))
    check("unknown type: ignored as noise, no reply", out[6:], b"")

    out, _ = run(host_bin, poweron + frame(0x01, 0x77))
    check("unknown command of a known type: no reply", out[6:], b"")

    out, _ = run(host_bin, b"\x8f\x8f\x01\x8f" + poweron)
    check("link-cable noise (8F) right before power-on is skipped", out, frame(0x01, 0x02, b"10"))

    out, _ = run(host_bin, poweron + bytes([0x11, 0, 150]) + bytes(150))
    check("oversized frame: no reply", out[6:], b"")

    # Full socket round trip against a local server, through redirect + portmap.
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]
    seen = {}

    def serve():
        c, _ = srv.accept()
        seen["req"] = c.recv(100)
        c.sendall(b"HTTP/1.0 200 OK\r\n\r\nhello")
        c.close()

    t = threading.Thread(target=serve, daemon=True)
    t.start()

    name = b"rakujang.wgg.channel.or.jp"
    data = (poweron
            + frame(0x11, 0x08, name + b"\x00")
            + frame(0x11, 0x01, b"\x00")
            + frame(0x11, 0x03, b"\x00\x00\x02" + (80).to_bytes(2, "little") + bytes([127, 0, 0, 1]))
            + frame(0x11, 0x0E, b"\x00GET / HTTP/1.0\r\n\r\n")
            + frame(0x11, 0x0D, b"\x00\x40")
            + frame(0x11, 0x0D, b"\x00\x40")
            + frame(0x11, 0x0F, b"\x00\x40")
            + frame(0x11, 0x0F, b"\x00\x40")
            + frame(0x11, 0x07, b"\x00"))
    out, err = run(host_bin, data, f"server 127.0.0.1\nportmap 80 {port}\n")
    t.join(5)
    want = (frame(0x01, 0x02, b"10")
            + frame(0x11, 0x08, b"\x01" + name + b"\x00" + bytes([127, 0, 0, 1]))
            + frame(0x11, 0x01, b"\x00")
            + frame(0x11, 0x03, b"\x00\x01")
            + frame(0x11, 0x0E, b"\x00\x12")
            + frame(0x11, 0x0D, b"\x00\x11HTTP/1.0 200 OK\r\n")
            + frame(0x11, 0x0D, b"\x00\x02\r\n")
            + frame(0x11, 0x0F, b"\x00\x05hello")
            + frame(0x11, 0x0F, b"\x00\xFF")
            + frame(0x11, 0x07, b"\x00\x01"))
    check("DNS redirect, portmap, send, line recv, block recv, EOF, close", out, want)
    check("server got the request", seen.get("req", b""), b"GET / HTTP/1.0\r\n\r\n")

    # ---- Lode Runner DATA I/O link peer (our addition) ----
    say = lambda w: w + b"\x00"
    rec = lr_record()
    port, t, seen = one_shot_server(b"HTTP/1.0 200 OK\r\nContent-Length: 20\r\n\r\nstage queued abc123\n")
    out, err = run(host_bin, say(b"SEND") + say(b"OK") + rec, f"server 127.0.0.1\nportmap 80 {port}\n")
    t.join(5)
    check("link: SEND answered RECV + OK, nothing after the record", out, say(b"RECV") + say(b"OK"))
    req = seen.get("req", b"")
    head, _, body = req.partition(b"\r\n\r\n")
    check("link: record uploaded as the POST body", body, rec)
    check("link: POST /loderunner/stage, Host link.swanrevival.com (redirected + portmapped)",
          truth(b"POST /loderunner/stage HTTP/1.0" in head and b"Host: link.swanrevival.com" in head
                and b"Content-Length: 512" in head), b"yes")
    check("link: server's answer logged", truth("upload accepted (HTTP 200): stage queued abc123" in err), b"yes")

    port, t, seen = one_shot_server(b"HTTP/1.0 200 OK\r\n\r\n")
    out, err = run(host_bin, say(b"SEND") + say(b"OK") + lr_record(crc_ok=False) + poweron,
                   f"server 127.0.0.1\nportmap 80 {port}\n")
    check("link: bad CRC -> not uploaded; frames work again after the record", out,
          say(b"RECV") + say(b"OK") + frame(0x01, 0x02, b"10"))
    check("link: bad CRC logged, server not contacted",
          truth("record rejected (CRC-32 mismatch)" in err and "req" not in seen), b"yes")

    out, _ = run(host_bin, say(b"SEND") + say(b"NG"))
    check("link: NG (sender missed our mode) -> RECV again", out, say(b"RECV") + say(b"OK") + say(b"RECV"))

    out, _ = run(host_bin, say(b"RECV") + poweron)
    check("link: a console in receive mode gets no link answer (its NUL wakes the adapter as before)",
          out, b"\x55" * 5 + frame(0x01, 0x02, b"10"))

    out, _ = run(host_bin, b"SEN" + poweron + b"SEND" + poweron)
    check("link: SEND without its NUL is not a sender", out, frame(0x01, 0x02, b"10") * 2)

    out, _ = run(host_bin, b"\x00" * 10 + poweron + frame(0x11, 0x0E, b"\x00SEND\x00x") + say(b"SEND"))
    check("link: SEND inside a frame body is data; between frames it starts the peer", out,
          b"\x55" * 5 + frame(0x01, 0x02, b"10") + frame(0x11, 0x0E, b"\x00\xff") + say(b"RECV") + say(b"OK"))

    def paced(chunks, conf_text=""):
        """Feed chunks with pauses (a number = seconds of silence) to a live host."""
        with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as f:
            f.write(conf_text)
            conf = f.name
        p = subprocess.Popen([host_bin, "ASDF", "--config", conf], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for c in chunks:
            if isinstance(c, float):
                time.sleep(c)
            else:
                p.stdin.write(c)
                p.stdin.flush()
        out, err = p.communicate(timeout=10)
        os.unlink(conf)
        return out, err.decode(errors="replace")

    # The host's frame gap is 500 ms.
    out, err = paced([say(b"SEND") + say(b"OK") + rec[:100], 1.2, poweron])
    check("link: a quiet line drops a half transfer, then frames work", out,
          say(b"RECV") + say(b"OK") + frame(0x01, 0x02, b"10"))
    check("link: drop logged", truth("transfer dropped (100 of 512" in err), b"yes")

    out, err = paced([say(b"SEND") + say(b"OK"), 1.2, poweron])
    check("link: no record after two quiet spells -> dropped, frames work", out,
          say(b"RECV") + say(b"OK") + frame(0x01, 0x02, b"10"))

    port, t, seen = one_shot_server(b"HTTP/1.0 200 OK\r\n\r\nstage queued x\n")
    out, err = paced([say(b"SEND") + say(b"OK"), 0.7, rec], f"server 127.0.0.1\nportmap 80 {port}\n")
    t.join(5)
    check("link: one quiet spell before the record is allowed (the sender reads its EEPROM)",
          seen.get("req", b"").partition(b"\r\n\r\n")[2], rec)
    if FAILS:
        print(err)

    print(f"\n{'ALL PASS' if not FAILS else f'{FAILS} FAILED'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
