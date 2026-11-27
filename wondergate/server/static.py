"""Static downloads: files under server/content/<dir>/ served for a URL prefix.

Used for data the original servers handed out as plain files (map packs, etc.).
Replies close the connection: these games read until the server hangs up.
"""
import os
import pathlib

# WG_STATIC_CONTENT points a local server at a test set (e.g. local/loadrunner-test),
# so test files never have to sit in server/content/, which is what gets deployed.
CONTENT = pathlib.Path(os.environ.get("WG_STATIC_CONTENT") or pathlib.Path(__file__).resolve().parent / "content")

# (host, URL prefix) -> content subdirectory
ROUTES = {
    ("wgg01.channel.or.jp", "/download/sdgundame/"): "sdgundame",
    # Lode Runner: the cartridge sends "GET /" + "/download/...", hence the double slash.
    # No loadrunner/ directory = 404 = the game's "no data list" (error 603).
    ("wgg01.channel.or.jp", "//download/loadrunner/mapdata/"): "loadrunner",
}


# Gashapon Senki fetches title strips with a bare HTTP/0.9 GET, whose reply has no status line.
# It finds an error by looking for "<TITLE>" in the first 0x100 bytes and shows the number after
# it (ROM 0x6F452), but only after reading the 0x200 bytes it asked for: a shorter reply is error
# 004. So this route's 404 body is an HTML page of ours, padded to 0x200 bytes.
HTML_404 = {"sdgundame"}
NOT_FOUND_HTML = (b"<HTML><HEAD><TITLE>404 Not Found</TITLE></HEAD>\r\n"
                  b"<BODY><H1>Not Found</H1></BODY></HTML>\r\n").ljust(0x200)


def route(host, path):
    for (h, prefix), sub in ROUTES.items():
        if host == h and path.startswith(prefix):
            return lambda body: serve(sub, path[len(prefix):])
    return None


def route_any(path):
    """For requests without a Host header (HTTP/0.9): match the path alone."""
    for (h, prefix), sub in ROUTES.items():
        if path.startswith(prefix):
            return lambda body: serve(sub, path[len(prefix):])
    return None


def serve(sub, name):
    base = (CONTENT / sub).resolve()
    f = (base / name).resolve()
    if base not in f.parents or not f.is_file():
        if sub in HTML_404:
            return 404, "text/html", NOT_FOUND_HTML, f"static {sub}/{name}: missing", "close"
        return 404, "text/plain", b"not found\r\n", f"static {sub}/{name}: missing", "close"
    return 200, "application/octet-stream", f.read_bytes(), f"static {sub}/{name}", "close"
