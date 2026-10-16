// Buffers Evolution: POST http://wgg01.channel.or.jp/service/buffersevolution (HTTP/1.0).
// A port of buffers.py; see the game server repo's docs/wondergate/buffers-evolution.md.
import { isOffensive } from '../../../src/lib/wordfilter';
import { jst, latin1 } from './bytes';
import type { Conn } from './env';
import type { Reply } from './http';
import { writeAllowed } from './limits';
import { Store, type Order } from './ranking';

const GAME = 'buffers';
const COURSES = 36;
const NONE = 'AAAA000000000000';
// The contest from the ROM's own sample reply; nobody sends contest times.
const CONTEST_NAME = 'CONTEST NAME ARIOCH'; // 19 chars: the 20th is the space
const CONTEST_COURSE = '00201000a8B4';
const asText = (): Order => 'text';

function parse(text: string): [string, string, string[]] | null {
  const i = text.indexOf('BFEVSND=\r\n');
  if (i < 0) return null;
  text = text.slice(i + 10);
  const name = text.slice(0, 16);
  const rest = text.slice(16);
  const m = new RegExp(`^ ?([0-9A-Fa-f]{6}) ((?:[0-9A-Fa-f]{10} ){${COURSES}})`).exec(rest);
  if (!m) return null;
  return [name.replace(/\s+$/, ''), m[1].toUpperCase(), m[2].split(' ').filter(Boolean)];
}

export async function handle(conn: Conn, body: Uint8Array): Promise<Reply> {
  const got = parse(latin1(body));
  if (!got) return { status: 400, type: 'text/plain', body: 'bad request\r\n', note: 'buffers: unparsed body' };
  const [name, code, fields] = got;
  const store = new Store(conn);
  const times = fields.flatMap((f, course) => (f.slice(0, 6) !== '000000' ? [{ course, score: f.slice(0, 6), extra: f.slice(6) }] : []));
  // An offensive name, or too many uploads from one address: answered the same, not stored.
  if (times.length && !isOffensive(name) && (await writeAllowed(conn))) await store.submit(GAME, code, name, times, asText);

  const entries: string[] = [];
  // Lowest time first (the scores are fixed-width digit strings). Each course's page starts one place
  // ahead of the player: the time to beat.
  const courses = Array.from({ length: COURSES }, (_, i) => i);
  const tables = await store.tables(GAME, code, name, courses, asText, 1, 2, true);
  for (const course of courses) {
    const t = tables.get(course)!;
    if (!t.rank) entries.push(NONE);
    else entries.push(`${String(t.rank).padStart(4, '0').slice(-4)}${t.top}${t.page[0].score}`);
  }
  const t = jst();
  const today = `${t.Y}${t.m}${t.d}`;
  const start = `${t.Y}${t.m}01`;
  const last = new Date(Date.UTC(t.date.getUTCFullYear(), t.date.getUTCMonth() + 1, 0)).getUTCDate();
  const end = `${t.Y}${t.m}${String(last).padStart(2, '0')}`;
  const contest = `${CONTEST_NAME.padEnd(20).slice(0, 20)}${start} ${end} ${CONTEST_COURSE} ${NONE}`;
  const line = `${today} ${entries.join(' ')} ${contest}`;
  const played = entries.filter((e) => e !== NONE).length;
  return { status: 200, type: 'text/plain', body: `BFEVREC=\r\n${line}\r\n`, note: `buffers ${name}/${code}: ${played} ranked` };
}
