#!/usr/bin/env python3
"""Disassemble game code at CPU addresses, mapped to ROM through the emulator.

    emu/disasm.py GAME STATE SEG:OFF[,SEG:OFF...] [before] [after]

STATE is a state name in runs/<game>/ (bank selectors are taken from it).
Needs ndisasm. Prints each address's ROM offset and the code around it, with
offsets shown as SEG:OFF so they line up with debugger output.
"""
import os
import pathlib
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import drive  # noqa: E402


def main():
    game, state, addrs = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
    before = int(sys.argv[4], 16) if len(sys.argv) > 4 else 0x40
    after = int(sys.argv[5], 16) if len(sys.argv) > 5 else 0x80
    os.environ["WG_ADAPTER_CONFIG"] = str(drive.ROOT / "dev.conf")
    os.environ["WG_ADAPTER_LOG"] = "/dev/null"
    sys.path.insert(0, str(drive.TRANSLATION))
    from emulator.client import Client
    rom_path = drive.find_rom(game)
    rom = rom_path.read_bytes()
    out = drive.ROOT / "runs" / re.sub(r"\W+", "-", game.lower()).strip("-")
    with Client(core=drive.CORE) as ws:
        ws.call("rom.load", path=str(rom_path), profile="none")
        if state != "-":
            ws.call("state.load", path=str(out / f"{state}.state"))
        for a in addrs:
            seg, off = (int(v, 16) for v in a.split(":"))
            lin = ((seg << 4) + off) & 0xFFFFF
            m = ws.call("address.map", address=lin)
            ro = m["rom_offset"]
            print(f"=== {seg:04X}:{off:04X} linear {lin:05X} rom {ro:#x}" if ro is not None else f"=== {a}: not ROM ({m['region']})")
            if ro is None:
                continue
            start = max(0, ro - before)
            with tempfile.NamedTemporaryFile(suffix=".bin") as f:
                f.write(rom[start:ro + after]); f.flush()
                dis = subprocess.run(["ndisasm", "-b16", "-o", str(off - (ro - start)), f.name],
                                     capture_output=True, text=True).stdout
            for line in dis.splitlines():
                print(f"{seg:04X}:{line}")


if __name__ == "__main__":
    main()
