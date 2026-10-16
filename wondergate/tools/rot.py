#!/usr/bin/env python3
"""Rotate a screenshot 90 degrees (vertical games). rot.py IN OUT [cw]  (default counter-clockwise)"""
import struct, sys, zlib
src, dst = sys.argv[1], sys.argv[2]
d = open(src, "rb").read(); pos, idat = 8, b""
while pos < len(d):
    n, t = struct.unpack(">I4s", d[pos:pos + 8]); body = d[pos + 8:pos + 8 + n]; pos += 12 + n
    if t == b"IHDR": w, h, bd, ct = struct.unpack(">IIBB", body[:10])
    elif t == b"IDAT": idat += body
bpp = {2: 3, 6: 4}[ct]; raw = zlib.decompress(idat); stride = w * bpp
rows, prev, i = [], bytearray(stride), 0
for _ in range(h):
    f = raw[i]; line = bytearray(raw[i + 1:i + 1 + stride]); i += 1 + stride
    for x in range(stride):
        a = line[x - bpp] if x >= bpp else 0; b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
        if f == 1: line[x] = (line[x] + a) & 255
        elif f == 2: line[x] = (line[x] + b) & 255
        elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
        elif f == 4:
            p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
    rows.append(bytes(line)); prev = line
px = lambda x, y: rows[y][x * bpp:x * bpp + 3]
if len(sys.argv) > 3 and sys.argv[3] == "cw":
    out = b"".join(b"\x00" + b"".join(px(x, h - 1 - y) for y in range(h)) for x in range(w))
else:
    out = b"".join(b"\x00" + b"".join(px(w - 1 - x, y) for y in range(h)) for x in range(w))
chunk = lambda t, b: struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b))
open(dst, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", h, w, 8, 2, 0, 0, 0))
                      + chunk(b"IDAT", zlib.compress(out)) + chunk(b"IEND", b""))
