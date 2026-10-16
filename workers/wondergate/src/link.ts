// POST /link {"code":"ABCD2345","name":"Living-room PC"} -> 201 {"token":"…","handle":"mio"}
// Swaps a one-time code from the account page for a device token. Same rules as the site's
// /api/devices/claim/ (single use, ten minutes, only hashes stored); it lives on the game server too
// so a client needs one address: the tunnel's server. Another server can offer the same endpoint
// for its own accounts, or leave it out.
import type { Env } from './env';

const CODE = /^[A-Z0-9]{8}$/;

async function sha256url(value: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function link(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const { success } = await env.LINK_LIMITER.limit({ key: ip });
  if (!success) return Response.json({ error: 'Too many attempts. Wait a minute and try again.' }, { status: 429 });

  let body: { code?: unknown; name?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send a code.' }, { status: 400 });
  }
  const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const name = String(body.name ?? '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 40) || 'Unnamed device';
  if (!CODE.test(code)) return Response.json({ error: 'A link code has 8 characters.' }, { status: 400 });

  const now = Math.floor(Date.now() / 1000);
  // Delete first, so two simultaneous claims can't both succeed
  const claimed = await env.WG_DB.prepare('DELETE FROM link_codes WHERE code_hash = ? AND expires > ? RETURNING account_id')
    .bind(await sha256url(code), now)
    .first<{ account_id: string }>();
  if (!claimed) return Response.json({ error: 'That code is unknown, used, or expired. Make a new one on your account page.' }, { status: 400 });

  const token = randomToken();
  await env.WG_DB.prepare('INSERT INTO devices (id, account_id, name, token_hash, created) VALUES (?, ?, ?, ?, ?)')
    .bind(randomToken(9), claimed.account_id, name, await sha256url(token), now)
    .run();
  const account = await env.WG_DB.prepare('SELECT handle FROM accounts WHERE id = ?').bind(claimed.account_id).first<{ handle: string | null }>();
  return Response.json({ token, handle: account?.handle ?? null }, { status: 201, headers: { 'cache-control': 'no-store' } });
}
