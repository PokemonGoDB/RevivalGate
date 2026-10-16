// Lode Runner for WonderSwan: stages players send from the cartridge over the link cable. A port of
// loderunner.py. Our addition: Bandai never took uploads. The player picks DATA I/O -> 送信 -> MAP1/MAP2
// with the adapter on the link port; wgcore's link peer plays the receiving console and posts the
// 0x200-byte editor slot record here:
//   POST /loderunner/stage   Host: link.swanrevival.com   body = the record
//     +0x000 28x18 tile grid (504 bytes, 0x00-0x1E)   +0x1F8 music word
//     +0x1FA CRC-32 (zlib) of +0..+0x1F9              +0x1FE 4C 97
// Valid stages go to a PENDING queue for review (wg_state 'loderunner'), with the relay's account so
// the site can credit the player. Nothing is published from here; the download list stays separate.
// Replies (the adapter logs them; the game has already shown "sent"):
//   200 "stage queued <id>"   new, or the same grid already waiting
//   409 "stage refused: ..."  built-in map, or the grid was already reviewed
//   422 "stage refused: ..."  not a valid slot record
import { hex } from './bytes';
import type { Conn } from './env';
import type { Reply } from './http';
import { LODERUNNER_BUILTIN } from './loderunner-builtin';
import { withState } from './state';

const GRID = 28 * 18;
const RECORD = 0x200;

interface Stage {
  id: string;
  sha1: string;
  grid: string;
  music: number;
  received: string;
  source: string;
  peer: string;
  /** The linked relay's account (null for an unlinked relay): who the site credits. */
  account_id: string | null;
  status: 'pending' | string;
  times_received: number;
}
interface Queue {
  stages: Stage[];
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** zlib's CRC-32. */
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Why rec isn't a valid slot record, or null. */
function check(rec: Uint8Array): string | null {
  if (rec.length !== RECORD) return `${rec.length} bytes, a slot record is ${RECORD}`;
  if (rec[0x1fe] !== 0x4c || rec[0x1ff] !== 0x97) return 'no 4C 97 valid mark';
  const stored = (rec[0x1fa] | (rec[0x1fb] << 8) | (rec[0x1fc] << 16) | (rec[0x1fd] << 24)) >>> 0;
  if (crc32(rec.subarray(0, 0x1fa)) !== stored) return 'CRC-32 mismatch';
  if (rec.subarray(0, GRID).some((b) => b > 0x1e)) return 'tile value above 0x1E';
  return null;
}

function reply(status: number, text: string, note: string): Reply {
  return { status, type: 'text/plain', body: text + '\r\n', note, close: true };
}

export async function handle(conn: Conn, headers: Record<string, string>, body: Uint8Array): Promise<Reply> {
  const why = check(body);
  if (why) return reply(422, `stage refused: ${why}`, `loderunner: refused (${why})`);
  const grid = body.slice(0, GRID);
  const sha = hex(new Uint8Array(await crypto.subtle.digest('SHA-1', grid)));
  if (sha in LODERUNNER_BUILTIN) return reply(409, "stage refused: a copy of the game's own map", `loderunner: refused, ${LODERUNNER_BUILTIN[sha]}`);
  const sid = sha.slice(0, 12);
  const music = body[GRID] | (body[GRID + 1] << 8);

  return withState<Queue, Reply>(conn, 'loderunner', () => ({ stages: [] }), (q) => {
    const seen = q.stages.find((s) => s.sha1 === sha);
    if (seen) {
      seen.times_received = (seen.times_received ?? 1) + 1;
      if (seen.status === 'pending') return reply(200, `stage queued ${sid}`, `loderunner: stage queued ${sid} (already in the queue)`);
      return reply(409, `stage refused: already received (${seen.status})`, `loderunner: ${sid} already ${seen.status}`);
    }
    q.stages.push({
      id: sid,
      sha1: sha,
      grid: hex(grid),
      music,
      received: new Date().toISOString().replace(/\.\d+Z$/, '+00:00'),
      source: 'link-cable',
      peer: headers['x-wg-peer'] ?? '',
      account_id: conn.accountId,
      status: 'pending',
      times_received: 1
    });
    return reply(200, `stage queued ${sid}`, `loderunner: stage queued ${sid} (new, music ${music}, pending review)`);
  });
}
