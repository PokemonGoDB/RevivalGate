#!/usr/bin/env python3
"""Find the code that parses a server reply: which instructions read a marker.

    emu/findreaders.py GAME MARKER STEPS... -- STEPS...

Runs the first STEPS (load:NAME restores runs/<game>/NAME.state), then plays the second STEPS (the connection) once to find
MARKER (e.g. a unique player name the server sends) in RAM, replays everything
with a read-watchpoint on it, and prints each distinct CS:PC that read it with
its registers. The first readers are usually copy/strlen helpers; the parser is
typically the one reading it as data.
"""
import os
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import drive  # noqa: E402


def session(game, before, after, on_stop=None):
    rom = drive.find_rom(game)
    out = drive.ROOT / "runs" / "findreaders"
    out.mkdir(parents=True, exist_ok=True)
    os.environ["WG_ADAPTER_CONFIG"] = str(drive.ROOT / "dev.conf")
    os.environ["WG_ADAPTER_LOG"] = str(out / "adapter.log")
    sys.path.insert(0, str(drive.TRANSLATION))
    from emulator.client import Client
    ws = Client(core=drive.CORE)
    ws.call("rom.load", path=str(rom), profile="none")
    frame = [0]

    def run(n, buttons):
        """Run n whole frames; debugger stops go to on_stop and execution continues."""
        t = frame[0] + n
        while True:
            r = ws.call("run", frames=max(1, min(t - frame[0], 3600)), buttons=buttons)
            frame[0] = r["frame"]
            if r["stop"]["kind"] not in ("instructions", "frames") and on_stop:
                on_stop(ws, r)
                continue
            if frame[0] >= t and not r["partial_frame"]:
                return r

    states = drive.ROOT / "runs" / re.sub(r"\W+", "-", game.lower()).strip("-")

    def play(steps):
        for step in steps:
            if step.startswith("load:"):
                ws.call("state.load", path=str(states / f"{step[5:]}.state"))
                frame[0] = ws.call("status")["frame"]
            elif step.startswith("w"):
                yield run(int(step[1:]), [])
            else:
                b, _, hold = step.partition("*")
                yield run(int(hold or 6), b.split("+"))
                yield run(10, [])

    for _ in play(before):
        pass
    return ws, play, run


def main():
    game, marker = sys.argv[1], sys.argv[2].encode("latin-1")
    rest = sys.argv[3:]
    split = rest.index("--")
    before, after = rest[:split], rest[split + 1:]

    # Waits are split into 60-frame slices and RAM is searched after each:
    # games reuse the reply buffer soon after parsing it.
    sliced = []
    for step in after:
        if step.startswith("w"):
            n = int(step[1:])
            sliced += ["w60"] * (n // 60) + ([f"w{n % 60}"] if n % 60 else [])
        else:
            sliced.append(step)
    after = sliced
    ws, play, run = session(game, before, after)
    hits = []
    for _ in play(after):
        ram = bytes.fromhex(ws.call("mem.read", space="ram", address=0, size=65536)["hex"])
        hits = [i for i in range(len(ram)) if ram.startswith(marker, i)]
        if hits:
            break
    ws.close()
    print("marker at RAM", [hex(h) for h in hits])
    if not hits:
        return 1

    seen = {}

    def on_stop(ws, r):
        regs = ws.call("registers")
        key = (regs["CS"], regs["PC"])
        if key not in seen:
            seen[key] = (r["stop"]["value"], regs)

    ws, play, run = session(game, before, after, on_stop)
    ws.call("watch.add", space="cpu", address=hits[0], size=1, access="read")
    for _ in play(after):
        pass
    for (cs, pc), (val, regs) in seen.items():
        rom = ((cs << 4) + pc) & 0xFFFFF
        shown = {k: f"{regs[k]:04X}" for k in ("AX", "BX", "CX", "DX", "SI", "DI", "DS", "ES")}
        print(f"{cs:04X}:{pc:04X} (linear {rom:05X}) read {val:02X} {chr(val) if 32 <= val < 127 else '.'} {shown}")
    ws.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
