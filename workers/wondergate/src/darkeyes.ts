// Dark Eyes: Battle Gate (Bandai 2001): online battles on battleg1.dark-eyes.com. A port of darkeyes.py.
//   POST /cgi-bin/dark/nph-<name>.cgi   fields in X-SWAN-<NAME> headers; replies end lines in a bare LF.
// The server pairs two players polling nph-reqmatch (same PASS, if one is set) and relays their party
// and turn data (two queues per side); the battles run in the cartridges. Matchmaking state lives in
// D1 with versioned updates, so two players polling at once are paired exactly once.
//
// Story mode, a guild's 傭兵の登録と雇用 (mercenaries) and 世界情勢 (world market):
//   nph-upmrcnry   MCUP-ID PAY NAME CLASS LVL ... HP -> MCUP-RETCD, MCUP-MID (8 chars)
//   nph-listmrcnry MCDL-ID CLASS LVL -> MCDL-RETCD, MCDL-NO n, body n x 49-byte records
//   nph-downmrcnry MCDN-ID MID       -> MCDN-RETCD (1 + SJIS message: withdrawn)
//   nph-worldinfo  WINF-ID NAME MID MRID0 MRID1 + body (market block etc.) -> WINF-RETCD + body
// Their state ('darkeyes-world') is separate from matchmaking's, which is polled every second.
import { isOffensive } from '../../../src/lib/wordfilter';
import { bytesOf, concat, hex, jst, latin1, randomInt, sjisText, unhex } from './bytes';
import { DARKEYES_MERC_GONE } from './encoded';
import type { Conn } from './env';
import type { Reply } from './http';
import { quota, writeAllowed } from './limits';
import { withState } from './state';

const GROUPS: Record<string, string> = {
  'nph-login.cgi': 'SRVC', 'nph-account.cgi': 'ACNT', 'nph-upmrcnry.cgi': 'MCUP', 'nph-listmrcnry.cgi': 'MCDL',
  'nph-downmrcnry.cgi': 'MCDN', 'nph-worldinfo.cgi': 'WINF', 'nph-reqmatch.cgi': 'MTCH', 'nph-match.cgi': 'MTCH'
};
const HOST = 'battleg1.dark-eyes.com';
const PATH = '/cgi-bin/dark/nph-match.cgi';
const POLL = 1;
const TIMEOUT = 60;
const STALE = 10;
// Limits that keep the shared state small (real parties are 480 bytes, turns about 20, and each side
// collects its queue every second): a battle nobody has polled for 10 minutes is dropped. The state is
// one D1 row that every poll rewrites, so the number of players waiting and battling is capped too
// (the longest-idle go first), as is what can be queued for one player: a party and a few turns. The
// queue budget is in JSON characters, since that's what the row holds (a control byte takes six).
const MATCH_IDLE = 600;
const MAX_POST = 1024;
const MAX_QUEUE = 16;
const MAX_QUEUED = 4096;
const MAX_WAITING = 100;
const MAX_MATCHES = 100; // players in battles: 50 battles, at most about 450 KB
// Header fields kept in the state (the cart sends 6-8 characters; names are URL-encoded SJIS).
const MAX_FIELD: Record<string, number> = { id: 16, name: 64, lvl: 8, pass: 32 };

interface Info { id: string; name: string; lvl: string; pass: string; seen: number }
interface Match { opp: string; info: Info; seed: number; side: number; inbox: string[]; turns: string[]; announced?: boolean; seen?: number }
interface State { waiting: Record<string, Info>; matches: Record<string, Match> }

const keyOf = (h: Record<string, string>) => JSON.stringify([h['x-swan-mtch-id'] ?? '', h['x-swan-mtch-name'] ?? '']);
const poll = () => ({ 'X-SWAN-MTCH-POLINT': String(POLL), 'X-SWAN-MTCH-TIMEOUT': String(TIMEOUT) });

