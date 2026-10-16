#!/usr/bin/env python3
"""Tunnel tests: wgcore-host --tunnel against a scripted phone.

The phone end of the tunnel's TCP stand-in (core/wg_tunnel_stream.h): every
message is a u16 big-endian length + its bytes, the module's first frame is
INFO, the phone's first message STATUS. Console frames go in on stdin, as in
tools/test_core.py. Protocol: docs/wondergate-ble-protocol.md.

Usage: test_tunnel.py path/to/wgcore-host
"""
import os
import select
import socket
import subprocess
import sys
import tempfile
import time

# Module -> phone
OPEN, DATA, EOF, CLOSE, ACK, STATE, LOG = 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0F
# Phone -> module
OPENED, P_DATA, P_CLOSE, STATUS = 0x81, 0x82, 0x84, 0x85
WINDOW = 1024
SERVER_IP = bytes([10, 0, 0, 1])

FAILS = 0


def check(name, ok, detail=""):
    global FAILS
    FAILS += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    if not ok and detail:
        print(f"    {detail}")
    return ok


def frame(t, cmd, params=b""):
    return bytes([t, 0, len(params) + 1, cmd]) + params


def connect_frame(sock, ip, port):
    return frame(0x11, 0x03, bytes([sock, 0, 2]) + port.to_bytes(2, "little") + ip)


class Phone:
    """The phone end: accepts the module's stream, records what it sends."""

    def __init__(self):
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(1)
        self.port = self.srv.getsockname()[1]
        self.conn = None
        self.buf = b""
        self.seen = []          # every module message, in order (LOG/STATE left out)

    def accept(self, timeout=5):
        self.srv.settimeout(timeout)
        self.conn, _ = self.srv.accept()
        self.buf = b""
        return self.recv(timeout, raw=True)

    def _frame(self):
        if len(self.buf) >= 2:
            n = int.from_bytes(self.buf[:2], "big")
            if len(self.buf) >= 2 + n:
                m, self.buf = self.buf[2:2 + n], self.buf[2 + n:]
                return m
        return None

    def recv(self, timeout=3, raw=False, keep_state=False):
        """Next module message (LOG skipped; STATE skipped unless keep_state), or None."""
        end = time.time() + timeout
        while True:
            m = self._frame()
            if m is not None:
                if raw:
                    return m
                if m[0] == LOG or (m[0] == STATE and not keep_state):
                    continue
                self.seen.append(m)
                return m
            left = max(0, end - time.time())
            if self.conn is None:
                return None
            r, _, _ = select.select([self.conn], [], [], left)
            if not r:
                return None
            d = self.conn.recv(4096)
            if not d:
                self.conn = None
                return None
            self.buf += d

    def send(self, m):
        self.conn.sendall(len(m).to_bytes(2, "big") + m)

    def drop(self):
        self.conn.close()
        self.conn = None


class Console:
    """wgcore-host on pipes: frames in on stdin, replies out on stdout."""

    def __init__(self, host_bin, port, mtu=None, conf="server 127.0.0.1\nportmap 80 8080\n"):
        with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as f:
            f.write(conf)
            self.conf = f.name
        self.err = tempfile.TemporaryFile()
        cmd = [host_bin, "ASDF", "--config", self.conf, "--tunnel", f"127.0.0.1:{port}"]
        if mtu:
            cmd += ["--mtu", str(mtu)]
        self.p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err)
        self.buf = b""

    def send(self, data):
        self.p.stdin.write(data)
        self.p.stdin.flush()

    def reply(self, timeout=15, idle=None):
        """One reply frame. idle() runs every 10 ms while waiting (the phone's side)."""
        end = time.time() + timeout
        fd = self.p.stdout.fileno()
        while True:
            if len(self.buf) >= 3 and len(self.buf) >= 3 + self.buf[2]:
                n = 3 + self.buf[2]
                f, self.buf = self.buf[:n], self.buf[n:]
                return f
            if time.time() > end:
                return None
            r, _, _ = select.select([fd], [], [], 0.01)
            if r:
                d = os.read(fd, 4096)
                if not d:
                    return None
                self.buf += d
            elif idle:
                idle()

    def cmd(self, data, **kw):
        self.send(data)
        return self.reply(**kw)

    def close(self):
        try:
            self.p.stdin.close()
        except OSError:
            pass
        try:
            self.p.wait(5)
        except subprocess.TimeoutExpired:
            self.p.kill()
        os.unlink(self.conf)
        self.err.seek(0)
        return self.err.read().decode(errors="replace")


