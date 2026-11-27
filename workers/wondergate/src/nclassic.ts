// Wonder Classic: nclassic.wgg.channel.or.jp port 10000, binary, the server speaks first. A port of
// nclassic.py (without its reverse-engineering probe hooks); see that repo's
// docs/wondergate/wonder-classic.md.
//   server -> "WSR\r" + status(1) + count(1) + count records    (hello, count 0)
//   client -> "WGS\r" + 10 bytes (login: member ID)  or  "WSC\r" + type + params (request)
//   server -> "WSR\r" + status + count + records ("WSD\r" + data, padded to the type's size)
// Requests arrive in adapter-sized chunks, so one is answered once the line has been quiet for 0.5 s.
// Members, Net Tour scores and super shots live in D1 ('nclassic').
import { isOffensive } from '../../../src/lib/wordfilter';
import { bytesOf, concat, hex, jst, latin1, sjisText, strip, unhex } from './bytes';
import type { Conn } from './env';
import { quota, writeAllowed } from './limits';
import { readState, withState } from './state';

// Record size per request type (ROM A000:0382)
const SIZES = [0x1f, 0x16, 0x0e, 0x0e, 0x12, 0x111, 0xcc, 0x14, 0x26, 0x14, 0x2e, 0x45, 0x14, 0x08, 0x24, 0x29, 0x1b, 0x10, 0x0e, 0x20, 0x262, 0x480, 0x08];
const QUIET_MS = 500;
const MAX_SHOTS = 1000; // the list shows the newest 20
// The state is one D1 row (state.ts refuses writes past 1 MB), so everything in it is capped, oldest
// dropped first: members (about 60 bytes each), the best entries per round (about 20), the players in a
// round's final (about 26) and the rounds kept (one a month). Worst case: 186 KB + 24 x 20 KB +
// 24 x 5 KB + 115 KB of shots.
const MAX_MEMBERS = 3000;
const MAX_ENTRIES = 1000;
const MAX_FINALISTS = 200; // 100 qualify, more only when scores tie at the cutoff
const MAX_ROUNDS = 24;
// New member cards per address per day (a card is made once per cartridge).
const MEMBERS_PER_DAY = 20;

interface Db {
  next: number;
  members: Record<string, { handle: string; pref: number }>;
  /** round -> member ID -> best qualifier score (strokes over par), in the order they were entered */
  scores: Record<string, Record<string, number>>;
  /** round -> member ID -> the final's one or two scores, in the order the totals were reached */
  finals?: Record<string, Record<string, number[]>>;
  shots?: Array<{ id: number; user: string; header: string }>;
}
const fresh = (): Db => ({ next: 1, members: {}, scores: {} });

const WSD = bytesOf('WSD\r');

function reply(status = 0, records: Uint8Array[] = [], size = 0): Uint8Array {
  const recs = records.map((r) => {
    const out = new Uint8Array(size);
    out.set(r.subarray(0, size));
    return out;
  });
  return concat(bytesOf('WSR\r'), new Uint8Array([status, recs.length]), ...recs);
}

/** int.from_bytes(b, "little") of however many bytes there are. */
const le = (b: Uint8Array) => b.reduceRight((n, x) => n * 256 + x, 0);
const word = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
const dword = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);

const QUALIFY = 100; // the qualifier's best 100 may enter the final (the manual; shown by the bulletin)
const WINNERS = 32; // the final's "N位 までに はいれば にゅうしょう": our number, what 前回の入賞者 lists

/** The month's tour (our rules, see the doc): the qualifier runs from the 1st to the day before the
 * fourth Monday, the final from the fourth Monday to the end of the month. Dates as yyyymmdd text:
 * [qualifier start, qualifier end, final start, final end]. */