function matched(m: Match): Record<string, string> {
  const o = m.info;
  return {
    'X-SWAN-MTCH-RETCD': '2', 'X-SWAN-MTCH-ID': o.id, 'X-SWAN-MTCH-NAME': o.name, 'X-SWAN-MTCH-LVL': o.lvl,
    'X-SWAN-MTCH-SEED': String(m.seed), 'X-SWAN-MTCH-MATCH': String(m.side), 'X-SWAN-MTCH-HOST': HOST,
    'X-SWAN-MTCH-PATH': PATH, 'X-SWAN-MTCH-ACOUNT': '0', 'X-SWAN-MTCH-BCOUNT': '0', 'X-SWAN-MTCH-COUNT': '0',
    ...poll()
  };
}

/** Whether the player's matchmaking headers fit what the state keeps. */
const fits = (h: Record<string, string>) => Object.entries(MAX_FIELD).every(([k, n]) => (h[`x-swan-mtch-${k}`] ?? '').length <= n);

/** Drop the entries that have gone longest without a poll until at most `max` are left. */
function keepNewest<T>(entries: Record<string, T>, max: number, seen: (v: T) => number, drop: (key: string) => void) {
  const keys = Object.keys(entries);
  if (keys.length <= max) return;
  for (const k of keys.sort((a, b) => seen(entries[a]) - seen(entries[b])).slice(0, keys.length - max)) drop(k);
}

const queued = (m: Match) => JSON.stringify(m.inbox).length + JSON.stringify(m.turns).length;

function reqmatch(state: State, h: Record<string, string>): [Record<string, string>, string] {
  const me = keyOf(h);
  if (!fits(h)) return [{ 'X-SWAN-MTCH-RETCD': '9' }, `reqmatch: refused (header too long)`];
  const now = Date.now() / 1000;
  const m = state.matches[me];
  if (m && !m.announced) {
    m.announced = true;
    return [matched(m), `reqmatch ${me}: matched with ${m.opp}`];
  }
  delete state.matches[me];
  for (const [k, w] of Object.entries(state.waiting)) if (now - w.seen > STALE) delete state.waiting[k];
  const pw = h['x-swan-mtch-pass'] ?? '';
  const other = Object.keys(state.waiting).find((k) => k !== me && state.waiting[k].pass === pw);
  const [id, name] = JSON.parse(me) as [string, string];
  const mine: Info = { id, name, lvl: h['x-swan-mtch-lvl'] ?? '1', pass: pw, seen: now };
  if (other === undefined) {
    state.waiting[me] = mine;
    keepNewest(state.waiting, MAX_WAITING, (w) => w.seen, (k) => delete state.waiting[k]);
    return [{ 'X-SWAN-MTCH-RETCD': '1', ...poll() }, `reqmatch ${me}: waiting`];
  }
  const them = state.waiting[other];
  delete state.waiting[other];
  delete state.waiting[me];
  const seed = randomInt(0, 65536);
  // Room for two more: drop whole battles, longest-idle first.
  keepNewest(state.matches, MAX_MATCHES - 2, (m) => m.seen ?? 0, (k) => {
    if (state.matches[k]) delete state.matches[state.matches[k].opp];
    delete state.matches[k];
  });
  state.matches[other] = { opp: me, info: mine, seed, side: 0, inbox: [], turns: [], seen: now };
  state.matches[me] = { opp: other, info: them, seed, side: 1, inbox: [], turns: [], announced: true, seen: now };
  return [matched(state.matches[me]), `reqmatch ${me}: matched with ${other} (seed ${seed})`];
}

