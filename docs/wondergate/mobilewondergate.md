# MobileWonderGate cart — browser, mail and game downloads 🔁

Status: **browser, mail and game downloads work** headless (2026-10-13). The browser opens our
portal at `http://www.mopera.ne.jp/` and follows links. メール自動設定 creates a mail account on
our server, and the MAILER receives (POP3) and sends (SMTP) mail between WonderGate accounts
(never to the internet; see [limits and risks](#mail-limits-and-risks)). The GAME menu runs a game
downloaded through the browser. The original games are lost, so the portal offers our own:
**スネーク (Snake)**, [`games/snake/snake.asm`](../../wondergate/games/snake/snake.asm). Servers: [`server/portal.py`](../../wondergate/server/portal.py),
[`server/mail.py`](../../wondergate/server/mail.py); the BPL reply is in `wgserver.py`.

Checked again in the running cart on 2026-11-26: every BPL reply type the cart handles
([BPL](#bpl-port-5555)), the three [factory bookmarks](#factory-bookmarks) (all three reach pages
of ours since 2026-11-27), and mail sent from one account and received by another
([Mail](#mail-mailmoperanejp)).

## Browser

Portal pages ([`server/portal.py`](../../wondergate/server/portal.py)): home, 対応ソフト (built
from `docs/wondergate/progress.json`, the same per-game status as the website), お知らせ,
メールのつかいかた, and ゲームダウンロード (Snake).

Every page load first asks BPL (`bpl02.mopera.ne.jp:5555`, then `bpl01`; see
[BPL](#bpl-port-5555)), is told to fetch the page itself, and then sends `GET … HTTP/1.0` with
`User-Agent: SWAN/1.0`. Pages are Shift-JIS HTML 3.2 with forms
(`TEXT PASSWORD CHECKBOX RADIO HIDDEN SUBMIT RESET IMAGE FILE`, `TEXTAREA`, `SELECT`).
Toolbar (START), left to right: back, forward, home, reload, open a URL, bookmarks, connect or
disconnect (ネットワークへ接続 / ネットワークを切断), settings, back to the main menu. The cursor stays
where it was left. A 404 with a `text/plain` body shows as an empty page.
The cart ends a call by powering the adapter off (`0F FF`) after a power-on; the adapter
core now keeps the call state across that power-on and logs it as the hang-up.

## BPL (port 5555)

BPL was mopera's proxy for this browser: the cart sends it the URL and its screen size, and the
server could send back the finished page. Worked out from the cart's reader (ROM `0x1E8A5B`, caller
`0x1E86FE`) and then tried in the cart with a test server that sent each reply type (2026-11-26).

Request: a 24-byte header (`01 18`, type `00 00`, total size as 4 bytes, 8 zero bytes, `D8 00` =
216, the page width in pixels, then `C0 01` and `FF FF 00 00`), then records of
`[length, 2 bytes][type, 2 bytes][text]`: type 1 is the URL without `http://`, type 3 the page the
link was on. URLs that start with `start.mopera.ne.jp` are never asked about (ROM `0x1E872F`).

Reply: the same header with the type in bytes 2-3 (only the low 6 bits count) and the total size
in bytes 4-7, then the body. What each type does, as seen in the cart:

| Type | What the cart does |
|---|---|
| `0x10` | Reads no body and fetches the URL itself over HTTP. This is what we always send. |
| `0x12` | A game: the body holds a record `[length, 2][06][game]`, stored for the GAME menu like an `APPLICATION/WONDERGATE` download. Shows ダウンロード終了. Our Snake sent this way ran from GAME. |
| `0x21` | Opens a box asking for ID and PASS (パスワードの入力). What the cart sends after that was not followed. |
| `0x23` | Reads no body and shows ﾍﾟｰｼﾞが大きくすべて表示できません ("the page is too big to show"). |
| anything else | The body is the page, already drawn by the server: records of `[length, 2][04][2 bytes]` + tiles (2 bits per pixel, 448 bytes for each row of 28 tiles), with the page size in header bytes `0x0E`-`0x17`; the other records are copied to the page's link list. A test pattern sent as type `0x00` and as `0x11` appeared on screen. The layout of the link records is not worked out. |

A body may also come packed: `FF FF 00`, 5 bytes (the first is the number of blocks), then blocks of
`[00 = plain, 01 = LZSS][1 byte][length, 2][unpacked length, 2][data]` and two zero bytes
(ROM `0x1E8C7C`-`0x1E8F9E`). This was read from the code only, not tried.

Nothing our server offers needs the other types: pages and the game download go through HTTP after
type `0x10`, the first factory bookmark included (below; the adapter sends its bare host name to
us). What mopera's server really answered, and for which URLs, is not known.

## Factory bookmarks

The cart comes with three bookmarks (ROM `0x1EAB08`). All three reach pages of ours since
2026-11-27; opened in the cart that day (bookmarks are the sixth toolbar icon: A on an entry, then
START and ブックマークを開く):

| Title | URL | What happens |
|---|---|---|
| ゲームダウンロード | `game/` | BPL is asked about `game/` and answers type `0x10`. The cart looks up a host called `game`; the adapter sends that name to our server (it is on the built-in list in `core/wg.c`). The server answers `Host: game` with the portal's ゲームダウンロード page; its スネーク link (`/game.wg`, asked for on host `game`) downloads Snake, which then runs from GAME, and its ホーム link goes to the portal. |
| ドコモホームページ(テキスト) | `www.nttdocomo.co.jp/mc-user/` | The adapter sends this name to our server too. Every path on that host gets one short page of ours (`portal.py`): Docomo's page is gone, this page is not Docomo's, and a link to the portal home. |
| WonderSwan Web for WG | `wg.channel.or.jp/` | Reaches our server (`*.channel.or.jp` is redirected). Bandai's page is lost. The server answers with a page of ours (`portal.py`, keyed by host + path) that says so and links to the portal. |

Before that change (seen 2026-11-26) `game/` ended in 501.サーバの応答がありません, because no host
called `game` exists, and the Docomo bookmark went to NTT Docomo's web server of today, which
answers 301; the cart doesn't follow redirects and showed "Moved Permanently". An adapter without
the two names on its list still does both, so don't open the Docomo bookmark in a test with an
older adapter: the request leaves for the real site. In the adapter log both lookups now read
`(redirected)`.

`game/` has no host name, so on the original service the BPL server must have answered it itself
(a drawn page or a game); that is an inference, and what the bookmark showed is not known. Ours is
a choice: the same download page the portal has, which says what the game is before anything is
stored. The other way that works in the cart, BPL answering `game/` with type `0x12` and Snake,
starts the download at once with no page, and is not built. We have no copy of Docomo's text page;
our page for it only says it is gone.

Both servers route the two hosts (`route()` in `wgserver.py` and `http.ts`), and their replies
were compared byte for byte for `game/`, `game/game.wg`, a missing page on `game`, and three paths
on the Docomo host, with the Worker's `encoded.ts` regenerated in a scratch copy. Both bookmarks
were also opened in the cart against that Worker copy.

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
are filled in. The page stays on screen, and every further press of 設定する makes another account
(the cart keeps the last one). The cart's address then sits in its save memory at SRAM bank 0
`0xF105`.

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

Checked in the cart on 2026-11-26, from power-on against an empty server:

- One press of 設定する, then 受信 (MAILER toolbar, first icon): the ようこそ mail arrives and opens.
- メールの新規作成 (third icon): 宛先 → START → 宛先を入力 → 新規作成 → アドレス, typed on the
  keyboard, 決定, START → ○, START → 戻る; 件名 and the text typed the same way; START → 送信.
  The cart reads the daytime server, sends the mail by SMTP and hangs up.
- 受信 again: the mail is in the inbox with its sender, date and text. The words at `0xE382` of
  SRAM bank 0 and `0x0100` of bank 4 are then 2, and 1 if the mail was not sent (seen both ways;
  they look like the inbox count). Which bank the MAILER leaves mapped while it idles varied
  from run to run, so read bank 0 from the main menu.
- A second cart with its own account (`wg00002`) sent to the first cart's address; the first
  cart received it and showed `"wg00002" <wg00002@mopera.ne.jp>` as the sender.

The server's own mails (welcome and "didn't arrive") carry a `Date:` in Japan time (`+0900`)
whatever the host's time zone, the same as the Worker. With no mail waiting the cart shows
メールはありません. With the SMTP port closed the mail stayed in the 送信ボックス. Not checked: what
the cart shows when SMTP answers with an error, mail to an address outside `@mopera.ne.jp` (the
"didn't arrive" notice), CC and BCC, and deleting mail.

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
`emu/replays.txt`. As of 2026-11-26 `mwgmail` covers the auto-setup only, and it presses 設定する
three times, so it makes three accounts; sending and receiving have no replay there yet. Typing
on the cart's keyboard: `tools/mwg_type.py`. The address keyboard opens in 英数 with the cursor on
`a` (start `0,1`); 決定 is the last key of the bottom row.

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
