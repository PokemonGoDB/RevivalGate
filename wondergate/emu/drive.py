#!/usr/bin/env python3
"""Play a WonderGate game headless, with our adapter on the serial port.

Uses the translation project's wscli emulator host (JSON-lines protocol) with
our core build (emu/build_core.sh), so nothing opens on screen.

    emu/drive.py "raku jongg" w300 START w120 RIGHT A w60 s:menu

Steps, run in order:
    wN          run N frames with nothing held
    BUTTON      press for 6 frames, then 10 idle (A B START UP DOWN LEFT RIGHT
                Y_UP Y_DOWN Y_LEFT Y_RIGHT); BUTTON*N holds it N frames;
                A+B+Y_UP*120 holds several (e.g. a power-on combo as the first step)
    s:NAME      screenshot -> OUT/NAME.png (2x)
    save:NAME / load:NAME   emulator state in OUT/NAME.state
    reset       console reset (cartridge SRAM is kept)
    farcall:SEG:OFF  call a far routine from the current point (pushes CS:IP, jumps;
                its RETF resumes the game), e.g. a game's WonderGate request routine
    poke:ADDR=VAL   set a cartridge SRAM byte (ADDR, VAL hex; ADDR 0-FFFF within SRAM)
    eeprom:ADDR=VAL set a console internal EEPROM byte (word N = bytes 2N, 2N+1, low first)
    cartee:ADDR=VAL set a cartridge EEPROM byte (same layout)
                poke/eeprom/cartee: a VAL longer than 2 hex digits is a run of bytes from ADDR
                (e.g. cartee:200=4C97 sets 0x200 and 0x201), written in one state round trip
    ram:ADDR=VAL    set a console RAM byte (ADDR, VAL hex), e.g. to jump to a game mode
                through a save-state round trip; marks the run debug_injected.
                Stands in for game progress a feature needs.

Output defaults to runs/<game>/ ; the adapter trace goes to OUT/adapter.log.
Make sure the server is running (tools/serve.sh).
"""
import argparse
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TRANSLATION = pathlib.Path(os.environ.get("WSCLI_HOME", ROOT / "local/wscli"))  # the headless emulator host (README.md)
CORE = ROOT / "local/wscli-core-wg/mednafen_wswan_libretro.dylib"
# ROM folder: WS_ROMS, else /Volumes/Games if mounted, else ~/Documents (same layout).
ROMS = pathlib.Path(os.environ.get("WS_ROMS") or next(
    (p for p in ("/Volumes/Games", pathlib.Path.home() / "Documents") if pathlib.Path(p, "WonderSwan Color").is_dir()),
    "/Volumes/Games"))
BUTTONS = {"A", "B", "START", "UP", "DOWN", "LEFT", "RIGHT", "Y_UP", "Y_DOWN", "Y_LEFT", "Y_RIGHT"}


def find_rom(name):
    # local/roms/ (gitignored) holds header-fixed copies, e.g. Star Hearts with
    # its real 32 KB SRAM (tools/fix_header.py); they win over the dumps.
    for d in (ROOT / "local" / "roms", ROMS / "WonderSwan Roms/Unzipped WS Roms",
              ROMS / "WonderSwan Color/Unzipped Roms"):
        for p in sorted(d.glob("*.ws*")):
            if name.lower() in p.name.lower():
                return p
    sys.exit(f"no ROM matching {name!r} under {ROMS}")


def poke_sram(ws, out, addr, val, section=b"\x04SRAM"):
    """Set one byte (val an int) or a run of bytes (val bytes) from addr."""
    import base64
    import json
    tmp = out / "_poke.state"
    tmp.unlink(missing_ok=True)
    ws.call("state.save", path=str(tmp))
    j = json.loads(tmp.read_text())
    data = bytearray(base64.b64decode(j["data"]))
    # Mednafen state section: [name length]["SRAM"][u32 size][data]
    # (the console EEPROM is "\x07iEEPROM" + u32 size + data)
    i = data.find(section)
    if i < 0:
        sys.exit(f"poke: no {section[1:].decode()} section in the state")
    n = len(section)
    size = int.from_bytes(data[i + n:i + n + 4], "little")
    vals = val if isinstance(val, bytes) else bytes([val])
    if addr + len(vals) > size:
        sys.exit(f"poke: {section[1:].decode()} is only {size:#x} bytes")
    data[i + n + 4 + addr:i + n + 4 + addr + len(vals)] = vals
    j["data"] = base64.b64encode(bytes(data)).decode()
    j["provenance"] = "debug_injected"
    tmp.write_text(json.dumps(j))
    ws.call("state.load", path=str(tmp))
    tmp.unlink()


def poke_args(arg):
    """'ADDR=VAL' -> (addr, int) for one byte, (addr, bytes) for a longer hex run."""
    addr, val = arg.split("=")
    return int(addr, 16), bytes.fromhex(val) if len(val) > 2 else int(val, 16)


