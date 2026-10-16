#!/usr/bin/env python3
"""Tile screenshots side by side: tile.py OUT IN... [--rot cw|ccw|180] [--crop x,y,w,h] [--scale N]"""
import struct, sys, zlib


def load(p):
    d = open(p, "rb").read(); pos, idat = 8, b""
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
                p_ = a + b - c; pa, pb, pc = abs(p_ - a), abs(p_ - b), abs(p_ - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        rows.append([bytes(line[j:j + 3]) for j in range(0, stride, bpp)])
    return rows


def rotate(rows, how):
    h, w = len(rows), len(rows[0])
    if how == "ccw":
        return [[rows[y][w - 1 - x] for y in range(h)] for x in range(w)]
    if how == "cw":
        return [[rows[h - 1 - y][x] for y in range(h)] for x in range(w)]
    if how == "180":
        return [list(reversed(r)) for r in reversed(rows)]
    return rows


def main():
    args = sys.argv[1:]
    how = None
    if "--rot" in args:
        i = args.index("--rot"); how = args[i + 1]; del args[i:i + 2]
    crop, scale = None, 1
    if "--crop" in args:
        i = args.index("--crop"); crop = [int(v) for v in args[i + 1].split(",")]; del args[i:i + 2]
    if "--scale" in args:
        i = args.index("--scale"); scale = int(args[i + 1]); del args[i:i + 2]
    out, ins = args[0], args[1:]
    imgs = [rotate(load(p), how) for p in ins]
    if crop:
        x0, y0, cw, ch = crop
        imgs = [[r[x0:x0 + cw] for r in im[y0:y0 + ch]] for im in imgs]
    if scale > 1:
        imgs = [[[px for px in r for _ in range(scale)] for r in im for _ in range(scale)] for im in imgs]
    h = max(len(im) for im in imgs)
    gap = [b"\xff\xff\xff"] * 4
    lines = []
    for y in range(h):
        row = []
        for k, im in enumerate(imgs):
            row += im[y] if y < len(im) else [b"\x00\x00\x00"] * len(im[0])
            if k < len(imgs) - 1:
                row += gap
        lines.append(b"\x00" + b"".join(row))
    w = (len(lines[0]) - 1) // 3
    chunk = lambda t, b: struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b))
    open(out, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                          + chunk(b"IDAT", zlib.compress(b"".join(lines))) + chunk(b"IEND", b""))


if __name__ == "__main__":
    main()
