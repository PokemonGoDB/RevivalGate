#!/usr/bin/env python3
"""Print the cartridge SRAM held in a drive.py state file (non-zero rows only).

    emu/sram.py STATE [OUT.bin]
"""
import base64
import json
import sys


def sram(path):
    data = base64.b64decode(json.loads(open(path).read())["data"])
    i = data.find(b"\x04SRAM")
    size = int.from_bytes(data[i + 5:i + 9], "little")
    return data[i + 9:i + 9 + size]


def main():
    s = sram(sys.argv[1])
    if len(sys.argv) > 2:
        open(sys.argv[2], "wb").write(s)
    print(f"SRAM {len(s):#x} bytes")
    for a in range(0, len(s), 16):
        row = s[a:a + 16]
        if any(b not in (0, 0xFF) for b in row):
            print(f"{a:05X}  {row.hex(' ')}  {''.join(chr(b) if 32 <= b < 127 else '.' for b in row)}")


if __name__ == "__main__":
    main()
