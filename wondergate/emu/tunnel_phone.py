#!/usr/bin/env python3
"""A stand-in phone for the WonderGate Bluetooth tunnel, relaying to the local dev server.

Listens for the module's TCP stream (core/wg_tunnel_stream.h: u16 big-endian length + message,
the module's first frame is INFO) and does what the phone app's relay does
(Swan Revival src/lib/ble/relay.ts), but opens a plain TCP connection to wgserver.py per
OPEN instead of a WebSocket to /tunnel. Protocol: docs/wondergate-ble-protocol.md.

    emu/tunnel_phone.py [--listen 7600] [--offset N]
    WG_ADAPTER_TUNNEL=127.0.0.1:7600 emu/regress.py rakujang      # emulator, tunnel mode
    host/wgcore-host --config dev.conf --tunnel 127.0.0.1:7600     # Mednafen / a cable

Ports go to the dev server's (80 -> 8080, 25 -> 2525, 110 -> 1110, 13 -> 1313, others as is),
plus --offset for a server started with WG_PORT_OFFSET. One module at a time; a new module
connection replaces the old one (a lost link).
"""
import argparse
import selectors
import socket
import sys
import time

OPEN, DATA, EOF, CLOSE, ACK, STATE, LOG = 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0F
OPENED, P_DATA, P_CLOSE, STATUS = 0x81, 0x82, 0x84, 0x85
DEV_PORTS = {80: 8080, 25: 2525, 110: 1110, 13: 1313}


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


class Sock:
    def __init__(self, sid):
        self.id = sid
        self.tcp = None
        self.to_module = b""
        self.budget = 0
        self.ended = None       # CLOSE reason once the server side is done
        self.close_sent = False


class Link:
    """One module connection."""

    def __init__(self, conn, sel, a):
        self.conn, self.sel, self.a = conn, sel, a
        self.buf = b""
        self.info = None
        self.socks = {}
        self.maxmsg = 20
        sel.register(conn, selectors.EVENT_READ, self)

    def send(self, m):
        try:
            self.conn.sendall(len(m).to_bytes(2, "big") + m)
        except OSError:
            pass

    def readable(self):
        try:
            d = self.conn.recv(65536)
        except OSError:
            d = b""
        if not d:
            self.stop("module closed the link")
            return
        self.buf += d
        while len(self.buf) >= 2 and len(self.buf) >= 2 + int.from_bytes(self.buf[:2], "big"):
            n = int.from_bytes(self.buf[:2], "big")
            m, self.buf = self.buf[2:2 + n], self.buf[2 + n:]
            if self.info is None:
                self.hello(m)
            else:
                self.handle(m)

    def hello(self, info):
        self.info = info
        window, mtu = int.from_bytes(info[2:4], "big"), int.from_bytes(info[4:6], "big")
        self.window = window
        self.maxmsg = (mtu if mtu >= 23 else 23) - 3
        log(f"module: protocol {info[0]}, {info[1]} sockets, window {window}, MTU {mtu}, "
            f"{info[6:].decode(errors='replace')!r}")
        self.send(bytes([STATUS, self.a.status]))

    def handle(self, m):
        t, sid = m[0], m[1] if len(m) > 1 else None
        s = self.socks.get(sid)
        if t == OPEN:
            self.open(sid, int.from_bytes(m[2:4], "big"), m[4:].decode("ascii", "replace"))
        elif t == DATA and s and not s.close_sent and s.tcp:
            s.tcp.sendall(m[2:])
        elif t == EOF and s and not s.close_sent and s.tcp:
            try:
                s.tcp.shutdown(socket.SHUT_WR)
            except OSError:
                pass
        elif t == CLOSE and s:
            del self.socks[sid]
            self.shut(s)
            if not s.close_sent:
                self.send(bytes([P_CLOSE, sid, 0]))
            log(f"{sid}: console closed")
        elif t == ACK and s:
            s.budget += int.from_bytes(m[2:4], "big")
            self.pump(s)
        elif t == STATE:
            log(f"adapter state {m[1]}")
        elif t == LOG:
            log(f"module: {m[1:].decode(errors='replace')}")

    def open(self, sid, port, host):
        if sid in self.socks:
            log(f"{sid}: reopened before it closed")
            self.shut(self.socks.pop(sid))
        s = Sock(sid)
        s.budget = self.window
        self.socks[sid] = s
        real = DEV_PORTS.get(port, port) + self.a.offset
        try:
            s.tcp = socket.create_connection((self.a.server, real), timeout=5)
            s.tcp.setblocking(True)
        except OSError as e:
            log(f"{sid}: port {port} -> {real}: {e}")
            s.ended = 1
            self.pump(s)
            return
        log(f"{sid}: open port {port} host {host!r} -> {self.a.server}:{real}")
        self.sel.register(s.tcp, selectors.EVENT_READ, s)
        self.send(bytes([OPENED, sid]))

    def server_readable(self, s):
        try:
            d = s.tcp.recv(65536)
        except OSError:
            d = b""
        if not d:
            self.sel.unregister(s.tcp)
            s.tcp.close()
            s.tcp = None
            s.ended = 0
        else:
            s.to_module += d
        self.pump(s)

    def pump(self, s):
        room = self.maxmsg - 2
        while s.to_module and s.budget > 0 and not s.close_sent:
            n = min(len(s.to_module), s.budget, room)
            self.send(bytes([P_DATA, s.id]) + s.to_module[:n])
            s.to_module = s.to_module[n:]
            s.budget -= n
        if not s.to_module and s.ended is not None and not s.close_sent:
            s.close_sent = True
            self.send(bytes([P_CLOSE, s.id, s.ended]))
            log(f"{s.id}: server closed (reason {s.ended})")

    def shut(self, s):
        if s.tcp:
            self.sel.unregister(s.tcp)
            s.tcp.close()
            s.tcp = None

    def stop(self, why):
        log(why)
        for s in self.socks.values():
            self.shut(s)
        self.socks.clear()
        self.sel.unregister(self.conn)
        self.conn.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--listen", type=int, default=7600)
    ap.add_argument("--server", default="127.0.0.1")
    ap.add_argument("--offset", type=int, default=0, help="the server's WG_PORT_OFFSET")
    ap.add_argument("--status", type=lambda v: int(v, 0), default=3, help="STATUS flags to report (default 3)")
    a = ap.parse_args()

    sel = selectors.DefaultSelector()
    lsock = socket.socket()
    lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    lsock.bind(("127.0.0.1", a.listen))
    lsock.listen(4)
    sel.register(lsock, selectors.EVENT_READ, None)
    log(f"phone stand-in on 127.0.0.1:{a.listen}, server {a.server} (+{a.offset})")
    link = None
    while True:
        for key, _ in sel.select():
            if key.data is None:
                conn, _ = lsock.accept()
                if link and link.conn.fileno() >= 0:
                    link.stop("new module connection replaces the old one")
                link = Link(conn, sel, a)
            elif isinstance(key.data, Link):
                key.data.readable()
            elif link:
                link.server_readable(key.data)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
