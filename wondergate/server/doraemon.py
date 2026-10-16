"""Pocket no Naka no Doraemon: DORA MAIL date page, www.bea.hi-ho.ne.jp.

GET /log_inguz_1999/index.shtml (HTTP/1.1). The cartridge (parser at ROM
0x3DF974) finds the first "BR>" and reads fixed columns after it:
    +3 MM  +5 '/'  +6 DD  +8 ' '  +9 weekday (2 bytes, Shift-JIS, ignored)  +11 ' '  +12 HH
i.e. an SSI date like "10/13 火 12:34". Month/day pick which of the 39 seasonal
mails stored in the ROM arrive (table at 0x3D7308: New Year, Setsubun,
Valentine's, Tanabata, Christmas, ...); the hour stamps the mail. No "BR>"
means error 400. The page's other text is ignored.
"""
import datetime

JST = datetime.timezone(datetime.timedelta(hours=9))
WEEKDAYS = "月火水木金土日"


def page(now=None):
    now = now or datetime.datetime.now(JST)
    stamp = f"{now:%m/%d} {WEEKDAYS[now.weekday()]} {now:%H:%M}"
    html = ("<HTML><HEAD><TITLE>DORA MAIL</TITLE></HEAD><BODY>\r\n"
            f"<BR>{stamp}\r\n</BODY></HTML>\r\n")
    return html.encode("shift_jis"), stamp


def handle(body):
    html, stamp = page()
    return 200, "text/html", html, f"doraemon date page {stamp}"
