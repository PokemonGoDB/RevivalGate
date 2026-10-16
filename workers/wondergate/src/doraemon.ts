// Pocket no Naka no Doraemon: DORA MAIL date page on www.bea.hi-ho.ne.jp. A port of doraemon.py.
// The cartridge reads fixed columns after the first "BR>": "MM/DD <weekday> HH:MM"; the date picks
// which of the ROM's 39 seasonal mails arrive.
import { bytesOf, jst } from './bytes';
import { DORAEMON_WEEKDAYS } from './encoded';
import type { Reply } from './http';

export function handle(): Reply {
  const t = jst();
  const stamp = `${t.m}/${t.d} ${DORAEMON_WEEKDAYS[t.weekday]} ${t.H}:${t.M}`;
  const html = `<HTML><HEAD><TITLE>DORA MAIL</TITLE></HEAD><BODY>\r\n<BR>${stamp}\r\n</BODY></HTML>\r\n`;
  return { status: 200, type: 'text/html', body: bytesOf(html), note: `doraemon date page ${t.m}/${t.d} ${t.H}:${t.M}` };
}
