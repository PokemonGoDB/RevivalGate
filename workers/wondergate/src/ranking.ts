// Bandai "swan-ranking" service: a port of WonderswanCartDumper/wondergate/server/swan_ranking.py.
// Request (form POST, values not URL-encoded by the games):
//   *=<id>&owner=<name>&score=<course>|<score>[|<extra>]...[&list=<name>|<start>|<count>]
// Per-game details are in that repo's docs/wondergate/<game>.md. Keep the two in step:
// scripts/wg-conformance.mjs compares them byte for byte.
import { isOffensive } from '../../../src/lib/wordfilter';
import { isDigits, jst, latin1, strip } from './bytes';
import type { Conn } from './env';
import type { Reply } from './http';
import { writeAllowed } from './limits';

export const CONTENT_TYPE = 'application/x-swan-ranking-response';

// ---------- sort orders ----------

/** How a course ranks: by the score as a number, higher or lower first, or as text, lowest first
 * (Buffers Evolution's fixed-width times). */
export type Order = 'high' | 'low' | 'text';

const int = (s: string | null | undefined) => (s ? Number.parseInt(s, 10) || 0 : 0);
/** GunPey EX Puzzle: SSS 1 MM ss = stage, a flag, 100 - minutes, 60 - seconds (row display ROM
 * 0xFCD22), so a plain higher-is-better sort is right. A fresh save uploads 00010060 (100:00, "no
 * record"); send it back as zeros so the game shows "--:--" instead of a blank-minute "0:00". */
const gunpeyPuzzle = (s: string) => (s.slice(-5) === '10060' && int(s.slice(0, -5)) === 0 ? '00000000' : s);

/** Whether score a ranks strictly above b. */
function better(order: Order, a: string, b: string): boolean {
  if (order === 'text') return a < b;
  return order === 'high' ? int(a) > int(b) : int(a) < int(b);
}

// Scores are digit strings of at most MAX_SCORE digits, so SQLite's integer and JavaScript's number agree.
const SQL_ORDER: Record<Order, string> = { high: 'CAST(score AS INTEGER) DESC', low: 'CAST(score AS INTEGER)', text: 'score' };

// ---------- per-game settings (see swan_ranking.py GAMES) ----------

interface Cfg {
  courses: number;
  maxRows: number;
  nameMax: number;
  /** false, true (GunPey EX's date/info/group lines) or a function giving header lines */
  header: boolean | ((game: string) => string[]);
  countMax: number;
  /** course -> [divisor, digits]; 'default' for the rest */
  score: Record<number | 'default', [number, number]>;
  group: number;
  /** course -> f(score digits) -> digits sent back */
  replyFmt?: Record<number, (digits: string) => string>;
  /** course -> order; 'high' for the rest */
  rankKey?: Record<number, Order>;
  /** The groups a score may be stored under (default [1]); others are answered but not stored. */
  groups?: number[];
  courseFmt?: (v: { g: number; n: number; entrants: number; top: string; mine: string; rank: number }) => string;
  nameFmt?: (owner: string) => string;
  emptyName?: string;
  rowPrefix?: string;
  /** Byte budget for the reply body when a "+N" count asks for the rows ahead of the player
   * (Sennou Millennium's receive buffer holds 0x37F bytes with the HTTP header). */
  maxBody?: number;
  coursesPerGroup?: boolean;
  coursesOnUpload?: boolean;
  /** One table per group (each with course 1). An upload names its tables in the course field. */
  tablePerGroup?: boolean;
  content?: (fields: Record<string, string>) => string | null;
  /** rows -> the row count after "<listname>=" (default: decimal) */
  countFmt?: (n: number) => string;
}

/** Form-decode '+' to spaces and pad to a fixed width (D's Garage shows names). */
const formName = (width: number) => (owner: string) => owner.replace(/\+/g, ' ').slice(0, width).padEnd(width);

/** Pocket Fighter's info= flags: 6 extras, then 7 digital cards; '1' unlocks. The extras are always on. The cards
 *  rotate: each day (Japan time) offers one, Monday the first, so downloading on every day of the week collects all
 *  7 (the game only ever adds cards to the 7-bit set in its save, ROM 0x1CFAFB). Bandai's own server is not known to
 *  have done this; it's ours, so a card download means something again. */
