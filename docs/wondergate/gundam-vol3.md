# Mobile Suit Gundam Vol. 3: A Baoa Qu: sub-scenario download ✅

Status: **working** headless (2026-10-13). Sayla: "ここではサブシナリオをダウンロードできるのよ"
("you can download sub-scenarios here"). After a successful dial, one of the four
sub-scenarios is unlocked at random (Kai / Mirai / Sayla / Frau). They play from Bonus Mode.

**No server at all.** The game dials (a number pad prefilled with `##`; any number works with
our adapter), waits for the line to come up, hangs up and unlocks. The ROM's HTTP templates
(`POST`/`GET … User-Agent: SWAN/1.0`) are an unused library. That's why the docs table had
"?" for the host.

## Unlock condition (reverse-engineered)

The title menu (code at file `0x7FB560`, CS `FB56`) builds five items: New Game, Load
(SRAM `0x30`), an item gated by SRAM `0x2F2`, **Wonder Gate** (`[0x212C]`) and Bonus (any
sub-scenario flag at SRAM `0x11DC..0x11DF`, or `[0x25B9]`). `[0x212C]` is set (FB56:071D)
only when:

- SRAM `0x37 == 1` (game cleared), and
- the console's **internal EEPROM** holds a Gundam record with id `0x8000` whose 5th data byte
  is nonzero. The game writes it at the ending; it is how Vol. 1/2/3 pass data to each other.

EEPROM layout used by Bandai's library (B400:19B6 read / 19DA write, ports BA–BE):
words 0–3 = 7 LRU slot counters (bytes); slot n = 1…7 at word 6n: `id`, then 5 data words
(10 bytes). Vol. 3's record: byte 0 nonzero = data present, byte 4 = `stat[0x1D12]/100`
(≥ 1), byte 7 → `[0x25B9]`.

The replay fakes all this with `poke:37=1`, LRU bytes 0–7 = 0, `eeprom:C=0 eeprom:D=80`
(slot 1 id `0x8000`), `eeprom:E=1 eeprom:12=1`, then a reset.

Unlock code: page `0x7E`, CS `EC3E` state machine at `EC3E:0B0A` (file `0x7ECEEA`);
connect = `B400:0071` (dial), state `0x11` picks `rand % 4` and sets SRAM `0x25BA+n` and
`0x11DC+n`.
