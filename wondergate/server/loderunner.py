"""Lode Runner for WonderSwan: stages players send from the cartridge over the link cable.

Our addition: Bandai never took uploads. A player picks DATA I/O -> 送信 (send) -> MAP1/MAP2 with
the adapter on the link port; the adapter (wgcore's link peer) plays the receiving console and
POSTs the 0x200-byte editor slot record here:

    POST /loderunner/stage   Host: link.swanrevival.com   body = the record
      +0x000 28x18 tile grid (504 bytes, 0x00-0x1E)   +0x1F8 music word
      +0x1FA CRC-32 (zlib) of +0..+0x1F9              +0x1FE 4C 97

Valid stages go to a PENDING queue (data/loderunner.json) for review; nothing is published from
here. The download list (server/content/loadrunner/filelist.txt) only ever holds stages we
publish by hand, credited to the player on the site. Copies of the game's own maps (and the
editor's empty map) are refused by SHA-1 (loderunner_builtin.txt holds hashes, no map data).

Replies (the adapter logs them; the game itself has already shown "sent"):
    200 "stage queued <id>"            new, or the same grid already waiting
    409 "stage refused: ..."           built-in map, or the grid was already reviewed
    422 "stage refused: ..."           not a valid slot record
"""
import datetime
import hashlib
import json
import os
import pathlib
import struct
import zlib

HERE = pathlib.Path(__file__).resolve().parent
QUEUE = pathlib.Path(os.environ.get("WG_LODERUNNER_QUEUE") or HERE.parent / "data" / "loderunner.json")
GRID, RECORD = 28 * 18, 0x200


def builtin_hashes():
    out = {}
    for line in (HERE / "loderunner_builtin.txt").read_text().splitlines():
        if line and not line.startswith("#"):
            h, _, what = line.partition(" ")
            out[h] = what
    return out


BUILTIN = builtin_hashes()


def check(rec):
    """Return None if rec is a valid slot record, else why not."""
    if len(rec) != RECORD:
        return f"{len(rec)} bytes, a slot record is {RECORD}"
    if rec[0x1FE:0x200] != b"\x4c\x97":
        return "no 4C 97 valid mark"
    if zlib.crc32(rec[:0x1FA]) != struct.unpack_from("<I", rec, 0x1FA)[0]:
        return "CRC-32 mismatch"
    if max(rec[:GRID]) > 0x1E:
        return "tile value above 0x1E"
    return None


def load():
    try:
        return json.loads(QUEUE.read_text())
    except FileNotFoundError:
        return {"stages": []}


def store(data):
    QUEUE.parent.mkdir(parents=True, exist_ok=True)
    tmp = QUEUE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1) + "\n")
    tmp.replace(QUEUE)


def submit(rec, source, peer=""):
    """(status, reply text, log note) for one uploaded record."""
    why = check(rec)
    if why:
        return 422, f"stage refused: {why}", f"loderunner: refused ({why})"
    grid = rec[:GRID]
    sha = hashlib.sha1(grid).hexdigest()
    if sha in BUILTIN:
        return 409, "stage refused: a copy of the game's own map", f"loderunner: refused, {BUILTIN[sha]}"
    sid = sha[:12]
    music = struct.unpack_from("<H", rec, GRID)[0]
    data = load()
    for s in data["stages"]:
        if s["sha1"] == sha:
            s["times_received"] = s.get("times_received", 1) + 1
            store(data)
            if s["status"] == "pending":
                return 200, f"stage queued {sid}", f"loderunner: stage queued {sid} (already in the queue)"
            return 409, f"stage refused: already received ({s['status']})", f"loderunner: {sid} already {s['status']}"
    data["stages"].append({
        "id": sid,
        "sha1": sha,
        "grid": grid.hex(),
        "music": music,
        "received": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "source": source,
        "peer": peer,
        "status": "pending",
        "times_received": 1,
    })
    store(data)
    return 200, f"stage queued {sid}", f"loderunner: stage queued {sid} (new, music {music}, pending review)"


def handle(headers, body):
    status, text, note = submit(body, "link-cable", headers.get("x-wg-peer", ""))
    return status, "text/plain", (text + "\r\n").encode(), note, "close"
