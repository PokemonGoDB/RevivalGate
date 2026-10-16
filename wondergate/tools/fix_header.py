#!/usr/bin/env python3
"""Copy a ROM into local/roms/ with a corrected header save type (and checksum).

    tools/fix_header.py ROM SAVETYPE      e.g. 02 = 32 KB SRAM

Star Hearts declares 8 KB SRAM (01) but uses 32 KB, so emulators lose its saves
and its WonderGate menu never unlocks (Keitai Archive's WS-WonderGate-Patches
fixes the same header). emu/drive.py prefers local/roms/ copies.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    src, save = pathlib.Path(sys.argv[1]), int(sys.argv[2], 16)
    d = bytearray(src.read_bytes())
    d[-5] = save
    s = sum(d[:-2]) & 0xFFFF
    d[-2:] = s.to_bytes(2, "little")
    out = ROOT / "local" / "roms" / src.name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(d)
    print(f"{out}: save type {save:02X}, checksum {s:04X}")


if __name__ == "__main__":
    main()
