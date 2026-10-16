#!/usr/bin/env python3
"""Per-game WonderGate progress: docs/wondergate/progress.json is the source of
truth (also what the website reads). This tool validates it and regenerates the
progress table in docs/wondergate.md between the progress markers.

    tools/progress.py            validate, rewrite the table, print a summary
    tools/progress.py --check    validate only (exit 1 on problems)

A game's status is its worst feature's status.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / "docs" / "wondergate" / "progress.json"
TABLE_DOC = ROOT / "docs" / "wondergate.md"
REPLAYS = ROOT / "wondergate" / "emu" / "replays.txt"
START, END = "<!-- progress:start -->", "<!-- progress:end -->"
ORDER = ["missing", "partial", "impossible", "substitute", "shortcut-verified", "working"]
ICON = {"working": "✅", "shortcut-verified": "✅*", "substitute": "🔁", "partial": "🚧",
        "missing": "❌", "impossible": "⛔"}
VERIFIED = {"in-game", "injected", "patched-rom", "offline", "none"}


def game_status(game):
    return min((f["status"] for f in game["features"]), key=ORDER.index)


def validate(data):
    problems = []
    replays = {line.split("|")[0].strip() for line in REPLAYS.read_text().splitlines()
               if line.strip() and not line.startswith("#")}
    ids = set()
    for g in data["games"]:
        where = g.get("id", "?")
        if where in ids:
            problems.append(f"{where}: duplicate id")
        ids.add(where)
        if not (ROOT / g["doc"]).exists():
            problems.append(f"{where}: missing doc {g['doc']}")
        for r in g.get("replays", []):
            if r not in replays:
                problems.append(f"{where}: replay {r} not in replays.txt")
        if not g["features"]:
            problems.append(f"{where}: no features")
        for f in g["features"]:
            if f["status"] not in data["statuses"]:
                problems.append(f"{where}: unknown status {f['status']}")
            if f.get("verified") not in VERIFIED:
                problems.append(f"{where}: unknown verified {f.get('verified')}")
    return problems


def table(data):
    rows = ["| Game | Status | Features | Notes |", "|---|---|---|---|"]
    for g in data["games"]:
        st = game_status(g)
        feats = "; ".join(f"{ICON[f['status']]} {f['name']}" for f in g["features"])
        doc = g["doc"].removeprefix("docs/")
        rows.append(f"| {g['title']} | {ICON[st]} {st} | {feats} | [{pathlib.Path(doc).name}]({doc}) |")
    legend = " · ".join(f"{ICON[k]} {k}" for k in ORDER[::-1])
    return "\n".join(rows) + f"\n\n{legend}. Source: [progress.json](wondergate/progress.json) (`wondergate/tools/progress.py`)."


def main():
    data = json.loads(DATA.read_text())
    problems = validate(data)
    for p in problems:
        print("problem:", p)
    if "--check" in sys.argv:
        sys.exit(1 if problems else 0)
    text = TABLE_DOC.read_text()
    if START in text and END in text:
        head, rest = text.split(START, 1)
        _, tail = rest.split(END, 1)
        TABLE_DOC.write_text(f"{head}{START}\n{table(data)}\n{END}{tail}")
    else:
        print("no progress markers in", TABLE_DOC)
    counts = {}
    for g in data["games"]:
        counts[game_status(g)] = counts.get(game_status(g), 0) + 1
    print(f"{len(data['games'])} games:", ", ".join(f"{counts[s]} {s}" for s in ORDER[::-1] if s in counts))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
