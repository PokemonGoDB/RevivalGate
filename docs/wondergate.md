# WonderGate revival

How Bandai's WonderGate service worked, which games used it, and where each one stands on RevivalGate.
Each game's protocol notes are in [wondergate/](wondergate/); the code is in [../wondergate/](../wondergate/README.md).

## In short

- **The adapter talks sockets, not modem.** The console sends short framed commands over the EXT UART
  (9600 8-N-1): "open TCP socket", "connect", "send", "recv", "resolve hostname". The adapter ran PPP
  itself. So anything that can play the adapter (a PC program, an emulator, a small module) can map those
  commands onto ordinary TCP/IP. The console and cartridges stay unmodified.
- **Earlier work on the adapter.** trap15's *wonderfence* (2014, MIT) emulates the adapter on a PC, and
  RevivalGate's adapter follows it. Keitai Archive's *WonderGateway* (Yuvi, July 2026) does too, and
  reported 14 titles working against its own servers, which aren't public. [CREDITS.md](../CREDITS.md)
  lists exactly what RevivalGate used from each.
- **The servers had to be rebuilt.** No recordings of the original servers' traffic are known, so each
  game's server protocol is worked out from the game's own code and checked by running the game. Content
  that was only ever on Bandai's servers is lost unless it's in a ROM or turns up.
- **Redirecting is free.** The console asks the *adapter* to resolve hostnames (command `$11:$08`), so
  the adapter sends every dead domain to the RevivalGate server. No cartridge patches are needed.

## How the original worked

```
 WonderSwan ─EXT UART 9600─▶ MobileWonderGate adapter ─cable─▶ DoCoMo PDC phone ─9600 bps circuit call─▶ mopera ISP ─▶ servers
            (socket cmds)     (CPU + TCP/IP + PPP)              (modem)
```

