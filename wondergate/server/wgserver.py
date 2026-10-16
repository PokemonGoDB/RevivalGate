#!/usr/bin/env python3
"""WonderGate game server (dev): routes requests by original hostname, logs everything.

Listens on 127.0.0.1 only:
  8080   HTTP (games' port 80, remapped by the adapter's dev config)
  10000  HTTP (Wonder Classic also uses nclassic.wgg.channel.or.jp:10000)
  5555   BPL  (MobileWonderGate browser's URL check; always answers "allow")
  2525   SMTP, 1110 POP3, 1313 daytime (MobileWonderGate cart MAILER; ports 25/110/13)

HTTP/1.1 keep-alive matters: Raku Jongg sends three POSTs on one connection.
Every request is saved under captures/; unknown routes answer 404.
WG_PORT_OFFSET=N adds N to every port, so a second copy (e.g. in another worktree) can run
alongside; point its adapter config's portmap lines at the shifted ports.
"""
import asyncio
import datetime
import json
import os
import pathlib
import re
import struct
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import access  # noqa: E402
import buffers  # noqa: E402
import charge  # noqa: E402
import darkeyes  # noqa: E402
import digimon  # noqa: E402
import doraemon  # noqa: E402
import ggene  # noqa: E402
import loderunner  # noqa: E402
import starhearts  # noqa: E402
import static  # noqa: E402
import swan_ranking  # noqa: E402
import mail  # noqa: E402
import nclassic  # noqa: E402
import portal  # noqa: E402
import tonpuusou  # noqa: E402
import wizardry  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
CAPTURES = ROOT / "captures"
DATA = ROOT / "data"
PORT_OFFSET = int(os.environ.get("WG_PORT_OFFSET", "0"))
HTTP_PORTS = (8080 + PORT_OFFSET,)
NCLASSIC_PORT = 10000 + PORT_OFFSET
BPL_PORT = 5555 + PORT_OFFSET
BPL_HEADER = 0x18

STORE = None


def route(host, path, headers=None, query=""):
    """(host, path) -> handler(body) returning (status, content_type, body, note)."""
    host = host.split(":")[0].lower()
    if path.startswith("/service/charge/"):
        return lambda body: charge.handle(path, headers or {}, body)
    if (host, path) == ("wgg01.channel.or.jp", "/service/buffersevolution"):
        return lambda body: buffers.handle(STORE, body)
    if host == "tongpuso.wgg.channel.or.jp" and path.startswith("/cgi-bin/"):
        return lambda body: tonpuusou.handle(path, body)
    if path.rstrip("/") == "/tonpuusou" and not host.endswith((".or.jp", ".ne.jp", ".co.jp", ".com")):
        return lambda body: tonpuusou.page(path)          # for a PC browser
    if host == "www2.sting.co.jp" and path == "/cgi-bin/wg/wiz.cgi":
        return lambda body: wizardry.handle(path, query, body)
    if (host, path) == ("link.swanrevival.com", "/loderunner/stage"):   # ours: link-cable stage uploads
        return lambda body: loderunner.handle(headers or {}, body)
    if host == "start.mopera.ne.jp":
        return lambda body: mail.start(path, body)
    if host == "www.mopera.ne.jp":
        return lambda body: portal.handle(path)
    if (host, path) == ("s_hearts.wgg.channel.or.jp", "/cgi-bin/starhearts.cgi"):
        return lambda body: starhearts.handle(path, query, body)
    if host == "battleg1.dark-eyes.com" and path.startswith("/cgi-bin/dark/"):
        return lambda body: darkeyes.handle(path, headers or {}, body)
    if (host, path[:12]) in (("digi4.wgg.channel.or.jp", "/cgi-bin/dm4"), ("digi_b.wgg.channel.or.jp", "/cgi-bin/dmB")):
        return lambda body: digimon.handle(path, body)
    if (host, path) == ("wgg02.channel.or.jp", "/ring/cgi-bin/accsess.cgi"):
        return access.ring
    if (host, path) == ("terrors2.wgg.channel.or.jp", "/cgi-bin/accsess.cgi"):
        return access.terrors2
    if (host, path) == ("www.bea.hi-ho.ne.jp", "/log_inguz_1999/index.shtml"):
        return doraemon.handle
    if host == "wgg02.channel.or.jp" and path in ggene.FILES:
        return lambda body: ggene.handle(path)
    handler = static.route(host, path)
    if handler:
        return handler
    game = SWAN_RANKING.get((host, path))
    if game:
        return lambda body: swan_ranking.handle(STORE, game, body)
    return None


