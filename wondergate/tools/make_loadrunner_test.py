#!/usr/bin/env python3
"""Build a TEST download set for Lode Runner for WonderSwan from your own dump.

    tools/make_loadrunner_test.py [ROM] [MAP...]     (MAP = built-in map index, default 0 1)

The 50+ stages Bandai served are lost. This copies some of the game's own built-in maps,
only to exercise the download path. It is not served: output goes to
local/loadrunner-test/loadrunner/ (gitignored), never to server/content/, which is what the
live server hands out. To test, start your own server with
WG_STATIC_CONTENT=$PWD/local/loadrunner-test.

Format (docs/wondergate/lode-runner.md): filelist.txt holds CRLF lines "NAME,YYYY,MM,DD"
(NAME up to 12 characters, at most 50 lines are kept); each NAME is a raw 28x18 tile grid,
exactly 504 bytes, every byte 0x00-0x1E. Built-in maps are the same grid behind a 2-byte
header (width 0x1C, height 0x12), 126 of them from ROM 0x60000, 506 bytes apart.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "local" / "loadrunner-test" / "loadrunner"
MAPS, STRIDE, COUNT = 0x60000, 2 + 28 * 18, 126


def find_rom():
    sys.path.insert(0, str(ROOT / "emu"))
    import drive
    return drive.find_rom("lode runner")


def main():
    args = sys.argv[1:]
    rom = pathlib.Path(args.pop(0)) if args and not args[0].isdigit() else find_rom()
    picks = [int(a) for a in args] or [0, 1]
    d = rom.read_bytes()
    lines = []
    OUT.mkdir(parents=True, exist_ok=True)
    for n, i in enumerate(picks, 1):
        if not 0 <= i < COUNT:
            sys.exit(f"map index {i}: the cartridge has {COUNT} (0-{COUNT - 1})")
        at = MAPS + STRIDE * i
        if d[at:at + 2] != b"\x1c\x12" or max(d[at + 2:at + STRIDE]) > 0x1E:
            sys.exit(f"{rom.name}: no map at {at:#x}; is this Lode Runner for WonderSwan?")
        name = f"TEST{n:02d}.MAP"
        (OUT / name).write_bytes(d[at + 2:at + STRIDE])
        lines.append(f"{name},2000,4,{n}")   # the list shows No. and year/month/day; test dates
    (OUT / "filelist.txt").write_bytes(("\r\n".join(lines) + "\r\n").encode())
    print(f"{len(picks)} built-in maps {picks} -> {OUT}")


if __name__ == "__main__":
    main()
