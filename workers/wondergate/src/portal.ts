// MobileWonderGate cart browser: the home page (www.mopera.ne.jp) and the portal pages, in the
// browser's HTML subset, Shift-JIS. A port of portal.py (pages pre-encoded in encoded.ts; the games
// page comes from progress.json when that is generated).
import { bytesOf } from './bytes';
import { PORTAL_GAME, PORTAL_MISSING, PORTAL_PAGES } from './encoded';
import type { Reply } from './http';

export function handle(path: string): Reply {
  // Host + path keys are the cart's factory bookmarks (http.ts): every path on Docomo's old host gets our
  // one page for it, and the download page served for http://game/ links to the game on that host.
  if (path.startsWith('www.nttdocomo.co.jp/')) path = 'www.nttdocomo.co.jp/';
  if (path === '/game.wg' || path === 'game/game.wg') {
    // A game for the cart's GAME menu: the whole body, sent as CONTENT-TYPE: APPLICATION/WONDERGATE
    // (compared exactly, cart ROM 0x11584). The body is raw 8086 code, run at 1000:0010 (our Snake).
    const body = bytesOf(PORTAL_GAME);
    return { status: 200, type: null, body, note: `portal: game snake.bin (${body.length} bytes)`, headers: { 'CONTENT-TYPE': 'APPLICATION/WONDERGATE' } };
  }
  const page = PORTAL_PAGES[path];
  if (page === undefined) return { status: 404, type: 'text/html', body: bytesOf(PORTAL_MISSING), note: `portal: no page ${path}` };
  return { status: 200, type: 'text/html', body: bytesOf(page), note: `portal ${path}` };
}
