# blesim: the Mac as a WonderGate Bluetooth module

A stand-in for the Bluetooth module (docs/wondergate-ble.md)
until the hardware exists: wgcore (the adapter) + `core/wg_tunnel.c` (its sockets over the
[tunnel protocol](../../../docs/wondergate-ble-protocol.md)) + a CoreBluetooth peripheral with the
module's GATT service. The phone app (or the Web Bluetooth page) finds it as `WonderGate-XXXX`
and relays its sockets to the game server, exactly as it will for real hardware.

```
Mednafen or console+cable ─serial─▶ blesim (wgcore + wg_tunnel) ─BLE─▶ phone app ─WebSocket─▶ /tunnel
```

## Build

```bash
make -C tools/blesim          # from wondergate/; needs Xcode's command line tools
```

The binary embeds an `Info.plist` with a Bluetooth usage description and re-launches itself as
its own "responsible" process, so macOS asks for Bluetooth access for **blesim** (not for the
terminal or Mednafen that started it). The first run shows the prompt; click Allow. To change it
later: System Settings > Privacy & Security > Bluetooth. A rebuild may ask again. If the log says
`unauthorized`, that switch is off. (`--no-disclaim` skips the re-launch; then the app that
started blesim needs Bluetooth access itself.)

## Run

Console side is the same as `wgcore-host`:

```bash
# Mednafen (from wondergate/): the wrapper is the excomm program; trace in logs/blesim.log
mednafen -wswan.excomm 1 -wswan.excomm.path "$PWD/tools/blesim/mednafen-blesim.sh" game.wsc

# Real console through an ExtFriend-compatible dongle
tools/blesim/blesim --config dev.conf --serial /dev/cu.usbmodemXXXX --log logs/blesim.log
```

Run blesim once from a terminal first so the Bluetooth prompt can be answered (see Build).
`BLESIM_CONFIG=` points the wrapper at another config. Then open the phone app (or the Web Bluetooth page), pick
`WonderGate-XXXX`, and play: the game's sockets go phone → `wss://…/tunnel`. `dev.conf`'s
`portmap` lines are ignored in tunnel mode; ports go to the server as the game dialled them.

Options:

| Option | |
|---|---|
| `--config FILE` | adapter config (as wgcore-host; `portmap` ignored) |
| `--log FILE` | append the trace there too. Logs go to stderr, never stdout |
| `--quiet` | no log on stderr |
| `--serial DEV [--baud 9600\|38400]` | a real console through a dongle |
| `--name NAME` | advertised name (default `WonderGate-` + 4 hex digits from the host name; also INFO's `serial`) |
| `--phone-log events\|all\|none` | module log lines sent to the phone as `LOG` messages for bring-up: `events` (default) leaves out the per-frame hex dumps |

The trace shows the Bluetooth side (`# ble: …`: power state, advertising, the phone subscribing,
INFO reads) and the tunnel (`# tunnel: OPEN 0 port 80`, `phone closed 0`, …) next to wgcore's
frames.

## How it maps to the spec

- Service `06904a01-…` in the advertisement, local name `WonderGate-XXXX`.
- RX `06904a02-…`: write and write without response; each write is one phone message. Writes from a
  phone that hasn't subscribed are ignored.
- TX `06904a03-…`: notify, one message per notification. `updateValue` backpressure is respected
  (the queue waits for `peripheralManagerIsReadyToUpdateSubscribers`).
- INFO `06904a04-…`: read, built at read time with the phone's `maximumUpdateValueLength + 3` as MTU;
  fields `fw=blesim 1`, `serial`, `board=mac`.
- Subscribe = link up (ready after the phone's first `STATUS`); unsubscribe or disconnect = link
  down: the console's sockets read closed, ids are free, advertising restarts. One phone at a time.
- `STATE` goes out when the adapter's status changes (off / on / online).

Threads: CoreBluetooth runs on its own serial queue; wgcore and the tunnel run on the main
(console) thread, which polls the serial line every 50 ms and drains an inbox (mutex + condvar)
of phone messages and link changes; the tunnel's pump waits on the same inbox while a connect or
receive is pending.

Not done yet: the console's phone-status query (`01:00`) still answers wgcore's fixed
"ok + reception"; the module firmware will answer from `wgt_phone_state()` (no phone / no service).

## Without Bluetooth

For tests the same tunnel runs over TCP instead (see the spec's *Testing*):
`host/wgcore-host --tunnel HOST:PORT`, or the emulator core with `WG_ADAPTER_TUNNEL=HOST:PORT`,
against `emu/tunnel_phone.py` or Swan Revival's relay.
