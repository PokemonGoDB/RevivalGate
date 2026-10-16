// Bandai's Digimon WonderGate ladder, for two games that share one protocol. A port of digimon.py.
//   D1 Tamers (2000), the net D-1 Grand Prix:  POST http://digi4.wgg.channel.or.jp/cgi-bin/dm4<name>.cgi
//   Brave Tamer (2001):                        POST http://digi_b.wgg.channel.or.jp/cgi-bin/dmB<name>.cgi
// profile (26 bytes) ID[8] name[8] region party-size digimon-id[3] word; block = profile + 3 Digimon
// records (D1 Tamers 39 bytes each, Brave Tamer 55). The battles run in the cartridge; the server keeps
// the ladder (the stronger party moves up). Each game keeps its own players and ladder.
import { DIGIMON_FONTS, type DigimonFont } from '../../../src/data/digimon-text';
import { isOffensive } from '../../../src/lib/wordfilter';
import { concat, hex, jst, randomInt, unhex } from './bytes';
import { DIGIMON_NEWS } from './encoded';
import type { Conn } from './env';
import type { Reply } from './http';
import { quota, writeAllowed } from './limits';
import { withState } from './state';

const PROFILE = 26;

const word = (rec: Uint8Array, k: number) => rec[k] | (rec[k + 1] << 8);

interface Game {
  prefix: string;
  /** D1 state key */
  key: string;
  record: number;
  block: number;
  /** which of the games' two fonts names are in (src/data/digimon-text.ts) */
  font: DigimonFont;
  /** bytes between the result code and the profile in a battle reply */
  header: () => Uint8Array;
  /** one Digimon record -> number */
  strength: (rec: Uint8Array) => number;
}

const GAMES: Record<string, Game> = {
  // D1 Tamers record (39 bytes): name +5, HP +11, attack +13, P +15, speed +17 (byte), D +19.
  // Battle header: stage (0) then seed.
  dm4: {
    prefix: 'dm4', key: 'digimon', record: 39, block: PROFILE + 3 * 39, font: 'd1',
    header: () => new Uint8Array([0, randomInt(0, 256)]),
    strength: (r) => word(r, 11) + word(r, 19) + 4 * (word(r, 13) + word(r, 15) + r[17])
  },
  // Brave Tamer record (55 bytes, built by C9F7:3F97): flag (1, FF = empty slot), species word,
  // name[6] +4, stat caps HP +0x0A, DP +0x0C, AP +0x0E, PP +0x10 (words), SP +0x12.
  // Battle header: one byte, the battle's random seed (-> DS:2CF0).
  dmB: {
    prefix: 'dmB', key: 'digimon-b', record: 55, block: PROFILE + 3 * 55, font: 'bt',
    header: () => new Uint8Array([randomInt(0, 256)]),
    strength: (r) => word(r, 0x0a) + word(r, 0x0c) + 4 * (word(r, 0x0e) + word(r, 0x10) + r[0x12])
  }
};

interface Player {
  name: string;
  region: number;
  block: string | null;
  joined: string;
  /** The account of the relay that signed up, if it was linked: only that account may change the party. */
  account?: string;
}

// The ladder's state is one D1 row, so the tamers it keeps are capped: up to about 550 bytes each with a
// Brave Tamer party, so 1,500 stay under state.ts's 1 MB. A sign-up past the cap drops the oldest tamer
// who isn't on the ladder or in the hall of fame (or, failing that, the lowest on the ladder).
const MAX_PLAYERS = 1500;
// New tamers per address per day (each console signs up once).
const SIGNUPS_PER_DAY = 20;

/** Make room for one more tamer. */
function evict(db: Db) {
  const kept = new Set([...(db.hall ?? []).map((h) => h.id), db.leader]);
  while (Object.keys(db.players).length >= MAX_PLAYERS) {
    const ranked = new Set(db.ranking);
    const idle = Object.keys(db.players)
      .filter((id) => !ranked.has(id) && !kept.has(id))
      .sort((a, b) => (db.players[a].joined < db.players[b].joined ? -1 : 1));
    const gone = idle[0] ?? [...db.ranking].reverse().find((id) => !kept.has(id));
    if (gone === undefined) return;
    delete db.players[gone];
    db.ranking = db.ranking.filter((id) => id !== gone);
  }
}

/** A tamer's handle as the game shows it (FF ends it), for the name filter. */
function handleText(game: Game, hexName: string): string {
  let out = '';
  for (const b of unhex(hexName)) {
    if (b === 0xff) break;
    out += DIGIMON_FONTS[game.font][b] ?? '・';
  }
  return out;
}

