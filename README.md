# RevivalGate

RevivalGate brings Bandai's WonderGate service for the WonderSwan back online. WonderGate was the 2001
mobile adapter that let WonderSwan games post national rankings, download items and maps, send mail,
and play online through a Japanese mobile phone. Bandai shut its servers down in 2003.

This repository has everything that makes up RevivalGate except the hardware:

- an adapter that stands in for the WonderGate adapter and phone, so unmodified games and consoles connect;
- the game servers, each written from the game's own code (`docs/wondergate.md` has every game's status);
- the tools and tests used to work out and check every game's protocol.

I build this with Claude (Anthropic's AI) as my development assistant; every game's behavior is checked by
running the real game.

The hosted service runs at `wg.swanrevival.com`. How to play, and the leaderboards, are at
<https://swanrevival.com/revival-gate/>. The easiest way to play is the
[MesenCE fork](https://github.com/PokemonGoDB/MesenCE) (GPL-3.0), which has this adapter built in.

## What's here

```
wondergate/core/      wgcore: the adapter protocol in portable C99 (no allocation)
wondergate/host/      wgcore-host: the adapter on a PC, for Mednafen (stdio) or a real console's serial cable
wondergate/server/    the reference game server in Python: one server, routed by each game's original hostname
wondergate/emu/       headless emulator harness: replay a game's inputs and record what it sends
wondergate/tools/     protocol tests (test_core.py, test_raku.py, ...), ROM string scanner, helpers
wondergate/games/     homebrew served in place of lost Bandai content (Snake for the MobileWonderGate cart)
wondergate/captures/  3,000+ recorded requests from the games, replayed by the conformance test
workers/wondergate/   the live server: a Cloudflare Worker port of the Python server (TypeScript, D1)
migrations-wondergate/  the Worker's database schema
link/                 Swan Revival Link: the PC program that connects Mednafen or a real console
link-web/             the same adapter compiled to WebAssembly for the browser Link page
src/                  shared code the Worker and the browser Link use (word filter, Digimon text, Web Serial adapter)
scripts/              conformance test (Python vs Worker, byte for byte), end-to-end tests in MesenCE
docs/wondergate.md    how the original service worked, per-game status, lost content
docs/wondergate/      per-game protocol notes: requests, replies, ROM offsets, how each was verified
```

No ROMs are in this repository. The only things taken from the games' ROMs are what the servers need to
read players' data: the Digimon species names (to show players' teams) and SHA-1 hashes of Lode Runner's
built-in stages (to refuse uploads of Bandai's own). Where Bandai's server-only content is lost, the
server sends nothing, the documented original, or content clearly labelled as ours.

## Running it

The Python server listens on localhost (HTTP on 8080 and 10000, the browser check on 5555, mail on
2525/1110/1313; `WG_PORT_OFFSET` shifts them all):

```bash
python3 -I wondergate/server/wgserver.py     # or wondergate/tools/serve.sh to run it in the background
```

The adapter on a PC, with Mednafen or a real console:

```bash
make -C wondergate/host                       # builds wgcore-host
make -C wondergate/host test
```

The Worker (Node 22+, pnpm):

```bash
pnpm install
pnpm wg:check                                 # type-check
pnpm wg:migrate && pnpm wg:dev                # local Worker on port 8790
pnpm wg:conformance                           # replay every capture against Python and the Worker
```

`workers/wondergate/wrangler.jsonc` is the live service's configuration. To host your own copy, give it
your own route and D1 database.

The headless harness in `wondergate/emu/` (how every game was tested) drives a libretro build of Mednafen's
WonderSwan core, made with `wondergate/emu/build_core.sh`, through a small Python emulator host from my
translation tools that isn't in this repo; set `WSCLI_HOME` to it. To replay the games without it, use
`scripts/wg-mesen-e2e.mjs`, which plays the same replays in MesenCE.

`wondergate/README.md` covers the headless test harness, the adapter's choices where sources disagree,
and the full server inventory.

## Licenses

Everything here is MIT licensed (see `LICENSE`), except:

- `wondergate/emu/comm.c` is from the Mednafen WonderSwan core and stays GPL-2.0-or-later (its header says so).
- The adapter follows trap15's wonderfence, which is MIT; its notice is in
  `wondergate/core/NOTICE-wonderfence.txt` and `link-web/vendor/NOTICE-wonderfence.txt`.

WonderSwan, WonderSwan Color, and WonderGate are trademarks of Bandai. This project isn't affiliated
with Bandai.

## Credits

RevivalGate builds on other people's work. `CREDITS.md` lists exactly what came from whom.
