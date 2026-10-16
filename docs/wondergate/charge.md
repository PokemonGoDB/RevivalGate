# Bandai charge service (wgb01.channel.or.jp/service/charge/): working for Pocket Fighter ✅

Shared by Pocket Fighter, Rainbow Islands, Gundam Vol. 1, Wizardry, Wonder Classic, Digimon
(gettime) and Doraemon (gettime). Mapped from Pocket Fighter (2026-10-13); handler
`server/charge.py`.

## Protocol

POSTs with no body; the request carries `X-swan-srvc-id: <service>` (Pocket Fighter: `BAN00A01`),
later `X-swan-cmnd-sid: <srvc id><customer id><base64 token>` and `X-swan-cnts-aid: …`.
Replies are HTTP 200 with data in **`X-SWAN-*` response headers** (case-insensitive match,
value after the colon; table at Pocket Fighter ROM `0x0EFC50`):

| ID | Names | Meaning (so far) |
|---|---|---|
| 01 | `TIME-RET` `SRVC-RET` `CMND-RET` `CNTS-RET` | result code; **must be 0** (else shown as the error) |
| 02 | `TIME-NOW` | server time, 15 chars: `YYYYMMDDhhmmss` + 1 digit |
| 03/04 | `SRVC-OPEN` `SRVC-CLOSE` | service window (same 15-char time) |
| 05/06 | `SRVC-TIM`/`CMND-TIM`, `SRVC-TRM`/`CMND-TRM` | numbers, used when the service isn't free |
| 07–0A | `SRVC-MTN-FROM/TO`, `CHRG-MTN-FROM/TO` | maintenance windows |
| 0B | `SRVC-PRC` | price; **0 = free** ("このサービスはげんざいむりょうです") |
| 0C | `SRVC-WAY` `CMND-WAY` `CNTS-WAY` | payment way |
| 0D | `Content-Length` (plain) | |
| 0E | `CMND-BAL` | balance (prepaid) |
| 0F | `CMND-AID` `CNTS-AID` | session token, exactly 80 bytes (the game echoes it as `X-swan-cnts-aid`); `CNTS-AID` must be present on the content reply but isn't decoded |
| 10 | `CMND-URL`, plain `Location` | |
| 11 | `WM-RET` | |
| 12/13 | `CNTS-TIM` `CNTS-TRM` | |
| 14 | `SRVC-CNT` | **customer number**: the cart keeps the first one as its customer ID (`fzyA0001` for 1); we hand out a new number per call |

A step's missing header → error 700 ("じゅしんデータないにひつようなデータがありません").

## Flow (Pocket Fighter)

1. `nph-srvccount` → `SRVC-RET: 0`, `SRVC-CNT: <n>` (first visit: assigns the customer ID) ✅
2. `nph-gettime` → `TIME-RET: 0`, `TIME-NOW` ✅
3. `nph-srvcinfo` → `SRVC-RET: 0`, `SRVC-PRC: 0`, `SRVC-CLOSE: 209912312359590` … ✅ (shows "free",
   "until 2099/12/31", then asks "use this service? はい")
4. `nph-session` (`X-swan-cmnd-sid: <srvc id><customer id><token>`) → `CMND-RET: 0`,
   `CMND-AID` (80 bytes), `CMND-URL` ✅
5. Content request to the game's own URL (Pocket Fighter: swan-ranking/pocketf) → `CNTS-RET: 0`,
   `CNTS-AID`, and **the content in the body** ✅. The menu choice, not the reply, sets the
   content type/subtype (SRAM `0xC86`/`0xC87`); the body is parsed with keywords from a
   per-game table (Pocket Fighter ROM `0x10F7B0`: `ANSPF_SCORE=`, `ANSPF_POINT`, `ANSPF_CHARA`,
   `|`, `date=`, `course=`, `\r`, `info=`).

So the "content descriptor" turned out not to need decoding: the content is ordinary text.

## Open

- What the other charge-service games (Rainbow Islands, Gundam Vol. 1, Wizardry, Wonder Classic)
  expect as content bodies.