export function pocketfInfo(d = new Date()): string {
  const day = jst(d).weekday;
  return '1'.repeat(6) + Array.from({ length: 7 }, (_, i) => (i === day ? '1' : '0')).join('');
}

/** Pocket Fighter: extras and digital cards are both requested with group=0 and no list. */
function pocketfContent(fields: Record<string, string>): string | null {
  if (fields.group === '0' && !('list' in fields)) return 'info=' + pocketfInfo() + '\r\n';
  return null;
}

const finalLapLower: Record<number, Order> = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i + 1, 'low']));

export const GAMES: Record<string, Cfg> = {
  rakujang: { courses: 3, maxRows: 20, nameMax: 8, header: false, countMax: 99, score: { default: [1, 6] }, group: 1 },
  gunpeyex: {
    courses: 5, maxRows: 9, nameMax: 16, header: true, countMax: 9999,
    score: { default: [10, 6], 3: [1, 8] }, group: 1, replyFmt: { 3: gunpeyPuzzle }
  },
  heaven: { courses: 1, maxRows: 5, nameMax: 8, header: false, countMax: 99, score: { default: [1, 6] }, group: 1, rankKey: { 1: 'low' } },
  tanetori: {
    courses: 4, maxRows: 1, nameMax: 16, header: true, countMax: 9999, score: { default: [1, 10] }, group: 1,
    courseFmt: (v) => `course=${v.g}|${v.n}|${v.entrants}|${v.top}|${v.mine}|${String(v.rank).padStart(4, '0')}`,
    nameFmt: formName(16), emptyName: 'NO RANKING DATA.'
  },
  // Sennou Millennium: rows start with a space and carry their own rank, so its fixed
  // "ranking|10|+16" gets the top 10, then the places just ahead of the player down to their own
  // row, trimmed to fit its 895-byte receive buffer (docs/wondergate/sennou.md).
  'sen-know': {
    courses: 1, maxRows: 10, nameMax: 16, header: () => [`date=${dt('YmdHM')}`], countMax: 9999,
    score: { default: [1, 8] }, group: 1, rowPrefix: ' ', maxBody: 740
  },
  'final-lap': {
    courses: 16, maxRows: 9, nameMax: 3, header: () => [`date=${dt('Ymd')}`], countMax: 9999,
    score: { default: [1, 5] }, group: 1, rankKey: finalLapLower, coursesPerGroup: true, groups: [1, 2]
  },
  // Pocket Fighter: tables 1 score, 2 total points, 3-14 each fighter's points (docs/wondergate/pocket-fighter.md).
  pocketf: {
    courses: 1, maxRows: 50, nameMax: 8, header: false, countMax: 50, score: { default: [1, 8] }, group: 1,
    coursesOnUpload: true, tablePerGroup: true, content: pocketfContent, groups: Array.from({ length: 14 }, (_, i) => i + 1)
  },
  // Tare Panda no GunPey: fixed 10-char score fields, echoed as uploaded. Puzzle times are stored as
  // complements too (row display ROM 0x9C9CA), so higher is better there as well.
  tarepang: { courses: 4, maxRows: 9, nameMax: 16, header: true, countMax: 9999, score: { default: [1, 10] }, group: 1 },
  // Uchuu Senkan Yamato: ヤマト指数 (0-65535), top 50. The game reads only date= (which also sets how
  // many crew logs it shows) and the rows; its row-count parser drops a second digit, so the count
  // goes as one character, '0' + n (docs/wondergate/yamato.md).
  yamato: {
    courses: 1, maxRows: 50, nameMax: 8, header: () => [`date=${dt('Ymd')}`], countMax: 9999,
    score: { default: [1, 5] }, group: 1, countFmt: (n) => String.fromCharCode(0x30 + n)
  }
};

/** (host + path) -> game key, as wgserver.SWAN_RANKING. */
export const SWAN_RANKING: Record<string, string> = {
  'rakujang.wgg.channel.or.jp/swan-ranking': 'rakujang',
  'gunpeyex.wgg.channel.or.jp/swan-ranking': 'gunpeyex',
  'wgg01.channel.or.jp/service/swan-ranking/tarepang': 'tarepang',
  'heaven.wgg.channel.or.jp/swan-ranking': 'heaven',
  'wgg01.channel.or.jp/service/swan-ranking/tanetori': 'tanetori',
  'wgg01.channel.or.jp/service/swan-ranking/sen-know': 'sen-know',
  'wgg01.channel.or.jp/service/swan-ranking/final-lap': 'final-lap',
  'wgg01.channel.or.jp/service/swan-ranking/pocketf': 'pocketf',
  'yamato.wgg.channel.or.jp/swan-ranking': 'yamato'
};

