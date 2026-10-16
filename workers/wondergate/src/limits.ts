// Per-address limits on what one player can write. Two kinds:
//   writeAllowed  Workers rate limiting (WRITE_LIMITER), per minute. Cloudflare counts loosely (a flood
//                 gets several times the limit through), so it's a brake, not a guarantee.
//   quota         a hard daily count in D1 (wg_quota), for things that create something new: mail
//                 accounts and messages, Digimon tamers, Wonder Classic members, Dark Eyes mercenaries.
// The hard caps on sizes and collections in each service are what keep the shared state bounded; these
// only stop one address from filling them. Loopback is exempt so the local test suites aren't throttled
// (as TUNNEL_LIMITER in index.ts).
import { hex } from './bytes';
import type { Conn } from './env';

const exempt = (peer: string) => !peer || peer === '127.0.0.1' || peer === '::1';

/** The address to count: IPv6 by its /64, since one subscriber is handed a whole /64. */
export function addressKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1); // IPv4-mapped
  const [head, tail = ''] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/** Whether this address may write now (score uploads, game state, mail). */
export async function writeAllowed(conn: Conn): Promise<boolean> {
  if (exempt(conn.peer)) return true;
  const ok = (await conn.env.WRITE_LIMITER.limit({ key: addressKey(conn.peer) })).success;
  if (!ok) conn.log('write refused: rate limit');
  return ok;
}

/** Count one `kind` for this address today (UTC); false once `perDay` have been counted. Rows are keyed
 * by a SHA-256 of the kind, day and address, never the address itself, and are deleted the next day. */
export async function quota(conn: Conn, kind: string, perDay: number): Promise<boolean> {
  if (exempt(conn.peer)) return true;
  const day = Math.floor(Date.now() / 86400_000);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}\n${day}\n${addressKey(conn.peer)}`));
  const db = conn.env.WG_DB;
  const [, counted] = await db.batch([
    db.prepare('DELETE FROM wg_quota WHERE day < ?').bind(day),
    // At the limit the update's WHERE fails, so nothing comes back.
    db.prepare('INSERT INTO wg_quota (key, day, n) VALUES (?, ?, 1) ON CONFLICT (key) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n').bind(
      hex(new Uint8Array(digest)),
      day,
      perDay
    )
  ]);
  const ok = counted.results.length > 0;
  if (!ok) conn.log(`${kind} refused: ${perDay} a day from this address`);
  return ok;
}
