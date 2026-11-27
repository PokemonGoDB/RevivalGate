#!/usr/bin/env python3
"""Replay every game in emu/replays.txt headless and check the WonderGate session.

    emu/regress.py [game-key ...]
    emu/regress.py --bless [game-key ...]    record what each replay's last screen looks like
    emu/regress.py --fault [game-key ...]    corrupt every reply: each replay should now FAIL

Each replay runs against its own fresh copy of the server (in a temp folder, ports moved by
WG_REGRESS_OFFSET, default 3000), so nothing touches a server you're running or the repo's data,
and one replay's uploads never change what the next one sees. A folder emu/seeds/<key>/ is copied
into that server's data/ first, for replays that need other players on the server; a NAME.sql in
it is run into data/NAME.sqlite instead (wg.sql fills the rankings), and a server.env in it (NAME=VALUE
lines) sets the server's test hooks for that replay, such as a fixed date.

Pass = all of:
  - the adapter log shows an HTTP 200 reply (or the optional 4th column's text, for games that
    only dial) and a hang-up, with no unknown commands. A 5th column "link" marks a link-cable
    session (Lode Runner DATA I/O): no call, so no hang-up needed;
  - the game took the reply, by emu/checks.txt: memory the game sets (drive.py's expect: steps)
    and the last screen's fingerprint (emu/screen.py), which may differ in a few tiles.
A final screenshot per game goes to runs/regress/<key>.png (runs/regress-fault/ with --fault).

--bless plays each replay twice (tiles that differ between the two aren't compared) and once more
with every HTTP reply's body corrupted, to see that the fingerprint can tell: it reports how far
the corrupted run's screen is from the good one. Look at the screenshot before trusting a blessing.

WG_REGRESS_CONFIG=/abs/path.conf replays against a server you started yourself instead, and so does
WG_ADAPTER_TUNNEL (the adapter's sockets go through the phone link to whatever server that reaches,
with dev.conf). That server's state is unknown, so screens aren't compared.
"""
import os
import pathlib
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "emu"))
import screen  # noqa: E402

REPLAYS = ROOT / "emu" / "replays.txt"
CHECKS = ROOT / "emu" / "checks.txt"
SEEDS = ROOT / "emu" / "seeds"
OFFSET = int(os.environ.get("WG_REGRESS_OFFSET", "3000"))
# The console's ports and where the server copy listens (wgserver.py, mail.py).
PORTS = {80: 8080, 8080: 8080, 10000: 10000, 5555: 5555, 25: 2525, 110: 1110, 13: 1313}
FAULT_PORT = 9080 + OFFSET
CHECKS_HEAD = """# What each replay's game shows once it has taken the server's reply (emu/regress.py).
# game key | memory checks (drive.py expect: steps, without "expect:") | tiles of the last screen that may differ | the last screen's fingerprint
# Written by `emu/regress.py --bless`; the memory checks are added by hand and kept.
"""


def read_checks():
    checks = {}
    if CHECKS.exists():
        for line in CHECKS.read_text().splitlines():
            if line.strip() and not line.startswith("#"):
                key, memory, limit, shot = (p.strip() for p in line.split("|"))
                checks[key] = {"memory": memory.split(), "limit": int(limit or 0), "screen": shot}
    return checks


def write_checks(checks, order):
    lines = [f"{k} | {' '.join(c['memory'])} | {c['limit']} | {c['screen']}"
             for k in order if (c := checks.get(k)) and (c["memory"] or c["screen"])]
    CHECKS.write_text(CHECKS_HEAD + "\n".join(lines) + "\n")


