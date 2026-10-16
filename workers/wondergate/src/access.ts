// accsess.cgi check-ins: Ring Infinity and Terrors 2 (same developer, same library). A port of access.py.
// Both read 7 lines (status and headers) and then the body, and wait for the server to hang up.
import { bytesOf, jst } from './bytes';
import type { Reply } from './http';

const HEADERS = { Server: 'wgserver', 'Cache-Control': 'no-cache' };

/** Ring Infinity only needs the connection to succeed; it picks the hint mail itself. */
export function ring(): Reply {
  return { status: 200, type: 'text/plain', body: 'OK\r\n', note: 'ring infinity check-in', close: true, headers: HEADERS };
}

/** Terrors 2: body bytes 2-4 are the real-time campaign clock (half-day, hour, minute), Japan time. */
export function terrors2(): Reply {
  const t = jst();
  const clock = String.fromCharCode(t.hour < 12 ? 1 : 2, t.hour % 12, t.minute);
  return { status: 200, type: 'application/octet-stream', body: bytesOf(`T2${clock}\r\n`), note: `terrors2 clock ${t.H}:${t.M} JST`, close: true, headers: HEADERS };
}
