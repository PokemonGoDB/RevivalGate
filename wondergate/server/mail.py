"""MobileWonderGate cart mail: account auto-setup, SMTP and POP3 for the MAILER.

メール自動設定 dials 0120-903-025 and opens http://start.mopera.ne.jp/ in the
browser. A reply of type application/x-mopera-autoconf with NAME:value lines
(names in the cart ROM at 0x1D3CC) configures the dial-up and mail account:

    DIALUPNUMBERPDC: PPPUSERNAME: PPPPASSWORD: MAILADDRESS:
    POP3SERVERNAME: SMTPSERVERNAME: MAILUSERNAME: MAILPASSWORD:

Before sending it reads the time from ns1/ns2.channel.or.jp port 13 (daytime).
Each auto-setup creates a new account <user>@mopera.ne.jp. Mail stays on this
server: SMTP delivers only to our accounts, and nothing is ever sent out to the
internet. Mail to any other address (or to an account that doesn't exist) is
dropped, and the sender gets a notice in their own mailbox. POP3 serves each account's mailbox. The cart logs in with USER/PASS (never
APOP), so data/mail.json keeps only a salted PBKDF2 hash of each password.
See docs/wondergate/mobilewondergate.md.
"""
import asyncio
import email.utils
import hashlib
import hmac
import json
import os
import pathlib
import secrets
import time

DB = pathlib.Path(__file__).resolve().parent.parent / "data" / "mail.json"
DOMAIN = "mopera.ne.jp"
MAIL_HOST = "mail.mopera.ne.jp"
_OFFSET = int(os.environ.get("WG_PORT_OFFSET", "0"))  # see wgserver.py
SMTP_PORT, POP3_PORT, DAYTIME_PORT = 2525 + _OFFSET, 1110 + _OFFSET, 1313 + _OFFSET
PBKDF2_ROUNDS = 200_000  # about 50 ms per check
NOTICE = ("From: WonderGate <postmaster@{domain}>\r\nTo: {user}@{domain}\r\nDate: {date}\r\n"
          "Subject: =?ISO-2022-JP?B?{subject}?=\r\n"
          "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=ISO-2022-JP\r\n\r\n{body}\r\n")


def log(msg):
    print(time.strftime("%H:%M:%S"), "mail:", msg, flush=True)


def hash_password(password, salt=None, rounds=PBKDF2_ROUNDS):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), rounds).hex()
    return f"pbkdf2_sha256${rounds}${salt}${digest}"


def check_password(stored, password):
    _, rounds, salt, _ = stored.split("$")
    return hmac.compare_digest(stored, hash_password(password, salt, int(rounds)))


def load():
    db = json.loads(DB.read_text()) if DB.exists() else {"accounts": {}, "next": 1}
    # Accounts made before passwords were hashed: hash them now, once.
    old = [a for a in db["accounts"].values() if "password" in a]
    for acct in old:
        acct["hash"] = hash_password(acct.pop("password"))
    if old:
        save(db)
        log(f"hashed the passwords of {len(old)} older accounts")
    return db


def save(db):
    DB.parent.mkdir(exist_ok=True)
    DB.write_text(json.dumps(db, indent=1, ensure_ascii=False))


def jis(text):
    import base64
    return base64.b64encode(text.encode("iso2022_jp")).decode()


def deliver(db, user, raw):
    db["accounts"][user]["box"].append({"id": secrets.token_hex(6), "raw": raw})


def notice(db, user, subject, body):
    """A mail from postmaster to one of our accounts (ISO-2022-JP, as the MAILER reads)."""
    deliver(db, user, NOTICE.format(domain=DOMAIN, user=user, date=email.utils.formatdate(localtime=True),
                                    subject=jis(subject), body=body.encode("iso2022_jp").decode("latin-1")))


def local_user(db, address):
    user, _, dom = address.partition("@")
    return user if dom.lower() == DOMAIN and user in db["accounts"] else None


