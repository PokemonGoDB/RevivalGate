// Bandai "charge" service on wgb01.channel.or.jp/service/charge/: a port of charge.py.
// nph-* are non-parsed-header CGIs: the data travels in X-SWAN-* response headers. Every reply is
// 200 with an *-RET header whose number is the result code (0 = success). See the game server
// repo's docs/wondergate/charge.md.
import { jst, randomUrlsafe } from './bytes';
import type { Conn } from './env';
import type { Reply } from './http';

export const CONTENT_PATHS = ['/service/swan-ranking/pocketf'];

/** CMND-AID: the game stores and echoes back exactly 80 bytes. */
const token80 = () => randomUrlsafe(60).slice(0, 80);

/** YYYYMMDDhhmmss + one digit (GunPey EX's sample ends in 3; meaning unknown). */
function now15() {
  const t = jst();
  return `${t.Y}${t.m}${t.d}${t.H}${t.M}${t.S}0`;
}

/** SRVC-CNT: a new number per call. A cartridge keeps the first one as its customer ID. */
async function nextCustomer(conn: Conn, service: string): Promise<number> {
  const row = await conn.env.WG_DB.prepare(
    'INSERT INTO charge_counter (service, n) VALUES (?, 1) ON CONFLICT (service) DO UPDATE SET n = n + 1 RETURNING n'
  )
    .bind(service)
    .first<{ n: number }>();
  return row!.n;
}

/** Content request (the game's own URL, after nph-session): needs CNTS-RET and CNTS-AID. */
export function contentReply(headers: Record<string, string>): Record<string, string> {
  return { 'X-SWAN-CNTS-RET': '0', 'X-SWAN-CNTS-AID': (headers['x-swan-cnts-aid'] ?? '').slice(0, 80) || token80() };
}

export async function handle(conn: Conn, path: string, headers: Record<string, string>, _body: Uint8Array): Promise<Reply> {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const srvc = headers['x-swan-srvc-id'] ?? '';
  let h: Record<string, string> = {};
  if (name === 'nph-srvccount') {
    // Each service ID gets a counter row; real ones are 8 characters (00000000, BAN00A01), so anything
    // else shares one rather than adding rows.
    const service = /^[0-9A-Za-z]{1,16}$/.test(srvc) ? srvc : '-';
    h = { 'X-SWAN-SRVC-RET': '0', 'X-SWAN-SRVC-CNT': String(await nextCustomer(conn, service)) };
  } else if (name === 'nph-gettime') {
    h = { 'X-SWAN-TIME-RET': '0', 'X-SWAN-TIME-NOW': now15() };
  } else if (name === 'nph-srvcinfo') {
    // Free service, open all the time, no maintenance window.
    h = {
      'X-SWAN-SRVC-RET': '0', 'X-SWAN-SRVC-OPEN': '200001010000000', 'X-SWAN-SRVC-CLOSE': '209912312359590',
      'X-SWAN-SRVC-PRC': '0', 'X-SWAN-SRVC-WAY': '0', 'X-SWAN-SRVC-TIM': '0', 'X-SWAN-SRVC-TRM': '0'
    };
  } else if (name === 'nph-session') {
    h = {
      'X-SWAN-CMND-RET': '0', 'X-SWAN-CMND-AID': token80(),
      'X-SWAN-CMND-URL': 'http://wgg01.channel.or.jp/service/swan-ranking/pocketf', 'X-SWAN-CMND-BAL': '0'
    };
  } else if (name === 'nph-contents') {
    h = { 'X-SWAN-CNTS-RET': '0', 'X-SWAN-CNTS-AID': '0000000001' };
  }
  // nph-* ("non-parsed header") CGIs ended the connection when they finished, and games read the
  // reply until it closes: Rainbow Islands and Gundam Vol. 1 wait for that, Pocket Fighter gives up
  // after 30 s. (The Python server keeps the connection open until its 60 s idle timeout.)
  return { status: 200, type: 'text/plain', body: '', note: `${name} srvc=${srvc}`, headers: h, hangUp: name.startsWith('nph-') };
}
