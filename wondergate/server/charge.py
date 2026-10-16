"""Bandai "charge" service on wgb01.channel.or.jp/service/charge/: service window,
server time, sessions and paid contents, shared by several games.

nph-* are non-parsed-header CGIs: the data travels in X-SWAN-* response headers
(table in Pocket Fighter's ROM at 0x0EFC50: X-SWAN- + TIME-RET/SRVC-RET/CMND-RET/
CNTS-RET, TIME-NOW, SRVC-OPEN/CLOSE, SRVC-/CMND-TIM, SRVC-/CMND-TRM, SRVC-/CHRG-MTN-
FROM/TO, SRVC-PRC, SRVC-/CMND-/CNTS-WAY, CMND-BAL, CMND-/CNTS-AID, CMND-URL,
WM-RET, CNTS-TIM/TRM, SRVC-CNT; plus plain Content-Length and Location).

Every reply must be 200 with an *-RET header whose number is the result code:
0 = success, anything else is shown to the player as the error. A missing
header the step needs = error 700. See docs/wondergate/charge.md.
"""
import json
import pathlib
import secrets
import time

COUNTER = pathlib.Path(__file__).resolve().parent.parent / "data" / "charge-counter.json"


def next_customer(service):
    """SRVC-CNT: a new number per call. A cartridge keeps the first one it gets
    as its customer ID (Pocket Fighter shows fzyA0001 for 1), so distinct carts
    get distinct IDs."""
    COUNTER.parent.mkdir(exist_ok=True)
    data = json.loads(COUNTER.read_text()) if COUNTER.exists() else {}
    data[service] = data.get(service, 0) + 1
    COUNTER.write_text(json.dumps(data))
    return data[service]


def token80():
    """CMND-AID: the game stores and echoes back exactly 80 bytes."""
    return secrets.token_urlsafe(60)[:80]


def now15():
    """YYYYMMDDhhmmss + one digit (GunPey EX's sample ends in 3; meaning unknown)."""
    return time.strftime("%Y%m%d%H%M%S") + "0"


CONTENT_PATHS = ("/service/swan-ranking/pocketf",)


def content_reply(path, headers, body):
    """Content request (the game's own URL, after nph-session): needs CNTS-RET and CNTS-AID."""
    # CNTS-AID must be present; Pocket Fighter doesn't decode it (the content
    # itself is the reply body, a swan-ranking table or an info= line).
    return {"X-SWAN-CNTS-RET": "0", "X-SWAN-CNTS-AID": headers.get("x-swan-cnts-aid", "")[:80] or token80()}


def handle(path, headers, body):
    """Return (status, content_type, body_bytes, note, extra_headers)."""
    name = path.rsplit("/", 1)[-1]
    srvc = headers.get("x-swan-srvc-id", "")
    note = f"{name} srvc={srvc} sid={headers.get('x-swan-cmnd-sid', '')} aid={headers.get('x-swan-cnts-aid', '')}"
    if name == "nph-srvccount":
        h = {"X-SWAN-SRVC-RET": "0", "X-SWAN-SRVC-CNT": str(next_customer(srvc or "-"))}
    elif name == "nph-gettime":
        h = {"X-SWAN-TIME-RET": "0", "X-SWAN-TIME-NOW": now15()}
    elif name == "nph-srvcinfo":
        # Free service, open all the time, no maintenance window.
        h = {"X-SWAN-SRVC-RET": "0", "X-SWAN-SRVC-OPEN": "200001010000000",
             "X-SWAN-SRVC-CLOSE": "209912312359590", "X-SWAN-SRVC-PRC": "0",
             "X-SWAN-SRVC-WAY": "0", "X-SWAN-SRVC-TIM": "0", "X-SWAN-SRVC-TRM": "0"}
    elif name == "nph-session":
        h = {"X-SWAN-CMND-RET": "0", "X-SWAN-CMND-AID": token80(),
             "X-SWAN-CMND-URL": "http://wgg01.channel.or.jp/service/swan-ranking/pocketf",
             "X-SWAN-CMND-BAL": "0"}
    elif name == "nph-contents":
        h = {"X-SWAN-CNTS-RET": "0", "X-SWAN-CNTS-AID": "0000000001"}
    else:
        h = {}
    return 200, "text/plain", b"", note, h
