// Tonpuusou: R (rate) shared with the PC version, on tongpuso.wgg.channel.or.jp. A port of tonpuusou.py.
//   POST /cgi-bin/getrate.cgi   c=<ID>&d=<password>
//   POST /cgi-bin/setrate.cgi   c=<ID>&d=<password>&e=<rate×100>&f=<games>&g=<games before>
// g = f - 1 (ROM 0x4F7F2): the game count the cart's new rate was computed from, so a resent result
// changes nothing and an out-of-order one never moves the count backwards.
// Reply lines: c=1 (OK; anything else = authentication failed), e=<rate>, f=<games>.
// An unknown ID is registered on first use with its password; new players start at R1500.00.
import { isOffensive } from '../../../src/lib/wordfilter';
import { jst, latin1, strip } from './bytes';
import type { Conn } from './env';
import type { Reply } from './http';
import { quota, writeAllowed } from './limits';

const START_RATE = 150000;
const MAX_ID = 16;
const MAX_PASSWORD = 32;
const MAX_G = 8;
const PLAYERS_PER_DAY = 20;
const digits = (v: string | undefined, n: number) => !!v && /^[0-9]+$/.test(v) && v.length <= n;

async function hash(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(d)));
}

interface Player { id: string; password_hash: string; rate: number; games: number; g: string }

function reply(ok: number, p: Player | null, note: string): Reply {
  let body = `c=${ok}\r\n`;
  if (p) body += `e=${p.rate}\r\nf=${p.games}\r\n`;
  return { status: 200, type: 'text/plain', body, note };
}

export async function handle(conn: Conn, path: string, raw: Uint8Array): Promise<Reply> {
  // parse_qsl: '+' is a space and %XX is decoded; the last value of a key wins.
  const form: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(strip(latin1(raw), '\r\n\0'))) form[k] = v;
  const pid = form.c ?? '';
  const pw = form.d ?? '';
  if (!pid) return reply(0, null, `tonpuusou ${path}: no ID`);

  // The cart's ID is 4 characters, its password 5 and g one digit: anything much longer isn't a player.
  if (pid.length > MAX_ID || pw.length > MAX_PASSWORD || (form.g ?? '').length > MAX_G) return reply(0, null, `tonpuusou ${path}: field too long`);

  const db = conn.env.WG_DB;
  const pwHash = await hash(pw);
  let p = await db.prepare('SELECT id, password_hash, rate, games, g FROM tonpuusou_players WHERE id = ?').bind(pid).first<Player>();
  const isNew = !p;
  if (!p) {
    // An unknown ID is a new player: limited per address, like other sign-ups, and shown on the PC page,
    // so it goes through the name filter.
    if (isOffensive(pid)) return reply(0, null, `tonpuusou ${path}: new ID refused (name filter)`);
    if (!(await writeAllowed(conn)) || !(await quota(conn, 'tonpuusou player', PLAYERS_PER_DAY))) return reply(0, null, `tonpuusou ${path}: new ID ${pid} refused (limit)`);
    p = { id: pid, password_hash: pwHash, rate: START_RATE, games: 0, g: '0' };
  } else if (p.password_hash !== pwHash) return reply(0, null, `tonpuusou ${path}: wrong password for ${pid}`);

  const setting = path.endsWith('/setrate.cgi');
  if (setting) {
    if (!(digits(form.e, 6) && digits(form.f, 5))) return reply(0, null, `tonpuusou setrate: bad values`);
    const rate = Number.parseInt(form.e, 10);
    let games = Number.parseInt(form.f, 10);
    // The same result sent again (the reply was lost): nothing to change.
    if (!isNew && rate === p.rate && games === p.games) return reply(1, p, `tonpuusou setrate ${pid}: resent, unchanged`);
    // Computed from an older download (the same ID played on another console in between): keep the
    // result, but never move the game count backwards.
    if (/^[0-9]+$/.test(form.g ?? '') && Number.parseInt(form.g, 10) !== p.games) games = Math.max(games, p.games + 1);
    p = { ...p, rate, games, g: form.g ?? '' };
  } else if (!path.endsWith('/getrate.cgi')) {
    return { status: 404, type: 'text/plain', body: 'not found\r\n', note: `tonpuusou: unknown ${path}` };
  }
  await db
    .prepare(
      `INSERT INTO tonpuusou_players (id, password_hash, rate, games, g, updated) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET rate = excluded.rate, games = excluded.games, g = excluded.g,
         updated = COALESCE(excluded.updated, updated)`
    )
    // Only an upload counts as an update (shown on the PC page).
    .bind(p.id, p.password_hash, p.rate, p.games, p.g, setting ? Math.floor(Date.now() / 1000) : null)
    .run();
  return reply(1, p, `tonpuusou ${path} ${pid}${isNew ? ' (new)' : ''}: R${(p.rate / 100).toFixed(2)}, ${p.games} games`);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

/** The PC side: the original shared each ID's R with the Windows Tonpuusou. That client is gone, so a PC
 * browser gets this table of the cartridge players instead (never the passwords). */
export async function page(conn: Conn): Promise<Reply> {
  const { results } = await conn.env.WG_DB.prepare('SELECT id, rate, games, updated FROM tonpuusou_players ORDER BY rate DESC, rowid').all<{
    id: string;
    rate: number;
    games: number;
    updated: number | null;
  }>();
  const when = (t: number | null) => {
    if (t === null) return '';
    const d = jst(new Date(t * 1000));
    return `${d.Y}-${d.m}-${d.d} ${d.H}:${d.M}:${d.S}`;
  };
  const body = results
    .map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.id)}</td><td>${(p.rate / 100).toFixed(2)}</td><td>${p.games}</td><td>${when(p.updated)}</td></tr>`)
    .join('');
  const doc = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>東風荘 R ranking</title>
<style>body{font-family:sans-serif;margin:16px}table{border-collapse:collapse}
td,th{border:1px solid #999;padding:4px 8px;text-align:right}</style></head><body>
<h1>東風荘 WonderSwan R</h1>
<p>Ratings uploaded from the WonderSwan cartridge's ランキング対戦 (${results.length} players).</p>
<table><tr><th>#</th><th>ID</th><th>R</th><th>Games</th><th>Updated</th></tr>${body}</table>
</body></html>`;
  return { status: 200, type: 'text/html; charset=utf-8', body: new TextEncoder().encode(doc), note: `tonpuusou page (${results.length} players)` };
}
