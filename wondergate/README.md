# WonderGate: adapter + servers

Code for the [WonderGate revival](../docs/wondergate.md).

```
core/      wgcore: adapter protocol in portable C (PC host + future Wi-Fi firmware);
           wg_tunnel: its sockets over the Bluetooth tunnel (module side)
host/      wgcore-host: the adapter on a PC (Mednafen stdio, or a dongle's serial port)
server/    wgserver.py: game server (routes by original hostname, logs every request)
           swan_ranking.py: Bandai national rankings (7 games, per-game formats)
           charge.py: Bandai charge service (X-SWAN-* headers; in progress)
emu/       headless emulator: build_core.sh, drive.py, regress.py (+ replays.txt, checks.txt, seeds/),
           watchrange.py / findreaders.py (find a game's reply parser)
tools/     play.sh, test_core.py, test_raku.py, rom_strings.py, mednafen-adapter.sh;
           blesim/: the Mac as a Bluetooth module (CoreBluetooth peripheral)
games.tsv  the 30 WonderGate games: name, and the SHA-1 and size of the dump tested (no ROMs here)
dev.conf   adapter config for local dev
```

## Headless testing (how games are tested now)

```bash
emu/build_core.sh          # once: headless core with our adapter on its serial port
tools/serve.sh             # dev game server (for drive.py and play.sh)
emu/regress.py             # replay every working game (emu/replays.txt) against its own fresh server copy
emu/regress.py --bless KEY # after a look at runs/regress/KEY.png: record that screen in emu/checks.txt
emu/regress.py --fault     # corrupt every HTTP reply: shows which replays would notice a bad reply
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
make -C host test           # adapter, byte level; the game's receive wait; Bluetooth tunnel against a scripted phone
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
| Recv with nothing to give | count 0, after the wait the game asked for (the command's third parameter, seconds); after 2 s when the game sends none | the games' own code and waits, [below](#the-games-receive-wait); no capture of a real adapter shows a receive that timed out |
| Noise before a frame | skipped (only types 01 02 03 0F 11 start a frame) | GunPey EX link-cable `8F` |
| `SEND`+NUL between frames | link peer (our addition): answer `RECV`, `OK`, take Lode Runner's 512-byte stage, upload it | Lode Runner ROM (docs/wondergate/lode-runner.md) |

### The game's receive wait

Built 2026-11-27. The two receive commands (`11:0D` one line, `11:0F` a block) are `[socket][length]`
plus, in most games, a third byte. We read it as how long the adapter should wait for data, in
seconds, and wait that long before answering "nothing yet" (count 0). Data that arrives sooner is
returned at once, a closed socket still answers `FF`, and a receive without the byte (or with 0)
waits 2 s as before. Until this change every receive answered count 0 after 2 s, and Terrors 2,
which counts that answer as a line of the reply, set its clock from the wrong line whenever the
server's reply started more than 2 s late ([ring-terrors.md](../docs/wondergate/ring-terrors.md)).

**What the "seconds" reading rests on.** No real adapter was ever recorded timing out, so this comes
from the games:

- Terrors 2 and Ring Infinity send a fixed 05 (ROM `0x34E9FF` / `0x34CFC7`, `mov ah,5`) and then wait
  `0x177` = 375 = 5 × 75 ticks of their frame counter for the answer. That library counts its waits
  in frames, mostly whole seconds at 75 a second: power-on and send 75, shutdown and close 225,
  name lookup 375, dial 3750 (one status query waits 125).
- Rainbow Islands passes 30 as an argument of its library's receive call (`push 0x1E` at ROM
  `0x1FC8BD`; the library, ROM `0x1FB74E`, sends it as the third byte). The library's own wait for
  the answer's first byte is a fixed 40,000 turns of a loop that takes about a millisecond.
- Each game's own wait for the answer, measured in the emulator with an adapter that never answers a
  receive (time from the command's last byte to the next byte the game sends):

| Value | Games | The game waits | Then |
|---|---|---|---|
| 05 | Ring Infinity, Terrors 2 | 4.96 s (374 frames) | shuts the socket down, closes, hangs up |
| 05 | Gather Beat | 9.9 s | shuts the socket down |
| 05 | Sennou Millennium | 29.8 s | hangs up |
| 07 | D1 Tamers, Brave Tamer, Another Heaven, Doraemon, Star Hearts, Wizardry, Raku Jongg, Yamato | 7.20 s (543 frames) | closes the socket (D1 Tamers, Doraemon, Star Hearts, Wizardry) or sends its request again (the others) |
| 0A | Tonpuusou | 5.96 s | closes the socket |
| 0A | Wonder Classic | 12.0 s | starts over with a power-on |
| 0A | Lode Runner | 12.9 s | closes the socket |
| 14 | Dark Eyes | 29.8 s | hangs up |
| 1E | Rainbow Islands, Gundam Vol. 1 | 38.4 s, 38.1 s | closes the socket |
| none | Pocket Fighter 54.7 s; GunPey EX, Tare Panda, Buffers Evolution 39.7 s; the cart's browser 11.4 s | | |

  Seven of the nine rows with a value wait as long as the value in seconds or longer, three of them
  only a little longer (7 → 7.2 s, 10 → 12 s and 12.9 s, 30 → 38 s). Terrors 2 and Ring Infinity
  wait 375 frames, 5 s at 75 frames a second; it comes to 4.96 s because the console runs at 75.47.
  Tonpuusou is the exception: it sends 10 and gives up after 6 s. A smaller unit (half a second,
  say) would fit every game too, so "seconds" is the likely reading, not a proven one. Raku Jongg
  and Yamato use both 05 and 07 in one session.

**When the wait runs out** the game gets count 0. Rainbow Islands and Gundam Vol. 1 ask again, with
no limit, until the socket closes (Rainbow Islands ROM `0x1FC8E5`, the same code in Gundam Vol. 1
at `0x3FCCC1`: the count is added and the loop repeats; only `FFFF` ends it). Terrors 2 and Ring
Infinity count it as a line. In those two and in Tonpuusou the
game's own wait is the shorter one, so on a real console the game has already moved on when our
count 0 would arrive, and its next command would take that late answer for its own. So a receive
that is still waiting when the console sends again is dropped with no answer (the log says so).
What the real adapter did there is not known.

**How each platform waits** (`sock_recv_wait` in `core/wg.h`; a platform without it keeps the 2 s
for every receive):

| Platform | How | Seen working |
|---|---|---|
| PC host (`host/`, `core/wg_posix.c`) | blocks in `poll()` on the socket and the console's descriptor: the program does nothing else, and the console's bytes wait in the pipe or serial buffer | `host/test_wait.py` |
| Tunnel (`core/wg_tunnel.c`: Bluetooth module, `--tunnel`) | the same pump loop as before, until the game's wait instead of `recv_ms`, looking at the console every 20 ms. Only once the platform sets `console_busy`; without it nothing changes | `host/test_tunnel.py`; in the emulator with `emu/tunnel_phone.py` |
| Headless emulator (`emu/comm.c`) | blocks inside the call, as before, so the emulated clock stands still while the server is slow and a replay sees the same frames whatever the server's speed. Only when the whole wait passes with nothing is the count 0 held back for the same time on the console's clock, and dropped if the game sends first. Nobody watches a headless run, so the block costs only time, and only when the server is silent | Terrors 2 (below), Rainbow Islands, all replays |
| Browser (`link-web/`, `src/lib/link-web/adapter.ts`) | the receive import returns a Promise (asyncify), now with the game's wait as its timer; bytes fed meanwhile end it. The page is never blocked | a scripted tunnel server; `scripts/link-web-replay.mjs` for three recorded sessions |

In the game (2026-11-27, `terrors 2` with the server's reply held back by a proxy, `T2_TIME=23:59`):
0, 3 and 4.5 s late give the right clock (`[0xAA5]` = `02 00 CF 02`), at the same frame each time;
the adapter before this change gave `02 00 7A 00` at 3 s. At 6 s, and with a server that never
answers, the game gives up after its own 4.96 s, the late answer is dropped, the clock stays unset
(`00 00 00 00`), and the shutdown, close, hang-up and power-off are answered as usual. The game
shows データを受信しました either way: it has no error for this. A reply more than 5 s late cannot
work in Terrors 2 on any adapter that does what the game asks. Rainbow Islands with the reply 10 s
late takes it in one receive; with a silent server it gets count 0 after 30 s and asks again.
Pocket Fighter, which sends no value, still gets count 0 after 2 s (it then retries the request
once and hangs up; it would itself wait 54 s).

Not done here: the MesenCE fork and the Bluetooth module's firmware are other repositories. Both
keep working unchanged (MesenCE has no `sock_recv_wait`, the firmware doesn't set `console_busy`).

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