function match(state: State, h: Record<string, string>, body: string): [Record<string, string>, string, string] {
  const me = keyOf(h);
  const cmd = h['x-swan-mtch-cmd'] ?? '';
  const m = state.matches[me];
  const opp = m ? state.matches[m.opp] : undefined;
  if (!m || !opp) return [{ 'X-SWAN-MTCH-RETCD': '9' }, '', `match ${me} cmd ${cmd}: no match`];
  m.seen = Date.now() / 1000;
  if (
    (cmd === '0' || cmd === '2') &&
    (body.length > MAX_POST || (cmd === '0' ? opp.inbox : opp.turns).length >= MAX_QUEUE || queued(opp) + JSON.stringify(body).length > MAX_QUEUED)
  ) {
    return [{ 'X-SWAN-MTCH-RETCD': '9' }, '', `match ${me} cmd ${cmd}: refused ${body.length} bytes (limit)`];
  }
  if (cmd === '0') {
    opp.inbox.push(body);
    return [{ 'X-SWAN-MTCH-RETCD': '0', ...poll() }, '', `match ${me} cmd 0: posted ${body.length} bytes`];
  }
  if (cmd === '1') {
    if (m.inbox.length) {
      const data = m.inbox.shift()!;
      return [{ 'X-SWAN-MTCH-RETCD': '2', ...poll() }, data, `match ${me} cmd 1: delivered ${data.length} bytes`];
    }
    return [{ 'X-SWAN-MTCH-RETCD': '1', ...poll() }, '', `match ${me} cmd 1: nothing yet`];
  }
  if (cmd === '2') {
    opp.turns.push(body);
    return [{ 'X-SWAN-MTCH-RETCD': '3', ...poll() }, '', `match ${me} cmd 2: turn posted (${body.length} bytes)`];
  }
  if (cmd === '3') {
    if (m.turns.length) {
      const data = m.turns.shift()!;
      return [{ 'X-SWAN-MTCH-RETCD': '5', ...poll() }, data, `match ${me} cmd 3: turn delivered (${data.length} bytes)`];
    }
    return [{ 'X-SWAN-MTCH-RETCD': '4', ...poll() }, '', `match ${me} cmd 3: nothing yet`];
  }
  return [{ 'X-SWAN-MTCH-RETCD': '9' }, '', `match ${me}: unknown cmd ${cmd}`];
}

/** Drop battles that neither side has polled for a while (abandoned mid-battle). */
function prune(state: State) {
  const now = Date.now() / 1000;
  for (const [k, m] of Object.entries(state.matches)) if (now - (m.seen ?? 0) > MATCH_IDLE) delete state.matches[k];
}

// ---------- mercenaries and the world market ----------

const MAX_LIST = 40; // the cart's list arrays hold 40 entries (SRAM 0x3DA9, 40 x 47 bytes)
const MARKET = 0x3c0; // 15 towns x 64 goods, price level per byte; bit 7 = changed locally
// A list record (parser 5900:2AC1) -> the cart's 47-byte roster record:
//   +0 year (word)  +2 month  +3 day  (shown as the registration date)
//   +4 MID (8 chars)  +12 PAY (word)  +14 name (16, space padded)
//   +30.. the uploaded fields below, one byte each, then HP (word)
const STATS = ['class', 'lvl', 'exp', 'str', 'dex', 'int', 'atr', 'em', 'ry', 'sk0', 'sk1', 'sk2', 'sk3', 'it0', 'it1', 'it2', 'it3'] as const;
// Who is on each connection: worldinfo (sent before an upload in every session) carries the player's
// ID and hero name; uploads don't. Keyed by a hash of the player's address; forgotten after a day.
const SESSION_TTL = 86400;
// The world is one D1 row too: about 400 bytes a mercenary and 150 a session, so these keep it under
// 600 KB. The oldest mercenaries (lowest MID) and the longest-idle sessions go first.
const MAX_MERCS = 1000;
const MAX_SESSIONS = 1000;
// Mercenaries registered per address per day (the cart holds one; re-registering replaces it).
const MERCS_PER_DAY = 30;

type Merc = { owner: string; owner_key: string; owner_name: string; pay: number; name: string; hp: number; date: [number, number, number]; hired?: number } & Record<
  (typeof STATS)[number],
  number
>;
interface World {
  mercs: Record<string, Merc>;
  next: number;
  market: string | null;
  earned: Record<string, number>;
  sessions: Record<string, { owner: string; seen: number }>;
  /** Each player's last uploaded battle counters (running totals from the save). */
  battle_counts?: Record<string, { counts: number[]; seen: number }>;
  /** New random battles per region, and who fought them, by day (yyyy-mm-dd, JST). */
  battle_days?: Record<string, { regions: number[]; players: string[] }>;
}
const freshWorld = (): World => ({ mercs: {}, next: 1, market: null, earned: {}, sessions: {}, battle_counts: {}, battle_days: {} });

