#!/usr/bin/env python3
"""Tests for server/loderunner.py (link-cable stage uploads), on a temporary queue file.

    python3 -I tools/test_loderunner.py
"""
import hashlib
import json
import os
import pathlib
import struct
import sys
import tempfile
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
tmp = tempfile.mkdtemp()
os.environ["WG_LODERUNNER_QUEUE"] = os.path.join(tmp, "loderunner.json")
sys.path.insert(0, str(ROOT / "server"))
import loderunner  # noqa: E402

FAILS = 0


def check(name, got, want):
    global FAILS
    ok = got == want
    FAILS += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"\n    got  {got!r}\n    want {want!r}"))


def record(grid, music=1, crc_fix=0, magic=b"\x4c\x97"):
    rec = bytes(grid) + struct.pack("<H", music)
    return rec + struct.pack("<I", zlib.crc32(rec) ^ crc_fix) + magic


def test_grid(gold_at=5):
    """Synthetic test pattern (not a stage): solid border, brick floor, one gold tile."""
    g = bytearray(28 * 18)
    for r in range(18):
        for c in range(28):
            g[28 * r + c] = 0x05 if r in (0, 17) or c in (0, 27) else 0x04 if r == 16 else 0x00
    g[28 * 15 + gold_at] = 0x0E
    return g


def main():
    status = lambda rec: loderunner.handle({"x-wg-peer": "127.0.0.1"}, rec)[:3]
    g = test_grid()
    sid = hashlib.sha1(bytes(g)).hexdigest()[:12]

    check("new stage queued", status(record(g, 3)), (200, "text/plain", f"stage queued {sid}\r\n".encode()))
    q = json.loads(pathlib.Path(os.environ["WG_LODERUNNER_QUEUE"]).read_text())["stages"]
    check("queue entry", (len(q), q[0]["id"], q[0]["grid"], q[0]["music"], q[0]["status"], q[0]["source"]),
          (1, sid, bytes(g).hex(), 3, "pending", "link-cable"))
    check("same grid again (other music): still queued, not duplicated",
          status(record(g, 5))[0], 200)
    q = json.loads(pathlib.Path(os.environ["WG_LODERUNNER_QUEUE"]).read_text())["stages"]
    check("dedupe by grid", (len(q), q[0]["times_received"]), (1, 2))
    status(record(test_grid(7)))
    check("a different grid is a second entry",
          len(json.loads(pathlib.Path(os.environ["WG_LODERUNNER_QUEUE"]).read_text())["stages"]), 2)

    check("bad CRC refused", status(record(g, crc_fix=1))[0], 422)
    check("no 4C 97 refused", status(record(g, magic=b"\xb3\x96"))[0], 422)
    bad = bytearray(g)
    bad[100] = 0x1F
    check("tile above 0x1E refused", status(record(bad))[0], 422)
    check("short body refused", status(b"\x00" * 504)[0], 422)

    # A built-in map is recognised by its hash alone; fake one by adding the test grid's hash.
    loderunner.BUILTIN[hashlib.sha1(bytes(test_grid(9))).hexdigest()] = "built-in map (test)"
    check("built-in copy refused", status(record(test_grid(9)))[:1], (409,))
    check("hash list: 126 built-in maps + the empty map", len(loderunner.builtin_hashes()), 127)

    print(f"\n{'ALL PASS' if not FAILS else f'{FAILS} FAILED'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
