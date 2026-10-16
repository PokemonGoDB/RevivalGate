# WonderGate Bluetooth tunnel protocol (v1)

How the Bluetooth module and the phone carry the console's sockets. Hardware and
rationale: wondergate-ble.md. The server side is unchanged:
the phone opens one WebSocket per console socket to the game server's `/tunnel`,
exactly as the PC relay does (Swan Revival repo, `workers/wondergate/src/index.ts`).

```
console ─UART─▶ module: wgcore + tunnel (wg_tunnel.c) ─BLE frames─▶ phone: relay ─WebSocket per socket─▶ /tunnel
```

Implementations:

| Side | Code |
|---|---|
| Module (reference, portable C) | `wondergate/core/wg_tunnel.c` (firmware, Mac simulator, emulator, `wgcore-host --tunnel`); `wg_tunnel_stream.c` is the TCP stand-in for the BLE link (see *Testing*) |
| Phone (TypeScript, no dependencies) | Swan Revival repo, `src/lib/ble/` (React Native app, Web Bluetooth page, Node tests) |

Status: v1, 2026-10-14. No module hardware yet; both sides are tested against each other
headless (Swan Revival `scripts/wg-ble-e2e.mjs`) and over real Bluetooth with the Mac module
simulator (`wondergate/tools/blesim`).

## GATT

UUIDs are fixed for good (see wondergate-ble.md). Never change them; bump the
protocol version instead.

| What | UUID | Properties |
|---|---|---|
| Service | `06904a01-fe90-45b2-9d6e-409bc479cabf` | primary, in the advertising packet |
| RX (phone → module) | `06904a02-fe90-45b2-9d6e-409bc479cabf` | write without response, write |
| TX (module → phone) | `06904a03-fe90-45b2-9d6e-409bc479cabf` | notify |
| INFO | `06904a04-fe90-45b2-9d6e-409bc479cabf` | read |

Every RX write and every TX notification carries **exactly one message**, at most
**ATT MTU − 3** bytes. BLE keeps them in order and doesn't lose them once queued,
so the protocol has no sequence numbers or retries. Both sides must work at the
minimum MTU (23, so 20-byte messages).

Phone, after connecting: (Android) request MTU 247 → read INFO → check the
version → subscribe to TX → send `STATUS`. The module sends nothing on TX until
the phone has subscribed and sent its first `STATUS`.

### INFO

| Bytes | Field |
|---|---|
| 0 | protocol version, `1` |
| 1 | sockets: the most the module opens at once (ids `0` … n−1) |
| 2–3 | window, u16 big-endian: DATA bytes the phone may have unacknowledged per socket |
| 4–5 | the connection's ATT MTU as the module sees it at read time, u16 BE (`0` = unknown) |
| 6… | UTF-8 text, `key=value` lines separated by `\n`: `fw` (firmware version), `serial`, `board` |

The phone sends messages of at most `min(its own MTU, INFO MTU) − 3` bytes. Web
Bluetooth can't read the MTU, so a browser trusts INFO's value (20 if it's 0).

A phone that doesn't know the version refuses the module and asks for an update.

## Messages

`u16` is big-endian. `sock` is a socket id the module chose.

### Module → phone (TX)

| Type | Name | Body | Meaning |
|---|---|---|---|
| `01` | OPEN | sock, port u16, host (ASCII, 0–63 bytes) | The console connected. `host` is the name it looked up; empty if unknown, if it was redirected to the configured server, or if it doesn't fit one message (the module never cuts a name: at MTU 23 a host fits only up to 16 bytes). The port is the one the game dialled (no remapping). The phone opens a WebSocket and sends `{"v":1,"port":…,"host":…,"token":…}` (`host` left out when empty) |
| `02` | DATA | sock, bytes | The console sent bytes. May follow OPEN before OPENED; the phone holds them until the tunnel is ready |
| `03` | EOF | sock | The console shut down its sending side; it may still be waiting for the reply. Phone sends `{"eof":true}` |
| `04` | CLOSE | sock | The console closed the socket (or the module gave up on it). See *Closing* |
| `05` | ACK | sock, count u16 | The console has taken `count` more bytes of this socket's DATA; the phone may send that many more |
| `06` | STATE | adapter status u8 | The adapter's state changed: `0` off, `2` on, `3` online (dialled). For the app's display only |
| `0F` | LOG | UTF-8 text | One line of module log, for bring-up. Phones may show or drop it |

### Phone → module (RX)

| Type | Name | Body | Meaning |
|---|---|---|---|
| `81` | OPENED | sock | The server answered `{"ready":true}`; the connection is up |
| `82` | DATA | sock, bytes | Bytes from the server. Unacknowledged bytes per socket never exceed the window |
| `84` | CLOSE | sock, reason u8 | The connection ended. Before OPENED this is a refused connect. Reasons: `0` server closed, `1` server unreachable, `2` server refused (`unknown port`, rate limit), `3` phone error |
| `85` | STATUS | flags u8 | bit 0 internet, bit 1 game server reachable, bit 2 account linked. Sent after subscribing and on every change |

Unknown types are ignored, so later versions can add messages that older peers skip.

## Sockets

**Opening.** The module picks a free id and sends OPEN. The phone opens the WebSocket,
sends the hello with its device token (if linked to an account on *that* server), and
answers OPENED on `{"ready":true}` or CLOSE (reason 1 or 2) if the WebSocket fails or
closes first. The module's connect waits for that answer (default 10 s, then CLOSE and
fail). After a refused connect the module sends its CLOSE at once, so the id frees as
soon as the console deletes the socket. If the phone's last STATUS lacks internet or the
server, or no phone is connected, the module fails the connect at once without sending OPEN.

