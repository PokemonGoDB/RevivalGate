// A service's state as one JSON value in D1, updated read-modify-write with a version check:
// if another request changed it in between, the update runs again on the fresh value.
import type { Conn } from './env';

const ATTEMPTS = 8;
// D1 refuses rows over 2 MB, which would break the service for everyone. Well before that, writes
// that would grow a row stop (that request fails); writes that keep or shrink it still go through,
// so people already playing carry on.
const MAX_STATE = 1_000_000;

export async function withState<S, R>(conn: Conn, key: string, init: () => S, update: (state: S) => R | Promise<R>): Promise<R> {
  const db = conn.env.WG_DB;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const row = await db.prepare('SELECT value, version FROM wg_state WHERE key = ?').bind(key).first<{ value: string; version: number }>();
    const state: S = row ? JSON.parse(row.value) : init();
    const before = row?.value ?? '';
    const result = await update(state);
    const after = JSON.stringify(state);
    if (after === before) return result;
    if (after.length > MAX_STATE && after.length > before.length) {
      throw new Error(`state ${key}: ${after.length} bytes, over the ${MAX_STATE}-byte limit`);
    }
    const write = row
      ? await db.prepare('UPDATE wg_state SET value = ?, version = version + 1 WHERE key = ? AND version = ?').bind(after, key, row.version).run()
      : await db.prepare('INSERT OR IGNORE INTO wg_state (key, value, version) VALUES (?, ?, 1)').bind(key, after).run();
    if (write.meta.changes === 1) return result;
  }
  throw new Error(`state ${key}: too many concurrent updates`);
}

/** Read-only view of a service's state. */
export async function readState<S>(conn: Conn, key: string, init: () => S): Promise<S> {
  const row = await conn.env.WG_DB.prepare('SELECT value FROM wg_state WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? JSON.parse(row.value) : init();
}
