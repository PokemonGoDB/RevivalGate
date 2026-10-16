// HTTP for the WonderGate games: a port of wgserver.py's http_conn and response().
// The games parse replies at fixed offsets, so every quirk here is deliberate.
import { bytesOf, concat, Inbox, indexOf, latin1 } from './bytes';
import * as access from './access';
import * as buffers from './buffers';
import * as charge from './charge';
import * as darkeyes from './darkeyes';
import * as digimon from './digimon';
import * as doraemon from './doraemon';
import type { Conn } from './env';
import * as ggene from './ggene';
import * as loderunner from './loderunner';
import * as mail from './mail';
import * as portal from './portal';
import * as ranking from './ranking';
import * as starhearts from './starhearts';
import * as statics from './statics';
import * as tonpuusou from './tonpuusou';
import * as wizardry from './wizardry';

export interface Reply {
  status: number;
  /** Content-Type, or null for none */
  type: string | null;
  body: Uint8Array | string;
  note: string;
  /** Close after this reply, announcing it with "Connection: close" (some games read to end-of-connection). */
  close?: boolean;
  /** Hang up after this reply without a Connection header (the original's nph-* CGIs did). */
  hangUp?: boolean;
  headers?: Record<string, string>;
  /** Header lines end in a bare LF, with Content-Length first (nph-* CGIs that printed "\n"). */
  lf?: boolean;
}
export type Handler = (body: Uint8Array) => Promise<Reply> | Reply;

/** (host, path) -> handler, as wgserver.route(). */
export function route(conn: Conn, rawHost: string, path: string, headers: Record<string, string>, query = ''): Handler | null {
  const host = rawHost.split(':')[0].toLowerCase();
  if (path.startsWith('/service/charge/')) return (body) => charge.handle(conn, path, headers, body);
  if (host === 'wgg01.channel.or.jp' && path === '/service/buffersevolution') return (body) => buffers.handle(conn, body);
  if (host === 'tongpuso.wgg.channel.or.jp' && path.startsWith('/cgi-bin/')) return (body) => tonpuusou.handle(conn, path, body);
  // For a PC browser (any host but the games' own)
  if (path.replace(/\/+$/, '') === '/tonpuusou' && !/\.(or\.jp|ne\.jp|co\.jp|com)$/.test(host)) return () => tonpuusou.page(conn);
  if (host === 'www2.sting.co.jp' && path === '/cgi-bin/wg/wiz.cgi') return () => wizardry.handle(conn, query);
  // Ours: Lode Runner stages sent from the cartridge over the link cable (wgcore's link peer).
  if (host === 'link.swanrevival.com' && path === '/loderunner/stage') return (body) => loderunner.handle(conn, headers, body);
  if (host === 'start.mopera.ne.jp') return () => mail.start(conn, path);
  if (host === 'www.mopera.ne.jp') return () => portal.handle(path);
  if (host === 's_hearts.wgg.channel.or.jp' && path === '/cgi-bin/starhearts.cgi') return () => starhearts.handle(conn, query);
  if (host === 'battleg1.dark-eyes.com' && path.startsWith('/cgi-bin/dark/')) return (body) => darkeyes.handle(conn, path, headers, body);
  if ((host === 'digi4.wgg.channel.or.jp' && path.startsWith('/cgi-bin/dm4')) || (host === 'digi_b.wgg.channel.or.jp' && path.startsWith('/cgi-bin/dmB'))) {
    return (body) => digimon.handle(conn, path, body);
  }
  if (host === 'wgg02.channel.or.jp' && path === '/ring/cgi-bin/accsess.cgi') return access.ring;
  if (host === 'terrors2.wgg.channel.or.jp' && path === '/cgi-bin/accsess.cgi') return access.terrors2;
  if (host === 'www.bea.hi-ho.ne.jp' && path === '/log_inguz_1999/index.shtml') return doraemon.handle;
  if (host === 'wgg02.channel.or.jp' && ggene.isFile(path)) return () => ggene.handle(path);
  const file = statics.route(conn, host, path);
  if (file) return file;
  const game = ranking.SWAN_RANKING[`${host}${path}`];
  if (game) return (body) => ranking.handle(conn, game, body);
  return null;
}

const REASONS: Record<number, string> = {
  200: 'OK', 404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity', 500: 'Internal Server Error'
};

/** Short headers, exactly "Name: value". */
export function response(status: number, type: string | null, body: Uint8Array, close = false, extra?: Record<string, string>, lf = false): Uint8Array {
  let head = `HTTP/1.1 ${status} ${REASONS[status] ?? 'OK'}\r\n`;
  // Dark Eyes finds the body by searching "\n\n" from just after the Content-Length line, so with
  // bare-LF replies that line comes before the other headers.
  if (lf) head += `Content-Length: ${body.length}\r\n`;
  for (const [k, v] of Object.entries(extra ?? {})) head += `${k}: ${v}\r\n`;
  if (close) head += 'Connection: close\r\n';
  if (type) head += `Content-Type: ${type}\r\n`;
  head += (lf ? '' : `Content-Length: ${body.length}\r\n`) + '\r\n';
  return concat(bytesOf(lf ? head.replace(/\r\n/g, '\n') : head), body);
}