class Server:
    """A copy of the server in a temp folder, restarted with empty data for every replay."""

    def __init__(self):
        self.work = pathlib.Path(tempfile.mkdtemp(prefix="wg-regress-"))
        shutil.copytree(ROOT / "server", self.work / "server")
        shutil.copytree(ROOT / "games", self.work / "games")
        progress = ROOT.parent / "docs" / "wondergate" / "progress.json"
        if progress.exists():  # the portal's games page reads it
            (self.work / "docs" / "wondergate").mkdir(parents=True)
            shutil.copy(progress, self.work / "docs" / "wondergate")
        self.proc = None
        self.log = open(self.work / "server.log", "ab")

    def config(self, fault=False):
        """An adapter config for this server; with fault, HTTP goes through the corrupting proxy."""
        lines = ["reception 15", "server 127.0.0.1"]
        for port, to in PORTS.items():
            via = {80: FAULT_PORT, 8080: FAULT_PORT, 10000: FAULT_PORT + 1}.get(port) if fault else None
            lines.append(f"portmap {port} {via or to + OFFSET}")
        path = self.work / ("fault.conf" if fault else "dev.conf")
        path.write_text("\n".join(lines) + "\n")
        return str(path)

    def restart(self, key):
        self.stop()
        shutil.rmtree(self.work / "data", ignore_errors=True)
        env = {}
        if (SEEDS / key).is_dir():
            shutil.copytree(SEEDS / key, self.work / "data", ignore=shutil.ignore_patterns("*.sql", "server.env"))
            if (SEEDS / key / "server.env").exists():  # NAME=VALUE lines: the server's test hooks, e.g. a fixed date
                env = dict(line.split("=", 1) for line in (SEEDS / key / "server.env").read_text().split() if "=" in line)
            for script in sorted((SEEDS / key).glob("*.sql")):  # wg.sql fills data/wg.sqlite
                db = sqlite3.connect(self.work / "data" / script.with_suffix(".sqlite").name)
                db.executescript(script.read_text())
                db.close()
        self.proc = subprocess.Popen([sys.executable, "-I", str(self.work / "server" / "wgserver.py")],
                                     cwd=self.work, stdout=self.log, stderr=self.log,
                                     env={**os.environ, **env, "WG_PORT_OFFSET": str(OFFSET)})
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", 8080 + OFFSET), timeout=0.2).close()
                return
            except OSError:
                time.sleep(0.05)
        sys.exit(f"the server copy didn't start; see {self.work / 'server.log'}")

    def stop(self):
        if self.proc:
            self.proc.terminate()
            self.proc.wait()
            self.proc = None


def fault_proxy():
    """Pass HTTP through to the server copy, replacing every byte of each reply's body and of its
    X-SWAN-* header values (where some games' replies are) with '?': the reply still arrives whole,
    but no game can make sense of it. Wonder Classic's own protocol (port 10000) gets the same
    treatment after the server's 6-byte greeting."""
    def pump(src, dst, corrupt, greeting=None):
        head, in_body = b"", not corrupt
        try:
            while data := src.recv(65536):
                if corrupt and in_body:
                    data = b"?" * len(data)
                elif corrupt and greeting is not None:
                    data, in_body = data[:greeting] + b"?" * len(data[greeting:]), len(data) >= greeting
                    greeting -= min(greeting, len(data))
                elif corrupt:
                    head += data
                    end = re.search(rb"\r?\n\r?\n", head)  # nph-* replies end their lines with a bare LF
                    if not end:
                        continue
                    data = re.sub(rb"(?im)^(x-swan-[^:\r\n]*:[ \t]*)([^\r\n]*)", lambda m: m[1] + b"?" * len(m[2]), head[:end.end()])
                    data, in_body = data + b"?" * (len(head) - end.end()), True
                dst.sendall(data)
            if corrupt and not in_body and greeting is None:
                dst.sendall(head)  # no header block (an HTTP/0.9 reply): passed on as it is
        except OSError:
            pass
        for s, how in ((dst, socket.SHUT_WR), (src, socket.SHUT_RD)):
            try:
                s.shutdown(how)
            except OSError:
                pass

    def serve(listener, target, greeting):
        while True:
            client, _ = listener.accept()
            try:
                upstream = socket.create_connection(("127.0.0.1", target))
            except OSError:
                client.close()
                continue
            threading.Thread(target=pump, args=(client, upstream, False), daemon=True).start()
            threading.Thread(target=pump, args=(upstream, client, True, greeting), daemon=True).start()

    for port, target, greeting in ((FAULT_PORT, 8080 + OFFSET, None), (FAULT_PORT + 1, 10000 + OFFSET, 6)):
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", port))
        listener.listen()
        threading.Thread(target=serve, args=(listener, target, greeting), daemon=True).start()


