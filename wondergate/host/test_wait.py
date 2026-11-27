#!/usr/bin/env python3
"""The game's own receive wait: wgcore-host with its own sockets against a slow server.

The receive commands (11:0D, 11:0F) carry a third parameter, the game's wait in
seconds. The adapter waits that long before answering "nothing yet", answers at
once when data or the close arrives, and drops the receive without an answer
when the console sends again first. A receive with no third parameter keeps the
2 s wait. Console frames go in on stdin one at a time, as a console sends them.

Usage: test_wait.py path/to/wgcore-host
"""
import os
import select
import socket
import subprocess
import sys
import tempfile
import threading
import time

FAILS = 0


def check(name, ok, detail=""):
    global FAILS
    FAILS += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    if not ok and detail:
        print(f"    {detail}")


def frame(t, cmd, params=b""):
    return bytes([t, 0, len(params) + 1, cmd]) + params


class Server:
    """Accepts one connection at a time and does what the test's script says."""

    def __init__(self):
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(4)
        self.port = self.srv.getsockname()[1]

    def serve(self, script):
        """script(conn) runs on its own thread for the next connection."""
        def run():
            c, _ = self.srv.accept()
            try:
                script(c)
            finally:
                c.close()
        threading.Thread(target=run, daemon=True).start()


class Console:
    def __init__(self, host_bin, port):
        with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as f:
            f.write(f"server 127.0.0.1\nportmap 80 {port}\n")
            self.conf = f.name
        self.err = tempfile.TemporaryFile()
        self.p = subprocess.Popen([host_bin, "ASDF", "--config", self.conf],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err)
        self.buf = b""

    def send(self, data):
        self.p.stdin.write(data)
        self.p.stdin.flush()

    def reply(self, timeout=15):
        end = time.time() + timeout
        fd = self.p.stdout.fileno()
        while True:
            if len(self.buf) >= 3 and len(self.buf) >= 3 + self.buf[2]:
                n = 3 + self.buf[2]
                f, self.buf = self.buf[:n], self.buf[n:]
                return f
            left = end - time.time()
            if left <= 0:
                return None
            r, _, _ = select.select([fd], [], [], left)
            if r:
                d = os.read(fd, 4096)
                if not d:
                    return None
                self.buf += d

    def cmd(self, data, **kw):
        self.send(data)
        return self.reply(**kw)

    def timed(self, data, **kw):
        t0 = time.time()
        r = self.cmd(data, **kw)
        return r, time.time() - t0

    def connect(self):
        """New socket, connected to the server. Returns its id."""
        sid = self.cmd(frame(0x11, 0x01, b"\x00"))[4]
        r = self.cmd(frame(0x11, 0x03, bytes([sid, 0, 2]) + (80).to_bytes(2, "little") + bytes([127, 0, 0, 1])))
        assert r == frame(0x11, 0x03, bytes([sid, 1])), r
        return sid

    def close(self):
        self.p.stdin.close()
        try:
            self.p.wait(5)
        except subprocess.TimeoutExpired:
            self.p.kill()
        os.unlink(self.conf)
        self.err.seek(0)
        return self.err.read().decode(errors="replace")


def main(host_bin):
    srv = Server()
    con = Console(host_bin, srv.port)
    con.cmd(frame(0x01, 0x02))
    con.cmd(frame(0x11, 0x08, b"wgg01.channel.or.jp\x00"))
    hold = threading.Event()

    # A reply that starts 3 s late, past the 2 s wait: one answer, with the data.
    srv.serve(lambda c: (time.sleep(3), c.sendall(b"late line\r\nrest"), hold.wait(20)))
    sid = con.connect()
    r, dt = con.timed(frame(0x11, 0x0D, bytes([sid, 0x7F, 5])))
    check("line receive with wait 5: a reply 3 s late comes back in the first answer",
          r == frame(0x11, 0x0D, bytes([sid, 11]) + b"late line\r\n") and 2.7 < dt < 4, f"{r} after {dt:.2f}s")
    r, dt = con.timed(frame(0x11, 0x0F, bytes([sid, 0x7F, 5])))
    check("block receive with wait 5: buffered data is answered at once",
          r == frame(0x11, 0x0F, bytes([sid, 4]) + b"rest") and dt < 0.5, f"{r} after {dt:.2f}s")

    # Nothing more comes: "nothing yet" after the game's wait, not after 2 s.
    r, dt = con.timed(frame(0x11, 0x0F, bytes([sid, 0x7F, 1])))
    check("wait 1, silent server: 0 bytes after ~1 s",
          r == frame(0x11, 0x0F, bytes([sid, 0])) and 0.8 < dt < 1.6, f"{r} after {dt:.2f}s")
    r, dt = con.timed(frame(0x11, 0x0D, bytes([sid, 0x7F, 3])))
    check("line receive, wait 3, silent server: 0 bytes after ~3 s",
          r == frame(0x11, 0x0D, bytes([sid, 0])) and 2.7 < dt < 3.8, f"{r} after {dt:.2f}s")
    r, dt = con.timed(frame(0x11, 0x0F, bytes([sid, 0x7F])))
    check("no wait parameter: 0 bytes after ~2 s, as before",
          r == frame(0x11, 0x0F, bytes([sid, 0])) and 1.8 < dt < 2.8, f"{r} after {dt:.2f}s")
    r, dt = con.timed(frame(0x11, 0x0F, bytes([sid, 0x7F, 0])))
    check("wait 0: the same 2 s",
          r == frame(0x11, 0x0F, bytes([sid, 0])) and 1.8 < dt < 2.8, f"{r} after {dt:.2f}s")

    # The console gives up first and sends its next command: the receive gets no answer.
    con.send(frame(0x11, 0x0F, bytes([sid, 0x7F, 30])))
    time.sleep(1)
    r, dt = con.timed(frame(0x11, 0x06, bytes([sid, 2])))
    check("wait 30, console sends shutdown after 1 s: the receive is dropped, shutdown answered at once",
          r == frame(0x11, 0x06, bytes([sid, 1])) and dt < 0.5, f"{r} after {dt:.2f}s")
    r = con.cmd(frame(0x11, 0x07, bytes([sid])))
    check("... and no late answer follows: close is answered next", r == frame(0x11, 0x07, bytes([sid, 1])), r)
    hold.set()

    # The server closes while the adapter waits: closed (FF) at once, not after the wait.
    srv.serve(lambda c: time.sleep(1))
    sid = con.connect()
    r, dt = con.timed(frame(0x11, 0x0D, bytes([sid, 0x7F, 10])))
    check("wait 10, server closes after 1 s: closed (FF) at once",
          r == frame(0x11, 0x0D, bytes([sid, 0xFF])) and 0.7 < dt < 2, f"{r} after {dt:.2f}s")
    con.cmd(frame(0x11, 0x07, bytes([sid])))

    # A line that starts in time but stalls: what arrived comes back after the short wait.
    srv.serve(lambda c: (time.sleep(1), c.sendall(b"half"), time.sleep(4)))
    sid = con.connect()
    r, dt = con.timed(frame(0x11, 0x0D, bytes([sid, 0x7F, 10])))
    check("wait 10, half a line after 1 s: answered with it 2 s later",
          r == frame(0x11, 0x0D, bytes([sid, 4]) + b"half") and 2.7 < dt < 4, f"{r} after {dt:.2f}s")

    err = con.close()
    check("the dropped receive is in the log", "the console sent again before its wait ran out" in err)
    if FAILS:
        print(err)
    print("\nALL PASS" if not FAILS else f"\n{FAILS} FAILED")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
