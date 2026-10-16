#!/usr/bin/env python3
"""Look for saved stages in a Lode Runner for WonderSwan cartridge save (2 KB EEPROM dump).

    tools/loderunner_save.py SAVE [ROM]

The game keeps no copy of a downloaded stage: it lands in the map editor's work buffer, and only
survives if the player saved it to MAP1 or MAP2. Those two slots are the only places an original
WonderGate stage can still exist on a cartridge. Each slot (EEPROM 0x200 and 0x400, 0x200 bytes):
  +0x000  28x18 tile grid, row-major, bytes 0x00-0x1E (the download format, 504 bytes)
  +0x1F8  word: background music chosen in the editor's sound menu
  +0x1FA  CRC-32 of +0x000..+0x1F9 (zlib's), little-endian
  +0x1FE  4C 97 = valid (B3 96 = erased or interrupted save)
With your own ROM, slots that are copies of a built-in map are named, since players
could load a built-in map into the editor and save it. Anything else is player-made, received over
the link cable, or downloaded: the data does not say which. Please send us any unknown stage.
Accepts either byte order (some dumpers swap the 16-bit EEPROM words).
"""
import pathlib
import struct
import sys
import zlib

SLOTS = (0x200, 0x400)
GRID = 28 * 18
MAPS, STRIDE, BUILTIN = 0x60000, 2 + GRID, 126


def builtins(rom):
    d = rom.read_bytes()
    return {d[MAPS + STRIDE * i + 2:MAPS + STRIDE * (i + 1)]: i for i in range(BUILTIN)
            if d[MAPS + STRIDE * i:MAPS + STRIDE * i + 2] == b"\x1c\x12"}


def main():
    save = pathlib.Path(sys.argv[1]).read_bytes()
    if len(save) < 0x600:
        sys.exit(f"{len(save)} bytes: expected the 2 KB EEPROM save")
    if any(save[s + 0x1FE:s + 0x200] in (b"\x97\x4c", b"\x96\xb3") for s in SLOTS):
        save = b"".join(save[i + 1:i + 2] + save[i:i + 1] for i in range(0, len(save), 2))
        print("(byte-swapped dump)")
    known = {}
    if len(sys.argv) > 2:
        known = builtins(pathlib.Path(sys.argv[2]))
    for n, s in enumerate(SLOTS, 1):
        slot = save[s:s + 0x200]
        magic = slot[0x1FE:0x200]
        crc_ok = zlib.crc32(slot[:0x1FA]) == struct.unpack_from("<I", slot, 0x1FA)[0]
        grid = slot[:GRID]
        state = "valid" if magic == b"\x4c\x97" and crc_ok else \
            "erased" if magic == b"\xb3\x96" else f"empty/invalid (magic {magic.hex()}, crc {'ok' if crc_ok else 'bad'})"
        print(f"MAP{n} (EEPROM {s:#05x}): {state}, music {struct.unpack_from('<H', slot, GRID)[0]}")
        if state != "valid":
            continue
        if grid in known:
            print(f"  copy of built-in map index {known[grid]} (not a lost stage)")
        else:
            print("  not a built-in map" if known else "  (pass the ROM to compare with the built-in maps)")
        for r in range(18):
            print("  " + " ".join(f"{b:02x}" if b else " ." for b in grid[28 * r:28 * r + 28]))


if __name__ == "__main__":
    main()
