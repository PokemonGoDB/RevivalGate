#!/usr/bin/env python3
"""List network-related strings in WonderGate ROMs: hostnames, URL paths,
HTTP/SMTP/POP request templates. A first map of what each game's server must
answer, before anyone plays it.

Usage: rom_strings.py ROM [ROM...]
"""
import re
import sys

ASCII = re.compile(rb"[\x20-\x7e\t\r\n]{4,}")
INTERESTING = re.compile(
    r"(\.jp\b|\.com\b|\.ne\b|\.or\b|https?:|\bcgi\b|\.cgi|nph-|/service/|"
    r"\b(GET|POST|HEAD) |HTTP/1\.|Content-|Host:|User-Agent|Cookie|"
    r"\b(HELO|EHLO|MAIL FROM|RCPT TO|DATA|USER|PASS|RETR|STAT|LIST|QUIT)\b|"
    r"\?[a-z_]+=|&[a-z_]+=|\.html?\b|\.dat\b|\.bin\b)",
    re.I,
)


def scan(path):
    data = open(path, "rb").read()
    hits = []
    for m in ASCII.finditer(data):
        s = m.group().decode("ascii")
        if INTERESTING.search(s):
            hits.append((m.start(), s))
    return hits


def main(paths):
    for p in paths:
        print(f"=== {p.rsplit('/', 1)[-1]}")
        seen = set()
        for off, s in scan(p):
            key = s.strip()
            if key in seen:
                continue
            seen.add(key)
            print(f"  {off:07X}  {key.encode('unicode_escape').decode()[:160]}")
        print()


if __name__ == "__main__":
    main(sys.argv[1:])
