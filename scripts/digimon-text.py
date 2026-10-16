"""Generate src/data/digimon-text.ts: the two Digimon WonderGate games' text encoding and species names.

Handles and Digimon names are stored in the games' own one-byte text encoding. The tables below were
checked on 2026-10-14 by having each game draw every byte: our ladder server sent handles holding each
code, and the games' ranking screens showed them (headless emulator, docs/wondergate in
WonderswanCartDumper). Only bytes the games were seen to draw are mapped; the page shows anything else
as ・. The two fonts agree on kana, letters and digits, but not on every symbol.

Species names come from the ROMs' text bank (far pointers at ROM 0x370000, bank 0x37):
  D1 Tamers:   group 0, species 0-237.
  Brave Tamer: group 5 for species below 0xEE, group 6 from 0xEE (the name lookup at 3D5D1F:
               cmp ax,0xEE; group 5 [ax], else group 6 [ax - 0xEE]); 310 species in all.

    python3 scripts/digimon-text.py [ROM folder]

The ROM folder defaults to ./roms. The ROMs are only read here;
nothing from them but the names is written out.
"""
import hashlib
import json
import pathlib
import struct
import sys

ROMS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "roms")
OUT = pathlib.Path(__file__).resolve().parent.parent / "src/data/digimon-text.ts"

# The dumps in wondergate/games.tsv, found in the ROM folder by SHA-1 whatever their file names.
D1_ROM = ("Digimon Adventure 02: D1 Tamers", "18d3dfe25d82964ab7bb61af363d368fd12f4d4b")
BT_ROM = ("Digimon Tamers: Brave Tamer", "31a718cfbcff2dab56ab9606a0b5b2dfccecbbcb")

# Gojūon, then voiced and half-voiced, then small kana: 0x0A-0x59 hiragana, 0x5A-0xA9 katakana.
HIRA = ("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"
        "がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉゃゅょっ")
KATA = ("アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン"
        "ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポァィゥェォャュョッ")
assert len(HIRA) == len(KATA) == 0x50

COMMON = {i: str(i) for i in range(10)}
COMMON.update({0x0A + i: c for i, c in enumerate(HIRA)})
COMMON.update({0x5A + i: c for i, c in enumerate(KATA)})
COMMON.update({0xAA: "ヴ", 0xAB: "ー", 0xAC: "！", 0xAD: "？", 0xAE: "…", 0xAF: "~", 0xB0: "、", 0xB1: "。", 0xB2: "%"})
COMMON.update({0xB4 + i: chr(ord("A") + i) for i in range(26)})
COMMON.update({0xCE + i: chr(ord("a") + i) for i in range(26)})
COMMON.update({0xE8: "*", 0xE9: "+", 0xEA: ",", 0xF4: "(", 0xF5: ")", 0xF6: "「", 0xF7: "」", 0xF8: "『", 0xF9: "』", 0xFD: " "})

FONTS = {
    "d1": {**COMMON, 0xB3: "#", 0xEB: "-", 0xEC: ".", 0xED: "/", 0xEE: ":", 0xEF: ";", 0xF0: "<", 0xF1: "=", 0xF2: ">", 0xF3: "@"},
    # 0xFA-0xFC draw blank in Brave Tamer (and unclearly in D1 Tamers), so they stay unmapped.
    "bt": {**COMMON, 0xB3: "@", 0xEB: ".", 0xEC: "/", 0xED: "=", 0xEE: ":", 0xEF: "#", 0xF0: "Ⅰ", 0xF1: "Ⅱ", 0xF2: "Ⅲ", 0xF3: "Ⅳ"},
}


def rom(name, sha1):
    for path in sorted(ROMS.glob("*.ws*")):
        data = path.read_bytes()
        if hashlib.sha1(data).hexdigest() == sha1:
            return data
    sys.exit(f"{name}: no ROM in {ROMS} matches the dump in games.tsv (SHA-1 {sha1})")


def far(data, at):
    off, seg = struct.unpack_from("<HH", data, at)
    return 0x300000 + seg * 16 + off


def group(data, n):
    return far(data, 0x370000 + 4 * n)


def name_at(data, at, font):
    raw = data[at:at + 24]
    if raw[0] == 0xFF:  # D1 Tamers' entries are FF name FF 00
        raw = raw[1:]
    raw = raw[:raw.index(0xFF)]
    missing = [b for b in raw if b not in font]
    if missing or not raw:
        sys.exit(f"name at {at:#x}: {raw.hex(' ')} has bytes the font table doesn't cover: {missing}")
    return "".join(font[b] for b in raw)


def species(data, font, groups):
    names = []
    for g, count in groups:
        base = group(data, g)
        names += [name_at(data, far(data, base + 4 * i), font) for i in range(count)]
    return names


d1 = rom(*D1_ROM)
bt = rom(*BT_ROM)
d1_species = species(d1, FONTS["d1"], [(0, 238)])
bt_species = species(bt, FONTS["bt"], [(5, 0xEE), (6, 72)])
assert (d1_species[2], d1_species[190], d1_species[197]) == ("アグモン", "ブイモン", "ワームモン")  # in our captures
assert bt_species[0xFD] == "セントガルゴモン"  # the replay's test party
assert bt_species[309] == "ロップモン" and bt_species[238] == "ジャリモン"

# Region names in the games' own text, read from both ROMs (the profile's region byte, 0-7).
def region_list(data, font):
    out, at = [], data.index(bytes([0x27, 0x59, 0x0F, 0x0B, 0x46, 0x0C, 0xFF]))  # ほっかいどう
    for _ in range(8):
        out.append(name_at(data, at, font))
        at = data.index(0xFF, at) + 1
        while data[at] == 0xFF:
            at += 1
    return out


regions = region_list(d1, FONTS["d1"])
assert region_list(bt, FONTS["bt"]) == regions, "region lists differ"
assert regions[0] == "ほっかいどう" and regions[7] == "きゅうしゅう"


def table(font):
    return "{ " + ", ".join(f"{k}: {json.dumps(v, ensure_ascii=False)}" for k, v in sorted(font.items())) + " }"


def strings(xs):
    lines, line = [], "  "
    for x in xs:
        item = json.dumps(x, ensure_ascii=False) + ", "
        if len(line) + len(item) > 110:
            lines.append(line.rstrip())
            line = "  "
        line += item
    lines.append(line.rstrip().rstrip(","))
    return "[\n" + "\n".join(lines) + "\n]"


OUT.write_text(f"""// Generated by scripts/digimon-text.py from the two games' ROMs. Don't edit by hand.
// One byte per character; FF ends a string. Bytes missing from a font table are shown as ・.

export type DigimonFont = 'd1' | 'bt';

export const DIGIMON_FONTS: Record<DigimonFont, Record<number, string>> = {{
  d1: {table(FONTS["d1"])},
  bt: {table(FONTS["bt"])}
}};

/** Region byte 0-7, as the games name them. */
export const DIGIMON_REGIONS_KANA = {strings(regions)};

/** D1 Tamers species by number. */
export const D1_SPECIES: readonly string[] = {strings(d1_species)};

/** Brave Tamer species by number (0-237 as in D1 Tamers, then the Tamers-era Digimon). */
export const BT_SPECIES: readonly string[] = {strings(bt_species)};
""")
print(f"wrote {OUT}: {len(d1_species)} + {len(bt_species)} species, {len(regions)} regions")