const END = bytesOf('\r\n\r\n');
const HEAD_LIMIT = 65536; // asyncio's default readuntil limit
// Requests on one connection. The most any game sends is a handful (Raku Jongg's three keep-alive
// POSTs; Dark Eyes opens a new connection for each poll), so this only stops a relay from keeping one
// tunnel open to run an endless stream of requests.
const MAX_REQUESTS = 50;

/** One TCP connection's worth of HTTP, fed bytes as they arrive. Keep-alive like the original. */
export class HttpSession {
  private buf = new Inbox();
  /** How far the buffer has been searched for the end of the headers. */
  private scanned = 0;
  /** The body length of the request whose headers are complete (read once, not per chunk). */
  private need: number | null = null;
  private requests = 0;
  private done = false;

  constructor(
    private conn: Conn,
    private send: (bytes: Uint8Array) => void,
    private close: () => void
  ) {}

  async feed(data: Uint8Array) {
    if (this.done) return;
    this.buf.push(data);
    await this.drain(false);
  }

  /** The relay saw the console stop sending: answer what's complete, then hang up. */
  async eof() {
    if (this.done) return;
    await this.drain(true);
    this.finish();
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    this.close();
  }

  private async drain(eof: boolean) {
    while (!this.done) {
      const view = this.buf.view();
      // Only the new bytes need searching (plus three, in case the terminator straddles a chunk).
      const end = indexOf(view, END, Math.max(0, this.scanned - 3));
      if (end < 0) {
        this.scanned = view.length;
        if (view.length > HEAD_LIMIT) return this.finish();
        if (eof && view.length) this.conn.log(`http: connection closed mid-request ${JSON.stringify(latin1(view.subarray(0, 200)))}`);
        return;
      }
      if (this.need === null || this.scanned !== end) {
        const m = /^content-length:\s*(\d+)/im.exec(latin1(view.subarray(0, end + 4)));
        this.need = m ? Number.parseInt(m[1], 10) : 0;
      }
      this.scanned = end;
      const need = this.need;
      if (view.length < end + 4 + need) {
        if (eof) this.conn.log('http: connection closed mid-body');
        return;
      }
      const headBytes = this.buf.take(end + 4);
      const body = this.buf.take(need);
      this.scanned = 0;
      this.need = null;
      if (await this.request(headBytes, body)) return this.finish();
      if (++this.requests >= MAX_REQUESTS) {
        this.conn.log(`http: closed after ${this.requests} requests (limit)`);
        return this.finish();
      }
    }
  }

  /** Handle one request; true when the connection should close. */
  private async request(rawHead: Uint8Array, body: Uint8Array): Promise<boolean> {
    // Gashapon Senki ends its headers with an extra CRLF; skip blank lines.
    let headText = latin1(rawHead).replace(/^[\r\n]+/, '');
    if (!headText.trim()) return false;
    const lines = headText.split('\r\n');
    const requestLine = lines[0];
    const headers: Record<string, string> = {};
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i >= 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const parts = requestLine.split(' ');
    const target = parts.length > 1 ? parts[1] : '/';
    // HTTP/0.9 ("GET /path", no version, no Host): the reply is the bare body, then close.
    const http09 = parts.length === 2;
    let host = headers['host'] ?? '';
    let path = target;
    const abs = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(target); // absolute-URI requests
    if (abs) {
      host = host || abs[1];
      path = abs[2] || '/';
    }
    const pathOnly = path.split('?')[0];
    const q = path.indexOf('?');
    const query = q >= 0 ? path.slice(q + 1) : '';

    const handler = route(this.conn, host, pathOnly, headers, query) ?? (!host ? statics.routeAny(this.conn, pathOnly) : null);
    let reply: Reply;
    if (!handler) {
      reply = { status: 404, type: 'text/plain', body: 'not implemented yet\r\n', note: 'no handler' };
    } else {
      try {
        reply = await handler(body);
      } catch (err) {
        // Keep serving; the game shows an error.
        reply = { status: 500, type: 'text/plain', body: 'error\r\n', note: `handler error: ${err instanceof Error ? err.stack ?? err.message : err}` };
      }
    }
    let close = Boolean(reply.close);
    let extra = reply.headers;
    if (charge.CONTENT_PATHS.includes(pathOnly) && reply.status === 200) {
      extra = { ...(extra ?? {}), ...charge.contentReply(headers) };
    }
    const rbody = typeof reply.body === 'string' ? bytesOf(reply.body) : reply.body;
    this.conn.log(`${requestLine} Host: ${host} -> ${reply.status} ${rbody.length}B ${reply.note}`);

    if (http09) {
      this.send(rbody);
      close = true;
    } else if (parts[0].toUpperCase() === 'HEAD') {
      // Headers only, with the length the GET would return.
      const full = response(reply.status, reply.type, rbody, close, extra, reply.lf);
      this.send(full.subarray(0, full.length - rbody.length));
    } else {
      this.send(response(reply.status, reply.type, rbody, close, extra, reply.lf));
    }
    return close || Boolean(reply.hangUp) || (headers['connection'] ?? '').toLowerCase() === 'close' || requestLine.endsWith('HTTP/1.0');
  }
}