/** Python's int(): an optional sign and digits, else the default. */
function num(h: Record<string, string>, key: string, dflt = 0): number {
  const v = h[key];
  if (v === undefined) return dflt;
  return /^\s*[+-]?\d+(?:_\d+)*\s*$/.test(v) ? Number.parseInt(v.replace(/_/g, ''), 10) : dflt;
}

/** urllib.parse.unquote_to_bytes: %XX to bytes, the rest as UTF-8. */
function unquoteBytes(s: string): Uint8Array {
  const raw = new TextEncoder().encode(s);
  const out: number[] = [];
  const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x25 && i + 2 < raw.length && isHex(raw[i + 1]) && isHex(raw[i + 2])) {
      out.push(Number.parseInt(String.fromCharCode(raw[i + 1], raw[i + 2]), 16));
      i += 2;
    } else out.push(raw[i]);
  }
  return new Uint8Array(out);
}

/** struct.pack("<H"), which refuses values out of range (the request then fails, as in Python). */
function word(v: number): Uint8Array {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new Error(`darkeyes: ${v} does not fit a word`);
  return new Uint8Array([v & 0xff, v >> 8]);
}

const ownerOf = (w: World, peer: string) => w.sessions[peer]?.owner ?? '';

/** The hero name part of an owner key, as cartridge bytes (half-width kana). */
const ownerName = (owner: string) => (owner ? hex(unquoteBytes(owner.slice(owner.indexOf('/') + 1))) : '');

/** The cart holds one registered mercenary (MID at SRAM 0x6070): any other one from the same owner
 * is stale (withdrawn or replaced). */
function dropOwned(w: World, owner: string, keep: string | null): string[] {
  if (!owner) return [];
  const gone = Object.keys(w.mercs).filter((mid) => w.mercs[mid].owner_key === owner && mid !== keep);
  for (const mid of gone) delete w.mercs[mid];
  return gone;
}

type Result = [Record<string, string>, Uint8Array, string];

/** A mercenary's name as cartridge bytes, up to the NUL (only the first 16 are ever sent back). */
function mercName(h: Record<string, string>): Uint8Array {
  const name = unquoteBytes(h['x-swan-mcup-name'] ?? '');
  const z = name.indexOf(0);
  return (z >= 0 ? name.subarray(0, z) : name).subarray(0, 16);
}

/** Why an upload can't be stored, before touching the state: fields longer than the cart sends (numbers of
 * 1-3 digits, a name of 6 characters), a pay that doesn't fit the list record's word (which would break
 * the list for everyone), or an offensive name. */
function mercRefused(h: Record<string, string>): string | null {
  for (const [k, v] of Object.entries(h)) if (k.startsWith('x-swan-mcup-') && v.length > (k === 'x-swan-mcup-name' ? 64 : 16)) return `${k} too long`;
  const pay = num(h, 'x-swan-mcup-pay');
  if (!Number.isInteger(pay) || pay < 0 || pay > 0xffff) return `pay ${pay}`;
  if (isOffensive(sjisText(mercName(h)))) return 'name filter';
  return null;
}

/** Keep the newest `max` keys of a record whose keys are zero-padded numbers. */
function keepHighest(entries: Record<string, unknown>, max: number) {
  const keys = Object.keys(entries);
  if (keys.length > max) for (const k of keys.sort().slice(0, keys.length - max)) delete entries[k];
}

