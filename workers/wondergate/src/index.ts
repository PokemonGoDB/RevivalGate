// WonderGate game server on Cloudflare Workers.
//
// Consoles reach it through a relay (the PC program today, the phone app for the Bluetooth module
// later). The relay opens one WebSocket per socket the console opens:
//   GET /tunnel  (WebSocket)
//   relay → {"v":1,"port":80,"token":"<device token, optional>"}   first message, text
//   server → {"ready":true,"handle":"mio"|null}
//   then binary frames carry the raw TCP bytes both ways;
//   relay → {"eof":true} when the console half-closes (it may still be waiting for the reply);
//   server closes the WebSocket when the game's connection should end.
// The games need byte-exact replies, which is why the bytes are tunnelled rather than sent as
// HTTP through Cloudflare's edge (that would rewrite headers).
import { BplSession } from './bpl';
import type { Conn, Env } from './env';
import { HttpSession } from './http';
import { DaytimeSession, Pop3Session, SmtpSession } from './mail';
import { NclassicSession } from './nclassic';

/** One connection's protocol, chosen by the port the game dialled. */
interface Session {
  start?(): Promise<void>;
  feed(data: Uint8Array): Promise<void>;
  eof(): Promise<void>;
}
import { link } from './link';

const IDLE_MS = 60_000; // as wgserver.py
// Abuse limits, far above what the games need (the largest request any game sends is about 1.4 KB,
// and connections last seconds): bytes a relay may send on one tunnel, and how long one may stay open.
const MAX_IN = 1024 * 1024;
const MAX_MS = 60 * 60_000;
// Messages per tunnel. Relays forward whatever arrives (the Bluetooth module's smallest pieces are 18
// bytes, so a 1.4 KB request is about 80), and every message costs a little however small it is.
const MAX_FRAMES = 16_384;

async function sha256url(value: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The account a relay's device token belongs to. An unknown or revoked token plays unlinked. */
async function deviceAccount(env: Env, ctx: ExecutionContext, token: unknown): Promise<{ id: string; handle: string | null } | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const hash = await sha256url(token);
  const row = await env.WG_DB.prepare(
    `SELECT d.id AS device, a.id, a.handle FROM devices d JOIN accounts a ON a.id = d.account_id
     WHERE d.token_hash = ? AND d.revoked IS NULL`
  )
    .bind(hash)
    .first<{ device: string; id: string; handle: string | null }>();
  if (!row) return null;
  ctx.waitUntil(env.WG_DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), row.device).run());
  return { id: row.id, handle: row.handle };
}

function tunnel(env: Env, ctx: ExecutionContext, peer: string): Response {
  const pair = new WebSocketPair();
  const [client, ws] = Object.values(pair);
  ws.accept();

  const tag = crypto.randomUUID().slice(0, 8);
  let session: Session | null = null;
  let closed = false;
  let idle: number | null = null;
  let received = 0;
  let frames = 0;
  const limit = setTimeout(() => close(1000, 'time limit'), MAX_MS);
  const close = (code = 1000, reason = 'done') => {
    if (closed) return;
    closed = true;
    clearTimeout(idle);
    clearTimeout(limit);
    try {
      ws.close(code, reason);
    } catch {}
  };
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => close(1000, 'idle'), IDLE_MS);
  };
  touch();

  async function onMessage(data: string | ArrayBuffer | Blob) {
    if (closed) return;
    received += typeof data === 'string' ? data.length : data instanceof Blob ? data.size : data.byteLength;
    if (received > MAX_IN || ++frames > MAX_FRAMES) {
      console.log(`[${tag}] tunnel closed after ${received} bytes in ${frames} messages (limit)`);
      return close(1009, 'too much data');
    }
    touch();
    if (typeof data === 'string') {
      let msg: { v?: number; port?: number; token?: unknown; eof?: boolean };
      try {
        msg = JSON.parse(data);
      } catch {
        return close(1003, 'bad control message');
      }
      if (msg.eof) return session?.eof();
      if (session) return;
      const account = await deviceAccount(env, ctx, msg.token);
      const conn: Conn = {
        env,
        accountId: account?.id ?? null,
        peer,
        log: (m) => console.log(`[${tag}${account ? ` @${account.handle ?? '?'}` : ''}] ${m}`)
      };
      const send = (b: Uint8Array) => {
        if (!closed) ws.send(b);
      };
      const end = () => close();
      switch (msg.port) {
        case 80:
        case 8080:
          session = new HttpSession(conn, send, end);
          break;
        case 10000: // Wonder Classic
          session = new NclassicSession(conn, send, end);
          break;
        case 5555: // MobileWonderGate browser's BPL check
          session = new BplSession(conn, send, end);
          break;
        case 25: // MobileWonderGate cart mail
          session = new SmtpSession(conn, send, end);
          break;
        case 110:
          session = new Pop3Session(conn, send, end);
          break;
        case 13: // daytime, read by the mailer before sending
          session = new DaytimeSession(send, end);
          break;
        default:
          return close(1008, 'unknown port');
      }
      ws.send(JSON.stringify({ ready: true, handle: account?.handle ?? null }));
      await session.start?.();
      return;
    }
    if (!session) return close(1008, 'hello first');
    // Binary frames can arrive as a Blob or an ArrayBuffer depending on the runtime.
    await session.feed(new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data));
  }

  // One message at a time, in order: a request can span frames and replies must not interleave.
  let chain = Promise.resolve();
  ws.addEventListener('message', (ev) => {
    chain = chain
      .then(() => onMessage(ev.data as string | ArrayBuffer | Blob))
      .catch((err) => {
        console.error(`[${tag}] tunnel error`, err);
        close(1011, 'server error');
      });
  });
  ws.addEventListener('close', () => {
    closed = true;
    clearTimeout(idle);
    clearTimeout(limit);
  });

  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/tunnel') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket only\n', { status: 426 });
      // Per address. A console battling in Dark Eyes opens one tunnel a second; this allows five at once.
      // Cloudflare counts this per machine and loosely (a flood gets several times the limit through),
      // so the hard stop is the WAF rate-limiting rule on wg.swanrevival.com, which also blocks before
      // the Worker runs. Loopback is exempt so the local test suites aren't throttled.
      const ip = request.headers.get('cf-connecting-ip') ?? '';
      if (ip && ip !== '127.0.0.1' && ip !== '::1' && !(await env.TUNNEL_LIMITER.limit({ key: ip })).success) {
        return new Response('Too many connections; try again in a minute\n', { status: 429 });
      }
      return tunnel(env, ctx, ip);
    }
    if (url.pathname === '/link' || url.pathname === '/link/') {
      if (request.method !== 'POST') return new Response('POST a link code\n', { status: 405 });
      return link(request, env);
    }
    if (url.pathname === '/') return new Response('Swan Revival WonderGate server\n', { headers: { 'content-type': 'text/plain' } });
    return new Response('not found\n', { status: 404 });
  }
} satisfies ExportedHandler<Env>;
