#!/usr/bin/env python3
"""Render text to WonderSwan 2bpp tiles (planar rows: plane 0 byte, plane 1 byte, MSB left).

    wstitle.py OUT.bin "TEXT" [--width 128 --height 16] [--order row|col] [--font PATH]

Background is colour 1 (what the games pre-fill, 0xFF00 words); text is colour 3.
"""
import argparse
from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"


def render(text, w, h, font=FONT, size=None):
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    size = size or h - 2
    f = ImageFont.truetype(font, size)
    while d.textlength(text, font=f) > w and size > 6:
        size -= 1
        f = ImageFont.truetype(font, size)
    tw = d.textlength(text, font=f)
    d.text(((w - tw) / 2, (h - size) / 2 - 1), text, fill=255, font=f)
    return img.point(lambda v: 255 if v > 110 else 0)


def tiles(img, order):
    w, h = img.size
    px = img.load()
    cols, rows = w // 8, h // 8
    seq = [(tx, ty) for ty in range(rows) for tx in range(cols)] if order == "row" else \
          [(tx, ty) for tx in range(cols) for ty in range(rows)]
    out = bytearray()
    for tx, ty in seq:
        for y in range(8):
            p0 = p1 = 0
            for x in range(8):
                ink = px[tx * 8 + x, ty * 8 + y] > 0
                c = 3 if ink else 1
                p0 |= (c & 1) << (7 - x)
                p1 |= (c >> 1) << (7 - x)
            out += bytes([p0, p1])
    return bytes(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("text")
    ap.add_argument("--width", type=int, default=128)
    ap.add_argument("--height", type=int, default=16)
    ap.add_argument("--order", choices=("row", "col"), default="row")
    ap.add_argument("--font", default=FONT)
    a = ap.parse_args()
    open(a.out, "wb").write(tiles(render(a.text, a.width, a.height, a.font), a.order))


if __name__ == "__main__":
    main()
