# MobileWonderGate cart — browser, mail and game downloads 🔁

Status: **browser, mail and game downloads work** headless (2026-10-13). The browser opens our
portal at `http://www.mopera.ne.jp/` and follows links. メール自動設定 creates a mail account on
our server, and the MAILER receives (POP3) and sends (SMTP) mail between WonderGate accounts
(never to the internet; see [limits and risks](#mail-limits-and-risks)). The GAME menu runs a game
downloaded through the browser. The original games are lost, so the portal offers our own:
**スネーク (Snake)**, [`games/snake/snake.asm`](../../wondergate/games/snake/snake.asm). Servers: [`server/portal.py`](../../wondergate/server/portal.py),
[`server/mail.py`](../../wondergate/server/mail.py); BPL "allow" is in `wgserver.py`.

## Browser

Portal pages ([`server/portal.py`](../../wondergate/server/portal.py)): home, 対応ソフト (built
from `docs/wondergate/progress.json`, the same per-game status as the website), お知らせ,
メールのつかいかた, and ゲームダウンロード (Snake).

Every page load first asks BPL (`bpl01/02.mopera.ne.jp:5555`, answered "allow"), then sends
`GET … HTTP/1.0` with `User-Agent: SWAN/1.0`. Pages are Shift-JIS HTML 3.2 with forms
(`TEXT PASSWORD CHECKBOX RADIO HIDDEN SUBMIT RESET IMAGE FILE`, `TEXTAREA`, `SELECT`).
Toolbar (START): back, forward, home, reload, …, URL entry, ネットワークを切断 (7th icon), settings.
The cart ends a call by powering the adapter off (`0F FF`) after a power-on; the adapter
core now keeps the call state across that power-on and logs it as the hang-up.

## Mail auto-setup (`start.mopera.ne.jp`, dial `0120-903-025`, then `#9601`)

設定 → メール自動設定 opens `http://start.mopera.ne.jp/`. Our page is a form that POSTs to
`/setup`; the cart reads auto-configuration only from a form POST reply (cart ROM bank 1,
`0x0BE1`). The reply:

```
HTTP/1.1 200 OK
Content-Length: …
CONTENT-TYPE: APPLICATION/X-MOPERA-AUTOCONF      (compared exactly, upper case)

DIALUPNUMBERPDC:##
PPPUSERNAME:wg00001        PPPPASSWORD:…
MAILADDRESS:wg00001@mopera.ne.jp
POP3SERVERNAME:mail.mopera.ne.jp   SMTPSERVERNAME:mail.mopera.ne.jp
MAILUSERNAME:wg00001       MAILPASSWORD:…
(four LFs)
```

Lines end in LF, and the reply must end in four LFs (or `</HTML>`): the cart only treats the
data as complete then (`0x1106A`). The screen then shows 自動設定完了 and the MAILER settings
are filled in. Each setup makes a new account.

## Mail (`mail.mopera.ne.jp`)

- **POP3** (port 110 → 1110): `USER/PASS`, `STAT`, `UIDL n`, `LIST n`, `RETR n`,
  `DELE n`, `QUIT`. Messages are ISO-2022-JP; dates are shown in JST. The cart never uses
  `APOP`, so `data/mail.json` keeps only a salted PBKDF2-SHA256 hash of each password, and the
  server log leaves out the autoconf reply. Plain-text passwords from older accounts are
  hashed the first time the server loads them.
- **Daytime** (`ns1/ns2.channel.or.jp` port 13 → 1313): asked before sending; the cart writes
  `Date: …, … +0900` from it (`Tue Oct 13 14:26:13 2026`, JST).
- **SMTP** (port 25 → 2525): `HELO`, `MAIL FROM:addr`, `RCPT TO:addr`, `DATA`, `QUIT`
  (`X-Mailer: MobileWonderGate1.0`). Mail to our accounts is delivered. Mail to any other
  address, or to an account that doesn't exist, is dropped: it is never sent out and never
  kept. The cart still gets `250` (we don't know how it shows an SMTP error), and the sender
  finds メールが とどきませんでした ("your mail didn't arrive") in their inbox, saying that
  mail only goes between `@mopera.ne.jp` addresses. There is no way to switch on sending to
  the internet; this follows the plan in [wondergate.md](../wondergate.md) (WonderSwan ↔
  WonderSwan only, so the server can't become a spam relay).

The cart caches DNS answers between sessions and may connect straight to the server's IP, so
the adapter core now learns the server address on connect too (for its port map).

## Mail: limits and risks

WonderGate mail is a toy for players to write to each other, not a private messaging
service. The portal's メールのつかいかた ("how to use mail") page tells players the short
version: mail can't reach the internet, it isn't encrypted, and they shouldn't write secrets.

**What players can't do**

- Send to or receive from the internet. Our addresses use `@mopera.ne.jp`, which is NTT
  Docomo's real domain. They only mean something on our server, so outside mail couldn't
  reach them either.
- Choose their address. Every account is `wgNNNNN@mopera.ne.jp`, and each メール自動設定 makes
  a new one.
- Get an account back. It lives in the cart's save. Lose the save or run setup again, and the
  old address and its mail are gone for that player (they stay on the server).
- Block or report another player.

**Security risks.** Each risk below says what it means for players and whether it's handled.

- **Nothing is encrypted on the cart's side.** The cart sends its password and every mail in
  plain text. That can't change without modifying carts. The hop from the player's adapter to
  our server is meant to go through the TLS WebSocket tunnel in
  wondergate-ble.md, which isn't built yet. Today the server only
  listens on `127.0.0.1`. Until the tunnel exists, don't open the mail ports to the internet.
- **We can read everyone's mail.** `data/mail.json` holds every message in plain text until
  the player deletes it in the MAILER. There is no size limit or quota.
- **The sender can be faked.** The cart's SMTP has no login (no `AUTH`), so anyone who can
  reach the SMTP port can send mail to any player claiming to come from any address. Possible
  fix, not built: after setup, the cart sends its account name and password at the start of
  every call (the dial-up login, logged by `wg.c` as `PPP login user=… pass=…`). The adapter
  could pass these to the server, which would check them against the sender before accepting.
- **Anyone can make accounts.** A POST to `start.mopera.ne.jp/setup` makes a new account with
  no limit. It needs a rate limit before the server is public. Not built.
- **Passwords are short.** They're 8 hex digits (32 bits). The server stores only a salted
  PBKDF2-SHA256 hash, but a stolen `mail.json` could still be cracked with a fast GPU (graphics
  card). Longer passwords depend on how many characters the cart's settings accept (not
  checked yet). Anyone holding a player's cart or save file can read their mail.
- **What ends up in logs.** The server log records sender, recipient and size for each mail,
  but not its contents or passwords. Server logs from before 2026-10-14 do contain the
  passwords of the accounts created then. The adapter's own log (`logs/adapter.log`, on the
  player's computer) records every byte, including the dial-up login and `PASS`. HTTP requests
  are saved under `wondergate/captures/`, which is committed to git. The setup request
  contains nothing secret, but any portal form that asks players for personal information
  would end up there.

## Game downloads (GAME menu)

A link whose reply has `CONTENT-TYPE: APPLICATION/WONDERGATE` (compared exactly, cart ROM
`0x11584`) is a game: the browser shows ダウンロード終了 and the whole body is stored in SRAM
bank 7 behind a 16-byte header the cart writes (`SWAN` + 12 zero bytes). Selecting GAME in the
main menu (third icon) checks the header, copies up to `0xFFF0` bytes to SRAM bank 2, maps it
at segment `1000` and jumps to `1000:0010` (`0x1FFE1E..0x1FFE50`). There is no return: a game
is a standalone program (raw 8086/V30 code, `org 0x10`, DS = ES = `1000`) that owns the
hardware. To quit it can jump to `FFFF:0000`, which restarts the cart.

Our Snake sets up its own display (mono 2bpp tiles at RAM `0x2000`, SCR1 map at `0x0800`),
polls the keypad (port `0xB5`), waits for VBlank (port `0x02`), and runs with interrupts off.
It's 1.6 KB: `python3 font.py && nasm -f bin -o snake.bin snake.asm` in `games/snake/`. The
portal serves `snake.bin` (or `MWG_GAME_FILE`) at `/game.wg`.

Regression: `mwgbrowser`, `mwgmail` and `mwggame` (download Snake, then start it from GAME) in
`emu/replays.txt`. Typing on the cart's keyboard:
`tools/mwg_type.py`.

## The original downloads

- **What Bandai promised:** mini-games of about 32 KB, "games, fortune-telling, puzzles",
  downloaded into the cartridge, room for one at a time, with the call dropped before the game runs
  ([r_gate01](https://web.archive.org/web/20020814/http://www.swan.channel.or.jp/swan/hardware/r_gate01.html),
  [r_gate03](https://web.archive.org/web/20020814/http://www.swan.channel.or.jp/swan/hardware/r_gate03.html),
  [1999 announcement](https://web.archive.org/web/20000418044612/http://www.swan.channel.or.jp/swan/w_new/r_wondergate.html)).
- **What was actually released:** Japanese Wikipedia says the only mini-game ever distributed was a
  **15-puzzle**, citing 電撃王 #112 (September 2000), which we haven't checked
  ([ja.wikipedia ワンダースワン](https://ja.wikipedia.org/wiki/ワンダースワン)).
- **Cost:** no per-game price is recorded, only call charges.
- **What survives:** no download page was archived, and no copy of the game is known.
- **Size limit:** Bandai says 32 KB, while the cart copies up to `0xFFF0` bytes. Keep games at
  32 KB or less to be safe.

## Plan: homebrew, clearly labelled

The GAME menu shows no title: it checks the header and jumps. So a game can only identify itself on
the download page and on its own screen. Every game we serve is labelled as homebrew in all of these
places:

- **Portal:** a separate section, e.g. 「ファンメイドゲーム（非公式）」, that says plainly the original
  downloads are lost and these are new games, not Bandai's.
- **Per-game page:** author, version, size, date, controls, how to quit, and a warning that
  downloading replaces the game already stored for GAME.
- **In the game:** a required title screen (name, "HOMEBREW", author, year), since the menu shows
  nothing.
- **Metadata:** a short jump at `0x10` followed by a metadata block (magic, title, author, version),
  so the portal and the site can build the catalogue from the games themselves.
- **Catalogue:** one manifest per game under `wondergate/games/` (title, author, licence, source),
  turned into the portal page and a list on the site.
- **Submissions:**
  - source code under an open licence
  - builds with nasm
  - 32 KB or less
  - quits through `FFFF:0000`
  - passes a replay test like `mwggame`
- **If the 15-puzzle is ever recovered,** it gets its own オリジナル配信 section, apart from homebrew.

## Check your cartridge

The cartridge keeps its downloaded game in battery-backed save memory (SRAM bank 7, behind `SWAN` and
12 zero bytes), so a used MobileWonderGate cartridge may still hold the last game it downloaded. If
you own one, please dump its save and send it to us.
