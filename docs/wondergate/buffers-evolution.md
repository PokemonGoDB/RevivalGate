# Buffers Evolution: national rankings ✅

Status: **working** headless (2026-10-13). One POST uploads the player's best time on every
course and returns their national rank, the world record and the time of the player one
rank above, for 18 Enduro and 18 S.S. courses, plus the server date and a contest. Shown under
VIEW ENDURO / VIEW S.S. / VIEW CONTEST (A on a course opens the detail screen: WORLD RECORD,
RANK n-1 and its time, YOUR RANK, YOUR TIME). Server: [`server/buffers.py`](../../wondergate/server/buffers.py).

## Reaching it

The title menu cycles ENDURO / S.S. / RECORD / WONDERGATE with X2/X4 (RIGHT/LEFT).
WONDERGATE is offered when `[0x280]` is set, either:

- held keys == `0xC20` (**A + B + X2/RIGHT**) at power-on (the hidden combo, from [Keitai Archive's WS-WonderGate-Patches](https://github.com/Keitai-Archive/WS-WonderGate-Patches)), or
- the cart EEPROM bytes `0x22E/0x230` are nonzero (the server date from an earlier access).

The menu is also locked to ENDURO alone until the cart EEPROM holds a course record (bytes
`0x5A + 20·n`). The game addresses the 2 KB cart EEPROM by **byte** offset (`shr bx,1` before the
EEPROM command). The replay fakes both with `cartee:5A=1 cartee:22E=1`, then a reset, then
WONDERGATE → ACCESS SERVER → A.

## Request

`POST http://wgg01.channel.or.jp/service/buffersevolution HTTP/1.0`, fixed `Content-Length: 1271`:

```
BFEVSND=\r\n
<owner name, 16, from the console EEPROM> <6 hex from console EEPROM words 0x3C/0x3D>
 36 × "MMSSHHXXXX " \r\n <the payload repeated as padding>
```

Course n < 18 (Enduro) reads cart EEPROM `0x5A + 20n` (MMSS) and the high byte of the next word
(HH); n ≥ 18 (S.S.) reads `0x1C2 + 4(n−18)`. XXXX is word `0x12 + 2n`, stored but not
interpreted. `000000` = no record.

Times are **BCD**: `MMSSHH` = minutes, seconds, hundredths (checked 2026-10-15: cart EEPROM bytes
`25 01` at `0x5A` and `17` at `0x5C` upload as `012517` and the RECORD screen shows 1'25"17; HH is
the *low* byte of the word at `0x5C`). Course n is stage `n mod 18 ÷ 3` (A-F), course `n mod 3 + 1`:
the RECORD screen lists S.S. A1, A2, A3, B1, … and a time poked at index 21 (`0x1CE`) shows as S.S. B1.
The site's boards are Enduro A1-F3 (0-17) and S.S. A1-F3 (18-35).

## Reply

```
BFEVREC=\r\n
YYYYMMDD <36 entries> <contest>\r\n
entry   = RRRR MMSSHH MMSSHH     rank ("AAAA" = none → "CHALLENGE UPPER RANK"), world record,
                                 time of the player one rank above (own time when rank 1)
contest = name (20, no separator) + YYYYMMDD␠YYYYMMDD␠ + 12 hex (course) + ␠ + entry
```

The ROM carries a sample reply at `0x3FF400` (contest "ARIOCH", course `00201000a8B4`); we
serve that contest for the current month. Parser: page `0x37` (CS `7000`) at `0x83EE`, entries via
`0x8522` into cart EEPROM `0x232 + 20i` (best-ever rank kept at `+0x10`). A contest whose name
differs from the stored one pushes the old one into a 4-deep history.

Ranks: lower time wins, ties go to the earlier upload; each player (name + code) keeps their
best per course. Contest times are never uploaded, so contest entries are "no rank".