def play(key, rom, steps, expect, link, memory, config, server, out):
    """One replay. Returns (problems, fingerprint of the last screen or None)."""
    if server:
        server.restart(key)
    log, shot = out / f"{key}.log", out / f"{key}.png"
    log.unlink(missing_ok=True)
    shot.unlink(missing_ok=True)
    # The emulator writes into a folder of this run's own, so two regress runs at once don't collide.
    with tempfile.TemporaryDirectory(prefix="wg-replay-") as tmp:
        cmd = [sys.executable, "-I", str(ROOT / "emu" / "drive.py"), rom, *steps.split(), f"s:{key}",
               *(f"expect:{m}" for m in memory), "--out", tmp, "--config", config]
        r = subprocess.run(cmd, capture_output=True, text=True)
        for made, kept in ((pathlib.Path(tmp, "adapter.log"), log), (pathlib.Path(tmp, f"{key}.png"), shot)):
            if made.exists():
                shutil.move(made, kept)
    text = log.read_text() if log.exists() else ""
    unknown = [l for l in text.splitlines() if "UNKNOWN" in l]
    failed = [l.split("check failed: ")[1] for l in r.stdout.splitlines() if "check failed: " in l]
    problems = [w for w, bad in ((f"no '{expect}'", expect not in text),
                                 ("no hang-up", not link and "# hang up" not in text),
                                 (f"{len(unknown)} unknown cmds", unknown),
                                 (f"exit {r.returncode}", r.returncode not in (0, 3)),
                                 *((f"memory: {f}", True) for f in failed)) if bad]
    return problems, screen.fingerprint(shot) if shot.exists() else None


def main(args):
    bless, fault = "--bless" in args, "--fault" in args
    only = {a for a in args if not a.startswith("--")}
    out = ROOT / "runs" / ("regress-fault" if fault else "regress")  # corrupted runs keep their own screenshots
    out.mkdir(parents=True, exist_ok=True)
    own = not (os.environ.get("WG_REGRESS_CONFIG") or os.environ.get("WG_ADAPTER_TUNNEL"))
    if (bless or fault) and not own:
        sys.exit("--bless and --fault need the server copy: unset WG_REGRESS_CONFIG and WG_ADAPTER_TUNNEL")
    server = Server() if own else None
    if own:
        fault_proxy()
    config = server.config() if own else os.environ.get("WG_REGRESS_CONFIG") or str(ROOT / "dev.conf")
    checks = read_checks()
    order, fails = [], 0
    try:
        for line in REPLAYS.read_text().splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            key, rom, steps, *rest = (p.strip() for p in line.split("|"))
            order.append(key)
            if only and key not in only:
                continue
            expect = rest[0] if rest and rest[0] else "200 OK"
            link = rest[1:2] == ["link"]
            check = checks.setdefault(key, {"memory": [], "limit": 0, "screen": ""})
            run = lambda cfg=config: play(key, rom, steps, expect, link, check["memory"], cfg, server, out)  # noqa: E731

            if bless:
                problems, first = run()
                more, second = run()
                problems += more
                if problems or not first or not second:
                    fails += 1
                    print(f"[FAIL] {key:10} not blessed: {', '.join(problems) or 'no screenshot'}")
                    continue
                good = screen.merge(first, second)
                _, bad = run(server.config(fault=True))
                apart = screen.differing(good, bad) if bad else 0
                # Allow a few tiles for text that changes with the date, but stay well short of the
                # corrupted run's screen.
                check["screen"], check["limit"] = good, min(6, apart // 3)
                if good.count(".") > len(good) // 4:
                    # The server picks something at random that the screen shows (a battle's seed):
                    # no screen to compare, the memory checks decide.
                    check["screen"], check["limit"] = "", 0
                run()  # leave the good run's screenshot and log behind
                print(f"[BLESS] {key:10} {good.count('.')} tiles vary between runs{'' if check['screen'] else ' (screen not compared)'}; a corrupted reply changes {apart}"
                      + ("" if apart or check["memory"] else "  <- the screen can't tell: add a memory check"))
                continue

            problems, shot = run(server.config(fault=True) if fault else config)
            if own and check["screen"] and shot:
                apart = screen.differing(check["screen"], shot)
                if apart > check["limit"]:
                    problems.append(f"screen differs in {apart} tiles (limit {check['limit']})")
            checked = own and (check["screen"] or check["memory"])
            fails += bool(problems)
            print(f"[{'FAIL' if problems else 'PASS'}] {key:10} {', '.join(problems)}"
                  + ("" if problems or checked else "(reply only: no check of the game's state)"))
    finally:
        if server:
            server.stop()
    if bless:
        write_checks(checks, order)
    if fault:
        print(f"\n{fails} replays noticed the corrupted replies")
        return 0
    print("\nALL PASS" if not fails else f"\n{fails} FAILED")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