**Data.** Console → server needs no flow control: the console sends at most ~1 KB/s.
Server → console does: replies arrive all at once, the console drains at 9600 baud,
and the module has little RAM. The phone keeps a per-socket send budget, starting at the
INFO window; each DATA spends its payload length and each ACK refills it. Bytes beyond the
budget wait on the phone. The module buffers a window per socket and ACKs as the console
reads: once half the window has been read, or whenever its buffer runs dry, so the phone is
never left waiting on bytes the console has already taken.
A console receive hands over what a TCP socket would: once bytes are buffered, the module keeps
gathering while further DATA arrives within 100 ms (`WGT_GATHER_MS`), up to what the game asked for.
At the smallest MTU a reply crosses as 18-byte pieces, and Dark Eyes reads its reply in one receive.

**Closing.** An id is free again once **both sides have sent CLOSE** for it.
- The server ends first: the phone first delivers every byte it still holds for that
  socket (as the window allows), then sends CLOSE. The module lets the console read
  what's buffered, then reports the socket closed. When the console closes it, the
  module sends CLOSE, and the id is free on both sides.
- The console closes first: the module sends CLOSE and ignores further DATA for that id.
  The phone closes the WebSocket, drops what it held, and answers CLOSE (reason 0).
- Both at once: each side has sent CLOSE and receives the other's; the id is free.

The phone ignores DATA/EOF for an id it has closed and not yet seen the module's CLOSE for.
The module never reuses an id until both CLOSEs have crossed, so a late message can't
reach the next connection.

**Link loss.** Every socket is gone on both sides. The module reports the sockets closed
to the console (a dropped call) and advertises again; the phone closes every WebSocket and
reconnects to the module.

## Phone status reported to the console

The module answers the console's phone-status query (`01:00`) from the link:
no phone connected → "no phone"; STATUS without internet or server → "no service";
otherwise "ok" with bars from the link's RSSI. Until the first STATUS after power-on,
it answers "ok" (games ask before dialling and some ask before power-on). This is the
firmware's job; the C tunnel exposes the state it needs (`wgt_phone_state()`).

## Testing

**The stream stand-in** (`wondergate/core/wg_tunnel_stream.c`): a TCP connection in place of the
BLE link. The module connects as a client to the phone stand-in's `HOST:PORT`. Each message, both
ways, is one frame: u16 big-endian length, then the message. The module's first frame on every
connection is INFO's bytes (what a read of the characteristic returns, with the stream's MTU);
the phone answers with STATUS, then both sides speak the messages above. A closed connection is
a lost link; the module reconnects about once a second. Turned on by:
- `wgcore-host --tunnel HOST:PORT [--mtu N]` (MTU default 247; `--mtu 23` for the BLE minimum);
- the emulator core: `WG_ADAPTER_TUNNEL=HOST:PORT` (and `WG_ADAPTER_MTU=N`) alongside
  `WG_ADAPTER_CONFIG`, e.g. through `emu/drive.py` or `emu/regress.py`.

- Unit tests: Swan Revival `tests/ble.test.mjs` (codec, relay against a fake server and a
  fake module); `make -C wondergate/host test` covers `wg_tunnel.c` with a scripted phone
  (`wondergate/host/test_tunnel.py`).
- Local end to end without Node: `wondergate/emu/tunnel_phone.py` is a phone stand-in that
  relays each OPEN to the dev server over TCP (`WG_ADAPTER_TUNNEL=127.0.0.1:7600 emu/regress.py`).
- Headless end to end: Swan Revival `node scripts/wg-ble-e2e.mjs [game …]` runs this repo's
  emulator with the adapter's sockets on `wg_tunnel` over the stream stand-in, the TypeScript
  relay on the other end, and a fresh Worker. Same replays and pass rule as `wg-e2e.mjs`.
- Real Bluetooth, no module: `wondergate/tools/blesim` makes the Mac a WonderGate module
  (wgcore + `wg_tunnel` + CoreBluetooth peripheral). Mednafen or a real console with a cable
  is the console; the phone app or the Web Bluetooth page is the phone.
