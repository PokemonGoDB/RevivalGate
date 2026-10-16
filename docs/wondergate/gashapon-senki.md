# SD Gundam Gashapon Senki Episode 1: map downloads ❌

Status (2026-10-14): **no maps are served.** The download protocol is fully worked out (below), but
the 12 maps Bandai served are lost. A stand-in that re-served the game's own 10 built-in maps was
pulled on 2026-10-14: those maps are already in the cartridge, so offering them as downloads made no
sense. `tools/make_sdgundame.py` still builds that pack, only as a local test of the download path
(output in `local/sdgundame-test/`, never deployed). Served by [`server/static.py`](../../wondergate/server/static.py)
when content exists.

## The original service

- Bandai's spec: "新マップ(12ステージ)", **12 new maps**, up to 3 per connection, and each map also
  brings **enemy AI data**, so a map is more than terrain
  ([swan.channel.or.jp r_gate, April 2001](https://web.archive.org/web/20010408/http://www.swan.channel.or.jp/swan/software/r_gate.html)).
- Available from the adapter's launch (14 July 2000) until **31 October 2001**, when this game's
  service ended along with Pocket Fighter's, Final Lap 2000's and others
  ([r_gate, December 2001](https://web.archive.org/web/20011222/http://www.swan.channel.or.jp/swan/software/r_gate.html)).
- No map names, screenshots or schedule survive anywhere we could find, and nothing under
  `wgg01.channel.or.jp/download/sdgundame/` was archived. The download list shows 4 maps a page, so 12
  maps are exactly 3 pages: they may all have been listed at once (inference).
- Other references: [product page](https://web.archive.org/web/20010110080500/http://www.swan.channel.or.jp:80/swan/software/line_up/sdg_episode1/index.html),
  [Keitai Wiki](https://keitaiwiki.com/wiki/SD_Gundam:_Gashapon_Senki_Episode_1).

## Check your cartridge

A cartridge that downloaded maps keeps up to 3 of them in its battery-backed save memory: map data at
SRAM `0x3FD6 + 0x600·slot`, title strips at `0x39D6 + 0x200·slot`, and slot bits in `[0x39C5]`. If you
own this game, especially a used copy, please dump its save and send it to us; it may hold maps
nobody has seen since 2001.

## Plan: custom maps

Custom maps are possible once the map format is decoded. They will be labelled as fan-made, never
passed off as Bandai's.

1. **Decode the format.** Compare the 10 built-in maps (sizes from the gaps in the pointer table at
   ROM `0x80000`), and trace the loader reading `8000:xxxx` / `1000:3FD6` in the emulator: grid size,
   terrain, capitals, starting units and sides, the enemy AI section.
2. **Encoder and decoder** that rebuild all 10 built-in maps byte for byte. That is the proof the
   format is understood.
3. **Editor:** a text grid or Tiled import feeding the encoder; previews drawn from tiles in the
   user's own dump (never shipped).
4. **Validation:** size ≤ `0x600`, objects in bounds, valid unit IDs, a capital per side, the index
   list ending on a line that doesn't start with `m`, and an automated emulator run (download into a
   slot, start a VS game, play some frames without a crash).
5. **Presentation:** each map's 128×16 title strip (`tools/wstitle.py`) reads e.g. 「FAN MAP 01」 over
   the author's name. IDs like `mF001` keep fan maps apart from anything official. A page on our site
   lists every map with screenshots, credits and licence (the game has no browser). Possibly a
   12-map "season", matching Bandai's count.
6. **Preservation:** every map we publish is committed to the repo (source and built file), so it
   isn't lost the way the originals were.

## Reaching it

Hold **A + B + Y3 + Y4** (combo from [Keitai Archive's WS-WonderGate-Patches](https://github.com/Keitai-Archive/WS-WonderGate-Patches); key word `0x0C0C`, checked at `0x4F0ED`) at power-on → title → START →
the menu gains ダウンロード → 接続 (connect).

## Adapter quirks (1999 library, page 5 `0x58000`)

- No power-on (01:02). After the 00 wake burst it sends **`02:00 (03)`**, undocumented. It waits
  for any type-02 frame and drains it, so wgcore answers `02 00 01 00`.
- Its dial-reply reader decrements the byte count before checking it. With a 1-param reply
  (`0B 00`) the counter underflows and it reads until timeout (error 999). wgcore now answers
  dial with `0B 00 00 00 00`, shaped like the hang-up reply. All other games still pass.

## HTTP

Every file is fetched as `HEAD <path> HTTP/1.1` (with an extra CRLF after the headers), then
**HTTP/0.9** `GET <path>\r\n\r\n` with no version or Host. The reply is the bare body; the game
reads until the server closes. The server now skips blank lines, answers HEAD without a body,
and serves Host-less 0.9 requests by path.

1. `/download/sdgundame/INDEX.TXT` (≤ 0x800 bytes, into SRAM `0x6D16`):
   ```
   :[MAP]
   m0001 /download/sdgundame/T0001.BIN     ← 'm' + 5 chars, then the title-strip path
   file=/download/sdgundame/M0001.BIN      ← anything up to '=', then the map path
   …
   :[END]
   ```
   Strings are stored in 0x30-byte slots at SRAM `0x51F6`; 4 maps per page. **The list must
   end with a line that doesn't start with `m`**: the cartridge's character reader returns from
   end-of-data without popping what it pushed, and the game crashes into garbage (a real
   bug that the original file never triggered).
2. Each visible entry's title strip: ≤ 0x200 bytes, 32 tiles of 2bpp (planar rows, MSB left),
   row-major 16×2 (128×16 px). Built-in titles live at ROM `6000:2EDF + 0x200·i`.
   `tools/wstitle.py` renders new ones from text.
3. The chosen map: ≤ 0x600 bytes (the game refuses larger ones), copied to SRAM
   `0x3FD6 + 0x600·slot`. Its title goes to `0x39D6 + 0x200·slot`, and bit `slot` is set in
   `[0x39C5]`. Same format as the built-in maps (pointer table at ROM `0x80000`:
   10 × `8000:xxxx`, then the 3 slots `1000:3FD6/45D6/4BD6`).

New maps could be made by editing that format (not decoded yet).