function dt(fmt: string): string {
  const t = jst();
  return [...fmt].map((c) => (t as unknown as Record<string, string>)[c] ?? c).join('');
}


const rankKey = (cfg: Cfg, course: number): Order => cfg.rankKey?.[course] ?? 'high';

function replyScore(cfg: Cfg, course: number, score: string | null | undefined): string {
  const [div, digits] = cfg.score[course] ?? cfg.score.default;
  const v = Math.min(Math.floor(int(score) / div), 10 ** digits - 1);
  const digitsOut = String(v).padStart(digits, '0');
  return cfg.replyFmt?.[course]?.(digitsOut) ?? digitsOut;
}

// ---------- storage ----------

/** One uploaded score. */
export interface Entry {
  course: number;
  score: string;
  extra: string;
}

/** One course for one player: its standing, and a page of the table. */
export interface Table {
  /** entrants */
  total: number;
  /** the player's place, 0 when they have no score */
  rank: number;
  /** the player's score */
  mine: string | null;
  /** the best score */
  top: string | null;
  /** the place of the page's first row */
  first: number;
  page: Array<{ owner: string; score: string; extra: string }>;
}

// Never moves a score off the account it's linked to (an unlinked one can be claimed by a linked relay).
// Checked here as well as in submit() so two uploads at once can't get round it.
const UPSERT = `INSERT INTO swan_ranking (game, course, player, owner, score, extra, updated, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (game, course, player, owner) DO UPDATE SET score = excluded.score, extra = excluded.extra, updated = excluded.updated,
    account_id = excluded.account_id
  WHERE swan_ranking.account_id IS NULL OR swan_ranking.account_id = excluded.account_id`;

/** Each course's standing and page in one query: ranked in D1, so only the rows a reply shows come back.
 * Ties go to the earlier score. ?1 game, ?2 player, ?3 owner, ?4 relative, ?5 start, ?6 count, ?7.. courses.
 * One row per course with entrants (n = 0, the standing), then its page rows (n = place). */
function tableSql(order: Order, courses: number): string {
  const list = Array.from({ length: courses }, (_, i) => `?${i + 7}`).join(', ');
  return `WITH r AS MATERIALIZED (
      SELECT course, owner, score, extra, player = ?2 AND owner = ?3 AS me,
        ROW_NUMBER() OVER (PARTITION BY course ORDER BY ${SQL_ORDER[order]}, updated, player, owner) AS n
      FROM swan_ranking WHERE game = ?1 AND course IN (${list})),
    s AS MATERIALIZED (
      SELECT course, COUNT(*) AS total, MAX(CASE WHEN me THEN n END) AS rank, MAX(CASE WHEN me THEN score END) AS mine,
        MAX(CASE WHEN n = 1 THEN score END) AS top,
        CASE WHEN ?4 THEN MAX(1, COALESCE(MAX(CASE WHEN me THEN n END), 1) - ?5) ELSE ?5 END AS first
      FROM r GROUP BY course)
    SELECT course, 0 AS n, total, rank, mine, top, first, NULL AS owner, NULL AS score, NULL AS extra FROM s
    UNION ALL
    SELECT r.course, r.n, NULL, NULL, NULL, NULL, NULL, r.owner, r.score, r.extra FROM r JOIN s ON s.course = r.course
      WHERE r.n >= MAX(1, s.first) AND r.n < MAX(1, s.first) + ?6
    ORDER BY 1, 2`;
}

/** A game table in D1. Tables can be large, so nothing reads one whole: submit() reads the player's own
 * rows, tables() the standings and pages a reply shows. */
export class Store {
  private writes: D1PreparedStatement[] = [];

  constructor(private conn: Conn) {}

