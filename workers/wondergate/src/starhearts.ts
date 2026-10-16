// Star Hearts (Bandai 2001): the Gate Bazaar, s_hearts.wgg.channel.or.jp/cgi-bin/starhearts.cgi?000N...
// A port of starhearts.py. Routines 3..5 read a number: 3 hex digits (digit count + 4, least
// significant first), 2 unused, then the number in hex.
import { randomInt } from './bytes';
import type { Conn } from './env';
import type { Reply } from './http';
import { writeAllowed } from './limits';
import { withState } from './state';

function number(value: number): string {
  const digits = (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const count = (digits.length + 4).toString(16).toUpperCase().padStart(3, '0').split('').reverse().join('');
  return `${count}00${digits}`;
}

export async function handle(conn: Conn, query: string): Promise<Reply> {
  const q = query.toUpperCase();
  if (q.startsWith('0005')) {
    const member = randomInt(10_000_000, 99_999_999);
    // Nothing reads the list back, so a refused write still gets its number.
    if (await writeAllowed(conn)) await withState<{ members: number[] }, void>(conn, 'starhearts', () => ({ members: [] }), (db) => {
      db.members.push(member);
      // Nothing reads the list back yet; keep the latest 10,000.
      if (db.members.length > 10_000) db.members.splice(0, db.members.length - 10_000);
    });
    return { status: 200, type: 'text/plain', body: number(member), note: `starhearts: new member ${member}` };
  }
  if (q.startsWith('0002')) return { status: 200, type: 'text/plain', body: number(0), note: 'starhearts: connection check' };
  if (q.startsWith('0003') || q.startsWith('0004')) return { status: 200, type: 'text/plain', body: number(0), note: `starhearts ?${query}: 0 (WIP)` };
  return { status: 404, type: 'text/plain', body: 'not found\r\n', note: `starhearts: unknown ?${query}` };
}