- **Package** (¥10,200, 2001): phone adapter + "mopera connection" cart
  (browser, mail). Games with WonderGate support talk to the adapter directly.
  The cart is only needed for browser/mail. The adapter takes a AAA cell for
  memory backup only ([k-tai Watch review](https://k-tai.watch.impress.co.jp/cda/article/review/3287.html)).
- **Adapter internals** (WSdev, partly unconfirmed): Suntac D82525GC001
  (CPU?), 8 Mbit NOR flash (M29W800AT), 1 Mbit SRAM.
- **Shutdown:** game services ended 2003-03-31. Browser/mail worked until
  mopera's WonderGate service closed at the end of 2004.

### Serial protocol (EXT UART)

9600 8-N-1, inverted polarity like all EXT serial (ExtFriend's PIO already
handles this). The adapter supports 38400, but the switch-over handshake
isn't documented.

Frame, both directions:

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | Type |
| 1 | 1 | Always 0 so far |
| 2 | 1 | Length of the rest (command byte + params) |
| 3 | 1 | Command |
| 4 | n | Params (max payload 145 bytes) |

Games send a burst of `$00` sync bytes first, so skip leading zeros.
Unknown commands and oversized payloads get **no reply** (games time out).

| Type:Cmd | Meaning | Reply notes |
|---|---|---|
| `01:02` | Power on adapter | Cold power-on answers with a raw `55 55 55 55 55` burst, otherwise a version word |
| `0F:FF` | Power off | Params must be `55 AA 55 AA`. Reply `0F 00 01 FF` |
| `02:01` | Adapter status | Reply uses cmd `02`: 0 = off, 2 = on, 3 = PPP up |
| `01:00` | Phone/PDC status | `status, reception(0–15)`. Status: 0 ok, 1 busy, 2 no service, 3 no phone. Some games ask before power-on, so answer "ok" from the start |
| `01:08` | Dial | Reply uses cmd `0B` |
| `01:0A` | Hang up | Reply uses cmd `0B` with 4 zero params (Raku Jongg checks length ≥ 8) |
| `01:10` | Set PPP user/pass | `01` = ok |
| `01:11` | Set DNS servers | `01` = ok |
| `11:01` | New TCP socket | Socket id, or `FF` |
| `11:03` | Connect | Params: sock, family (2 = INET), port **little-endian**, IPv4 |
| `11:06` | Shutdown socket | |
| `11:07` | Close socket | Must reply 2 bytes `00, 00` (Rainbow Islands aborts with error 999 otherwise) |
| `11:08` | Resolve hostname | `01`, canonical name, NUL, IPv4. **This is where we redirect** |
| `11:0D` | Recv one line (up to `\n`) | `00, count, data…`. `FF` = closed |
| `11:0E` | Send bytes | `00, count` |
| `11:0F` | Recv block | as `0D` |

**Link-cable traffic on the same port (our addition).** Lode Runner's DATA I/O sends a stage to
another console with NUL-terminated ASCII words (`SEND`, `RECV`, `OK`, `NG`, `SAME`) and then the
raw 512-byte editor slot. None of those words starts with a frame type, so wgcore spots a sender's
`SEND`+NUL between frames, answers as the receiving console and uploads the stage to our server
(`POST http://link.swanrevival.com/loderunner/stage`); no mode switch. Details:
[lode-runner.md](wondergate/lode-runner.md#link-cable-data-io).

Sources: [WSdev WonderGate](https://ws.nesdev.org/wiki/WonderGate), the
wonderfence source (MIT), and Yuvi's WonderGateway (Keitai Archive). From
WonderGateway we took facts, not code (it has **no license**):

- its real-adapter capture (`Hardware-Captures/N253i-Pocketfighet.txt`): the
  `55 55 55 55 55` wake reply, the `0F 00 01 FF` power-off reply and the `0B 02`
  busy-line reply;
- its per-game testing: socket ids from 0, phone status "ok" before power-on
  (Buffers Evolution), Rainbow Islands failing on a 1-byte socket-close reply,
  Raku Jongg needing a 4-byte hang-up reply;
- its README's list of working titles (the Keitai Archive column below).

Its Mednafen patch was read to see how Mednafen launches an outside adapter; our
emulator build (`emu/comm.c`, from the libretro core's own file) doesn't use it.
Other sources: kconger's wonderfence fork (`bpl_proxy.c`) and the WSdev bplXX page
for the browser's BPL "allow" reply; Keitai Wiki for the game list, per-game
features and scanned manuals; Keitai Archive's WS-WonderGate-Patches README for the
menu combos and Star Hearts' 32 KB save (see `tools/fix_header.py`).

### Browser handshake (BPL)

Before loading any page, the cart browser asks `bpl01/02.mopera.ne.jp:5555`
(a binary protocol) whether the URL is allowed. "Allow" is a 24-byte header
with type `0x0010` and no blocks. The original also acted as a translating
proxy for the browser's HTML 3.2 subset. Spec:
[WSdev bplXX page](https://ws.nesdev.org/wiki/WonderGate/bplXX.mopera.ne.jp).
kconger's wonderfence fork answers "allow" from inside the adapter, so no BPL
server is needed for basic browsing.

## Progress (our servers, tested headless against the real game code)

<!-- progress:start -->
| Game | Status | Features | Notes |
|---|---|---|---|
| MobileWonderGate cart | 🔁 substitute | ✅ Web browser (portal pages); ✅ Mail auto-setup; ✅ Mail (receive and send); 🔁 Game downloads (GAME menu) | [mobilewondergate.md](wondergate/mobilewondergate.md) |
| Raku Jongg | ✅ working | ✅ Rankings (ranks, tables, names, stages) | [raku-jongg.md](wondergate/raku-jongg.md) |
| GunPey EX | ✅ working | ✅ National rankings, all 5 modes | [gunpey-ex.md](wondergate/gunpey-ex.md) |
| Tare Panda no GunPey | ✅ working | ✅ National rankings, all 4 modes | [tare-panda.md](wondergate/tare-panda.md) |
| Another Heaven | ✅ working | ✅ Quick-solve ranking | [another-heaven.md](wondergate/another-heaven.md) |
| D's Garage 21: Tane o Maku Tori | ✅ working | ✅ National best on all 4 boards | [ds-garage.md](wondergate/ds-garage.md) |
| Sennou Millennium | ✅ working | ✅ Net ranking | [sennou.md](wondergate/sennou.md) |
| Final Lap 2000 | ✅ working | ✅ W.G ranking: total and lap times on all 16 courses | [final-lap.md](wondergate/final-lap.md) |
| Pocket Fighter | ✅ working | ✅ Customer ID, score upload, rankings; ✅ Paid extras and digital cards | [pocket-fighter.md](wondergate/pocket-fighter.md) |
| Rainbow Islands: Putty's Party | ✅ working | ✅ Item GET, Illust GET | [rainbow-islands.md](wondergate/rainbow-islands.md) |
| Mobile Suit Gundam Vol. 1: Side 7 | ✅* shortcut-verified | ✅* Hammer and Javelin unlock | [gundam-vol1.md](wondergate/gundam-vol1.md) |
| Mobile Suit Gundam Vol. 3: A Baoa Qu | ✅* shortcut-verified | ✅* Sub-scenario unlock (needs only a connection) | [gundam-vol3.md](wondergate/gundam-vol3.md) |
| Buffers Evolution | ✅ working | ✅ National rank, world record, and the time for the next rank, on all 36 courses | [buffers-evolution.md](wondergate/buffers-evolution.md) |
| Tonpuusou | 🔁 substitute | ✅ Rating (R) download and upload, ID and password; 🔁 Link results to the PC version | [tonpuusou.md](wondergate/tonpuusou.md) |
| SD Gundam Gashapon Senki Episode 1 | ❌ missing | ❌ Map downloads | [gashapon-senki.md](wondergate/gashapon-senki.md) |
| SD Gundam G Generation Gather Beat 1 & 2 | 🔁 substitute | ✅* Gather Beat 2 shop: units, parts, pilots, scenarios; 🔁 Gather Beat 1 shop: ☆ units, characters, parts | [gather-beat.md](wondergate/gather-beat.md) |
| Pocket no Naka no Doraemon | ✅ working | ✅ DORA MAIL seasonal mails | [doraemon.md](wondergate/doraemon.md) |
| Ring Infinity | ✅ working | ✅ Event mails (check-in) | [ring-terrors.md](wondergate/ring-terrors.md) |
| Terrors 2 | ✅ working | ✅ Real-time campaign clock | [ring-terrors.md](wondergate/ring-terrors.md) |
| Wizardry Scenario 1 | ✅* shortcut-verified | ✅ Additional maps; ✅ Net shopping (stock list); ✅* Ranking registration | [wizardry.md](wondergate/wizardry.md) |
| Digimon Adventure 02: D1 Tamers | ✅* shortcut-verified | ✅* Signup; ✅* Ranking battles and ladder; ✅* ID upload, search and battle | [digimon-d1-tamers.md](wondergate/digimon-d1-tamers.md) |
| Dark Eyes: Battle Gate | ✅* shortcut-verified | ✅ Online battles (login, prepaid service, matchmaking, turn relay); ✅* Mercenaries (register, list, hire, withdraw, fees); ✅ World info (market, world events, busiest and quietest battle regions, place names) | [dark-eyes.md](wondergate/dark-eyes.md) |
| Star Hearts | ✅* shortcut-verified | ✅ Gate Bazaar membership; ✅* Visitor counters | [star-hearts.md](wondergate/star-hearts.md) |
| Wonder Classic | 🔁 substitute | ✅ Member card registration; 🔁 Net Tour (bulletin, round download, play, entry); ✅ Rankings, your rank, previous winners, past rankings; ✅ New product (monthly item); ✅* Super shot upload and VTR; ✅* 耳寄り情報 (inside tips) and the ネオキャラ (Neo characters) unlock; 🔁 Tour replays | [wonder-classic.md](wondergate/wonder-classic.md) |
| Lode Runner for WonderSwan | ❌ missing | ❌ Extra stage downloads (50+); ✅ Stage sharing over the link cable (our addition) | [lode-runner.md](wondergate/lode-runner.md) |
| Digimon Tamers: Brave Tamer | ✅* shortcut-verified | ✅* Signup; ✅* Ranking battles and ladder; ✅* Hall-of-fame battles (でんどうバトル) | [brave-tamer.md](wondergate/brave-tamer.md) |
| Uchuu Senkan Yamato | ✅* shortcut-verified | ✅* National ranking (Yamato index, top 50); ✅* Crew logs (all 30, in the ROM) | [yamato.md](wondergate/yamato.md) |
| Mobile Suit Gundam Vol. 2: Jaburo | ✅* shortcut-verified | ✅* Side stories (セイラの回想, カイの回想), needs only a connection | [gundam-vol2.md](wondergate/gundam-vol2.md) |

✅ working · ✅* shortcut-verified · 🔁 substitute · ⛔ impossible · 🚧 partial · ❌ missing. Source: [progress.json](wondergate/progress.json) (`wondergate/tools/progress.py`).
<!-- progress:end -->

Regression: `wondergate/emu/regress.py` replays all of them.

## Games

25 titles per [Keitai Wiki](https://keitaiwiki.com/wiki/MobileWonderGate), plus 5 more found on
2026-10-14 by scanning all 201 of our WonderSwan ROMs for WonderGate code (hostnames, `SWAN/1.0`,
ワンダーゲート); none of the five is on Keitai Wiki's list or Bandai's WonderGate page. The scan
flagged all 25 known titles and no others.
Status as reported by Keitai Archive's
[WonderGateway README](https://github.com/Yuvi-App/WonderGateway) (servers not public).

| Game | Feature | Original host | Keitai Archive |
|---|---|---|---|
| MobileWonderGate cart | Browser, mail, mini-game downloads | `bpl0x.mopera.ne.jp` + mail | ✅ |
| Rainbow Islands: Putty's Party | Item / illustration downloads | `wgb01.channel.or.jp` | ✅ |
| Pocket Fighter | National rankings, new menu features | `wgb01`, `wgg01.channel.or.jp` | ✅ |
| Raku Jongg | Rankings | `rakujang.wgg.channel.or.jp` | ✅ |
| Wizardry Scenario 1 | Downloadable dungeons, shop stock | `www2.sting.co.jp` | ✅ |
| Terrors 2 | Real-time campaign | `terrors2.wgg.channel.or.jp` | ✅ |
| Buffers Evolution ¹ | Rankings | `wgg01.channel.or.jp` | ✅ |
| D's Garage21: Tane wo Maku Tori ¹ | Rankings | `wgg01.channel.or.jp` | ✅ |
| Sennou Millennium ¹ | Rankings | `wgg01.channel.or.jp` | ✅ |
| Another Heaven | Speed-solve rankings | `heaven.wgg.channel.or.jp` | ✅ |
| Pocket no Naka no Doraemon | Email questions | `www.bea.hi-ho.ne.jp` | ✅ |
| Star Hearts | Gate Bazaar shops, blacksmith | `s_hearts.wgg.channel.or.jp` | ✅ |
| Ring Infinity | Event mails (remembered as new scenarios) | `wgg02.channel.or.jp` | ✅ |
| Digimon Adventure 02: D1 Tamers | Online multiplayer | `digi4.wgg.channel.or.jp`, `wgb01` | ✅ |
| Dark Eyes: Battle Gate | Online battles, mercenaries | `battleg1.dark-eyes.com` | 🚧 |
| Tarepanda no Gunpey ¹ | Rankings | `wgg01.channel.or.jp` | — |
| SD Gundam Gashapon Senki Ep. 1 ¹ | New maps (12) | `wgg01.channel.or.jp` | — |
| Final Lap 2000 ² | Rankings | `wgg01.channel.or.jp` | — |
| SD Gundam G Generation Gather Beat | Rare data downloads | `wgg02.channel.or.jp` | — |
| SD Gundam G Generation Gather Beat 2 | Units, scenarios | `wgg02.channel.or.jp` | — |
| GUNPEY EX | Rankings on the web | `gunpeyex.wgg.channel.or.jp` | — |
| Wonder Classic | Courses, caddies, rankings | `nclassic.wgg.channel.or.jp` | — |
| Tonpuusou | Link results to PC version | `tongpuso.wgg.channel.or.jp` | — |
| Mobile Suit Gundam Vol. 1: Side 7 | Unlock missed weapons | `wgb01.channel.or.jp` | — |
| Mobile Suit Gundam Vol. 3: A BAOA QU | Unlock missed sub-scenario | none (dial only) | — |
| Lode Runner for WonderSwan ³ | 50+ extra stages (advertised, used) | `wgg01.channel.or.jp` | — |
| Digimon Tamers: Brave Tamer ³ | Online ranked battles (used in 2002) | `digi_b.wgg.channel.or.jp` | — |
| Uchuu Senkan Yamato ³ | National ranking, crew logs (never advertised) | `yamato.wgg.channel.or.jp` | — |
| Mobile Suit Gundam Vol. 2: Jaburo ³ | Side stories (announced as cut, still fully in the ROM) | none (dial only) | — |
| Last Alive ³ | None: Terrors 2's check-in code, never called | `terrors2.wgg.channel.or.jp` | — |

¹ WonderGate menu hidden behind a power-on button combo (works on real
hardware; [patches](https://github.com/Keitai-Archive/WS-WonderGate-Patches)
exist for emulators). The combos, Final Lap's sequence and Buffers Evolution's
one-finished-course rule all come from that Keitai Archive README; we later found
each check in the ROM. ² Button sequence in ranking mode. ³ Found by our ROM scan (2026-10-14);
not on Keitai Wiki's list.

Shared service endpoints on `wgb01.channel.or.jp/service/charge/` (`nph-srvccount`,
`nph-gettime`, `nph-srvcinfo`, `nph-session`) handle service windows,
time, pricing and session tokens for many titles. That's one shared layer
to build first.

Kinds of server work:

1. **Rankings:** submit + list. Small, stateful, easy once the format is known.
2. **Unlocks:** the server says "yes" and the content is already in ROM. Easy.
3. **Downloads** (maps, items, scenarios): the data lived on the server.
   **Lost** unless it's in ROM, in an archive, or someone recreates it.
   Check per game.
4. **Multiplayer** (Digimon, Dark Eyes, Terrors 2): real game logic and
   matchmaking. Hardest.
5. **Mail** (cart, Doraemon): run our own SMTP/POP3, closed to the outside
   internet (WonderSwan ↔ WonderSwan only), so it can't become a spam relay.

## Lost content: what we serve, and save data wanted

Where Bandai's server data is lost, we don't pass off our own content as the original. Any
stand-in is labelled as ours, in the game where possible and on the site, and is kept in this
repo so it isn't lost too. Status per game (2026-10-14):

| Game | Original | What we serve | Save data that could recover it |
|---|---|---|---|
| MobileWonderGate | One mini-game on record (a 15-puzzle) | Homebrew (Snake), to be labelled as such | The last downloaded game (SRAM bank 7) |
| Gashapon Senki | 12 maps with enemy AI | Nothing (stand-in pulled); custom fan maps planned | Up to 3 downloaded maps |
| Gather Beat 1 | 6 rounds of ☆ units, characters, parts; lists partly documented, no prices | Bandai's final (April 2001) list at our estimated prices, labelled as estimates | The last downloaded list, with prices (SRAM 0x79C) |
| Gather Beat 2 | Units, parts, pilots, 2 scenarios, documented with prices | The documented list at the documented prices | Unlikely (list read into RAM) |
| Wonder Classic | Monthly Net Tour; no round is known to have been held | A test round; themed monthly tours planned | A downloaded round (tour save) |
| Tonpuusou | R shared with the PC 東風荘 (closed 2018) | R kept on our server; a leaderboard on the site | — |

Each game's doc has the details, sources, and a "Check your cartridge" note to put on its page.

## References

- WSdev wiki: [WonderGate](https://ws.nesdev.org/wiki/WonderGate) ·
  [BPL protocol](https://ws.nesdev.org/wiki/WonderGate/bplXX.mopera.ne.jp)
- trap15, wonderfence (MIT): https://bitbucket.org/trap15/wonderfence ·
  write-up: http://daifukkat.su/blog/archives/2014/06/02/mobilewondergate_resurrection/
- kconger/wonderfence (fork with built-in BPL proxy, 2026): https://github.com/kconger/wonderfence
- Keitai Archive / Yuvi, WonderGateway (VB.NET, no license, 2026): https://github.com/Yuvi-App/WonderGateway
  (used for facts only: its hardware capture, per-game quirks and working-title list; see Sources above)
- Keitai Archive: [WS-WonderGate-Patches](https://github.com/Keitai-Archive/WS-WonderGate-Patches) ·
  [WS-Servers](https://github.com/Keitai-Archive/WS-Servers) (README and license only, as of 2026-10-16) ·
  [KeitaiStation](https://github.com/Keitai-Archive/KeitaiStation) (same idea for the PS1 phone cable)
- asie, "Browsing the web with a WonderSwan in 2023": https://blog.asie.pl/2023/08/browsing-the-web-wonderswan-2023/
- Keitai Wiki game list: https://keitaiwiki.com/wiki/MobileWonderGate
- Service end, games (Dengeki, 2003): https://dengekionline.com/data/news/2003/3/4/de85f556264d4cdbd6a7bce48abfce78.html
- Service end, mopera (k-tai Watch): https://k-tai.watch.impress.co.jp/cda/article/news_toppage/19998.html
- Hardware review (k-tai Watch): https://k-tai.watch.impress.co.jp/cda/article/review/3287.html