def far_call(ws, out, seg, off):
    """Make the CPU call SEG:OFF as if with CALL FAR from where it stands: push
    CS:IP on the game's stack, jump, and wake it from HLT. The routine's RETF
    returns to the game. Edits the state's V30MZ registers (IP, regs = AW CW DW
    BW SP BP IX IY, sregs = ES CS SS DS)."""
    import base64
    import json
    tmp = out / "_call.state"
    tmp.unlink(missing_ok=True)
    ws.call("state.save", path=str(tmp))
    j = json.loads(tmp.read_text())
    data = bytearray(base64.b64decode(j["data"]))

    def field(name):
        i = data.find(bytes([len(name)]) + name)
        return i + 1 + len(name) + 4
    ip_at, regs_at, sregs_at, hlt_at = field(b"IP"), field(b"regs"), field(b"sregs"), field(b"InHLT")
    ip = int.from_bytes(data[ip_at:ip_at + 2], "little")
    sp = int.from_bytes(data[regs_at + 8:regs_at + 10], "little")
    cs = int.from_bytes(data[sregs_at + 2:sregs_at + 4], "little")
    ss = int.from_bytes(data[sregs_at + 4:sregs_at + 6], "little")
    sp = (sp - 4) & 0xFFFF
    ram = data.find(b"\x03RAM") + 8
    lin = ((ss << 4) + sp) & 0xFFFF
    data[ram + lin:ram + lin + 4] = ip.to_bytes(2, "little") + cs.to_bytes(2, "little")
    data[regs_at + 8:regs_at + 10] = sp.to_bytes(2, "little")
    data[ip_at:ip_at + 2] = off.to_bytes(2, "little")
    data[sregs_at + 2:sregs_at + 4] = seg.to_bytes(2, "little")
    data[hlt_at] = 0
    j["data"] = base64.b64encode(bytes(data)).decode()
    j["provenance"] = "debug_injected"
    tmp.write_text(json.dumps(j))
    ws.call("state.load", path=str(tmp))
    tmp.unlink()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("game")
    ap.add_argument("steps", nargs="*")
    ap.add_argument("--out")
    ap.add_argument("--config", default=str(ROOT / "dev.conf"))
    a = ap.parse_args()

    rom = find_rom(a.game)
    out = pathlib.Path(a.out or ROOT / "runs" / re.sub(r"\W+", "-", a.game.lower()).strip("-"))
    out.mkdir(parents=True, exist_ok=True)
    os.environ["WG_ADAPTER_CONFIG"] = a.config
    os.environ["WG_ADAPTER_LOG"] = str(out / "adapter.log")
    sys.path.insert(0, str(TRANSLATION))
    from emulator.client import Client  # noqa: E402

    with Client(core=CORE) as ws:
        ws.call("rom.load", path=str(rom), profile="none")
        frame = 0

        def run(n, buttons):
            """Run exactly n whole frames; `run` stops early on its instruction budget."""
            nonlocal frame
            target = frame + n
            while True:
                r = ws.call("run", frames=max(1, min(target - frame, 3600)), buttons=buttons)
                frame = r["frame"]
                if frame >= target and not r["partial_frame"]:
                    return

        for step in a.steps:
            if re.fullmatch(r"w\d+", step):
                run(int(step[1:]), [])
            elif all(b in BUTTONS for b in step.split("*")[0].split("+")):
                b, _, hold = step.partition("*")
                run(int(hold or 6), b.split("+"))
                run(10, [])
            elif step.startswith("s:"):
                p = out / f"{step[2:]}.png"
                p.unlink(missing_ok=True)
                ws.call("screenshot", path=str(p), scale=2)
                print(f"frame {frame}: {p}")
            elif step.startswith("save:"):
                p = out / f"{step[5:]}.state"
                p.unlink(missing_ok=True)
                ws.call("state.save", path=str(p))
            elif step.startswith("poke:"):
                addr, val = poke_args(step[5:])
                poke_sram(ws, out, addr, val)
            elif step.startswith("eeprom:"):
                addr, val = poke_args(step[7:])
                poke_sram(ws, out, addr, val, b"\x07iEEPROM")
            elif step.startswith("ram:"):
                addr, val = (int(v, 16) for v in step[4:].split("="))
                ws.call("mem.write", address=addr, hex=f"{val:02x}")
            elif step.startswith("cartee:"):
                addr, val = poke_args(step[7:])
                poke_sram(ws, out, addr, val, b"\x06EEPROM")
            elif step.startswith("farcall:"):
                seg, off = (int(v, 16) for v in step[8:].split(":"))
                far_call(ws, out, seg, off)
            elif step == "reset":
                ws.call("rom.reset")
                run(1, [])
            elif step.startswith("load:"):
                ws.call("state.load", path=str(out / f"{step[5:]}.state"))
            else:
                sys.exit(f"unknown step {step!r}")


if __name__ == "__main__":
    main()
