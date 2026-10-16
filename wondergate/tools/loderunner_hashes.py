#!/usr/bin/env python3
"""Write server/loderunner_builtin.txt: SHA-1 hashes of Lode Runner for WonderSwan's own grids.

    tools/loderunner_hashes.py [ROM]

The server refuses link-cable uploads that are exact copies of a built-in map (players can load
one into the editor with 既存マップ参照 and save it) or of the editor's empty map. Only the hashes
are committed, never map data. Grids: 126 blocks of [1C 12] + 504 bytes from ROM 0x60000, 506 bytes
apart; the editor's empty map is the same shape at ROM 0x6820 (docs/wondergate/lode-runner.md).
"""
import hashlib
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "server" / "loderunner_builtin.txt"
MAPS, STRIDE, COUNT, BLANK = 0x60000, 2 + 28 * 18, 126, 0x6820


def grid(d, at):
    if d[at:at + 2] != b"\x1c\x12" or max(d[at + 2:at + STRIDE]) > 0x1E:
        sys.exit(f"no map at {at:#x}; is this Lode Runner for WonderSwan?")
    return d[at + 2:at + STRIDE]


def main():
    if len(sys.argv) > 1:
        rom = pathlib.Path(sys.argv[1])
    else:
        sys.path.insert(0, str(ROOT / "emu"))
        import drive
        rom = drive.find_rom("lode runner")
    d = rom.read_bytes()
    lines = ["# SHA-1 of the 28x18 tile grids built into Lode Runner for WonderSwan (hashes only, no",
             "# map data). Made by tools/loderunner_hashes.py from a dump. server/loderunner.py refuses",
             "# link-cable uploads that match one: they are Bandai's maps or the editor's empty map."]
    lines += [f"{hashlib.sha1(grid(d, MAPS + STRIDE * i)).hexdigest()} built-in map {i}" for i in range(COUNT)]
    lines.append(f"{hashlib.sha1(grid(d, BLANK)).hexdigest()} the editor's empty map")
    OUT.write_text("\n".join(lines) + "\n")
    print(f"{COUNT} built-in maps + the empty map -> {OUT}")


if __name__ == "__main__":
    main()
