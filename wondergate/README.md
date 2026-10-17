# WonderGate: adapter + servers

Code for the [WonderGate revival](../docs/wondergate.md).

```
core/      wgcore: adapter protocol in portable C (PC host + future Wi-Fi firmware);
           wg_tunnel: its sockets over the Bluetooth tunnel (module side)
host/      wgcore-host: the adapter on a PC (Mednafen stdio, or a dongle's serial port)
server/    wgserver.py: game server (routes by original hostname, logs every request)
           swan_ranking.py: Bandai national rankings (7 games, per-game formats)
           charge.py: Bandai charge service (X-SWAN-* headers; in progress)
emu/       headless emulator: build_core.sh, drive.py, regress.py (+ replays.txt),
           watchrange.py / findreaders.py (find a game's reply parser)
tools/     play.sh, test_core.py, test_raku.py, rom_strings.py, mednafen-adapter.sh;
           blesim/: the Mac as a Bluetooth module (CoreBluetooth peripheral)
games.tsv  the 30 WonderGate games: name, and the SHA-1 and size of the dump tested (no ROMs here)
dev.conf   adapter config for local dev
```

## Headless testing (how games are tested now)

```bash
emu/build_core.sh          # once: headless core with our adapter on its serial port
tools/serve.sh             # dev game server
emu/regress.py             # replay every working game (emu/replays.txt) and check the session
emu/drive.py "raku jongg" w600 RIGHT RIGHT RIGHT RIGHT A w180 DOWN DOWN A w120 A w1500 s:result
```

Uses the translation project's headless emulator host with our core build
(`emu/comm.c`: adapter linked into the serial port, level-triggered transmit
interrupt, receive gated on port enable). Debug helpers: `emu/watchrange.py`
(which instructions read a RAM range = finds reply parsers), `emu/findreaders.py`,
`tools/rot.py`/`tools/tile.py` for vertical-game screenshots.

## Dev loop with a window

```bash
tools/play.sh "raku jongg"
```

This builds `wgcore-host`, (re)starts the server,
and opens Mednafen with the adapter attached (`wswan.excomm`). Play to the
game's WonderGate menu, then read:

- `logs/adapter.log`: every frame to and from the console, plus decoded
  DNS, connect, send and recv
- `logs/server.log`: each HTTP request (method, path, headers, body)
- `captures/`: raw requests + `index.jsonl`

ROMs come from `/Volumes/Games` when mounted, else `~/Documents` (same `WonderSwan Roms/`,
`WonderSwan Color/` layout); override with `WS_ROMS=`. `WG_PORT_OFFSET=N` shifts every server port, for
a second server copy (its adapter config then needs matching `portmap` lines).
Stop the server with `pkill -f server/wgserver.py`. Rankings live in `data/wg.sqlite`.

## Real console

Through any ExtFriend-compatible dongle (v0 cable or v1):

```bash
host/wgcore-host --config dev.conf --serial /dev/cu.usbmodemXXXX --log logs/adapter.log
```

## Bluetooth module (tunnel)

The Bluetooth module runs wgcore itself and sends the console's sockets to the phone, which
relays each one to the game server's `/tunnel` WebSocket. Protocol:
[docs/wondergate-ble-protocol.md](../docs/wondergate-ble-protocol.md); module side
`core/wg_tunnel.c` (plugs in as wgcore's socket ops; names resolve to 10.0.0.N so a connect
carries the hostname; ports go through unremapped).

```bash
make -C tools/blesim && tools/blesim/blesim --config dev.conf     # the Mac as the module, for the phone app
emu/tunnel_phone.py &                                              # phone stand-in over TCP -> dev server
host/wgcore-host --config dev.conf --tunnel 127.0.0.1:7600         # Mednafen / cable, sockets via the tunnel
WG_ADAPTER_TUNNEL=127.0.0.1:7600 emu/regress.py rakujang           # headless, same (WG_ADAPTER_MTU=23 for the BLE minimum)
```

