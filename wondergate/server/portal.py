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
}


def handle(path):
    if path == "/game.wg":
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