function upmrcnry(w: World, h: Record<string, string>, peer: string): Result {
  const owner = ownerOf(w, peer);
  // Every session sends worldinfo first; without it the upload has no owner, so nothing would replace
  // it next time.
  if (!owner) return [{ 'X-SWAN-MCUP-RETCD': '9' }, new Uint8Array(0), 'upmrcnry: refused (no worldinfo from this player)'];
  dropOwned(w, owner, null);
  const mid = String(w.next).padStart(8, '0');
  w.next++;
  const t = jst();
  const m = {
    owner: (h['x-swan-mcup-id'] ?? '').slice(0, 16), owner_key: owner, owner_name: ownerName(owner), pay: num(h, 'x-swan-mcup-pay'),
    name: hex(mercName(h)), hp: num(h, 'x-swan-mcup-hp'), date: [t.year, t.month, t.day]
  } as Merc;
  for (const k of STATS) m[k] = num(h, `x-swan-mcup-${k}`);
  w.mercs[mid] = m;
  keepHighest(w.mercs, MAX_MERCS);
  return [{ 'X-SWAN-MCUP-RETCD': '0', 'X-SWAN-MCUP-MID': mid }, new Uint8Array(0), `upmrcnry: registered ${mid} (class ${m.class}, lv ${m.lvl}, pay ${m.pay})`];
}

function record(mid: string, m: Merc): Uint8Array {
  const [y, mo, d] = m.date;
  const name = new Uint8Array(16).fill(0x20);
  name.set(unhex(m.name).subarray(0, 16));
  const id = new Uint8Array(8).fill(0x30);
  id.set(bytesOf(mid).subarray(0, 8));
  return concat(word(y), new Uint8Array([mo, d]), id, word(m.pay), name, new Uint8Array(STATS.map((k) => m[k] & 0xff)), word(m.hp & 0xffff));
}

function listmrcnry(w: World, h: Record<string, string>): Result {
  const cls = num(h, 'x-swan-mcdl-class', -1);
  const lvl = num(h, 'x-swan-mcdl-lvl', 1);
  const found = Object.entries(w.mercs)
    .filter(([, m]) => m.class === cls)
    .sort(([a, ma], [b, mb]) => Math.abs(ma.lvl - lvl) - Math.abs(mb.lvl - lvl) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_LIST);
  if (!found.length) {
    // MCDL-NO 0 makes the cart say 選択したクラスの傭兵が1人もいません; it wants a body.
    return [{ 'X-SWAN-MCDL-RETCD': '0', 'X-SWAN-MCDL-NO': '0' }, new Uint8Array(1), `listmrcnry: class ${cls}: none`];
  }
  const body = concat(...found.map(([mid, m]) => record(mid, m)));
  return [{ 'X-SWAN-MCDL-RETCD': '0', 'X-SWAN-MCDL-NO': String(found.length) }, body, `listmrcnry: class ${cls} lv ${lvl}: ${found.length}`];
}

function downmrcnry(w: World, h: Record<string, string>): Result {
  const mid = (h['x-swan-mcdn-mid'] ?? '').slice(0, 8);
  const m = Object.hasOwn(w.mercs, mid) ? w.mercs[mid] : undefined;
  if (!m) return [{ 'X-SWAN-MCDN-RETCD': '1' }, bytesOf(DARKEYES_MERC_GONE), `downmrcnry ${mid}: gone`];
  m.hired = (m.hired ?? 0) + 1;
  w.earned[mid] = (w.earned[mid] ?? 0) + m.pay;
  // Pay waits for its owner's next worldinfo; owners who never come back don't keep it forever.
  keepHighest(w.earned, MAX_MERCS);
  return [{ 'X-SWAN-MCDN-RETCD': '0' }, new Uint8Array(0), `downmrcnry ${mid}: hired (owner earns ${m.pay})`];
}

