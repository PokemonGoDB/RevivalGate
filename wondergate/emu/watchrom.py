#!/usr/bin/env python3
"""List the instructions that read a ROM range (by ROM offset) while steps play.

    emu/watchrom.py GAME ROMOFF LEN STEPS...    (hex; steps as in drive.py, incl. load:NAME)
Watches the range in every 64 KB window it could be banked into, then keeps
the hits that really map to the ROM offset. Finds code that uses a string or
table without knowing the bank layout.
"""
import os
import re
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import drive  # noqa: E402


def main():
    game, romoff, size, steps = sys.argv[1], int(sys.argv[2], 16), int(sys.argv[3], 16), sys.argv[4:]
    out = drive.ROOT / "runs" / re.sub(r"\W+", "-", game.lower()).strip("-")
    os.environ["WG_ADAPTER_CONFIG"] = str(drive.ROOT / "dev.conf")
    os.environ["WG_ADAPTER_LOG"] = str(out / "adapter-watch.log")
    sys.path.insert(0, str(drive.TRANSLATION))
    from emulator.client import Client
    ws = Client(core=drive.CORE)
    ws.call("rom.load", path=str(drive.find_rom(game)), profile="none")
    seen = {}
    frame = [0]

    def run(n, buttons):
        t = frame[0] + n
        while True:
            r = ws.call("run", frames=max(1, min(t - frame[0], 3600)), buttons=buttons)
            frame[0] = r["frame"]
            if r["stop"]["kind"] == "read":
                a = r["stop"]["cpu_address"]
                m = ws.call("address.map", address=a)
                if m.get("rom_offset") is not None and romoff <= m["rom_offset"] < romoff + size:
                    regs = ws.call("registers")
                    k = (regs["CS"], regs["PC"], m["rom_offset"])
                    seen.setdefault(k, (m["rom_offset"], a, regs))
                continue
            if frame[0] >= t and not r["partial_frame"]:
                return

    armed = False
    for step in steps:
        if step.startswith("load:"):
            ws.call("state.load", path=str(out / f"{step[5:]}.state"))
            frame[0] = ws.call("status")["frame"]
            continue
        if not armed:
            for base in [0x20000, 0x30000] + [n << 16 for n in range(4, 16)]:
                ws.call("watch.add", space="cpu", address=base + (romoff & 0xFFFF), size=size, access="read")
            armed = True
        if re.fullmatch(r"w\d+", step):
            run(int(step[1:]), [])
        else:
            b, _, hold = step.partition("*")
            run(int(hold or 6), b.split("+"))
            run(10, [])
    ws.close()
    for (cs, pc, _), (ro, a, regs) in sorted(seen.items(), key=lambda x: x[1][0]):
        print(f"{cs:04X}:{pc:04X} rom {ro:#x} cpu {a:05X}  SI={regs['SI']:04X} DI={regs['DI']:04X} "
              f"BX={regs['BX']:04X} DS={regs['DS']:04X} ES={regs['ES']:04X}")


if __name__ == "__main__":
    main()
