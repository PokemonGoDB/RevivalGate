// Test Swan Revival Link the way Mednafen uses it: console frames on stdin, replies on stdout.
//
//   node scripts/wg-link-test.mjs [--adapter ~/WonderswanCartDumper/wondergate/host/wgcore-host]
//   node scripts/wg-link-test.mjs --link /path/to/unpacked/swan-link/swan-link   (a release package,
//                                 with its own bin/wgcore-host; or a wrapper that runs one in Docker)
//
// Starts a fresh Worker on :8790, adds a test account with a device token to its database, runs
// link/swan-link with that token, and plays a Raku Jongg upload + ranking request byte by byte.
// Checks the reply table and that the stored score carries the account.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { GAME_REPO, ROOT, WRANGLER, assertFree, sleep, start, stopAll, waitAll } from './lib/procs.mjs';

const { values: opt } = parseArgs({
  options: { adapter: { type: 'string' }, link: { type: 'string' }, work: { type: 'string' } }
});
const work = opt.work ?? mkdtempSync(join(tmpdir(), 'wg-link-'));
const PORT = 8790;
await assertFree([PORT]);
const state = join(work, 'd1');
const d1 = (args) => execFileSync(WRANGLER, ['d1', ...args, '--local', '--persist-to', state, '-c', 'workers/wondergate/wrangler.jsonc'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, CI: '1' } });
d1(['migrations', 'apply', 'swanrevival-wondergate']);

// A test account and device, as the site's /api/devices/claim/ would create them.
const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('base64url');
d1(['execute', 'swanrevival-wondergate', '--command',
  `INSERT INTO accounts (id, handle, created) VALUES ('acct-test', 'linktester', 0);
   INSERT INTO devices (id, account_id, name, token_hash, created) VALUES ('dev-test', 'acct-test', 'test', '${hash}', 0);`]);
writeFileSync(join(work, 'link.json'), JSON.stringify({ token, handle: 'linktester', tokenServer: `ws://127.0.0.1:${PORT}/tunnel` }));

start('worker', WRANGLER, ['dev', '-c', 'workers/wondergate/wrangler.jsonc', '--port', String(PORT), '--persist-to', state], { env: { ...process.env, CI: '1' } });
await waitAll([PORT]);

// A package finds its own adapter; the repo's link/ uses the game server repo's build.
const adapter = opt.adapter ?? (opt.link ? null : join(GAME_REPO, 'host', 'wgcore-host'));
const link = spawn(opt.link ?? join(ROOT, 'link', 'swan-link'), ['MEDNAFEN-ARG', ...(adapter ? ['--adapter', adapter] : []), '--server', `ws://127.0.0.1:${PORT}/tunnel`, '--config', join(work, 'link.json'), '--log', join(work, 'link.log')], {
  stdio: ['pipe', 'pipe', 'inherit']
});

// ---------- the console's side ----------
let out = Buffer.alloc(0);
link.stdout.on('data', (d) => (out = Buffer.concat([out, d])));
const frame = (t, cmd, params = Buffer.alloc(0)) => Buffer.concat([Buffer.from([t, 0, params.length + 1, cmd]), params]);
async function ask(t, cmd, params, waitMs = 2000) {
  link.stdin.write(frame(t, cmd, params));
  for (let i = 0; i < waitMs / 10; i++) {
    if (out.length >= 3 && out.length >= 3 + ((out[1] << 8) | out[2])) {
      const len = (out[1] << 8) | out[2];
      const reply = out.subarray(0, 3 + len);
      out = out.subarray(3 + len);
      return { type: reply[0], cmd: reply[3], params: reply.subarray(4) };
    }
    await sleep(10);
  }
  throw new Error(`no reply to ${t.toString(16)}:${cmd.toString(16)}`);
}
const fail = (msg) => {
  console.log(`[FAIL] ${msg}\n       log: ${join(work, 'link.log')}, ${join(work, 'adapter.log')}`);
  stopAll();
  link.kill();
  process.exit(1);
};

const on = await ask(0x01, 0x02, undefined, 30_000); // a package run in Docker takes a moment to start
if (on.params.toString() !== '10') fail(`power-on: ${on.params.toString('hex')}`);
const host = 'rakujang.wgg.channel.or.jp';
const dns = await ask(0x11, 0x08, Buffer.from(host + '\0'));
if (dns.params[0] !== 1) fail('DNS lookup refused');
const sock = (await ask(0x11, 0x01, Buffer.from([0]))).params[0];
const conn = await ask(0x11, 0x03, Buffer.from([sock, 0, 2, 80, 0, 127, 0, 0, 1]));
if (conn.params[1] !== 1) fail(`connect: ${conn.params.toString('hex')}`);

const body = `*=FFFFFF&owner=ABC&score=1|012345|03\r\n&list=rakujang|1|20`;
const req = Buffer.from(`POST /swan-ranking HTTP/1.1\r\nHost: ${host}\r\nContent-Length: ${body.length}\r\n\r\n${body}`, 'latin1');
for (let i = 0; i < req.length; i += 140) await ask(0x11, 0x0e, Buffer.concat([Buffer.from([sock]), req.subarray(i, i + 140)]));

let reply = Buffer.alloc(0);
for (let i = 0; i < 300; i++) {
  const r = await ask(0x11, 0x0f, Buffer.from([sock, 0x40]));
  const n = r.params[1];
  if (n === 0xff) break; // the server closed: the reply is complete
  if (n) reply = Buffer.concat([reply, r.params.subarray(2, 2 + n)]);
  else await sleep(20);
}
await ask(0x11, 0x07, Buffer.from([sock]));
link.stdin.end();

const text = reply.toString('latin1');
const checks = [
  ['HTTP 200 from the Worker', text.startsWith('HTTP/1.1 200 OK')],
  ['course block with the uploaded score', /course=1\|1\|1\|012345\|012345\|1/.test(text)],
  ['ranking row for ABC', text.includes('1|012345|ABC|03')]
];
const row = JSON.parse(execFileSync(WRANGLER, ['d1', 'execute', 'swanrevival-wondergate', '--local', '--persist-to', state, '-c', 'workers/wondergate/wrangler.jsonc', '--json', '--command', "SELECT account_id FROM swan_ranking WHERE game = 'rakujang'"], { cwd: ROOT, env: { ...process.env, CI: '1' } }))[0].results[0];
checks.push(['score stored with the linked account', row?.account_id === 'acct-test']);
let bad = 0;
for (const [name, ok] of checks) {
  bad += !ok;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
}
if (bad) console.log(`reply was:\n${JSON.stringify(text)}`);
stopAll();
process.exit(bad ? 1 : 0);