  /** Keep each player's best score per course. A score linked to an account stays with it: another
   * account's upload, or an unlinked relay's, doesn't replace it. Written by flush() or tables(). */
  async submit(game: string, player: string, owner: string, entries: Entry[], order: (course: number) => Order) {
    if (!entries.length) return;
    const db = this.conn.env.WG_DB;
    const courses = [...new Set(entries.map((e) => e.course))];
    const { results } = await db
      .prepare(`SELECT course, score, account_id FROM swan_ranking WHERE game = ? AND player = ? AND owner = ? AND course IN (${courses.map(() => '?').join(', ')})`)
      .bind(game, player, owner, ...courses)
      .all<{ course: number; score: string; account_id: string | null }>();
    const stored = new Map(results.map((r) => [r.course, r]));
    const me = this.conn.accountId;
    for (const e of entries) {
      const row = stored.get(e.course);
      if (row && !better(order(e.course), e.score, row.score)) continue;
      if (row?.account_id && row.account_id !== me) {
        this.conn.log(`ranking ${game} course ${e.course}: ${owner}'s score is another account's, not replaced`);
        continue;
      }
      stored.set(e.course, { course: e.course, score: e.score, account_id: me });
      this.writes.push(db.prepare(UPSERT).bind(game, e.course, player, owner, e.score, e.extra, Date.now() / 1000, me));
    }
  }

  async flush() {
    if (this.writes.length) await this.conn.env.WG_DB.batch(this.writes);
    this.writes = [];
  }

  /** Standings and pages for some courses (after any pending writes). A page starts at place `start`, or
   * with `relative`, `start` places ahead of the player (Final Lap "+1" = the rival just ahead). */
  async tables(
    game: string, player: string, owner: string, courses: number[], order: (course: number) => Order,
    start: number, count: number, relative = false
  ): Promise<Map<number, Table>> {
    const db = this.conn.env.WG_DB;
    const byOrder = new Map<Order, number[]>();
    for (const c of courses) byOrder.set(order(c), [...(byOrder.get(order(c)) ?? []), c]);
    const queries = [...byOrder].map(([o, cs]) =>
      db.prepare(tableSql(o, cs.length)).bind(game, player, owner, relative ? 1 : 0, start, count, ...cs)
    );
    const results = await db.batch<Record<string, unknown>>([...this.writes, ...queries]);
    this.writes = [];
    const out = new Map<number, Table>();
    // A course nobody has played has no rows at all.
    for (const c of courses) out.set(c, { total: 0, rank: 0, mine: null, top: null, first: relative ? Math.max(1, 1 - start) : start, page: [] });
    for (const r of results.slice(results.length - queries.length).flatMap((x) => x.results)) {
      const t = out.get(r.course as number)!;
      if (r.n === 0) Object.assign(t, { total: r.total, rank: r.rank ?? 0, mine: r.mine, top: r.top, first: r.first });
      else t.page.push({ owner: r.owner as string, score: r.score as string, extra: (r.extra as string | null) ?? '' });
    }
    return out;
  }
}

// ---------- request ----------

/** Split a form body without URL-decoding (names are echoed back byte-exact). Keys can repeat. */
export function parseForm(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const part of strip(body, '\r\n\0').split('&')) {
    const i = part.indexOf('=');
    if (i >= 0) out.push([part.slice(0, i), strip(part.slice(i + 1), '\r\n\0')]);
  }
  return out;
}

// What a stored score may hold, well above what the games send (IDs of 6-8 characters, scores of up to
// 10 digits, extras of up to 4). Longer ones are answered but not stored.
const MAX_PLAYER = 32;
const MAX_SCORE = 15; // digits: exact both as a JavaScript number and as SQLite's integer
const MAX_EXTRA = 16;

/** Whether a name can't go on the public tables. '+' is a form-encoded space. Pocket Fighter's names end
 * in the fighter's letter, so they're checked without it too. */
function offensive(cfg: Cfg, owner: string): boolean {
  const name = owner.replace(/\+/g, ' ');
  return isOffensive(name) || (Boolean(cfg.tablePerGroup) && isOffensive(name.slice(0, -1)));
}

