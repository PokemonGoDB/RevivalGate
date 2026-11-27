// Tonpuusou: R (rate) shared with the PC version, on tongpuso.wgg.channel.or.jp. A port of tonpuusou.py.
//   POST /cgi-bin/getrate.cgi   c=<ID>&d=<password>
//   POST /cgi-bin/setrate.cgi   c=<ID>&d=<password>&e=<rate×100>&f=<games>&g=<games before>
// g = f - 1 (ROM 0x4F7F2): the game count the cart's new rate was computed from, so a resent result
// changes nothing and an out-of-order one never moves the count backwards.
// Reply lines: c=1 (OK; anything else = authentication failed), e=<rate>, f=<games>.
// An unknown ID is registered on first use with its password; new players start at R1500.00.
//
// The 全国ヤクマンランキング is a separate request in Bandai's swan-ranking style (builder ROM 0x4EA13, reply
// parser 0xA1D4D); tonpuusou.py has the format:
//   POST /swan-ranking   *=<serial>&owner=<16 bytes>[&score=<n>%7C<count>%7C]...&list=BEST3%7C1%7C3
import { isOffensive } from '../../../src/lib/wordfilter';
import { bytesOf, hex, jst, latin1, strip, unhex } from './bytes';
import type { Conn } from './env';
import type { Reply } from './http';
import { quota, writeAllowed } from './limits';
import { withState } from './state';

const START_RATE = 150000;
// What the cart takes back (parser 0xA2C30, range check A000:3866; both tried in the game): R2500 or more is
// refused ("レートのあたいがいじょうです") at every download, so that ID could never play again; a rate with
// fewer than three digits isn't read (the cart reads stray RAM in its place); the game count is a 16-bit word.
const RATE_MAX = 249999;
const GAMES_MAX = 0xffff;
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
  if (p) body += `e=${String(Math.min(p.rate, RATE_MAX)).padStart(3, '0')}\r\nf=${Math.min(p.games, GAMES_MAX)}\r\n`;
  return { status: 200, type: 'text/plain', body, note };
}

const KINDS = 15; // yakuman kinds the cart counts and uploads
// The ranking screen draws a kind's count with three digits and the total's with four, and drops the digits
// above them (1000 reads as 0, 65535 as 535; seen in the game), so rows stop there.
const SHOWN = 999;
const SHOWN_TOTAL = 9999;
// The ranking is one D1 row (state.ts): about 130 bytes a player, so this many stay well under its limit. Past
// it, the player with the fewest yakuman goes.
const MAX_YAKUMAN_PLAYERS = 3000;
interface Yakuman { players: Record<string, { owner: string; counts: number[]; updated?: string }> }

/** The national yakuman ranking: keep this player's counts, send back the top 3 of each kind and of the total. */
async function yakuman(conn: Conn, raw: Uint8Array): Promise<Reply> {
  const body = latin1(raw);
  const serial = /^\*=([0-9A-Za-z]{1,8})/.exec(body);
  const at = body.indexOf('&owner=');
  const owner = at >= 0 ? body.slice(at + 7, at + 23) : '';
  const scores = new Map<number, number>();
  for (const m of body.slice(at + 23).matchAll(/&score=(\d{1,2})%7[Cc](\d{1,5})%7[Cc]/g)) scores.set(Number(m[1]), Number(m[2]));
  for (const [n, c] of scores) {
    if (n < 1 || n > KINDS || !c) scores.delete(n);
    else scores.set(n, Math.min(c, 0xffff));
  }
  // The owner goes back to every player inside a '|'-separated line: one that would break the line isn't kept.
  const sound = owner.length === 16 && ![...owner].some((ch) => ch.charCodeAt(0) < 0x20 || ch === '|');
  const store = !!serial && sound && scores.size > 0 && (await writeAllowed(conn));
  return withState<Yakuman, Reply>(conn, 'tonpuusou-yakuman', () => ({ players: {} }), (db) => {
    let note = 'no yakuman yet';
    if (store) {
      const key = `${serial![1].toUpperCase()}:${hex(bytesOf(owner))}`;
      const p = (db.players[key] ??= { owner: hex(bytesOf(owner)), counts: Array(KINDS).fill(0) });
      for (const [n, c] of scores) p.counts[n - 1] = Math.max(p.counts[n - 1], c); // the cart's counts only grow
      const t = jst();
      p.updated = `${t.Y}-${t.m}-${t.d} ${t.H}:${t.M}:${t.S}`;
      note = `${p.counts.reduce((a, b) => a + b, 0)} yakuman of ${p.counts.filter(Boolean).length} kinds`;
      const keys = Object.keys(db.players);
      if (keys.length > MAX_YAKUMAN_PLAYERS) {
        const total = (k: string) => db.players[k].counts.reduce((a, b) => a + b, 0);
        delete db.players[keys.reduce((low, k) => (total(k) < total(low) ? k : low))];
      }
    }
    const players = Object.values(db.players);
    const out: Uint8Array[] = [];
    const line = (text: string, name?: string) => out.push(bytesOf(text), ...(name === undefined ? [] : [unhex(name), bytesOf('|')]), bytesOf('\r\n'));
    let lines = 0;
    for (let table = 0; table <= KINDS; table++) {
      const count = (p: { counts: number[] }) => (table === 0 ? p.counts.reduce((a, b) => a + b, 0) : p.counts[table - 1]);
      const ranked = players.filter((p) => count(p));
      const top = [...ranked].sort((a, b) => count(b) - count(a)).slice(0, 3);
      // The total's course line always goes, rows or not: an empty reply is error 599.
      if (!top.length && table) continue;
      const five = (n: number) => String(n).padStart(5, '0');
      line(`${table === 0 ? 'course=2|01' : `course=1|${String(table).padStart(2, '0')}`}|${ranked.length}|${five(top.length ? count(top[0]) : 0)}`);
      lines++;
      if (!top.length) continue;
      line(` BEST3=${top.length}`);
      top.forEach((p, r) => line(` ${r + 1}|${five(Math.min(count(p), table ? SHOWN : SHOWN_TOTAL))}|`, p.owner));
      lines += 1 + top.length;
    }
    const size = out.reduce((n, b) => n + b.length, 0);
    const data = new Uint8Array(size);
    let o = 0;
    for (const b of out) {
      data.set(b, o);
      o += b.length;
    }
    return { status: 200, type: 'application/x-swan-ranking-response', body: data, note: `tonpuusou yakuman ranking: ${note}; ${lines} lines` };
  });
}

export async function handle(conn: Conn, path: string, raw: Uint8Array): Promise<Reply> {
  if (path === '/swan-ranking') return yakuman(conn, raw);
  // parse_qsl: '+' is a space and %XX is decoded; the last value of a key wins.
  const form: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(strip(latin1(raw), '\r\n\0'))) form[k] = v;
  const pid = form.c ?? '';
  const pw = form.d ?? '';
  if (!pid) return reply(0, null, `tonpuusou ${path}: no ID`);

  // The cart's keypad takes an ID of up to 8 digits and a password of up to 12 letters and digits, and g is
  // at most 5 digits: anything much longer isn't a player.
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