START_PAGE = """<html><head><title>mopera</title></head><body>
<center><b>メール自動設定</b></center><hr>
ワンダーゲートのメールアドレスを<br>つくります。<br><hr>
<form method="POST" action="/setup">
<input type="hidden" name="setup" value="1">
<input type="submit" value="設定する">
</form></body></html>"""


def start(path, body):
    """start.mopera.ne.jp: GET / is the sign-up page; its form POSTs to /setup,
    whose reply is the autoconf (the cart only reads autoconf from a form POST,
    cart ROM 0x10BE1)."""
    if path == "/setup":
        return autoconf(path)
    return 200, "text/html", START_PAGE.encode("cp932"), "mail: start page"


def autoconf(path):
    """Create an account and hand the cart its settings."""
    db = load()
    user = f"wg{db['next']:05d}"
    db["next"] += 1
    password = secrets.token_hex(4)
    db["accounts"][user] = {"hash": hash_password(password), "box": [], "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    notice(db, user, "ようこそ", "ワンダーゲートのメールへようこそ。\r\nこのアドレスでメールを送受信できます。")
    save(db)
    lines = [f"DIALUPNUMBERPDC:##", f"PPPUSERNAME:{user}", f"PPPPASSWORD:{password}",
             f"MAILADDRESS:{user}@{DOMAIN}", f"POP3SERVERNAME:{MAIL_HOST}", f"SMTPSERVERNAME:{MAIL_HOST}",
             f"MAILUSERNAME:{user}", f"MAILPASSWORD:{password}"]
    # The cart compares "CONTENT-TYPE: APPLICATION/X-MOPERA-AUTOCONF" exactly
    # (cart ROM 0x11163) and only treats the reply as complete once what it
    # has read ends in "</HTML>" or four LFs (0x1106A..0x11091). "secret":
    # the reply holds the password, so the server doesn't log it.
    return (200, None, ("\n".join(lines) + "\n\n\n\n").encode(), f"mail autoconf: new account {user}",
            {"CONTENT-TYPE": "APPLICATION/X-MOPERA-AUTOCONF"}, "lf", "secret")


async def daytime_conn(reader, writer):
    """Daytime (port 13 on ns1/ns2.channel.or.jp): the MAILER asks for the time
    before sending and writes the Date header as JST (+0900)."""
    import datetime
    jst = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    writer.write(jst.strftime("%a %b %d %H:%M:%S %Y\r\n").encode())
    await writer.drain()
    writer.close()


async def smtp_conn(reader, writer):
    async def say(line):
        writer.write((line + "\r\n").encode())
        await writer.drain()
    await say(f"220 {MAIL_HOST} ESMTP")
    rcpt, sender = [], ""
    try:
        while True:
            line = (await asyncio.wait_for(reader.readline(), 120)).decode("latin-1").rstrip("\r\n")
            if not line:
                break
            cmd = line[:4].upper()
            if cmd in ("HELO", "EHLO"):
                await say(f"250 {MAIL_HOST}")
            elif cmd == "MAIL":
                sender, rcpt = line.split(":", 1)[1].strip(" <>"), []
                await say("250 OK")
            elif cmd == "RCPT":
                rcpt.append(line.split(":", 1)[1].strip(" <>"))
                await say("250 OK")
            elif cmd == "DATA":
                await say("354 End data with <CR><LF>.<CR><LF>")
                data = []
                while True:
                    l = await asyncio.wait_for(reader.readline(), 120)
                    if l in (b".\r\n", b".\n", b""):
                        break
                    data.append(l[1:] if l.startswith(b"..") else l)
                raw = b"".join(data).decode("latin-1")
                db = load()
                for r in rcpt:
                    user = local_user(db, r)
                    if user:
                        deliver(db, user, f"Return-Path: <{sender}>\r\n" + raw)
                        log(f"SMTP {sender} -> {r}: delivered ({len(raw)} bytes)")
                        continue
                    # Never sent out, never kept. The cart still gets 250 (how
                    # it handles an SMTP error is unknown), and the sender, if
                    # it's one of ours, finds a notice in its mailbox.
                    log(f"SMTP {sender} -> {r}: not one of our accounts, dropped")
                    back = local_user(db, sender)
                    if back:
                        notice(db, back, "メールが とどきませんでした",
                               f"{r} あての メールは とどきませんでした。\r\n"
                               f"ワンダーゲートの メールは、ワンダーゲートどうし\r\n"
                               f"（@{DOMAIN} の アドレス）でしか おくれません。\r\n"
                               f"アドレスを たしかめてね。")
                save(db)
                await say("250 OK queued")
            elif cmd == "RSET":
                rcpt, sender = [], ""
                await say("250 OK")
            elif cmd == "NOOP":
                await say("250 OK")
            elif cmd == "QUIT":
                await say("221 Bye")
                break
            else:
                await say("502 Command not implemented")
    except (asyncio.TimeoutError, ConnectionError, IndexError):
        pass
    writer.close()


async def pop3_conn(reader, writer):
    async def say(line):
        writer.write((line + "\r\n").encode("latin-1"))
        await writer.drain()
    await say(f"+OK {MAIL_HOST} POP3 ready")
    user, box, deleted, db = None, None, set(), None
    try:
        while True:
            line = (await asyncio.wait_for(reader.readline(), 120)).decode("latin-1").rstrip("\r\n")
            if not line:
                break
            parts = line.split()
            cmd, args = parts[0].upper(), parts[1:]
            if cmd == "USER":
                user = args[0] if args else None
                await say("+OK")
            elif cmd == "PASS":
                db = load()
                acct = db["accounts"].get(user)
                ok = acct and await asyncio.get_running_loop().run_in_executor(
                    None, check_password, acct["hash"], args[0] if args else "")
                if not ok:
                    await say("-ERR authentication failed")
                    log(f"POP3 login failed for {user}")
                    continue
                box = acct["box"]
                log(f"POP3 {user}: {len(box)} messages")
                await say(f"+OK {len(box)} messages")
            elif box is None and cmd != "QUIT":
                await say("-ERR not logged in")
            elif cmd == "STAT":
                live = [m for i, m in enumerate(box) if i not in deleted]
                await say(f"+OK {len(live)} {sum(len(m['raw']) for m in live)}")
            elif cmd in ("LIST", "UIDL"):
                key = (lambda i, m: str(len(m["raw"]))) if cmd == "LIST" else (lambda i, m: m["id"])
                if args:
                    i = int(args[0]) - 1
                    await say(f"+OK {i + 1} {key(i, box[i])}")
                else:
                    await say("+OK")
                    for i, m in enumerate(box):
                        if i not in deleted:
                            await say(f"{i + 1} {key(i, m)}")
                    await say(".")
            elif cmd in ("RETR", "TOP"):
                i = int(args[0]) - 1
                raw = box[i]["raw"]
                if cmd == "TOP":
                    head, _, body = raw.partition("\r\n\r\n")
                    raw = head + "\r\n\r\n" + "\r\n".join(body.split("\r\n")[:int(args[1]) if len(args) > 1 else 0])
                await say(f"+OK {len(raw)} octets")
                for l in raw.split("\r\n"):
                    await say("." + l if l.startswith(".") else l)
                await say(".")
                log(f"POP3 {user}: {cmd} {i + 1}")
            elif cmd == "DELE":
                deleted.add(int(args[0]) - 1)
                await say("+OK deleted")
            elif cmd == "RSET":
                deleted.clear()
                await say("+OK")
            elif cmd == "NOOP":
                await say("+OK")
            elif cmd == "QUIT":
                if box is not None and deleted:
                    db = load()
                    acct = db["accounts"][user]
                    acct["box"] = [m for i, m in enumerate(acct["box"]) if i not in deleted]
                    save(db)
                await say("+OK bye")
                break
            else:
                await say("-ERR unknown command")
    except (asyncio.TimeoutError, ConnectionError, IndexError, ValueError):
        pass
    writer.close()
