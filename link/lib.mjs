// Shared by swan-link (for players) and swan-relay (for development): the account link and the
// tunnel from local TCP ports to the RevivalGate server. Node 22+, no dependencies.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// RevivalGate (Swan Revival's) is the default server; any server with the same tunnel protocol can be used.
export const DEFAULT_SERVER = 'wss://wg.swanrevival.com/tunnel';
export const DEFAULT_CONFIG = join(homedir(), '.swanrevival', 'link.json');

const norm = (server) => String(server ?? '').trim().replace(/\/+$/, '').toLowerCase();
export const sameServer = (a, b) => norm(a) !== '' && norm(a) === norm(b);

/** A server's account-link endpoint: https://host/link for wss://host/…, http for ws. */
export function linkUrl(server) {
  const u = new URL(server);
  return `${u.protocol === 'ws:' ? 'http:' : 'https:'}//${u.host}/link`;
}

/** The saved token, but only for the server that issued it (links made before this rule were Swan Revival's). */
export function tokenFor(cfg, server) {
  return cfg.token && sameServer(cfg.tokenServer ?? DEFAULT_SERVER, server) ? cfg.token : null;
}

export function readConfig(path = DEFAULT_CONFIG) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfig(cfg, path = DEFAULT_CONFIG) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

/** Swap a one-time code from the server's account page for a device token, and keep it with that server. */
export async function link({ code, name, server = DEFAULT_SERVER, config = DEFAULT_CONFIG }) {
  const res = await fetch(linkUrl(server), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name })
  }).catch((err) => ({ ok: false, status: 0, json: async () => ({ error: String(err.message ?? err) }) }));
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(body.error ?? `HTTP ${res.status}`);
  writeConfig({ ...readConfig(config), token: body.token, handle: body.handle ?? null, tokenServer: server }, config);
  return body.handle ?? null;
}

export function unlink(config = DEFAULT_CONFIG) {
  const cfg = readConfig(config);
  delete cfg.token;
  delete cfg.handle;
  delete cfg.tokenServer;
  writeConfig(cfg, config);
}

/** One console socket <-> one WebSocket tunnel. */
function tunnel(socket, port, { server, token, log }) {
  const id = `${socket.remotePort}->${port}`;
  const pending = [];
  let open = false;
  let eofPending = false;
  const ws = new WebSocket(server);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    open = true;
    ws.send(JSON.stringify({ v: 1, port, ...(token ? { token } : {}) }));
    for (const chunk of pending.splice(0)) ws.send(chunk);
    if (eofPending) ws.send(JSON.stringify({ eof: true }));
  });
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.ready) log(`${id} connected${msg.handle ? ` as ${msg.handle}` : ''}`);
      } catch {}
      return;
    }
    if (!socket.destroyed) socket.write(Buffer.from(ev.data));
  });
  ws.addEventListener('close', () => {
    if (!socket.destroyed) socket.end();
  });
  ws.addEventListener('error', (ev) => {
    log(`${id} can't reach the server: ${ev.message ?? 'connection failed'}`);
    socket.destroy();
  });

  socket.on('data', (chunk) => (open ? ws.send(chunk) : pending.push(chunk)));
  // The console stopped sending but may still be waiting for the reply.
  socket.on('end', () => (open ? ws.send(JSON.stringify({ eof: true })) : (eofPending = true)));
  socket.on('close', () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  });
  socket.on('error', () => socket.destroy());
}

/**
 * Listen on 127.0.0.1 and tunnel each connection to the server.
 * ports: [{ local, remote }], local 0 = any free port. Resolves to [{ local, remote }] as bound.
 */
export async function startRelay({ ports, server = DEFAULT_SERVER, token = null, log = () => {} }) {
  return Promise.all(
    ports.map(
      ({ local, remote }) =>
        new Promise((resolve, reject) => {
          const srv = createServer({ allowHalfOpen: true }, (socket) => tunnel(socket, remote, { server, token, log }));
          srv.on('error', reject);
          srv.listen(local, '127.0.0.1', () => resolve({ local: srv.address().port, remote }));
        })
    )
  );
}

/** The ports WonderGate games dial: HTTP, Wonder Classic's 10000, the browser's BPL check, and the
 *  MobileWonderGate cart's mail (SMTP 25, POP3 110, and daytime 13, read before sending). The server
 *  decides which it serves. */
export const GAME_PORTS = [80, 10000, 5555, 25, 110, 13];

/**
 * Turn Mednafen's WonderGate port on for every game, pointed at `program` (swan-link). Changes only those two
 * settings and keeps a copy of the file as it was. Mednafen rewrites mednafen.cfg when it quits, so run this
 * while it's closed. Returns the file's path.
 */
export function setupMednafen({ program, home = process.env.MEDNAFEN_HOME || join(homedir(), '.mednafen') }) {
  const file = join(home, 'mednafen.cfg');
  const had = existsSync(file);
  const lines = had ? readFileSync(file, 'utf8').split('\n') : [];
  for (const [key, value] of [['wswan.excomm', '1'], ['wswan.excomm.path', program]]) {
    const i = lines.findIndex((l) => l.split(/[ \t]/, 1)[0] === key);
    if (i >= 0) lines[i] = `${key} ${value}`;
    else lines.splice(lines.length && lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${key} ${value}`);
  }
  mkdirSync(home, { recursive: true });
  if (had) copyFileSync(file, `${file}.before-swan-link`);
  writeFileSync(file, `${lines.join('\n').replace(/\n*$/, '')}\n`);
  return file;
}