function tourDates(): string[] {
  const t = jst();
  const firstWeekday = (((t.weekday - (t.day - 1)) % 7) + 7) % 7;
  const final = 1 + ((7 - firstWeekday) % 7) + 21;
  const last = new Date(Date.UTC(t.year, t.month, 0)).getUTCDate();
  return [1, final - 1, final, last].map((d) => `${t.Y}${t.m}${String(d).padStart(2, '0')}`);
}

/** Oct 2026 = round 1 */
function tourRound(): number {
  const t = jst();
  return Math.max((t.year - 2026) * 12 + t.month - 9, 1);
}

/** Week of the month's tour: 0 on the days before the first Monday, then 1, 2, ... from each Monday
 * (up to 5). */
function tourWeek(): number {
  const t = jst();
  return Math.max(0, Math.floor((t.day - t.weekday - 1) / 7) + 1);
}

/** Word +4 of the bulletin and of the round. The cart saves it with the round and downloads a round
 * again only when the bulletin's round or this word differs from the saved ones (6000:1946; otherwise
 * error 708), so it has to change whenever the conditions do: every Monday. The cart reads it as
 * signed: below 4 is the qualifier, 4 is the final (the cart then asks types 10, 11 and 12 instead of
 * 7, 8 and 9) and above 4 is refused (errors 704/705). So it is the week of the month, and the final
 * starts on the fourth Monday; a fifth Monday changes nothing (still 4: the final runs on to the end of
 * the month). That the word counts weeks is our reading; what Bandai sent is not known. */
function stageWord(): number {
  return Math.min(tourWeek(), 4);
}

/** Type 6: this month's Net Tour round (body after WSD\r): round number (word +0), stage (word +4, see
 * stageWord), qualifier cutoff rank (word +6), entry fee in yen (word +10), the qualifier's start and
 * end dates as yyyymmdd text (+168, +176; shown as yy/mm/dd), course id (+0x96). Shown only in the final
 * (stage 4): prize cutoff rank (word +8), the final's start and end dates (+184, +192). */
function bulletin(size: number): Uint8Array {
  const body = new Uint8Array(size - 4);
  body.set(word(tourRound()), 0);
  body.set(word(stageWord()), 4);
  body.set(word(QUALIFY), 6);
  body.set(word(WINNERS), 8);
  body.set(word(0), 10);
  body.set(bytesOf(tourDates().join('')), 168);
  body[0x96] = (jst().month % 4) + 1;
  return concat(WSD, body);
}

/** This week's weather and wind for the 18 holes, as the manual describes the Net Tour: they change
 * every Monday, and the final (from the round's fourth Monday) is played in harder conditions. Fixed
 * per week (SHA-256 of the month and week, as nclassic.week_conditions), so every player gets the same
 * round. */
async function weekConditions(): Promise<{ rain: boolean; strength: number[]; direction: number[] }> {
  const t = jst();
  const week = stageWord();
  const final = week === 4;
  const seed = `wclassic ${t.Y}-${t.m} week ${week}`;
  const sha = async (x: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(x)));
  const a = await sha(`${seed} a`);
  const b = await sha(`${seed} b`);
  const [base, spread] = final ? [6, 9] : [0, 7]; // 6-14 m / 0-6 m
  const prevailing = a[30] % 16;
  return {
    rain: a[31] < (final ? 128 : 64), // 50% / 25% of weeks
    strength: Array.from({ length: 18 }, (_, h) => Math.min(15, base + (a[h] % spread))),
    direction: Array.from({ length: 18 }, (_, h) => (prevailing + [-1, 0, 0, 1][b[h] % 4] + 16) % 16)
  };
}