export async function handle(conn: Conn, game: string, raw: Uint8Array): Promise<Reply> {
  const cfg = GAMES[game];
  const fields = parseForm(latin1(raw));
  const first: Record<string, string> = {};
  for (const [k, v] of fields) if (!(k in first)) first[k] = v;
  const note: string[] = [];

  const player = first['*'] ?? '';
  const owner = (first.owner ?? '').slice(0, cfg.nameMax);
  const group = isDigits(first.group ?? '') ? Number.parseInt(first.group, 10) : 1;
  // No game sends more than group 3; a huge one would make the course numbers below lose precision.
  if (group > 999_999) return { status: 200, type: CONTENT_TYPE, body: '', note: `${owner}: bad group` };
  // Pocket Fighter: one table per group (1 score, 2 total points, 3-14 a fighter's points). Downloads give
  // the group; uploads name each table in the course field (score=02|<points>&score=07|<points>: total and
  // Morrigan's points).
  const tableOf = (g: number) => (cfg.tablePerGroup && g !== 1 ? `${game}/${g}` : game);
  const tableKey = tableOf(group);
  // Final Lap: group 2 asks for courses 17-32 (lap times; 1-16 are total times).
  const courseBase = cfg.coursesPerGroup ? (group - 1) * cfg.courses : 0;
  const order = (course: number) => rankKey(cfg, course);

  // Only the game's own groups and courses are stored, so an upload can't start new tables. Others are
  // still answered as the game expects.
  const groups = cfg.groups ?? [1];
  const storable = groups.includes(group);
  const store = new Store(conn);
  const width = new Map<number, [number, number]>();
  const entries = new Map<string, Entry[]>();
  const add = (table: string, e: Entry) => entries.set(table, [...(entries.get(table) ?? []), e]);
  let scores = 0;
  for (const [k, v] of fields) {
    if (k !== 'score') continue;
    const parts = v.split('|');
    if (parts.length >= 2 && isDigits(parts[0]) && isDigits(parts[1])) {
      // A game uploads each course (Pocket Fighter: each table) at most once.
      if (++scores > (cfg.tablePerGroup ? groups.length : cfg.courses)) break;
      const course = Number.parseInt(parts[0], 10);
      const score = parts[1];
      const extra = parts.length > 2 ? parts[2] : '';
      if (player.length > MAX_PLAYER || score.length > MAX_SCORE || extra.length > MAX_EXTRA) {
        note.push(`course ${parts[0].slice(0, 10)}: too long, not stored`);
        continue;
      }
      width.set(course, [score.length, extra.length]);
      note.push(`course ${course}: ${score}${extra ? '|' + extra : ''}`);
      if (cfg.tablePerGroup) {
        if (groups.includes(course)) add(tableOf(course), { course: 1, score, extra });
        else note.push('(no such table, not stored)');
      } else if (course > courseBase && course <= courseBase + cfg.courses) add(tableKey, { course, score, extra });
      else note.push('(no such course, not stored)');
    }
  }
  if (entries.size) {
    // Refused uploads get the same reply as stored ones.
    const refused = !storable ? `group ${group}` : offensive(cfg, owner) ? 'name' : !(await writeAllowed(conn)) ? 'rate limit' : null;
    if (refused) note.push(`not stored (${refused})`);
    else for (const [table, es] of entries) await store.submit(table, player, owner, es, order);
  }

  const special = cfg.content?.(first) ?? null;
  if (special !== null) {
    await store.flush();
    return { status: 200, type: CONTENT_TYPE, body: special, note: `content ${first.owner}` };
  }
  if (!('list' in first) && !cfg.coursesOnUpload) {
    await store.flush();
    return { status: 200, type: CONTENT_TYPE, body: '', note: `${owner} ${note.join(', ')}` };
  }

  if (!('list' in first)) {
    // Pocket Fighter reads "your rank" from the course line after an upload: the first table it sent
    // (score, or total points).
    const courses = Array.from({ length: cfg.courses }, (_, i) => i + 1);
    const replyKey = entries.keys().next().value ?? tableKey;
    const tables = await store.tables(replyKey, player, owner, courses, order, 1, 1, false);
    const out = courses.map((course) => {
      const t = tables.get(course)!;
      const top = replyScore(cfg, course, t.page[0]?.score ?? '0');
      return `course=${cfg.group}|${course}|${Math.min(t.total, 9999)}|${top}|${replyScore(cfg, course, t.mine)}|${Math.min(t.rank, cfg.countMax)}`;
    });
    return { status: 200, type: CONTENT_TYPE, body: out.join('\r\n') + '\r\n', note: `${owner} ${note.join(', ')}; ranks` };
  }

  // list=<name>|<start>|<count>; a start of "+N" is relative to the player:
  // N places ahead of them (Final Lap "+1" = the rival just ahead; Pocket Fighter "+0" = their own entry).
  // A count of "+N" (Sennou Millennium's fixed "ranking|10|+16") reads the same way from the other
  // field: the top <start> rows, then the N places ahead of the player down to the player.
  const lp = first.list.replace(/%2b/g, '+').replace(/%2B/g, '+').split('|');
  const listname = lp[0];
  const num = (v: string) => (isDigits(v.replace(/^\++/, '')) ? Number.parseInt(v.replace(/^\++/, ''), 10) : null);
  // (Past any table's end, so the reply is the same; it keeps the number exact for D1.)
  let start = Math.min(lp.length > 1 && num(lp[1]) !== null ? num(lp[1])! : 1, 1e9);
  const relative = lp.length > 1 && lp[1].startsWith('+');
  const near = lp.length > 2 && lp[2].startsWith('+') ? num(lp[2]) : null;
  let count = lp.length > 2 && num(lp[2]) !== null ? num(lp[2])! : cfg.maxRows;
  count = Math.max(1, Math.min(count, cfg.maxRows));
  const g = cfg.group;

  const out: string[] = [];
  if (typeof cfg.header === 'function') out.push(...cfg.header(game));
  else if (cfg.header) {
    out.push(`date${dt('YmdHMS')}3`, `info=www.bandai.co.jp:${game}`, `group=${g}|20000101|20991231|DEFAULT`);
  }
  const courses = Array.from({ length: cfg.courses }, (_, i) => courseBase + i + 1);
  const tables = near !== null
    ? await store.tables(tableKey, player, owner, courses, order, 1, start, false)
    : await store.tables(tableKey, player, owner, courses, order, start, count, relative);
  for (const course of courses) {
    const t = tables.get(course)!;
    let ranked = t.page.map((r, i) => [t.first + i, r] as const);
    if (near !== null && t.rank > start) {
      const lo = Math.max(start + 1, t.rank - near);
      const more = (await store.tables(tableKey, player, owner, [course], order, lo, t.rank - lo + 1, false)).get(course)!;
      ranked = ranked.concat(more.page.map((r, i) => [lo + i, r] as const));
    }
    const ew = (width.get(course) ?? [6, 2])[1];
    const cap = cfg.countMax;
    const top = replyScore(cfg, course, t.page[0]?.score ?? '0');
    const v = { g, n: course, entrants: Math.min(t.total, cap), top, mine: replyScore(cfg, course, t.mine), rank: Math.min(t.rank, cap) };
    out.push(cfg.courseFmt ? cfg.courseFmt(v) : `course=${v.g}|${v.n}|${v.entrants}|${v.top}|${v.mine}|${v.rank}`);
    // Raku Jongg's parser always reads at least one row: never send an empty table.
    const rows: (readonly [number, string, string, string])[] = ranked.length
      ? ranked.map(([i, r]) => [i, r.owner, r.score, r.extra] as const)
      : [[near !== null ? 1 : t.first, cfg.emptyName ?? '-', '0', '0'.repeat(ew)] as const];
    const name = cfg.nameFmt ?? ((o: string) => o);
    const lines = rows.map(([i, o, sc, e]) => `${cfg.rowPrefix ?? ''}${i}|${replyScore(cfg, course, sc)}|${name(o)}|${e}`);
    const countLine = (n: number) => `${listname}=${cfg.countFmt ? cfg.countFmt(n) : n}`;
    if (near !== null && cfg.maxBody !== undefined) {
      // Drop the rows farthest ahead of the player until the reply fits the game's receive
      // buffer (the top rows and the player's own row stay).
      const size = () => [...out, countLine(lines.length), ...lines].reduce((n, x) => n + x.length + 2, 0);
      while (size() > cfg.maxBody && lines.length > start + 1) lines.splice(start, 1);
    }
    out.push(countLine(lines.length), ...lines);
  }
  note.push(`table ${listname} ${start}+${count}`);
  // The table ends the exchange; Tare Panda reads until the connection closes.
  return { status: 200, type: CONTENT_TYPE, body: out.join('\r\n') + '\r\n', note: `${owner} ${note.join('; ')}`, close: true };
}
