"""MobileWonderGate cart browser: the home page (http://www.mopera.ne.jp/) and the
portal pages, in the browser's HTML subset (HTML 3.2, Shift-JIS, a 224-pixel
screen). The games page is built from docs/wondergate/progress.json, the same
per-game status the website shows."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROGRESS = ROOT.parent / "docs" / "wondergate" / "progress.json"
GAME_FILE = ROOT / "games" / "snake" / "snake.bin"
MARK = {"working": "OK", "shortcut-verified": "OK", "substitute": "OK*", "partial": "a part",
        "missing": "-", "impossible": "-"}
ORDER = ["missing", "partial", "impossible", "substitute", "shortcut-verified", "working"]


def page(title, body):
    return f"""<html><head><title>{title}</title></head><body>
<b>{title}</b><hr>
{body}
<hr><a href="/">ホーム</a>
</body></html>"""


def games_page():
    data = json.loads(PROGRESS.read_text())
    lines = []
    for g in data["games"]:
        status = min((f["status"] for f in g["features"]), key=ORDER.index)
        lines.append(f"{g['title']} [{MARK[status]}]<br>")
    return page("対応ソフト", "サーバーが うごいている<br>ソフトです。<br>"
                "OK* = もとのデータの かわりを<br>はいしん中<br><br>" + "\n".join(lines)
                + f"<br>({data['updated']})")


PAGES = {
    "/": lambda: """<html><head><title>WonderGate</title></head><body>
<center><b>ワンダーゲート</b></center>
<hr>
ワンダーゲートのサーバーが<br>もどってきました。<br>
<hr>
<a href="/games.html">対応ソフト</a><br>
<a href="/news.html">お知らせ</a><br>
<a href="/mail.html">メールのつかいかた</a><br>
<a href="/download.html">ゲームダウンロード</a><br>
</body></html>""",
    "/games.html": games_page,
    "/news.html": lambda: page("お知らせ", """2026年10月<br>
ワンダーゲートのサーバーが<br>ふっかつしました。<br><br>
・ランキングや対戦が<br>　ふたたび あそべます。<br>
・メールアドレスを<br>　つくれます。<br>
・ゲームを ダウンロード<br>　できます。"""),
    "/mail.html": lambda: page("メールのつかいかた", """1. 設定の メール自動設定で<br>
　アドレスを つくります。<br>
2. MAILER で メールを<br>
　うけとり・おくりできます。<br><br>
ワンダーゲートどうしの<br>メールが とどきます。<br><br>
ちゅうい<br>
・インターネットへは<br>　おくれません。<br>
・メールは あんごうか<br>　されていません。<br>
　ひみつの ことは<br>　かかないでね。"""),
    "/download.html": lambda: page("ゲームダウンロード", """ダウンロードした ゲームは<br>
メインメニューの GAME で<br>あそべます。<br><br>
<a href="/game.wg">スネーク</a><br>
へびを うごかして えさを<br>たべよう。A:スタート<br>
START:おわる"""),
    # The cart's factory bookmark "WonderSwan Web for WG" opens http://wg.channel.or.jp/ (cart ROM
    # 0x1EAB71). Bandai's page there is lost, so this page of ours says so and links to the portal.
    # Keyed by host + path, so the route for that host is portal.handle(host + path).
    "wg.channel.or.jp/": lambda: """<html><head><title>WonderSwan Web</title></head><body>
<b>WonderSwan Web for WG</b><hr>
バンダイの ページは<br>のこっていません。<br><br>
この ページは バンダイの<br>ものではなく、ワンダーゲートを<br>ふっかつさせた ファンが<br>つくりました。<br>
<hr><a href="http://www.mopera.ne.jp/">ワンダーゲートの ホーム</a>
</body></html>""",
    # The factory bookmark ドコモホームページ(テキスト) opens http://www.nttdocomo.co.jp/mc-user/. Docomo's
    # text page for the cart is gone, and the adapter sends that name to us so the request doesn't go to
    # Docomo's site of today. Every path on that host gets this page: it says whose page it is.
    "www.nttdocomo.co.jp/": lambda: """<html><head><title>ドコモホームページ</title></head><body>
<b>ドコモホームページ(テキスト)</b><hr>
ドコモの この ページは<br>もう ありません。<br><br>
この ページは ドコモの<br>ものではなく、ワンダーゲートを<br>ふっかつさせた ファンが<br>つくりました。<br>
<hr><a href="http://www.mopera.ne.jp/">ワンダーゲートの ホーム</a>
</body></html>""",
}
# The factory bookmark ゲームダウンロード opens http://game/, a name with no domain; the adapter sends
# it to us. It gets the portal's download page: the /game.wg link works from that host too (handle), and
# ホーム leads to the portal, since "/" on this host is the page itself.
PAGES["game/"] = lambda: PAGES["/download.html"]().replace('<a href="/">ホーム</a>', '<a href="http://www.mopera.ne.jp/">ホーム</a>')


def handle(path):
    if path.startswith("www.nttdocomo.co.jp/"):
        path = "www.nttdocomo.co.jp/"
    if path in ("/game.wg", "game/game.wg"):
        # A game for the cart's GAME menu: the whole body, sent as
        # CONTENT-TYPE: APPLICATION/WONDERGATE (compared exactly, cart ROM 0x11584).
        # The body is raw 8086 code, run at 1000:0010 (see games/snake/snake.asm).
        import os
        f = pathlib.Path(os.environ.get("MWG_GAME_FILE") or GAME_FILE)
        body = f.read_bytes()
        return 200, None, body, f"portal: game {f.name} ({len(body)} bytes)", {"CONTENT-TYPE": "APPLICATION/WONDERGATE"}
    make = PAGES.get(path)
    if make is None:
        return 404, "text/html", "<html><body>ページがありません<br><a href=\"/\">もどる</a></body></html>".encode("cp932"), f"portal: no page {path}"
    return 200, "text/html", make().encode("cp932"), f"portal {path}"