/** Type 5, the Net Tour round (parser 6000:4F8E, unpacked into the tour save at SRAM 0xACF):
 *   +0 round (word; 0 = no tour)   +4 stage (word, as in the bulletin: stageWord)
 *   +0xB2 start date, +0xBA end date, "yyyymmdd" (this stage's entry period)
 *   +0xC2 18 hole indexes, each a built-in course * 18 + hole (table 6000:50FE)
 *   +0xD4 rain: byte +0xD4 = holes 1-8, byte +0xD5 = holes 10-17, MSB first. The parser takes 9 holes
 *         from each byte, so holes 9 and 18 are always dry
 *   +0xD7 18 nibbles, high first: wind strength in m (0-15)
 *   +0xE0 18 nibbles: wind direction, 16 steps of 22.5 deg clockwise from straight up the hole screen
 *   +0xE9 18 (x, y) byte pairs: pin position; 0, 0 = the hole's default pin
 * We play one built-in course's 18 holes, with this week's weather and wind. */
async function netRound(size: number): Promise<Uint8Array> {
  const body = new Uint8Array(size - 4);
  body.set(word(tourRound()), 0);
  body.set(word(stageWord()), 4);
  // This stage's own dates: the cart refuses an entry outside them (706 before, 707 after).
  body.set(bytesOf(tourDates().slice(stageWord() === 4 ? 2 : 0).slice(0, 2).join('')), 0xb2);
  const c = await weekConditions();
  for (let h = 0; h < 18; h++) {
    body[0xc2 + h] = h;
    if (c.rain && h % 9 < 8) body[0xd4 + Math.floor(h / 9)] |= 0x80 >> (h % 9); // holes 9 and 18 have no bit
    const shift = h % 2 ? 0 : 4;
    body[0xd7 + (h >> 1)] |= c.strength[h] << shift;
    body[0xe0 + (h >> 1)] |= c.direction[h] << shift;
  }
  return concat(WSD, body);
}

