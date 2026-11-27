#!/usr/bin/env python3
"""Fingerprint a screenshot so a replay can tell the game's success screen from an error screen.

    emu/screen.py SHOT.png            print the fingerprint
    emu/screen.py A.png B.png         print how many tiles differ

The screen is 28 x 18 tiles of 8 x 8 pixels. Each tile becomes one hex digit (a hash of its
pixels), so the fingerprint is 504 characters and holds no picture of the game. '.' marks a tile
that isn't compared (one that changes from run to run, such as a blinking cursor).
"""
import pathlib
import sys
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
from tile import load  # noqa: E402

COLS, ROWS, TILE = 28, 18, 8


def fingerprint(png):
    rows = load(png)
    scale = len(rows) // (ROWS * TILE)  # drive.py's screenshots are 2x
    out = []
    for ty in range(ROWS):
        for tx in range(COLS):
            px = b"".join(rows[(ty * TILE + y) * scale][(tx * TILE + x) * scale]
                          for y in range(TILE) for x in range(TILE))
            out.append("%x" % (zlib.crc32(px) & 15))
    return "".join(out)


def differing(a, b):
    """Tiles that differ, leaving out those either side marks as not compared."""
    return sum(1 for x, y in zip(a, b) if x != y and "." not in (x, y))


def merge(a, b):
    """One fingerprint from two runs of the same replay: tiles that differ aren't compared."""
    return "".join(x if x == y else "." for x, y in zip(a, b))


if __name__ == "__main__":
    prints = [fingerprint(p) for p in sys.argv[1:3]]
    print(prints[0] if len(prints) == 1 else differing(*prints))
