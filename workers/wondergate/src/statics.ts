// Static downloads: files under content/<dir>/ served for a URL prefix (map packs and the like).
// A port of static.py. Replies close the connection: these games read until the server hangs up.
import type { Conn } from './env';
import type { Handler, Reply } from './http';

// "host URL-prefix" -> content subdirectory
const ROUTES: Array<[string, string, string]> = [
  ['wgg01.channel.or.jp', '/download/sdgundame/', 'sdgundame'],
  // Lode Runner: the cartridge sends "GET /" + "/download/...", hence the double slash.
  // No loadrunner/ directory = 404 = the game's "no data list" (error 603).
  ['wgg01.channel.or.jp', '//download/loadrunner/mapdata/', 'loadrunner']
];

export function route(conn: Conn, host: string, path: string): Handler | null {
  for (const [h, prefix, sub] of ROUTES) if (host === h && path.startsWith(prefix)) return () => serve(conn, sub, path.slice(prefix.length));
  return null;
}

/** For requests without a Host header (HTTP/0.9): match the path alone. */
export function routeAny(conn: Conn, path: string): Handler | null {
  for (const [, prefix, sub] of ROUTES) if (path.startsWith(prefix)) return () => serve(conn, sub, path.slice(prefix.length));
  return null;
}

async function serve(conn: Conn, sub: string, name: string): Promise<Reply> {
  const missing: Reply = { status: 404, type: 'text/plain', body: 'not found\r\n', note: `static ${sub}/${name}: missing`, close: true };
  if (!name || name.includes('..') || name.includes('\\') || name.startsWith('/')) return missing;
  const res = await conn.env.CONTENT.fetch(`https://content.invalid/${sub}/${name}`);
  if (!res.ok) return missing;
  return { status: 200, type: 'application/octet-stream', body: new Uint8Array(await res.arrayBuffer()), note: `static ${sub}/${name}`, close: true };
}