// 新製品開発情報 (type 22): one new product a month. Body = [club set, ball, glove, shoes] item kinds,
// 1 = パワー, 2 = コントロール; the game shows and unlocks the first record.
const PRODUCTS = ['01000000', '00010000', '00000100', '00000001', '02000000', '00020000', '00000200', '00000002'];

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** [(member ID, score)] of a round's qualifier, best first (a player's best entry of the month). Equal
 * scores stay in the order they were entered (the manual's rule): the table is kept in that order. */
function standings(db: Db, rnd: number): Array<[string, number]> {
  return Object.entries(db.scores[String(rnd)] ?? {}).sort((a, b) => a[1] - b[1]);
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

/** [(member ID, [scores])] of a round's final, best total first, equal totals in the order they were
 * reached. While the final runs, a player with one score is on it with that score (the cart calls this
 * rank provisional, ざんてい); once the month is over only the players with both scores are left
 * (1かい だけでは しっかく). */
function finalBoard(db: Db, rnd: number): Array<[string, number[]]> {
  const running = rnd === tourRound();
  return Object.entries(db.finals?.[String(rnd)] ?? {})
    .filter(([, s]) => running || s.length === 2)
    .sort((a, b) => sum(a[1]) - sum(b[1]));
}

/** A player's rank among (member ID, value) rows, as the cart numbers its own ranking list: equal
 * values share a rank (2T, 2T, then 4). 0 = not in the rows. */
function rankOf(rows: Array<[string, number]>, uid: string): number {
  const mine = rows.find(([u]) => u === uid);
  return mine ? 1 + rows.filter(([, v]) => v < mine[1]).length : 0;
}

const handleOf = (db: Db, uid: string) => unhex(Object.hasOwn(db.members, uid) ? db.members[uid].handle : '00'.repeat(16));

/** Type 8: this round's qualifier (params round(4) 00 00 start count), name +0, score +0x20. Type 11: a
 * round's final (params round(4) start count), asked for the ranking during the final and for
 * 前回の入賞者: name +0, prefecture +0x10, the two scores +0x17 and +0x27 (the ranking adds them up,
 * parser 6000:4DAC), their total +0x37 (前回の入賞者 shows it, 6000:4EC6). Type 14: the best final totals
 * of past rounds, round +2, name +6, score +0x16. Names are the member card's handle (8 two-byte
 * characters). */
function rankingRows(kind: number, req: Uint8Array, db: Db): Uint8Array[] {
  const p = req.subarray(5);
  const size = SIZES[kind];
  const out: Uint8Array[] = [];
  if (kind === 8 || kind === 11) {
    const rnd = le(p.subarray(0, 4));
    const at = kind === 8 ? 6 : 4;
    const start = le(p.subarray(at, at + 2)) || 1;
    const count = le(p.subarray(at + 2, at + 4)) || 32;
    const table: Array<[string, number | number[]]> = kind === 8 ? standings(db, rnd) : finalBoard(db, rnd);
    for (const [uid, score] of table.slice(start - 1, start - 1 + count)) {
      const body = new Uint8Array(size - 4);
      body.set(handleOf(db, uid).subarray(0, 16), 0);
      if (typeof score === 'number') {
        body.set(word(score), 0x20);
      } else {
        body[0x10] = Object.hasOwn(db.members, uid) ? db.members[uid].pref : 0;
        body.set(word(score[0]), 0x17);
        body.set(word(sum(score.slice(1))), 0x27);
        body.set(word(sum(score)), 0x37);
      }
      out.push(concat(WSD, body));
    }
  } else {
    const current = tourRound();
    const rows: Array<[number, string, string]> = [];
    for (const rnd of Object.keys(db.finals ?? {})) {
      if (Number.parseInt(rnd, 10) >= current) continue;
      for (const [uid, score] of Object.entries(db.finals![rnd])) if (score.length === 2) rows.push([sum(score), rnd, uid]);
    }
    rows.sort((a, b) => a[0] - b[0] || cmp(a[1], b[1]) || cmp(a[2], b[2]));
    for (const [score, rnd, uid] of rows.slice(0, 32)) {
      const body = new Uint8Array(size - 4);
      body.set(word(Number.parseInt(rnd, 10)), 2);
      body.set(handleOf(db, uid).subarray(0, 16), 6);
      body.set(word(score), 0x16);
      out.push(concat(WSD, body));
    }
  }
  return out;
}

interface Session {
  user?: string;
}

/** Reply to one client request. `session` holds the member ID from the connection's "WGS\r" login. */
async function answer(conn: Conn, req: Uint8Array, session: Session): Promise<Uint8Array> {
  const log = (m: string) => conn.log(`nclassic ${m}`);
  const head = latin1(req.subarray(0, 4));
  if (head === 'WGS\r') session.user = strip(latin1(req.subarray(4, 14)), '\0');
  if (head !== 'WSC\r' || req.length <= 4 || req[4] >= SIZES.length) return reply();
  const kind = req[4];
  const size = SIZES[kind];
  const user = session.user ?? '';
  switch (kind) {
    case 1: {
      // Member-card registration: the new member's 10-byte ID (sent back in every later "WGS\r"
      // login) and 8 more bytes. Card: handle +0 (8 two-byte characters), name +16, postal code +46,
      // prefecture +54.
      const card = req.subarray(5);
      const handle = new Uint8Array(16);
      handle.set(card.subarray(0, 16));
      // Refused (an offensive handle, or too many cards from one address): an error status, no card.
      if (isOffensive(sjisText(handle))) {
        log('WSC type 1 (register): handle refused (name filter)');
        return reply(1);
      }
      if (!(await writeAllowed(conn)) || !(await quota(conn, 'nclassic member', MEMBERS_PER_DAY))) return reply(1);
      const uid = await withState(conn, 'nclassic', fresh, (db) => {
        const id = `WC${String(db.next).padStart(8, '0')}`;
        db.next++;
        db.members[id] = { handle: hex(handle), pref: card.length > 54 ? card[54] : 0 };
        // Oldest (lowest-numbered) cards go first; their scores stay, shown without a name.
        const ids = Object.keys(db.members);
        if (ids.length > MAX_MEMBERS) for (const old of ids.sort().slice(0, ids.length - MAX_MEMBERS)) delete db.members[old];
        return id;
      });
      log(`WSC type 1 (register): new member ${uid}`);
      return reply(0, [concat(WSD, bytesOf(`${uid}PASSWORD`))], size);
    }
    case 2: {
      // メンバーズカードの変更: the card again, in type 1's layout. The cart needs one record back with
      // 10 bytes (it compares them with its member ID but ignores the result; no record gives error
      // 705). We send the ID. What Bandai sent is not known.
      const card = req.subarray(5);
      const handle = new Uint8Array(16);
      handle.set(card.subarray(0, 16));
      // Refused as a new card would be: an error status, and the old card stays.
      if (isOffensive(sjisText(handle))) {
        log('WSC type 2 (card change): handle refused (name filter)');
        return reply(1);
      }
      if (!(await writeAllowed(conn))) return reply(1);
      const issued = await withState(conn, 'nclassic', fresh, (db) => {
        if (!/^WC\d{8}$/.test(user) || Number(user.slice(2)) < 1 || Number(user.slice(2)) >= db.next) return false;
        db.members[user] = { handle: hex(handle), pref: card.length > 54 ? card[54] : 0 };
        const ids = Object.keys(db.members);
        if (ids.length > MAX_MEMBERS) for (const old of ids.sort().slice(0, ids.length - MAX_MEMBERS)) delete db.members[old];
        return true;
      });
      log(`WSC type 2 (card change): ${user}${issued ? '' : ' (not a member ID of ours: not kept)'}`);
      return reply(0, [concat(WSD, bytesOf(user))], size);
    }
    case 9: {
      // Net Tour entry in the qualifier (after the type-4 clock): round(4), the stage word, score
      // (signed word, strokes over par). An empty reply completes it.
      const rnd = le(req.subarray(5, 9));
      const score = req.length >= 13 ? ((le(req.subarray(11, 13)) << 16) >> 16) : 0;
      log(`WSC type 9: entry round ${rnd}, ${user} ${score >= 0 ? '+' : ''}${score}`);
      // Only while this month's qualifier is open: its table decides who may enter the final. Otherwise
      // もくてきの データが みつかりませんでした 712 (the cart's own date check comes first: 707).
      if (rnd !== tourRound() || stageWord() === 4) return reply(2);
      // Only so many per address; the reply is the same.
      if (!(await writeAllowed(conn))) return reply();
      await withState(conn, 'nclassic', fresh, (db) => {
        const best = (db.scores[String(rnd)] ??= {});
        if (Object.hasOwn(best, user) && score >= best[user]) return;
        if (!Object.hasOwn(best, user) && Object.keys(best).length >= MAX_ENTRIES) {
          // Full: the new entry takes the last place's spot if it beats it.
          const [last, worst] = standings(db, rnd).at(-1)!;
          if (score >= worst) return;
          delete best[last];
        }
        delete best[user]; // a better score counts from now (ties)
        best[user] = score;
        const rounds = Object.keys(db.scores).sort((a, b) => Number(a) - Number(b));
        for (const old of rounds.slice(0, Math.max(0, rounds.length - MAX_ROUNDS))) {
          delete db.scores[old];
          delete db.finals?.[old];
        }
      });
      return reply();
    }
    case 12: {
      // Net Tour entry in the final, same params as type 9. A player's first two scores are kept (the
      // cart sends no more; it adds them up itself). An empty reply completes it; an error status
      // leaves the score on the cart.
      const rnd = le(req.subarray(5, 9));
      const score = req.length >= 13 ? ((le(req.subarray(11, 13)) << 16) >> 16) : 0;
      log(`WSC type 12: final entry round ${rnd}, ${user} ${score >= 0 ? '+' : ''}${score}`);
      if (rnd !== tourRound() || stageWord() !== 4) return reply(2); // no final running: 712
      // Too many writes from this address: サーバーが こんざつしています, and the cart keeps its score.
      if (!(await writeAllowed(conn))) return reply(3);
      const refused = await withState(conn, 'nclassic', fresh, (db) => {
        const table = db.finals?.[String(rnd)] ?? {};
        const mine = Object.hasOwn(table, user) ? table[user] : [];
        // Not among the qualifier's best 100 (the cart turns away a player with no qualifier entry by
        // itself), or a third score: うけつけにんずうを こえたため とうろくが できません 715
        const rank = rankOf(standings(db, rnd), user);
        if (rank < 1 || rank > QUALIFY) return 'not qualified';
        if (mine.length >= 2) return 'two scores already';
        if (!mine.length && Object.keys(table).length >= MAX_FINALISTS) return 'the final is full';
        delete table[user]; // back in at the end: ties go to the earlier total
        table[user] = [...mine, score];
        (db.finals ??= {})[String(rnd)] = table;
        return '';
      });
      if (refused) log(`WSC type 12: refused (${refused})`);
      return refused ? reply(7) : reply();
    }
    case 10: {
      // あなたの順位 in the final (params round(4)): rank word +2, and word +0x1E 0 = "5位（ざんてい）"
      // (one score so far), not 0 = the rank alone. +0 is not shown (we put the number of players on
      // the board there). A player who is not on the board: もくてきの データが みつかりませんでした 712.
      const rnd = le(req.subarray(5, 9));
      const board = finalBoard(await readState(conn, 'nclassic', fresh), rnd);
      const rank = rankOf(board.map(([u, s]) => [u, sum(s)]), user);
      log(`WSC type 10: ${user} final rank ${rank} of ${board.length} in round ${rnd}`);
      if (!rank) return reply(2);
      const body = new Uint8Array(size - 4);
      body.set(word(board.length), 0);
      body.set(word(rank), 2);
      body[0x1e] = board.find(([u]) => u === user)![1].length === 2 ? 1 : 0;
      return reply(0, [concat(WSD, body)], size);
    }
    case 6:
      log('WSC type 6: tour bulletin');
      return reply(0, [bulletin(size)], size);
    case 5:
      log('WSC type 5: Net Tour round');
      return reply(0, [await netRound(size)], size);
    case 4: {
      // Server clock, yyyymmddhhmmss (JST), checked against the tour dates before an entry (a past
      // date gives すでに しめきりが すぎていました 707).
      const t = jst();
      const now = `${t.Y}${t.m}${t.d}${t.H}${t.M}${t.S}`;
      log(`WSC type 4: clock ${now}`);
      return reply(0, [concat(WSD, bytesOf(now))], size);
    }
    case 22: {
      const item = PRODUCTS[(tourRound() - 1) % PRODUCTS.length];
      log(`WSC type 22: new product ${item}`);
      return reply(0, [concat(WSD, unhex(item))], size);
    }
    case 13: {
      // 前回の入賞者: the previous round (word); round 0 makes the game say だい1かいのネットツアーが
      // しゅうりょうしていません. It then asks type 11 with these 4 bytes + start + count.
      const prev = tourRound() - 1;
      log(`WSC type 13: previous round ${prev}`);
      return reply(0, [concat(WSD, word(prev), new Uint8Array(2))], size);
    }
    case 18: {
      // スーパースーパーショット エントリー: the 0x25-byte shot header (packed from the super-shot record
      // at SRAM 0xD6F, 6000:534E): kind, course*18+hole, conditions and four shot-parameter blocks.
      // Viewers re-simulate the shot from it. An empty reply completes it.
      const header = hex(req.subarray(5, 5 + 0x25));
      if (!(await writeAllowed(conn))) return reply();
      const sid = await withState(conn, 'nclassic', fresh, (db) => {
        const shots = (db.shots ??= []);
        const id = (shots.at(-1)?.id ?? 0) + 1;
        shots.push({ id, user, header });
        if (shots.length > MAX_SHOTS) shots.splice(0, shots.length - MAX_SHOTS);
        return id;
      });
      log(`WSC type 18: super shot ${sid} from ${user}, kind ${req[5]}`);
      return reply();
    }
    case 16: {
      // Super-shot list (6000:51CF): word 1 (0 ends the list), 4-byte ID (sent back with type 15),
      // 16 bytes shown in the list (the uploader's handle), 1 byte. Up to 20, newest first.
      const db = await readState(conn, 'nclassic', fresh);
      const rows = (db.shots ?? [])
        .slice(-20)
        .reverse()
        .map((shot) => {
          const name = new Uint8Array(16);
          name.set(handleOf(db, shot.user).subarray(0, 16));
          return concat(WSD, word(1), dword(shot.id), name, new Uint8Array(1));
        });
      log(`WSC type 16: ${rows.length} super shots`);
      // The cart needs at least one record (none gives error 705): with no shots, one zero record,
      // which ends the list (データがありません).
      return reply(0, rows.length ? rows : [WSD], size);
    }
    case 15: {
      // One super shot (params: its 4-byte ID): the uploaded header.
      const sid = le(req.subarray(5, 9));
      const shot = (await readState(conn, 'nclassic', fresh)).shots?.find((x) => x.id === sid);
      log(`WSC type 15: super shot ${sid}: ${shot ? 'found' : 'missing'}`);
      if (!shot) return reply();
      return reply(0, [concat(WSD, unhex(shot.header))], size);
    }
    case 7: {
      // あなたの順位 in the qualifier (params round(4)): rank word +2 (shown as "18位"); +0 is not shown
      // (we put the number of entrants there).
      const rnd = le(req.subarray(5, 9));
      const table = standings(await readState(conn, 'nclassic', fresh), rnd);
      const rank = rankOf(table, user);
      log(`WSC type 7: ${user} rank ${rank} of ${table.length} in round ${rnd}`);
      return reply(0, [concat(WSD, word(table.length), word(rank))], size);
    }
    case 8:
    case 11:
    case 14: {
      const rows = rankingRows(kind, req, await readState(conn, 'nclassic', fresh));
      log(`WSC type ${kind}: ranking, ${rows.length} rows`);
      return reply(0, rows, size);
    }
  }
  // Other types (20/21 スーパースーパーショット replays) are not rebuilt: answer an empty list.
  log(`WSC type ${kind} (${size}-byte records): not implemented, empty reply`);
  return reply();
}

// Requests on one connection: a session is a login and a dozen or so menu requests.
const MAX_REQUESTS = 100;

export class NclassicSession {
  /** This request's chunks, joined once it's complete (joining on every chunk would be quadratic). */
  private chunks: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private session: Session = {};
  private requests = 0;
  /** Answers go out one at a time, in order (each may wait on D1). */
  private replies: Promise<void> = Promise.resolve();

  constructor(private conn: Conn, private send: (b: Uint8Array) => void, private close: () => void) {}

  async start() {
    this.send(reply());
  }

  async feed(data: Uint8Array) {
    this.chunks.push(data);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), QUIET_MS);
  }

  private flush() {
    this.timer = null;
    const req = concat(...this.chunks);
    this.chunks = [];
    if (!req.length) return this.replies;
    if (++this.requests > MAX_REQUESTS) {
      this.conn.log(`nclassic: closed after ${MAX_REQUESTS} requests (limit)`);
      this.close();
      return this.replies;
    }
    this.replies = this.replies
      .then(async () => {
        this.conn.log(`nclassic request ${req.length} bytes`);
        this.send(await answer(this.conn, req, this.session));
      })
      .catch((err) => this.conn.log(`nclassic error: ${err instanceof Error ? err.stack ?? err.message : err}`));
    return this.replies;
  }

  /** The console stopped sending: answer what has arrived, then hang up. */
  async eof() {
    if (this.timer) clearTimeout(this.timer);
    await this.flush();
    this.close();
  }
}