# (host, path) -> swan_ranking game key
SWAN_RANKING = {
    ("rakujang.wgg.channel.or.jp", "/swan-ranking"): "rakujang",
    ("gunpeyex.wgg.channel.or.jp", "/swan-ranking"): "gunpeyex",
    ("wgg01.channel.or.jp", "/service/swan-ranking/tarepang"): "tarepang",
    ("heaven.wgg.channel.or.jp", "/swan-ranking"): "heaven",
    ("wgg01.channel.or.jp", "/service/swan-ranking/tanetori"): "tanetori",
    ("wgg01.channel.or.jp", "/service/swan-ranking/sen-know"): "sen-know",
    ("wgg01.channel.or.jp", "/service/swan-ranking/final-lap"): "final-lap",
    ("wgg01.channel.or.jp", "/service/swan-ranking/pocketf"): "pocketf",
    ("yamato.wgg.channel.or.jp", "/swan-ranking"): "yamato",
}


def stamp():
    return datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]


def log(msg):
    print(datetime.datetime.now().strftime("%H:%M:%S"), msg, flush=True)


def save(kind, host, path, raw, extra=None):
    CAPTURES.mkdir(exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{host}{path}")[:80]
    name = f"{stamp()}-{kind}-{safe}"
    (CAPTURES / f"{name}.bin").write_bytes(raw)
    entry = {"time": stamp(), "kind": kind, "host": host, "path": path, "file": f"{name}.bin"}
    if extra:
        entry.update(extra)
    with open(CAPTURES / "index.jsonl", "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


REASONS = {200: "OK", 404: "Not Found", 409: "Conflict", 422: "Unprocessable Entity",
           500: "Internal Server Error"}


def response(status, content_type, body, close=False, extra=None, eol="\r\n"):
    # Keep headers short and exactly "Name: value": games parse fixed offsets.
    head = f"HTTP/1.1 {status} {REASONS.get(status, 'OK')}\r\n"
    if eol == "\n":
        # Dark Eyes finds the body by searching "\n\n" from just after the
        # Content-Length line, so that line must come before the other headers.
        head += f"Content-Length: {len(body)}\r\n"
    for k, v in (extra or {}).items():
        head += f"{k}: {v}\r\n"
    if close:
        head += "Connection: close\r\n"
    if content_type:
        head += f"Content-Type: {content_type}\r\n"
    head += (f"Content-Length: {len(body)}\r\n" if eol != "\n" else "") + "\r\n"
    # nph-* CGIs that printed bare "\n" (Dark Eyes parses numbers up to a space or LF).
    return head.replace("\r\n", eol).encode("latin-1") + body


async def http_conn(reader, writer):
    peer = writer.get_extra_info("peername")
    while True:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 60)
            m = re.search(rb"(?im)^content-length:\s*(\d+)", head)
            body = await reader.readexactly(int(m.group(1))) if m else b""
        except asyncio.IncompleteReadError as e:
            if e.partial:
                log(f"http {peer}: connection closed mid-request {e.partial[:200]!r}")
                save("http-partial", "unknown", "", e.partial)
            break
        except (asyncio.TimeoutError, asyncio.LimitOverrunError, ConnectionError):
            break

        # Gashapon Senki ends its headers with an extra CRLF; skip blank lines.
        head = head.lstrip(b"\r\n")
        if not head.strip():
            continue
        lines = head.decode("latin-1").split("\r\n")
        request_line = lines[0]
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        headers["x-wg-peer"] = peer[0] if peer else ""   # the player's address, for per-player state
        parts = request_line.split(" ")
        target = parts[1] if len(parts) > 1 else "/"
        # HTTP/0.9 ("GET /path", no version, no Host): Gashapon Senki fetches
        # files this way after a HEAD. The reply is the bare body, then close.
        http09 = len(parts) == 2
        host = headers.get("host", "")
        m = re.match(r"(?i)https?://([^/]+)(/.*)?$", target)  # absolute-URI requests
        if m:
            host, path = host or m.group(1), m.group(2) or "/"
        else:
            path = target
        path_only = path.split("?")[0]

        log(f"HTTP {request_line}  Host: {host}  body {len(body)} bytes")
        if body:
            log(f"     body: {body[:300]!r}")
        save("http", host, path, head + body, {"request": request_line, "headers": headers})

        handler = route(host, path_only, headers, path.partition("?")[2]) or (static.route_any(path_only) if not host else None)
        close, extra, eol, secret = False, None, "\r\n", False
        if handler is None:
            status, ctype, rbody, note = 404, "text/plain", b"not implemented yet\r\n", "no handler"
        else:
            try:
                status, ctype, rbody, note, *flags = handler(body)
                close = "close" in flags
                eol = "\n" if "lf" in flags else "\r\n"
                secret = "secret" in flags
                extra = next((f for f in flags if isinstance(f, dict)), None)
            except Exception as e:  # keep serving; the game shows an error
                status, ctype, rbody, note = 500, "text/plain", b"error\r\n", f"handler error: {e!r}"
        log(f"  -> {status} {len(rbody)} bytes  {note}")
        if rbody:
            log("     reply: (holds a password, not logged)" if secret else f"     reply: {rbody[:300]!r}")
        if path_only in charge.CONTENT_PATHS and status == 200:
            extra = {**(extra or {}), **charge.content_reply(path_only, headers, body)}
        if extra:
            log(f"     headers: {extra}")
        if http09:
            writer.write(rbody)
            close = True
        elif parts[0].upper() == "HEAD":
            # Headers only, with the length the GET would return.
            writer.write(response(status, ctype, rbody, close, extra, eol)[:-len(rbody) or None])
        else:
            writer.write(response(status, ctype, rbody, close, extra, eol))
        await writer.drain()
        # Some games read to end-of-connection instead of Content-Length.
        if close or headers.get("connection", "").lower() == "close" or request_line.endswith("HTTP/1.0"):
            break
    writer.close()


async def bpl_conn(reader, writer):
    """BPL: 24-byte header, little-endian type at 2 and total size at 4.
    Echo the request header with type 0x0010 (allow, no blocks)."""
    try:
        while True:
            hdr = await asyncio.wait_for(reader.readexactly(BPL_HEADER), 60)
            total = struct.unpack_from("<I", hdr, 4)[0]
            rest = await reader.readexactly(max(0, total - BPL_HEADER))
            urls = [s.decode("shift_jis", "replace") for s in re.findall(rb"[\x20-\x7e]{4,}", rest)]
            log(f"BPL request {total} bytes, strings: {urls}")
            save("bpl", "bpl", "", hdr + rest, {"strings": urls})
            resp = bytearray(hdr)
            resp[0], resp[1] = 0x01, BPL_HEADER
            struct.pack_into("<H", resp, 2, 0x0010)
            struct.pack_into("<I", resp, 4, BPL_HEADER)
            writer.write(bytes(resp))
            await writer.drain()
    except (asyncio.IncompleteReadError, asyncio.TimeoutError, ConnectionError):
        pass
    writer.close()


async def main():
    global STORE
    DATA.mkdir(exist_ok=True)
    STORE = swan_ranking.Store(str(DATA / "wg.sqlite"))
    servers = [
        *[await asyncio.start_server(http_conn, "127.0.0.1", p) for p in HTTP_PORTS],
        await asyncio.start_server(nclassic.conn, "127.0.0.1", NCLASSIC_PORT),
        await asyncio.start_server(bpl_conn, "127.0.0.1", BPL_PORT),
        await asyncio.start_server(mail.smtp_conn, "127.0.0.1", mail.SMTP_PORT),
        await asyncio.start_server(mail.pop3_conn, "127.0.0.1", mail.POP3_PORT),
        await asyncio.start_server(mail.daytime_conn, "127.0.0.1", mail.DAYTIME_PORT),
    ]
    log(f"wgserver: HTTP on {HTTP_PORTS}, nclassic on {NCLASSIC_PORT}, BPL on {BPL_PORT}, "
        f"SMTP on {mail.SMTP_PORT}, POP3 on {mail.POP3_PORT}, captures in {CAPTURES}")
    await asyncio.gather(*(s.serve_forever() for s in servers))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