interface Db {
  players: Record<string, Player>;
  ranking: string[];
  next_id: number;
  /** Brave Tamer's hall of fame, oldest first */
  hall?: Array<{ id: string; week: string | null }>;
  leader?: string;
  leader_week?: string;
}

const le16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);

function reply(data: Uint8Array, note: string): Reply {
  return { status: 200, type: 'application/octet-stream', body: data, note };
}

/** Party strength: the sum of each present Digimon's strength. */
function power(game: Game, block: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    const rec = block.subarray(PROFILE + game.record * i, PROFILE + game.record * (i + 1));
    if (rec.length === game.record && rec[0] !== 0xff && !(rec[1] === 0xff && rec[2] === 0xff)) total += game.strength(rec);
  }
  return total;
}

function profile(db: Db, pid: string, rank = 0): Uint8Array {
  const p = db.players[pid];
  const prof = p.block
    ? unhex(p.block).slice(0, PROFILE)
    : concat(unhex(pid), unhex(p.name), new Uint8Array([p.region, 0]), new Uint8Array(6).fill(0xff), new Uint8Array(2));
  prof.set(le16(rank), 0x18);
  return prof;
}

const rankOf = (db: Db, pid: string) => (db.ranking.includes(pid) ? db.ranking.indexOf(pid) + 1 : 0);

function listing(db: Db, ids: string[]): Uint8Array {
  const shown = ids.slice(0, 8);
  const body = new Uint8Array(PROFILE * 8);
  shown.forEach((pid, i) => body.set(profile(db, pid, rankOf(db, pid)), i * PROFILE));
  return concat(new Uint8Array([shown.length]), body);
}

