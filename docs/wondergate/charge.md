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

## Rainbow Islands and Gundam Vol. 1: an older library (checked in the games, 2026-11-26)

These two carry an earlier build of the library (name table at Rainbow Islands ROM `0x1FCD07`,
Gundam Vol. 1 `0x3FD0E3`). It has no `TIME-RET` at all, and their WonderGate paths send one request
only, `nph-gettime`. The `nph-srvcinfo` / `nph-session` / `nph-contents` code is in both ROMs but
was not called in any run, so paid, unpaid and expired never come up for them. Gundam Vol. 2 and 3
send nothing ([vol. 2](gundam-vol2.md), [vol. 3](gundam-vol3.md)).

The gettime routine (Rainbow Islands `FBB8:01FF`, ROM `0x1FBD7F`) reads the reply **until the server
closes the connection**, then looks only at the HTTP status: 200 goes on, 302 is followed
(`Location: http://host/path`, the POST is sent again there), anything else is an error. The header
parser (`FBB8:129E`, ROM `0x1FCE1E`) upper-cases the headers, takes lines starting `X-SWAN-`, and
copies each value from **after the first space** up to the CR, with no length check, into 16-byte
slots (`TIME-NOW` at SRAM `0x6D86`). gettime then copies `TIME-NOW` to the game (Rainbow Islands
SRAM `0x0DBE`, Gundam Vol. 1 SRAM `0x26A0`).

Each reply below was sent to both games from a test server:

| Reply | Rainbow Islands | Gundam Vol. 1 |
|---|---|---|
| 200, `TIME-RET: 0`, `TIME-NOW` (what we send) | item or illustration unlocked | weapons unlocked |
| 200, no `X-SWAN-` header at all | same (time left empty) | same |
| 200, `TIME-RET: 5` | same: the header isn't known | not tried |
| 200, `TIME-NOW: 000000000000000` or `999912312359599` | same | not tried |
| 200, `x-swan-time-now:…` with no space after the colon | same; the "time" kept is the next header's value | not tried |
| 302 + `Location:` | request repeated at the new path, then as 200 | same |
| 404, 500 | error 999, nothing unlocked | 「エラーナンバー999だ」, nothing unlocked |

Neither game reads the time it stored: a read watch on the copy saw nothing during Item GET or
Illust GET, and Gundam Vol. 1's save is the same with and without `TIME-NOW` apart from the string
itself. So for these two the service is a check that the connection works.

Our servers: `TIME-NOW` is Japan time on both (the Python server sent the machine's local time until
2026-11-26). The Worker hangs up after an `nph-` reply (read from its code, not run here). The
Python server leaves the connection open until its 60 s idle timeout, and both games were seen to
wait that long before unlocking.

## Open

- What the other charge-service games (Rainbow Islands, Gundam Vol. 1, Wizardry, Wonder Classic)
  expect as content bodies.
