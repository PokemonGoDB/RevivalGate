#!/usr/bin/env python3
"""Break at CPU linear addresses while steps play; print registers and the stack.

    emu/stackat.py GAME LINEAR[,LINEAR...] STEPS...   (hex; steps as in drive.py, incl. load:NAME)
Prints the first N hits (env HITS, default 3) with 24 stack words: the return
addresses of the callers, for walking up from a known routine. DUMP=space:addr+len[,...]
(hex; space ram, rom or cpu — SRAM is cpu:1XXXX) also prints memory at each hit.
"""
import os
import re
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import drive  # noqa: E402


def main():
    game, addrs, steps = sys.argv[1], [int(a, 16) for a in sys.argv[2].split(",")], sys.argv[3:]
    out = drive.ROOT / "runs" / re.sub(r"\W+", "-", game.lower()).strip("-")
    os.environ["WG_ADAPTER_CONFIG"] = str(drive.ROOT / "dev.conf")
    os.environ["WG_ADAPTER_LOG"] = str(out / "adapter-watch.log")
    sys.path.insert(0, str(drive.TRANSLATION))
    from emulator.client import Client
    ws = Client(core=drive.CORE)
    ws.call("rom.load", path=str(drive.find_rom(game)), profile="none")
    hits = [0]
    limit = int(os.environ.get("HITS", "3"))
    frame = [0]

    def run(n, buttons):
        t = frame[0] + n
        while True:
            r = ws.call("run", frames=max(1, min(t - frame[0], 3600)), buttons=buttons)
            frame[0] = r["frame"]
            if r["stop"]["kind"] == "execute":
                if hits[0] < limit:
                    hits[0] += 1
                    g = ws.call("registers")
                    sp = (g["SS"] << 4) + g["SP"]
                    st = bytes.fromhex(ws.call("mem.read", space="ram", address=sp & 0xFFFF, size=48)["hex"])
                    words = " ".join(f"{int.from_bytes(st[i:i + 2], 'little'):04X}" for i in range(0, 48, 2))
                    print(f"hit {g['CS']:04X}:{g['PC']:04X} AX={g['AX']:04X} BX={g['BX']:04X} CX={g['CX']:04X} "
                          f"DX={g['DX']:04X} SI={g['SI']:04X} DI={g['DI']:04X} DS={g['DS']:04X} ES={g['ES']:04X} "
                          f"BP={g['BP']:04X} SS={g['SS']:04X} SP={g['SP']:04X}\n  stack {words}", flush=True)
                    for spec in filter(None, os.environ.get("DUMP", "").split(",")):
                        space, _, rest = spec.partition(":")
                        a, _, n = rest.partition("+")
                        d = ws.call("mem.read", space=space, address=int(a, 16), size=int(n, 16))["hex"]
                        print(f"  {space}:{a} {d}", flush=True)
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
            for a in addrs:
                ws.call("break.add", space="cpu", address=a)
            armed = True
        if re.fullmatch(r"w\d+", step):
            run(int(step[1:]), [])
        else:
            b, _, hold = step.partition("*")
            run(int(hold or 6), b.split("+"))
            run(10, [])
    ws.close()


if __name__ == "__main__":
    main()