// 世界情勢, what the server announces each period (our schedule; the original's is lost):
//   C1 (SRAM 0x6031): the world event. ジュリア's script (ROM 0x20CDB6) runs event 0-9 once per
//      save (marks bit n of the word at 0x602F); scripts in bank 0x27 (0x277ACD..) switch map flags
//      for the larger values. We step weekly.
//   C2, C3 (0x6032/33): the region with the most and the fewest random battles. Random-encounter
//      earnings there are x1/2 and x5/4 (ROM 0x3686A7, on the ELD at 0x4A08 when [0x298] = 0xFF,
//      region [0x274] = 0-7); shop prices don't change; 0xFF = none. The cart uploads its
//      per-region battle counts with every worldinfo; we tally them from all players
//      (battleRegions): the bonus region from a small sample, the halved one only once several
//      players fight; FF until then. As darkeyes.battle_regions.
//   names (+0xC4, 3 x 16 bytes): players whose names go on places ("@6の沼" instead of
//      ピラニアンの沼, op 0x74). We use the three most-hired mercenary owners.
const WORLD_EVENTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x21, 0x29, 0x33, 0x3b, 0x43, 0x51, 0x59, 0x6b, 0x6d, 0x73];
const CAMPAIGN_START = Date.UTC(2026, 9, 5);
const mod = (a: number, n: number) => ((a % n) + n) % n;
const REGIONS = 8; // battle counters: 8 words at SRAM 0x601B, region [0x274]
// Few people play this game, so the two sides switch on separately: the bonus region (+25%) only
// rewards, so it starts with a small sample from anyone; the halved region waits for a real crowd.
const REGION_WINDOW = 30; // days of battles that pick the regions (the days before today)
const BOOM_MIN_BATTLES = 20;
const SLUMP_MIN_PLAYERS = 3;
const SLUMP_MIN_BATTLES = 50;
const MAX_PLAYERS_PER_DAY = 1000;

/** The JST date n days before today, yyyy-mm-dd. */
function isoDay(n = 0): string {
  const t = jst();
  return new Date(Date.UTC(t.year, t.month - 1, t.day - n)).toISOString().slice(0, 10);
}

/** Add a player's new random battles per region (running totals kept in the save; a smaller total
 * means a new save, counted from zero). */
function recordBattles(w: World, owner: string, counts: number[]): number {
  const all = (w.battle_counts ??= {});
  const days = (w.battle_days ??= {});
  const total = (c: number[]) => c.reduce((a, b) => a + b, 0);
  let last = all[owner]?.counts;
  if (!last || total(counts) < total(last) || counts.some((c, i) => c < last![i])) last = new Array(REGIONS).fill(0);
  const fresh = counts.map((c, i) => c - last![i]);
  all[owner] = { counts, seen: Date.now() / 1000 };
  keepNewest(all, MAX_SESSIONS, (v) => v.seen, (k) => delete all[k]);
  if (fresh.some((n) => n)) {
    const day = (days[isoDay()] ??= { regions: new Array(REGIONS).fill(0), players: [] });
    day.regions = day.regions.map((n, i) => n + fresh[i]);
    if (!day.players.includes(owner) && day.players.length < MAX_PLAYERS_PER_DAY) day.players.push(owner);
  }
  const cutoff = isoDay(REGION_WINDOW + 1);
  for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
  return total(fresh);
}

/** (most, fewest) random battles by region over the REGION_WINDOW days before today; 0xFF where
 * there isn't enough to go on. The fewest is picked among regions someone fought in, never the
 * busiest one. Ties go to the lower region number. */
function battleRegions(w: World): [number, number] {
  const days = Array.from({ length: REGION_WINDOW }, (_, n) => w.battle_days?.[isoDay(n + 1)]).filter((d) => d !== undefined);
  const totals = Array.from({ length: REGIONS }, (_, r) => days.reduce((a, d) => a + d.regions[r], 0));
  const players = new Set(days.flatMap((d) => d.players));
  const sum = totals.reduce((a, b) => a + b, 0);
  const fought = totals.flatMap((n, r) => (n ? [r] : []));
  if (!fought.length) return [0xff, 0xff];
  let most = fought.reduce((a, r) => (totals[r] > totals[a] ? r : a));
  const quiet = fought.filter((r) => r !== most);
  const fewest = quiet.length && sum >= BOOM_MIN_BATTLES ? quiet.reduce((a, r) => (totals[r] < totals[a] ? r : a)) : 0xff;
  if (players.size < SLUMP_MIN_PLAYERS || sum < SLUMP_MIN_BATTLES) most = 0xff;
  return [most, fewest];
}

