#!/usr/bin/env python3
"""Build a TEST download set for SD Gundam Gashapon Senki Episode 1 from your own dump.

    tools/make_sdgundame.py [ROM]

The 12 maps Bandai served are lost. This packs the game's 10 built-in maps, with their
own title graphics, only to exercise the download path while the map format is decoded.
It is not served: output goes to local/sdgundame-test/ (gitignored), never to
server/content/, which is what the live server hands out. To test, copy it to
server/content/sdgundame/ on your machine and don't commit it.
Format notes: docs/wondergate/gashapon-senki.md.
"""
import pathlib
import struct
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "local" / "sdgundame-test"
PREFIX = "/download/sdgundame/"
MAPS = 0x80000        # page 8: far pointers (offset, segment) to the maps
TITLES = 0x62EDF      # 6000:2EDF: 10 title strips, 0x200 bytes each (16x2 tiles, 2bpp)
MAP_MAX = 0x600       # the cartridge refuses bigger maps (error 599) and copies 0x600


def find_rom():
    sys.path.insert(0, str(ROOT / "emu"))
    import drive
    return drive.find_rom("gashapon")


def main():
    rom = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else find_rom()
    d = rom.read_bytes()
    ptrs = [struct.unpack_from("<HH", d, MAPS + 4 * i) for i in range(10)]
    if any(seg != 0x8000 for _, seg in ptrs):
        sys.exit(f"{rom.name}: map table not found; is this Gashapon Senki Episode 1?")
    offs = [o for o, _ in ptrs]
    OUT.mkdir(parents=True, exist_ok=True)
    index = [":[MAP]"]
    for i, o in enumerate(offs):
        size = (offs[i + 1] - o) if i + 1 < len(offs) else MAP_MAX
        n = f"{i + 1:04d}"
        (OUT / f"M{n}.BIN").write_bytes(d[MAPS + o:MAPS + o + min(size, MAP_MAX)])
        (OUT / f"T{n}.BIN").write_bytes(d[TITLES + 0x200 * i:TITLES + 0x200 * (i + 1)])
        index += [f"m{n} {PREFIX}T{n}.BIN", f"file={PREFIX}M{n}.BIN"]
    # The cartridge's reader returns from end-of-data without restoring its
    # stack, so the list must end on a line the parser stops at before the end.
    index.append(":[END]")
    (OUT / "INDEX.TXT").write_bytes(("\r\n".join(index) + "\r\n").encode())
    print(f"{len(offs)} maps -> {OUT}")


if __name__ == "__main__":
    main()