def session(host_bin, mtu=None, status=0x03):
    """Phone + console, link ready, adapter powered on."""
    phone = Phone()
    con = Console(host_bin, phone.port, mtu)
    info = phone.accept()
    phone.send(bytes([STATUS, status]))
    st0 = phone.recv(keep_state=True)
    on = con.cmd(frame(0x01, 0x02))
    st2 = phone.recv(keep_state=True)
    phone.seen.clear()
    return phone, con, info, (st0, on, st2)


def open_sock(con, phone, wg_id=None, ip=SERVER_IP, port=80):
    """socket-new + connect; the phone answers OPENED. Returns (console id, tunnel id, OPEN)."""
    r = con.cmd(frame(0x11, 0x01, b"\x00"))
    cid = r[4] if wg_id is None else wg_id
    con.send(connect_frame(cid, ip, port))
    m = phone.recv()
    phone.send(bytes([OPENED, m[1]]))
    r = con.reply()
    assert r == frame(0x11, 0x03, b"\x00\x01"), r
    return cid, m[1], m


def main(host_bin):
    # ---- handshake, STATE, DNS, a full exchange with a reply 3x the window ----
    phone, con, info, (st0, on, st2) = session(host_bin)
    check("INFO: version 1, 8 sockets, window 1024, MTU 247, fw field",
          info[:6] == bytes([1, 8, 4, 0, 0, 247]) and b"fw=wgcore-host" in info[6:], info.hex(" "))
    check("STATE 0 once STATUS arrives, STATE 2 after power-on",
          st0 == bytes([STATE, 0]) and st2 == bytes([STATE, 2]) and on == frame(0x01, 0x02, b"10"),
          f"{st0} {st2}")

    name = b"rakujang.wgg.channel.or.jp"
    r = con.cmd(frame(0x11, 0x08, name + b"\x00"))
    check("redirected name resolves to the server's synthetic address 10.0.0.1",
          r == frame(0x11, 0x08, b"\x01" + name + b"\x00" + SERVER_IP), r and r.hex(" "))
    r = con.cmd(frame(0x11, 0x08, b"www.example.com\x00"))
    check("other names get 10.0.0.2+", r is not None and r.endswith(bytes([10, 0, 0, 2])), r and r.hex(" "))

    con.send(frame(0x01, 0x08, b"\x00\x01\x03\x04" + b"1234"))
    con.reply()
    check("dial sends STATE 3", phone.recv(keep_state=True) == bytes([STATE, 3]))
    phone.seen.clear()

    r = con.cmd(frame(0x11, 0x01, b"\x00"))
    con.send(connect_frame(0, SERVER_IP, 80))
    m = phone.recv()
    check("connect sends OPEN 0, port 80 as dialled (portmap ignored), no host for the server",
          m == bytes([OPEN, 0, 0, 80]), m and m.hex(" "))
    phone.send(bytes([OPENED, 0]))
    check("OPENED answers the console's connect ok", con.reply() == frame(0x11, 0x03, b"\x00\x01"))
    req = b"GET / HTTP/1.0\r\n\r\n"
    r = con.cmd(frame(0x11, 0x0E, b"\x00" + req))
    check("send answers the byte count", r == frame(0x11, 0x0E, b"\x00" + bytes([len(req)])), r and r.hex(" "))
    m = phone.recv()
    check("send goes out as DATA", m == bytes([DATA, 0]) + req, m and m.hex(" "))
    con.cmd(frame(0x11, 0x06, b"\x00\x01"))
    check("shutdown sends EOF", phone.recv() == bytes([EOF, 0]))

    # The server's reply, 3000 bytes, sent the way the relay does: budget = window, ACK refills.
    body = bytes((i * 7 + i // 256) & 0xFF for i in range(3000))
    st = {"queue": body, "budget": WINDOW, "acked": 0, "over": False, "closed": False, "ack_while": False}

    def phone_side():
        while True:
            m = phone.recv(0)
            if m is None:
                break
            if m[0] == ACK and m[1] == 0:
                n = int.from_bytes(m[2:4], "big")
                st["budget"] += n
                st["acked"] += n
                if st["queue"]:
                    st["ack_while"] = True
        while st["queue"] and st["budget"] > 0:
            n = min(len(st["queue"]), st["budget"], 247 - 3 - 2)
            phone.send(bytes([P_DATA, 0]) + st["queue"][:n])
            st["queue"] = st["queue"][n:]
            st["budget"] -= n
        if not st["queue"] and not st["closed"]:
            st["closed"] = True
            phone.send(bytes([P_CLOSE, 0, 0]))

    phone_side()
    got, end = b"", None
    for _ in range(60):
        # 7F: the largest read any game makes (wg.c cuts replies over 249 data bytes).
        r = con.cmd(frame(0x11, 0x0F, b"\x00\x7F"), idle=phone_side)
        phone_side()
        if r[4:6] == b"\x00\xFF":
            end = r
            break
        got += r[6:]
    check("reply larger than the window arrives whole and in order", got == body, f"{len(got)} bytes")
    check("ACKs refill the window while the reply is still coming", st["ack_while"] and st["acked"] >= len(body) - WINDOW,
          f"acked {st['acked']}")
    check("after the phone's CLOSE and the last byte, recv answers closed (FF)", end is not None)
    r = con.cmd(frame(0x11, 0x07, b"\x00"))
    m = phone.recv()
    check("console close sends CLOSE 0", m == bytes([CLOSE, 0]) and r == frame(0x11, 0x07, b"\x00\x01"), m)
    kinds = [x[0] for x in phone.seen]
    ok = (kinds[:3] == [OPEN, DATA, EOF] and kinds[-1] == CLOSE and set(kinds[3:-1]) == {ACK})
    check("message order OPEN, DATA, EOF, ACK..., CLOSE", ok, " ".join(f"{k:02x}" for k in kinds))
    phone.seen.clear()
    _, tid, _ = open_sock(con, phone)
    check("server closed first + console closed: id 0 is free again at once", tid == 0, tid)
    con.cmd(frame(0x11, 0x07, b"\x00"))
    phone.recv()
    phone.send(bytes([P_CLOSE, 0, 0]))
    con.send(frame(0x01, 0x0A, b"\x01"))
    con.reply()
    check("hang-up sends STATE 2", phone.recv(keep_state=True) == bytes([STATE, 2]))
    err = con.close()
    if FAILS:
        print(err)

    # ---- refused connect, recv wait, server closes first, console closes first ----
    phone, con, _, _ = session(host_bin)
    con.cmd(frame(0x11, 0x01, b"\x00"))
    con.send(connect_frame(0, SERVER_IP, 81))
    m = phone.recv()
    phone.send(bytes([P_CLOSE, m[1], 2]))
    r = con.reply()
    check("refused connect (phone CLOSE before OPENED) fails the console's connect", r == frame(0x11, 0x03, b"\x00\x00"), r)
    check("... and the module answers CLOSE at once", phone.recv() == bytes([CLOSE, 0]))
    r = con.cmd(frame(0x11, 0x07, b"\x00"))
    check("... console close then sends nothing more", r == frame(0x11, 0x07, b"\x00\x01") and phone.recv(0.3) is None)

    cid, tid, _ = open_sock(con, phone)
    check("refused id is reused", tid == 0, tid)
    t0 = time.time()
    r = con.cmd(frame(0x11, 0x0F, b"\x00\x40"))
    dt = time.time() - t0
    check("recv with nothing buffered waits ~2 s, then answers 0 bytes", r == frame(0x11, 0x0F, b"\x00\x00") and 1.8 < dt < 3,
          f"{r} after {dt:.2f}s")
    phone.send(bytes([P_DATA, tid]) + b"hi\n")
    phone.send(bytes([P_CLOSE, tid, 0]))
    r = con.cmd(frame(0x11, 0x0D, b"\x00\x40"))
    check("line recv gets the buffered line after the server closed", r == frame(0x11, 0x0D, b"\x00\x03hi\n"), r)
    r = con.cmd(frame(0x11, 0x0E, b"\x00more"))
    check("send after the server closed still answers its count, sends nothing",
          r == frame(0x11, 0x0E, b"\x00\x04") and phone.recv(0.3) is None, r)
    r = con.cmd(frame(0x11, 0x0F, b"\x00\x40"))
    check("then recv answers closed", r == frame(0x11, 0x0F, b"\x00\xFF"), r)
    con.cmd(frame(0x11, 0x07, bytes([cid])))
    check("console close after the server's: CLOSE, id free", phone.recv() == bytes([CLOSE, tid]))

    cid, tid, _ = open_sock(con, phone)
    con.cmd(frame(0x11, 0x07, bytes([cid])))
    check("console closes first: CLOSE 0", phone.recv() == bytes([CLOSE, 0]))
    phone.send(bytes([P_DATA, 0]) + b"late")          # crossed our CLOSE
    cid2, tid2, _ = open_sock(con, phone)
    check("id 0 stays reserved until the phone's CLOSE: next socket is 1", tid2 == 1, tid2)
    check("late DATA for a closed id is ignored (no ACK)", all(m[0] != ACK for m in phone.seen))
    phone.send(bytes([P_CLOSE, 0, 0]))
    con.cmd(frame(0x11, 0x07, bytes([cid2])))
    phone.recv()
    phone.send(bytes([P_CLOSE, 1, 0]))
    _, tid3, _ = open_sock(con, phone)
    check("after both CLOSEs crossed, id 0 is used again", tid3 == 0, tid3)
    con.close()

    # ---- link loss ----
    phone, con, _, _ = session(host_bin)
    cid, tid, _ = open_sock(con, phone)
    phone.send(bytes([P_DATA, tid]) + b"x" * 10)
    time.sleep(0.2)
    phone.drop()
    t0 = time.time()
    r = con.cmd(frame(0x11, 0x0F, b"\x00\x40"))
    check("link loss: the console's socket reads closed (buffered bytes dropped)",
          r == frame(0x11, 0x0F, b"\x00\xFF") and time.time() - t0 < 1, r)
    r2 = con.cmd(frame(0x11, 0x01, b"\x00"))
    t0 = time.time()
    r = con.cmd(connect_frame(r2[4], SERVER_IP, 80))
    check("no link: connect fails at once", r == frame(0x11, 0x03, b"\x00\x00") and time.time() - t0 < 0.5,
          f"{r} {time.time() - t0:.2f}s")
    con.cmd(frame(0x11, 0x07, bytes([r2[4]])))
    info = phone.accept(5)
    check("the module reconnects and sends INFO first", info is not None and info[0] == 1)
    phone.send(bytes([STATUS, 3]))
    check("STATE resent on the new link", phone.recv(keep_state=True) == bytes([STATE, 2]))
    r = con.cmd(frame(0x11, 0x07, bytes([cid])))
    check("closing a socket lost with the link sends nothing", r == frame(0x11, 0x07, b"\x00\x01") and phone.recv(0.3) is None)
    phone.seen.clear()
    _, tid, _ = open_sock(con, phone)
    check("ids are free after link loss", tid == 0, tid)
    con.close()

    # ---- phone without service ----
    phone, con, _, _ = session(host_bin, status=0x01)
    r2 = con.cmd(frame(0x11, 0x01, b"\x00"))
    t0 = time.time()
    r = con.cmd(connect_frame(r2[4], SERVER_IP, 80))
    check("STATUS without the server bit: connect fails at once, no OPEN",
          r == frame(0x11, 0x03, b"\x00\x00") and time.time() - t0 < 0.5 and phone.recv(0.3) is None, r)
    con.close()

    # ---- no phone at all ----
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    dead_port = s.getsockname()[1]
    s.close()
    con = Console(host_bin, dead_port)
    con.cmd(frame(0x01, 0x02))
    r2 = con.cmd(frame(0x11, 0x01, b"\x00"))
    t0 = time.time()
    r = con.cmd(connect_frame(r2[4], SERVER_IP, 80))
    check("no phone ever connected: connect fails at once", r == frame(0x11, 0x03, b"\x00\x00") and time.time() - t0 < 0.5, r)
    con.close()

    # ---- MTU 23 ----
    phone, con, info, _ = session(host_bin, mtu=23)
    check("INFO reports MTU 23", info[4:6] == bytes([0, 23]), info.hex(" "))
    for nm, want in ((b"a.jp", b"a.jp"), (b"averyveryverylongname.example.com", b"")):
        r = con.cmd(frame(0x11, 0x08, nm + b"\x00"))
        ip = r[-4:]
        r2 = con.cmd(frame(0x11, 0x01, b"\x00"))
        con.send(connect_frame(r2[4], ip, 10000))
        m = phone.recv()
        check(f"MTU 23: OPEN carries host {want.decode() or '(none: too long)'}, port 10000",
              m is not None and m[2:4] == (10000).to_bytes(2, "big") and m[4:] == want, m and m.hex(" "))
        phone.send(bytes([OPENED, m[1]]))
        con.reply()
    payload = bytes(range(100))
    r = con.cmd(frame(0x11, 0x0E, bytes([r2[4]]) + payload))
    parts = []
    while True:
        m = phone.recv(0.5)
        if m is None:
            break
        parts.append(m)
    check("MTU 23: 100 bytes go out as DATA of at most 20 bytes each (18 payload)",
          all(len(m) <= 20 and m[0] == DATA for m in parts) and b"".join(m[2:] for m in parts) == payload
          and len(parts) == 6, [len(m) for m in parts])
    # A reply crossing the link as several messages comes back in one receive, as from a TCP
    # socket (Dark Eyes reads its reply in one go).
    sid, tid = r2[4], parts[0][1]
    reply = bytes(range(90))
    phone.send(bytes([P_DATA, tid]) + reply[:18])
    con.send(frame(0x11, 0x0F, bytes([sid, 200])))
    for i in range(18, 90, 18):
        time.sleep(0.04)
        phone.send(bytes([P_DATA, tid]) + reply[i:i + 18])
    r = con.reply()
    check("MTU 23: a reply arriving as 5 messages 40 ms apart comes back in one receive",
          r == frame(0x11, 0x0F, bytes([0, 90]) + reply), r and r.hex(" "))
    con.close()

    print(f"\n{'ALL PASS' if not FAILS else f'{FAILS} FAILED'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