function worldState(w: World): [number, number, number, Uint8Array[]] {
  const t = jst();
  const days = Math.round((Date.UTC(t.year, t.month - 1, t.day) - CAMPAIGN_START) / 86400_000);
  const c1 = WORLD_EVENTS[mod(Math.floor(days / 7), WORLD_EVENTS.length)];
  const [c2, c3] = battleRegions(w);
  const fame = new Map<string, number>();
  for (const m of Object.values(w.mercs)) if (m.owner_name) fame.set(m.owner_name, (fame.get(m.owner_name) ?? 0) + (m.hired ?? 0));
  const names = [...fame]
    .sort((a, b) => b[1] - a[1])
    // These go on every player's map: never an offensive name.
    .filter(([n, c]) => c > 0 && !isOffensive(sjisText(unhex(n))))
    .slice(0, 3)
    .map(([n]) => unhex(n));
  return [c1, c2, c3, names];
}

/** Request body (5900:2F83): 16 + 4 + 1 bytes of player state, the market block (SRAM 0x6278), a
 * word (SRAM 0x602F), a checksum byte (sum of the rest). Reply body (5900:30C0): 2 bytes
 * (0x6032/33), the market block, a word added to the player's money (0x5FF6, saturating), 1 byte
 * (0x6031), the word, three 16-byte names (read when the body is 0x3F8+ bytes), the checksum. */
function worldinfo(w: World, h: Record<string, string>, body: Uint8Array, peer: string): Result {
  const sum = (b: Uint8Array) => b.reduce((n, x) => n + x, 0) & 0xff;
  const market = w.market ? unhex(w.market) : new Uint8Array(MARKET).fill(0x30);
  const note: string[] = [];
  let wd: Uint8Array = new Uint8Array(2);
  if (body.length >= 21 + MARKET + 3 && sum(body.subarray(0, -1)) === body[body.length - 1]) {
    const mine = body.subarray(21, 21 + MARKET);
    wd = body.slice(21 + MARKET, 23 + MARKET);
    let changed = 0;
    mine.forEach((b, i) => {
      if (b & 0x80) {
        market[i] = b & 0x7f;
        changed++;
      }
    });
    note.push(`${changed} prices changed`);
    // The first 16 bytes are the cart's battle counters (8 regions, little-endian words).
    const owner = `${h['x-swan-winf-id'] ?? ''}/${h['x-swan-winf-name'] ?? ''}`;
    if (owner.length <= 81) {
      const counts = Array.from({ length: REGIONS }, (_, r) => body[2 * r] | (body[2 * r + 1] << 8));
      const battles = recordBattles(w, owner, counts);
      if (battles) note.push(`${battles} new battles`);
    }
  } else if (body.length) {
    note.push(`bad body (${body.length} bytes)`);
  }
  w.market = hex(market);
  // The cart sends an 8-character ID and a 6-character name; longer ones aren't kept (this player can't
  // register a mercenary).
  const sized = (h['x-swan-winf-id'] ?? '').length <= 16 && (h['x-swan-winf-name'] ?? '').length <= 64;
  const owner = sized ? `${h['x-swan-winf-id'] ?? ''}/${h['x-swan-winf-name'] ?? ''}` : '';
  const now = Date.now() / 1000;
  for (const [k, v] of Object.entries(w.sessions)) if (now - v.seen > SESSION_TTL) delete w.sessions[k];
  if (owner) {
    w.sessions[peer] = { owner, seen: now };
    keepNewest(w.sessions, MAX_SESSIONS, (s) => s.seen, (k) => delete w.sessions[k]);
  }
  const mid = (h['x-swan-winf-mid'] ?? '').slice(0, 8);
  let gone: string[] = [];
  if (owner && 'x-swan-winf-mid' in h) {
    // 00000000 = the player withdrew their mercenary (解除, offline); a real MID is their current
    // one, so any other of theirs is stale.
    gone = dropOwned(w, owner, mid === '00000000' ? null : mid);
    if (gone.length) note.push(`withdrawn ${gone.join(', ')}`);
  }
  let pay = 0;
  // Only the owner collects a mercenary's pay (anyone can send any MID).
  const own = owner && Object.hasOwn(w.mercs, mid) && w.mercs[mid].owner_key === owner ? [mid] : [];
  for (const m of [...own, ...gone]) {
    if (!m || m === '00000000' || !Object.hasOwn(w.earned, m)) continue;
    pay += w.earned[m];
    delete w.earned[m];
  }
  pay = Math.min(pay, 0xffff);
  if (pay) note.push(`pays ${pay}`);
  for (const k of ['x-swan-winf-mrid0', 'x-swan-winf-mrid1']) if (h[k]) note.push(`contract over: ${h[k]}`);
  const [c1, c2, c3, names] = worldState(w);
  const padded = [0, 1, 2].map((i) => {
    const n = new Uint8Array(16);
    if (names[i]) n.set(names[i].subarray(0, 16));
    return n;
  });
  const data = concat(new Uint8Array([c2, c3]), market, word(pay), new Uint8Array([c1]), wd, ...padded);
  const h2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  note.push(`event ${c1}, regions ${h2(c2)}/${h2(c3)}, names ${names.length}`);
  return [{ 'X-SWAN-WINF-RETCD': '0' }, concat(data, new Uint8Array([sum(data)])), `worldinfo: ${note.join(', ')}`];
}