Without Bluetooth the link is a TCP stream (u16 length + message; the module's first frame is
INFO, the phone's first message STATUS). [tools/blesim/README.md](tools/blesim/README.md) covers
the real-Bluetooth setup.

## Tests

```bash
make -C host test           # adapter, byte level; Bluetooth tunnel against a scripted phone
python3 tools/test_raku.py  # Raku Jongg ranking server vs. a port of the game's parser
python3 tools/test_loderunner.py  # Lode Runner link-cable stage uploads (pending queue)
```

The test feeds console frames to the host program and checks reply bytes:
power-on/off, status, dial and hang-up, DNS redirect, port remap, and a full
socket round trip.

## Adapter behaviour we chose

Sources disagree in places. Where we have it, the real-adapter capture wins: Yuvi's, in
[WonderGateway](https://github.com/Yuvi-App/WonderGateway) (Keitai Archive), `Hardware-Captures/N253i-Pocketfighet.txt`.

Frame: `[type][length hi][length lo][cmd][params]`, length counts cmd + params.

| Point | Choice | Source |
|---|---|---|
| `00` burst to a sleeping adapter | `55 55 55 55 55` (wake banner), once | Sennou Millennium's code; WonderGateway's real-adapter capture (Yuvi) |
| Power-on | `01 00 03 02 '1' '0'` | Sennou checks for cmd 02 |
| Power-off | `0F 00 01 FF` | WonderGateway's real-adapter capture (Yuvi) |
| Phone status before power-on | "ok" | WonderGateway's per-game testing (Buffers Evolution) |
| Dial | `0B 00` (connected) | trap15 |
| Hang-up | `0B F0` (line down) | Wonder Classic needs exactly 5 bytes and `(b & F0) == F0`, else it retries 3 times; `F0` is "connection cut" (error 007) in the games' libraries. Found 2026-10-16 in blind tests; the earlier `0B 01 00 00 00` made Wonder Classic retry |
| Close socket | `<sock> 01` | Sennou checks for 1; Dark Eyes checks the socket id |
| Socket ids | from 0 | WonderGateway's tested value (trap15 used 0x30); games accept 0-7 (Another Heaven checks) |
| Socket replies (connect, send, recv, close, shutdown) | start with the socket id asked about | Tonpuusou and Lode Runner read it, Gather Beat retries on a mismatch, Dark Eyes checks it on close. Shutdown's contents are ignored by every game (any reply works, none stalls them), so it follows the same `<sock> 01` shape. All 37 replays also pass with ids starting at 1 |
| Recv on closed socket | count `FF` | both; Sennou treats `FF` and `00` as end |
| Noise before a frame | skipped (only types 01 02 03 0F 11 start a frame) | GunPey EX link-cable `8F` |
| `SEND`+NUL between frames | link peer (our addition): answer `RECV`, `OK`, take Lode Runner's 512-byte stage, upload it | Lode Runner ROM (docs/wondergate/lode-runner.md) |

## Server inventory (from ROM strings)

From `tools/rom_strings.py` over our dumps. All HTTP with `User-Agent: SWAN/1.0`.

### Shared: Bandai "swan-ranking"

Form POST (`application/x-www-form-urlencoded`) with fields `owner`, `score`,
`list` (`NAME|start|count`), `group`. Reply `Content-Type:
application/x-swan-ranking-response`. **One handler covers all of these:**

| Game | URL |
|---|---|
| Raku Jongg | `http://rakujang.wgg.channel.or.jp/swan-ranking` (`list=rakujang\|1\|20`, `score=1\|`…`3\|`) |
| Another Heaven | `http://heaven.wgg.channel.or.jp/swan-ranking` (`list=BEST\|1\|5`) |
| GunPey EX | `http://gunpeyex.wgg.channel.or.jp/swan-ranking` |
| Final Lap 2000 | `http://wgg01.channel.or.jp/service/swan-ranking/final-lap` (`list=FLTOP\|1\|1`) |
| Pocket Fighter | `http://wgg01.channel.or.jp/service/swan-ranking/pocketf` (`list=ANSPF_SCORE\|1\|50`) |
| Sennou Millennium | `http://wgg01.channel.or.jp/service/swan-ranking/sen-know` (`list=ranking\|10\|%2b16`) |
| Tarepanda no Gunpey | `http://wgg01.channel.or.jp/service/swan-ranking/tarepang` |
| D's Garage 21 | `http://wgg01.channel.or.jp/service/swan-ranking/tanetori` |
| Tonpuusou | `tongpuso.wgg.channel.or.jp` `/cgi-bin/getrate.cgi`, `/cgi-bin/setrate.cgi` (`list=RANK%7C1%7C100`) |

GunPey EX contains a leftover sample response:

```
HTTP/1.1 200 OK
Date: 1999-10-19
Content-Type: application/x-swan-ranking-response
Content-Length: ?

date199912311500003
info=www.bandai.co.jp:tarepang
group=1|19991215|20001215|DEFAULT
course=1|1|7526|0009999900|0000000500|21
RANK=3
1|0009999900|snorse|4899
2|0009875100|temprer|3602
3|0008732600|monk|3218
...
```

### Shared: Bandai "charge" (service window, time, session)

`wgb01.channel.or.jp/service/charge/`: `nph-srvccount`, `nph-gettime`,
`nph-srvcinfo` (header `X-swan-srvc-id`), `nph-session` (header
`X-swan-cmnd-sid`), `nph-contents` (header `X-swan-cnts-aid`). Used by
Pocket Fighter, Rainbow Islands, Gundam Vol. 1, Wizardry, Wonder Classic,
Digimon and Doraemon (gettime).

### Per game

| Game | Endpoints |
|---|---|
| Buffers Evolution | `POST http://wgg01.channel.or.jp/service/buffersevolution` (HTTP/1.0). ROM has a sample `BFEVREC=` reply |
| Rainbow Islands | charge layer + `nph-contents` downloads |
| Gundam Vol. 1 | charge layer + `nph-contents` |
| Gundam Vol. 3 | no host string found; likely built at runtime. Capture needed |
| Wizardry Scenario 1 | `http://www2.sting.co.jp/cgi-bin/wg/wiz.cgi?` (`mp=kure`, `it=kure`, `nm=…&sc=…`) + charge layer |
| Wonder Classic | `nclassic.wgg.channel.or.jp` ports 80 **and 10000**; `POST /cgi-bin/kakin.cgi` + charge layer (`X-swan-srvc-id: BAN00C01`) |
| Digimon D1 Tamers | `http://digi4.wgg.channel.or.jp/cgi-bin/dm4{signup,login,rankbtl,rankdl,idupld,idsrch,idbtl}.cgi`, UA `SWAN/1.0 DIGIMON-04` |
| Digimon Brave Tamer | `http://digi_b.wgg.channel.or.jp/cgi-bin/dmB{signup,login,rankbtl,rankdl,idupld,idsrch,idbtl}.cgi`, UA `SWAN/1.0 DIGIMON-0B` (same server module) |
| Dark Eyes | `battleg1.dark-eyes.com/cgi-bin/dark/nph-{login,account,upmrcnry,listmrcnry,downmrcnry,worldinfo,reqmatch,match}.cgi` |
| Star Hearts | `http://s_hearts.wgg.channel.or.jp/cgi-bin/starhearts.cgi?000{2..5}FFFF` |
| Ring Infinity | `GET /ring/cgi-bin/accsess.cgi?RING=666` on `wgg02.channel.or.jp` |
| Terrors 2 | `GET /cgi-bin/accsess.cgi?T2=www.sign-eight.co.jp` on `terrors2.wgg.channel.or.jp` |
| SD Gundam G Gen Gather Beat 1/2 | `wgg02.channel.or.jp`, paths not in plain text |
| SD Gundam Gashapon Senki | `wgg01.channel.or.jp`, paths not in plain text |
| Doraemon | `www.bea.hi-ho.ne.jp:80/log_inguz_1999/index.shtml`, `www.swan.channel.or.jp`, nifty.com test URLs |
| MobileWonderGate cart | BPL `bpl0x.mopera.ne.jp:5555`, portal `*.mopera.ne.jp`, mail via SMTP (`HELO`/`MAIL FROM`/`RCPT TO`) + POP3 (`USER`/`PASS`/`LIST`/`RETR`), `X-Mailer: MobileWonderGate1.0`, DNS `ns1/ns2.channel.or.jp` |
