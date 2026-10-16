#!/usr/bin/env python3
"""List every instruction that reads a RAM range while steps play.

    emu/watchrange.py GAME ADDR LEN STEPS...      (ADDR/LEN hex; steps as in drive.py,
                                                  incl. load:NAME from runs/<game>/)
Prints CS:PC, the address read and the byte, ordered by address: the parse order
of a reply buffer.
"""
import os
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import drive  # noqa: E402


def main():
    game, addr, size, steps = sys.argv[1], int(sys.argv[2], 16), int(sys.argv[3], 16), sys.argv[4:]
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
                regs = ws.call("registers")
                k = (regs["CS"], regs["PC"], r["stop"]["cpu_address"])
                if k not in seen:
                    seen[k] = (r["stop"]["cpu_address"], r["stop"]["value"], regs)
                continue
            if frame[0] >= t and not r["partial_frame"]:
                return

    armed = False
    for step in steps:
        if step.startswith("load:"):
            ws.call("state.load", path=str(out / f"{step[5:]}.state"))
            r = ws.call("status"); frame[0] = r["frame"]
            continue
        if not armed:
            ws.call("watch.add", space="cpu", address=addr, size=size, access="read")
            armed = True
        if re.fullmatch(r"w\d+", step):
            run(int(step[1:]), [])
        else:
            b, _, hold = step.partition("*")
            run(int(hold or 6), b.split("+"))
            run(10, [])
    ws.close()
    for (cs, pc, _), (a, v, regs) in sorted(seen.items(), key=lambda x: x[1][0]):
        print(f"{cs:04X}:{pc:04X} [{a:04X}]={v:02X} {chr(v) if 32 <= v < 127 else '.'}  "
              f"SI={regs['SI']:04X} DI={regs['DI']:04X} BX={regs['BX']:04X} CX={regs['CX']:04X} DS={regs['DS']:04X} ES={regs['ES']:04X}")


if __name__ == "__main__":
    main()