const WORLD: Record<string, (w: World, h: Record<string, string>, body: Uint8Array, peer: string) => Result> = {
  'nph-upmrcnry.cgi': (w, h, _b, peer) => upmrcnry(w, h, peer),
  'nph-listmrcnry.cgi': (w, h) => listmrcnry(w, h),
  'nph-downmrcnry.cgi': (w, h) => downmrcnry(w, h),
  'nph-worldinfo.cgi': worldinfo
};

async function peerKey(peer: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`darkeyes:${peer}`));
  return hex(new Uint8Array(d).subarray(0, 12));
}

export async function handle(conn: Conn, path: string, headers: Record<string, string>, raw: Uint8Array): Promise<Reply> {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const fresh = (): State => ({ waiting: {}, matches: {} });
  let h: Record<string, string>;
  let data: Uint8Array | string = '';
  let note: string;
  if (name === 'nph-reqmatch.cgi') {
    [h, note] = await withState(conn, 'darkeyes', fresh, (state) => (prune(state), reqmatch(state, headers)));
  } else if (name === 'nph-match.cgi') {
    [h, data, note] = await withState(conn, 'darkeyes', fresh, (state) => match(state, headers, latin1(raw)));
  } else if (Object.hasOwn(WORLD, name)) {
    // Registering and hiring are limited per address; a refused upload gets an error code, a refused
    // hire the "withdrawn" message.
    if (name === 'nph-upmrcnry.cgi') {
      const why = mercRefused(headers) ?? (!(await writeAllowed(conn)) || !(await quota(conn, 'darkeyes mercenary', MERCS_PER_DAY)) ? 'limit' : null);
      if (why) return { status: 200, type: null, body: '', note: `darkeyes upmrcnry: refused (${why})`, headers: { 'X-SWAN-MCUP-RETCD': '9' }, lf: true };
    } else if (name === 'nph-downmrcnry.cgi' && !(await writeAllowed(conn))) {
      return { status: 200, type: null, body: bytesOf(DARKEYES_MERC_GONE), note: 'darkeyes downmrcnry: refused (limit)', headers: { 'X-SWAN-MCDN-RETCD': '1' }, lf: true };
    }
    const peer = await peerKey(conn.peer);
    [h, data, note] = await withState(conn, 'darkeyes-world', freshWorld, (w) => WORLD[name](w, headers, raw, peer));
  } else {
    const group = Object.hasOwn(GROUPS, name) ? GROUPS[name] : undefined;
    if (!group) return { status: 404, type: 'text/plain', body: 'not found\n', note: `darkeyes: unknown ${name}`, lf: true };
    h = { [`X-SWAN-${group}-RETCD`]: '0' };
    if (name === 'nph-login.cgi') {
      const t = jst();
      h['X-SWAN-SRVC-TIME'] = `${t.Y}${t.m}${t.d}${t.H}${t.M}${t.S}`;
    }
    note = name;
  }
  return { status: 200, type: null, body: data, note: `darkeyes ${note}`, headers: h, lf: true };
}
