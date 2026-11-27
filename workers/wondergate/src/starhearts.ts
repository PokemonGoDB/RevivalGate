// Star Hearts (Bandai 2001): the Gate Bazaar, s_hearts.wgg.channel.or.jp/cgi-bin/starhearts.cgi?000N...
// A port of starhearts.py. Routines 3..5 read a number: 3 hex digits (digit count + 4, least
// significant first), 2 unused, then the number in hex.
import { jst, randomInt } from './bytes';
import type { Conn } from './env';
import type { Reply } from './http';
import { writeAllowed } from './limits';
import { withState } from './state';

/** The reply the cartridge reads as value. Its hex reader (A000:350C) rotates the low word left a digit at a
 *  time where it should shift it, so each digit pushed out of the top comes back in at the bottom and is added
 *  to the next one: plain hex is read right only below 0x10000 (it read 00010000 as 65537, seen in the game).
 *  So for the high word's digits, lowest first, take back what the rotation adds. Below 0x10000 this is plain
 *  hex. The dialogue draws nine digits: with a tenth the first comes out as a stray character (seen in the
 *  game), so the number stops at 999,999,999. */
function number(value: number): string {
  const v = Math.min(value, 999_999_999) >>> 0;
  let x = v & 0xffff;
  let low = '';
  for (const shift of [16, 20, 24, 28]) {
    const d = (x - (v >>> shift)) & 0xf;
    low = d.toString(16).toUpperCase() + low;
    x = (x - d) & 0xffff;
    x = (x >>> 4) | ((x & 0xf) << 12);
  }
  const digits = x.toString(16).toUpperCase().padStart(4, '0') + low;
  const count = (digits.length + 4).toString(16).toUpperCase().padStart(3, '0').split('').reverse().join('');
  return `${count}00${digits}`;
}

interface State {
  members: number[];
  /** Bazaar visits: the day (Japan time) `today` counts, and the count since opening. As starhearts.py. */
  day?: string;
  today?: number;
  visitors?: number;
}

/** Count a bazaar visit; returns [today's count, all-time count]. A visit from an address that's writing too
 *  often isn't counted: it reads the standing counts, moved off a round number so the greeters' gifts (at
 *  multiples of 10, 100 and 1000) can't be collected over and over. */
async function visit(conn: Conn): Promise<[number, number]> {
  const t = jst();
  const day = `${t.Y}-${t.m}-${t.d}`;
  const count = await writeAllowed(conn);
  return withState<State, [number, number]>(conn, 'starhearts', () => ({ members: [] }), (db) => {
    const today = db.day === day ? db.today ?? 0 : 0;
    const total = db.visitors ?? 0;
    if (!count) return [today + (today % 10 === 0 ? 1 : 0), total + (total % 10 === 0 ? 1 : 0)];
    db.day = day;
    db.today = today + 1;
    db.visitors = total + 1;
    return [db.today, db.visitors];
  });
}

export async function handle(conn: Conn, query: string): Promise<Reply> {
  const q = query.toUpperCase();
  if (q.startsWith('0005')) {
    const member = randomInt(10_000_000, 99_999_999);
    // Nothing reads the list back, so a refused write still gets its number.
    if (await writeAllowed(conn)) await withState<State, void>(conn, 'starhearts', () => ({ members: [] }), (db) => {
      db.members.push(member);
      // Nothing reads the list back yet; keep the latest 10,000.
      if (db.members.length > 10_000) db.members.splice(0, db.members.length - 10_000);
    });
    return { status: 200, type: 'text/plain', body: number(member), note: `starhearts: new member ${member}` };
  }
  if (q.startsWith('0002')) return { status: 200, type: 'text/plain', body: number(0), note: 'starhearts: connection check' };
  if (q.startsWith('0003') || q.startsWith('0004')) {
    const [today, total] = await visit(conn);
    const n = q.startsWith('0003') ? today : total;
    return { status: 200, type: 'text/plain', body: number(n), note: `starhearts: visitor ${n} (${q.startsWith('0003') ? "today's" : 'all-time'})` };
  }
  return { status: 404, type: 'text/plain', body: 'not found\r\n', note: `starhearts: unknown ?${query}` };
}
