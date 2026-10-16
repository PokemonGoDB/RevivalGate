#!/usr/bin/env python3
"""Print drive.py steps that type ASCII text on the MobileWonderGate cart's
direct-input keyboard (英数 mode). The cursor starts on 英数 (row 1, col 0)
unless ROW,COL is given.

    tools/mwg_type.py "wg00013@mopera.ne.jp" [ROW,COL]
Grid (row, column), column 0 is the mode column:
    a b c d e z . / ~ @  |  f g h i j _ - [ ] ,  |  k l m n o 0 1 2 3 4
    p q r s t 5 6 7 8 9  |  u v w x y
"""
import sys

ROWS = ["abcdez./~@", "fghij_-[],", "klmno01234", "pqrst56789", "uvwxy"]
POS = {ch: (r, c + 1) for r, row in enumerate(ROWS) for c, ch in enumerate(row)}


def steps(text, start=(1, 0)):
    out, (r, c) = [], start
    for ch in text:
        tr, tc = POS[ch]
        out += ["DOWN*2 w16"] * max(0, tr - r) + ["UP*2 w16"] * max(0, r - tr)
        out += ["RIGHT*2 w16"] * max(0, tc - c) + ["LEFT*2 w16"] * max(0, c - tc)
        out.append("A*2 w20")
        r, c = tr, tc
    return " ".join(out)


if __name__ == "__main__":
    start = tuple(int(v) for v in sys.argv[2].split(",")) if len(sys.argv) > 2 else (1, 0)
    print(steps(sys.argv[1], start))
