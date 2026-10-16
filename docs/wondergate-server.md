# Running a server for WonderGate games

Swan Revival runs RevivalGate, the default server (`wss://wg.swanrevival.com/tunnel`), but nothing ties
players to it. MesenCE (WonderSwan settings, WonderGate tab, Server), Swan Revival Link
(`--server`), and later the USB-C module all take a server address (the browser page, Connect a console, always uses RevivalGate). If Swan Revival ever goes
away, anyone can run a server that speaks the protocol below, and players switch by changing that
one address.

Everything needed to run one: this Worker (`workers/wondergate/`, Cloudflare Workers + D1) and the
reference Python server it was ported from (WonderswanCartDumper, `wondergate/server/`), which can
also be run directly behind a small WebSocket bridge.

## 1. The tunnel (required)

The console's adapter (emulated in MesenCE or Link, or the hardware module) opens TCP connections to
the old Bandai hosts. Each connection is carried to the server as one WebSocket:

```
GET wss://<server>/tunnel            (WebSocket upgrade)

client → text   {"v":1,"port":80,"token":"<optional device token>"}     first message
server → text   {"ready":true,"handle":"<name or null>"}                 optional
both   → binary the connection's bytes, unchanged
client → text   {"eof":true}       the console stopped sending (half-close); keep answering
server closes the WebSocket        the game's connection is over (the adapter hangs up)
```

- `port` is the port the game dialled: 80 (HTTP to the Bandai and partner hosts), 10000 (Wonder
  Classic), 5555 (the MobileWonderGate browser's BPL check), 25 and 110 (the MobileWonderGate
  cart's SMTP and POP3 mail). Clients pass any port through, so a server can add protocols
  without client updates; close the WebSocket for ports you don't serve. Every hostname the
  games use resolves to the server, so HTTP requests are routed by their `Host` header.
- Replies must be byte-exact. The games parse fixed offsets: exact header spelling and order,
  `Content-Length` with one space, closing when the original servers closed. That is why the
  bytes are tunnelled instead of sent as HTTP through a proxy or CDN.
- A missing or unknown token still plays; the score is just not linked to an account.

## 2. Account linking (optional)

```
POST https://<server>/link           (http:// when the tunnel is ws://)
{"code":"ABCD2345","name":"Living-room PC (MesenCE)"}
→ 201 {"token":"<device token>","handle":"mio"}
→ 4xx {"error":"<message for the player>"}
```

The player makes the 8-character code on the server's own website. Clients store the token with the
server address that issued it and never send it to any other server. A server without accounts can
leave `/link` out.

## 3. The games

What each game sends and expects is documented per game in the reference project
(`docs/wondergate/<game>.md`) and implemented in both servers. To check a new or changed server
against the reference, replay the recorded sessions:

```bash
node scripts/wg-conformance.mjs      # every captured request, byte for byte, against the Python server
node scripts/wg-mesen-e2e.mjs        # the games themselves, headless in MesenCE, against the Worker
```

## Deliberate differences from the Python server

- Bandai's charge service (`/service/charge/nph-*`) hangs up after each reply, as the original
  non-parsed-header CGIs did. Games such as Rainbow Islands and Gundam Vol. 1 read until the
  connection closes; the Python server keeps it open until its 60-second idle timeout.
- Clock values are Japan time; the Python server uses the host's local time (`wg-conformance.mjs` runs
  it with `TZ=Asia/Tokyo` so dates in binary replies compare).
- Dark Eyes ties a mercenary upload to the player who last sent world info from the same address.
  The Python server keeps that in memory by client address; the Worker stores a hash of the relay's
  address in D1 and forgets it after a day.
- Pocket Fighter's digital cards rotate: the Worker's `info=` reply turns on one of the 7 card flags
  per day (Japan time, Monday the first), so a player collects all 7 by downloading on each day of the
  week. The Python server turns all 7 on, as the six extras still are on both. (`wg-conformance.mjs`
  masks the card flags.)
- MobileWonderGate mail passwords are hashed with PBKDF2-SHA256 at 100,000 rounds, the most Workers
  allow; the Python server uses 200,000. Both store the rounds with each hash.
- The Python server's reverse-engineering probe hooks (environment variables such as `NC_MARK`,
  `DE_EVENT`, `RING_BODY`) are not ported.