/** ISO week as Python's strftime("%G-W%V"), Japan time. */
export function isoWeek(t = jst()): string {
  // The week's Thursday decides the ISO year; week 1 is the one holding January 4.
  const thursday = Date.UTC(t.year, t.month - 1, t.day) + (3 - ((t.date.getUTCDay() + 6) % 7)) * 86400_000;
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * 86400_000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Brave Tamer's hall of fame (でんどう): each week's ladder leader is enshrined. Bandai's list is lost;
 * ours starts empty and fills week by week. The current leader is shown too, so the list is never empty
 * once someone is ranked. Newest first, at most 8 (the reply's size). */
function hallOfFame(db: Db): string[] {
  const week = isoWeek();
  const hall = (db.hall ??= []);
  const ladder = db.ranking;
  if (ladder.length && db.leader_week !== week) {
    // A new week: last week's standing leader goes into the hall.
    if (db.leader && Object.hasOwn(db.players, db.leader)) hall.push({ id: db.leader, week: db.leader_week ?? null });
    db.leader_week = week;
  }
  if (ladder.length) db.leader = ladder[0];
  const ids = ladder.length ? [ladder[0]] : [];
  for (const h of [...hall].reverse()) if (!ids.includes(h.id) && db.players[h.id]?.block) ids.push(h.id);
  return ids.slice(0, 8);
}

function battle(game: Game, db: Db, opp: string, myRank: number, oppRank: number, result = 0): Uint8Array {
  const block = unhex(db.players[opp].block!);
  return concat(new Uint8Array([result]), game.header(), profile(db, opp, oppRank), block.slice(PROFILE, game.block), le16(myRank), le16(oppRank));
}

function joinedNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export async function handle(conn: Conn, path: string, body: Uint8Array): Promise<Reply> {
  const cgi = path.slice(path.lastIndexOf('/') + 1);
  const game = Object.hasOwn(GAMES, cgi.slice(0, 3)) ? GAMES[cgi.slice(0, 3)] : undefined;
  if (!game) return { status: 404, type: 'text/plain', body: 'not found\r\n', note: `digimon: unknown game ${cgi}` };
  const name = cgi.slice(3);
  const tag = game.prefix === 'dm4' ? 'digimon' : `digimon ${game.prefix}`;
  const pid = hex(body.subarray(0, 8));
  const fresh = (): Db => ({ players: {}, ranking: [], next_id: 1 });
  const refuse = (why: string) => reply(new Uint8Array([1]), `${tag} ${name.replace('.cgi', '')}: ${why}`);

  // Writes. A refused sign-up gets "handle taken" (1), so the player can pick another; a refused upload
  // gets "unknown ID" (1).
  const upload = (name === 'rankbtl.cgi' || name === 'idupld.cgi') && body.length >= game.block;
  if (name === 'signup.cgi' && body.length >= 9) {
    if (isOffensive(handleText(game, hex(body.subarray(0, 8))))) return refuse('handle refused (name filter)');
    if (!(await writeAllowed(conn)) || !(await quota(conn, `signup ${game.prefix}`, SIGNUPS_PER_DAY))) return refuse('too many sign-ups from this address');
  } else if (upload) {
    // The party's profile carries the handle other players see.
    if (isOffensive(handleText(game, hex(body.subarray(8, 16))))) return refuse('handle refused (name filter)');
    if (!(await writeAllowed(conn))) return refuse('too many uploads from this address');
  }

  return withState<Db, Reply>(conn, game.key, fresh, (db) => {
    const players = db.players;
    if (name === 'signup.cgi' && body.length >= 9) {
      const handleName = hex(body.subarray(0, 8));
      if (Object.values(players).some((p) => p.name === handleName)) return reply(new Uint8Array([1]), `${tag} signup: handle ${handleName} taken`);
      evict(db);
      const id = new Uint8Array([...String(db.next_id).padStart(8, '0')].map(Number));
      db.next_id++;
      players[hex(id)] = { name: handleName, region: body[8], block: null, joined: joinedNow(), ...(conn.accountId ? { account: conn.accountId } : {}) };
      return reply(concat(new Uint8Array([0]), id), `${tag} signup: ${handleName} -> ID ${hex(id)}`);
    }
    // IDs are sequential, so anyone could upload as anyone: a tamer signed up from a linked relay takes
    // uploads only from that account.
    if (upload && Object.hasOwn(players, pid) && players[pid].account && players[pid].account !== conn.accountId) {
      return refuse(`${pid} belongs to another account`);
    }
    if (name === 'login.cgi') {
      const known = pid in players;
      const news = Uint8Array.from(DIGIMON_NEWS[game.prefix], (c) => c.charCodeAt(0));
      return reply(concat(new Uint8Array([0]), news), `${tag} login ${pid} command ${hex(body.subarray(8, 9))} (${known ? 'known' : 'unknown'})`);
    }
    if (name === 'rankbtl.cgi' && body.length >= game.block) {
      if (!(pid in players)) return reply(new Uint8Array([1]), `${tag} rankbtl: unknown ID ${pid}`);
      players[pid].block = hex(body.subarray(0, game.block));
      const ladder = db.ranking;
      const newcomer = !ladder.includes(pid);
      if (newcomer) ladder.push(pid);
      const me = ladder.indexOf(pid);
      if (me === 0) return reply(new Uint8Array([2]), `${tag} rankbtl: ${pid} is #1, party updated`);
      const opp = ladder[me - 1];
      const mine = power(game, body);
      const theirs = power(game, unhex(players[opp].block!));
      // Ranks are 0-based on the wire; the challenger's 0 reads "ランクがい" (unranked)
      const out = battle(game, db, opp, newcomer ? 0 : me, me - 1);
      if (mine > theirs) [ladder[me - 1], ladder[me]] = [pid, opp];
      return reply(out, `${tag} rankbtl: ${pid} (#${me + 1}, ${mine}) vs ${opp} (#${me}, ${theirs}) -> ${mine > theirs ? 'win' : 'lose'}`);
    }
    if (name === 'rankdl.cgi') return reply(listing(db, db.ranking), `${tag} rankdl: ${db.ranking.length} ranked`);
    if (name === 'idupld.cgi' && body.length >= game.block) {
      if (!(pid in players)) return reply(new Uint8Array([1]), `${tag} idupld: unknown ID ${pid}`);
      players[pid].block = hex(body.subarray(0, game.block));
      return reply(new Uint8Array([0]), `${tag} idupld: ${pid} party stored`);
    }
    if (name === 'idsrch.cgi' && body.length >= 16) {
      const key = hex(body.subarray(8, 16));
      if (game.prefix === 'dmB' && key === 'fd'.repeat(8)) {
        // Brave Tamer's でんどうバトル searches with a blank key: the hall of fame.
        const hall = hallOfFame(db);
        return reply(hall.length ? listing(db, hall) : new Uint8Array([0]), `${tag} idsrch hall of fame: ${hall.length}`);
      }
      const hits = Object.keys(players).filter((k) => players[k].block && (k === key || players[k].name === key));
      return reply(hits.length ? listing(db, hits) : new Uint8Array([0]), `${tag} idsrch ${key}: ${hits.length} found`);
    }
    if (name === 'idbtl.cgi' && body.length >= 16) {
      const target = hex(body.subarray(8, 16));
      if (!players[target]?.block) return reply(new Uint8Array([1]), `${tag} idbtl: ${target} not found`);
      return reply(battle(game, db, target, 0, 0), `${tag} idbtl: ${pid} vs ${target}`);
    }
    return { status: 404, type: 'text/plain', body: 'not found\r\n', note: `${tag}: unhandled ${cgi} (${body.length} bytes)` };
  });
}
