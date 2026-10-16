#!/usr/bin/env python3
"""Replay every game in emu/replays.txt headless and check the WonderGate session.

    emu/regress.py [game-key ...]

Pass = the adapter log shows an HTTP 200 reply (or the optional 4th column's
text, for games that only dial) and a hang-up, with no unknown commands. A 5th column
"link" marks a link-cable session (Lode Runner DATA I/O): no call, so no hang-up needed. A final screenshot per game goes to runs/regress/<key>.png.
WG_REGRESS_CONFIG=/abs/path.conf replays against another server copy (e.g. one started with
WG_PORT_OFFSET, with matching portmap lines) instead of dev.conf's.
"""
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main(only):
    out = ROOT / "runs" / "regress"
    out.mkdir(parents=True, exist_ok=True)
    fails = 0
    for line in (ROOT / "emu" / "replays.txt").read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        key, rom, steps, *rest = (p.strip() for p in line.split("|"))
        expect = rest[0] if rest else "200 OK"
        link = rest[1:2] == ["link"]
        if only and key not in only:
            continue
        log = out / f"{key}.log"
        log.unlink(missing_ok=True)
        cmd = [sys.executable, "-I", str(ROOT / "emu" / "drive.py"), rom, *steps.split(),
               f"s:{key}", "--out", str(out)]
        if os.environ.get("WG_REGRESS_CONFIG"):
            cmd += ["--config", os.environ["WG_REGRESS_CONFIG"]]
        env_log = {"WG_ADAPTER_LOG_NAME": str(log)}
        r = subprocess.run(cmd, capture_output=True, text=True,
                           env={**os.environ, **env_log})
        (out / "adapter.log").rename(log) if (out / "adapter.log").exists() else None
        text = log.read_text() if log.exists() else ""
        ok200 = expect in text
        hung = link or "# hang up" in text
        unknown = [l for l in text.splitlines() if "UNKNOWN" in l]
        ok = ok200 and hung and not unknown and r.returncode == 0
        fails += not ok
        why = [] if ok else [w for w, bad in ((f"no '{expect}'", not ok200), ("no hang-up", not hung),
                                              (f"{len(unknown)} unknown cmds", unknown),
                                              (f"exit {r.returncode}", r.returncode)) if bad]
        print(f"[{'PASS' if ok else 'FAIL'}] {key:10} {', '.join(why)}")
    print("\nALL PASS" if not fails else f"\n{fails} FAILED")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(set(sys.argv[1:])))
