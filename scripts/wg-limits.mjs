// Check the game server's abuse limits (workers/wondergate/src/limits.ts and the caps in each service)
// against a local Worker.
//
//   node scripts/wg-limits.mjs [--server ws://127.0.0.1:8795/tunnel --state <its --persist-to dir>]
//
// Without --server it starts its own Worker on :8790 (WG_WORKER_PORT) with a fresh local D1 and stops it
// afterwards. Loopback is exempt from the per-address limits, so every tunnel here claims a made-up
// address with cf-connecting-ip (wrangler dev passes it through; Cloudflare sets it in production).
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, WRANGLER, assertFree, start, stopAll, waitAll } from './lib/procs.mjs';

const { values: opt } = parseArgs({ options: { server: { type: 'string' }, state: { type: 'string' } } });
const WORKER_PORT = Number(process.env.WG_WORKER_PORT ?? 8790);
const state = opt.state ?? join(mkdtempSync(join(tmpdir(), 'wg-limits-')), 'd1');
const server = opt.server ?? `ws://127.0.0.1:${WORKER_PORT}/tunnel`;

const d1 = (sql) =>
  JSON.parse(
    execFileSync(WRANGLER, ['d1', 'execute', 'swanrevival-wondergate', '--local', '--persist-to', state, '-c', 'workers/wondergate/wrangler.jsonc', '--json', '--command', sql], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' }
    })
  )[0].results;

if (!opt.server) {
  await assertFree([WORKER_PORT]);
  execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'swanrevival-wondergate', '--local', '--persist-to', state, '-c', 'workers/wondergate/wrangler.jsonc'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, CI: '1' }
  });
  start('worker', WRANGLER, ['dev', '-c', 'workers/wondergate/wrangler.jsonc', '--port', String(WORKER_PORT), '--persist-to', state, '--log-level', 'warn'], {
    env: { ...process.env, CI: '1' }
  });
  await waitAll([WORKER_PORT]);
}

// ---------- tunnels ----------

/** One console connection: send chunks (each its own WebSocket message), then EOF unless told not to;
 * collect the reply until the server closes. A string chunk is Latin-1 bytes. */
function tunnel(port, chunks, { ip = '198.51.100.1', token, eof = true, ms = 20000, wait = 0 } = {}) {
  return new Promise((res) => {
    const ws = new WebSocket(server, { headers: ip ? { 'cf-connecting-ip': ip } : {} });
    ws.binaryType = 'arraybuffer';
    const got = [];
    const timer = setTimeout(() => (ws.close(), res({ code: 'timeout', text: Buffer.concat(got).toString('latin1') })), ms);
    ws.onopen = () => ws.send(JSON.stringify({ v: 1, port, ...(token ? { token } : {}) }));
    ws.onmessage = async (ev) => {
      if (typeof ev.data !== 'string') return got.push(Buffer.from(ev.data));
      if (!JSON.parse(ev.data).ready) return;
      for (const c of [].concat(chunks)) {
        if (ws.readyState !== WebSocket.OPEN) break;
        ws.send(typeof c === 'string' ? Buffer.from(c, 'latin1') : c);
        if (wait) await new Promise((r) => setTimeout(r, wait));
      }
      if (eof && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ eof: true }));
    };
    ws.onclose = (ev) => (clearTimeout(timer), res({ code: ev.code, text: Buffer.concat(got).toString('latin1') }));
    ws.onerror = () => {};
  });
}

const post = (host, path, body, headers = {}) =>
  `POST http://${host}${path} HTTP/1.1\r\nHost: ${host}\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}Content-Length: ${Buffer.byteLength(body, 'latin1')}\r\n\r\n${body}`;
const get = (host, path) => `GET ${path} HTTP/1.1\r\nHost: ${host}\r\n\r\n`;
const bodyOf = (text) => text.slice(text.indexOf('\r\n\r\n') + 4);

let fails = 0;
function check(what, ok, detail = '') {
  fails += !ok;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${what}${ok || !detail ? '' : `: ${detail}`}`);
}
let ipN = 10;
const freshIp = () => `198.51.100.${ipN++}`;

// ---------- rankings ----------

const rank = (body, opts) => tunnel(80, post('rakujang.wgg.channel.or.jp', '/swan-ranking', body), opts);
const rows = (where) => d1(`SELECT game, course, player, owner, score, account_id FROM swan_ranking WHERE ${where} ORDER BY game, course`);

await rank('*=100001&owner=GOOD&score=1|000100&score=9|000200&score=0|000300');
check('ranking: course outside 1..3 not stored', JSON.stringify(rows("player = '100001'").map((r) => r.course)) === '[1]');

const accepted = await rank('*=100002&owner=NICE&score=1|000100|00&list=RANK|1|20');
const refused = await rank('*=100003&owner=FUCK&score=1|000900|00&list=RANK|1|20');
check(
  'ranking: offensive owner answered like a stored score, not stored',
  !rows("player = '100003'").length && refused.text.includes('RANK=') && bodyOf(refused.text).split('\r\n').length === bodyOf(accepted.text).split('\r\n').length
);

await rank(`*=${'9'.repeat(40)}&owner=LONG&score=1|000100`);
await rank(`*=100004&owner=LONG&score=1|${'9'.repeat(30)}`);
await rank(`*=100005&owner=LONG&score=1|000100|${'x'.repeat(40)}`);
check('ranking: over-long player, score and extra not stored', !rows("owner = 'LONG'").length);

await rank(`*=100006&owner=MANY${Array.from({ length: 10 }, (_, i) => `&score=${(i % 3) + 1}|00010${i}`).join('')}`);
check('ranking: at most `courses` scores per request', rows("player = '100006'").length === 3);

const pf = (body) => tunnel(80, post('wgg01.channel.or.jp', '/service/swan-ranking/pocketf', body));
await pf('*=200001&owner=ABCD&score=01|00001000&group=7');
await pf('*=200001&owner=ABC~&score=01|00001000&group=3');
await pf('*=200001&owner=ABCD&score=01|00001000&group=3');
check(
  'ranking: Pocket Fighter stores only groups 1-3 and fighter letters',
  JSON.stringify(rows("player = '200001'").map((r) => r.game)) === '["pocketf/3/D"]'
);
const t0 = Date.now();
const huge = await pf(`*=200002&owner=ABCD&group=${'9'.repeat(30)}&list=X|1|5`);
check('ranking: a huge group is answered at once', huge.code === 1000 && Date.now() - t0 < 5000, `${huge.code} in ${Date.now() - t0} ms`);

// Account takeover (M2): two linked relays and an unlinked one.
const tokenA = `test-token-a-${randomUUID()}`;
const tokenB = `test-token-b-${randomUUID()}`;
const hash = (t) => createHash('sha256').update(t).digest('base64url');
d1(
  `INSERT INTO accounts (id, handle, created) VALUES ('acct-a', 'alice', 0), ('acct-b', 'bob', 0);
   INSERT INTO devices (id, account_id, name, token_hash, created) VALUES ('dev-a', 'acct-a', 'a', '${hash(tokenA)}', 0), ('dev-b', 'acct-b', 'b', '${hash(tokenB)}', 0);`
);
await rank('*=300001&owner=MINE&score=1|000100', { token: tokenA });
await rank('*=300001&owner=MINE&score=1|000500');
await rank('*=300001&owner=MINE&score=1|000600', { token: tokenB });
let r = rows("player = '300001'")[0];
check("ranking: a linked score can't be replaced by another account or an unlinked relay", r.score === '000100' && r.account_id === 'acct-a', JSON.stringify(r));
await rank('*=300001&owner=MINE&score=1|000700', { token: tokenA });
r = rows("player = '300001'")[0];
check('ranking: its own account still improves it', r.score === '000700' && r.account_id === 'acct-a', JSON.stringify(r));
await rank('*=300002&owner=OPEN&score=1|000100');
await rank('*=300002&owner=OPEN&score=1|000200', { token: tokenB });
r = rows("player = '300002'")[0];
check('ranking: an unlinked score is claimed by a linked upload', r.score === '000200' && r.account_id === 'acct-b', JSON.stringify(r));

// ---------- per-address write rate (soft) ----------

const wizIp = freshIp();
for (let i = 0; i < 70; i++) await tunnel(80, get('www2.sting.co.jp', `/cgi-bin/wg/wiz.cgi?nm=W${i}&sc=${i + 1}`), { ip: wizIp });
const wiz = JSON.parse(d1("SELECT value FROM wg_state WHERE key = 'wizardry'")[0].value);
check('write rate limit: 70 quick writes from one address, at most 60 stored', wiz.length <= 60 && wiz.length >= 50, `${wiz.length} stored`);
await tunnel(80, get('www2.sting.co.jp', `/cgi-bin/wg/wiz.cgi?nm=${'N'.repeat(17)}&sc=5`), { ip: freshIp() });
await tunnel(80, get('www2.sting.co.jp', '/cgi-bin/wg/wiz.cgi?nm=BITCH&sc=5'), { ip: freshIp() });
const wiz2 = JSON.parse(d1("SELECT value FROM wg_state WHERE key = 'wizardry'")[0].value);
check('wizardry: over-long and offensive names not stored', !wiz2.some(([n]) => n.length > 16 || n === 'BITCH'));

// ---------- Digimon ----------

const dm = (cgi, body, opts) => tunnel(80, post('digi4.wgg.channel.or.jp', `/cgi-bin/dm4${cgi}.cgi`, body.toString('latin1')), opts);
const dmIp = freshIp();
const signups = [];
for (let i = 0; i < 22; i++) signups.push(bodyOf((await dm('signup', Buffer.from([10, 11, 12, i % 40, 14, 15, 16, 0xff, 3]), { ip: dmIp })).text).charCodeAt(0));
check('digimon: 20 sign-ups a day per address', signups.slice(0, 20).every((c) => c === 0) && signups.slice(20).every((c) => c === 1), signups.join(','));
// F U C K in D1 Tamers' font
const rude = bodyOf((await dm('signup', Buffer.from([185, 200, 182, 190, 0xff, 0xff, 0xff, 0xff, 3]), { ip: freshIp() })).text).charCodeAt(0);
check('digimon: offensive handle refused as "taken"', rude === 1);
const mine = bodyOf((await dm('signup', Buffer.from([20, 21, 22, 23, 0xff, 0xff, 0xff, 0xff, 3]), { ip: freshIp(), token: tokenA })).text);
const pid = Buffer.from(mine.slice(1, 9), 'latin1');
const block = Buffer.concat([pid, Buffer.from([20, 21, 22, 23, 0xff, 0xff, 0xff, 0xff, 3]), Buffer.alloc(143 - 17)]);
const other = bodyOf((await dm('idupld', block, { ip: freshIp() })).text).charCodeAt(0);
const own = bodyOf((await dm('idupld', block, { ip: freshIp(), token: tokenA })).text).charCodeAt(0);
check("digimon: a linked tamer's party can't be uploaded by others", other === 1 && own === 0, `others ${other}, own ${own}`);

// ---------- Dark Eyes ----------

const de = (cgi, headers, opts, body = '') => tunnel(80, post('battleg1.dark-eyes.com', `/cgi-bin/dark/nph-${cgi}.cgi`, body, headers), opts);
const retcd = (text, g) => (new RegExp(`X-SWAN-${g}-RETCD: (\\d+)`).exec(text) ?? [])[1];
const merc = (extra = {}) => ({ 'X-SWAN-MCUP-ID': '12345678', 'X-SWAN-MCUP-PAY': '5', 'X-SWAN-MCUP-NAME': '%B1%B2', 'X-SWAN-MCUP-CLASS': '1', 'X-SWAN-MCUP-LVL': '1', ...extra });
const deIp = freshIp();
check('dark eyes: no mercenary before worldinfo', retcd((await de('upmrcnry', merc(), { ip: deIp })).text, 'MCUP') === '9');
await de('worldinfo', { 'X-SWAN-WINF-ID': '12345678', 'X-SWAN-WINF-NAME': '%B1%B2' }, { ip: deIp });
check('dark eyes: mercenary after worldinfo', retcd((await de('upmrcnry', merc(), { ip: deIp })).text, 'MCUP') === '0');
check('dark eyes: pay that overflows the list record refused', retcd((await de('upmrcnry', merc({ 'X-SWAN-MCUP-PAY': '70000' }), { ip: deIp })).text, 'MCUP') === '9');
check('dark eyes: over-long field refused', retcd((await de('upmrcnry', merc({ 'X-SWAN-MCUP-HP': '1'.repeat(40) }), { ip: deIp })).text, 'MCUP') === '9');
check('dark eyes: offensive mercenary name refused', retcd((await de('upmrcnry', merc({ 'X-SWAN-MCUP-NAME': 'SHIT' }), { ip: deIp })).text, 'MCUP') === '9');
const codes = [];
for (let i = 0; i < 31; i++) codes.push(retcd((await de('upmrcnry', merc(), { ip: deIp })).text, 'MCUP'));
// 30 counted: the two uploads above that got as far as the state (with and without worldinfo), then 28.
check('dark eyes: 30 mercenaries a day per address', codes.filter((c) => c === '0').length === 28 && codes.at(-1) === '9', codes.join(''));
const world = JSON.parse(d1("SELECT value FROM wg_state WHERE key = 'darkeyes-world'")[0].value);
check('dark eyes: one mercenary per player kept', Object.keys(world.mercs).length === 1, `${Object.keys(world.mercs).length} kept`);
const longName = await de('reqmatch', { 'X-SWAN-MTCH-ID': '1', 'X-SWAN-MTCH-NAME': 'x'.repeat(5000) }, { ip: freshIp() });
check('dark eyes: matchmaking refuses an over-long name', retcd(longName.text, 'MTCH') === '9');

// ---------- Wonder Classic ----------

const ncIp = freshIp();
const card = Buffer.concat([Buffer.from('WSC\r\x01', 'latin1'), Buffer.from([0x82, 0x60, 0x82, 0x61]), Buffer.alloc(60)]);
const status = [];
for (let i = 0; i < 21; i++) {
  const t = await tunnel(10000, [card], { ip: ncIp, eof: false, ms: 1500 });
  status.push(t.text.charCodeAt(10)); // after the hello: "WSR\r" status count
}
check('wonder classic: 20 member cards a day per address', status.slice(0, 20).every((s) => s === 0) && status[20] === 1, status.join(','));
const rudeCard = Buffer.concat([Buffer.from('WSC\r\x01', 'latin1'), Buffer.from([0x82, 0x65, 0x82, 0x74, 0x82, 0x62, 0x82, 0x6a]), Buffer.alloc(60)]);
check('wonder classic: offensive handle refused', (await tunnel(10000, [rudeCard], { ip: freshIp(), eof: false, ms: 1500 })).text.charCodeAt(10) === 1);

// ---------- mail ----------

const setupIp = freshIp();
const setups = [];
for (let i = 0; i < 21; i++) setups.push((await tunnel(80, get('start.mopera.ne.jp', '/setup'), { ip: setupIp })).text.includes('PPPUSERNAME'));
check('mail: 20 setups a day per address', setups.slice(0, 20).every(Boolean) && !setups[20]);
const setup = (await tunnel(80, get('start.mopera.ne.jp', '/setup'), { ip: freshIp() })).text;
const user = /MAILUSERNAME:(\w+)/.exec(setup)[1];
const rcpts = Array.from({ length: 6 }, () => `RCPT TO:<${user}@mopera.ne.jp>\r\n`);
const smtp = await tunnel(25, ['HELO x\r\n', `MAIL FROM:<${user}@mopera.ne.jp>\r\n`, ...rcpts, 'QUIT\r\n'], { ip: freshIp() });
check('smtp: sixth recipient refused with 452', /250 OK\r\n452 4\.5\.3/.test(smtp.text) && (smtp.text.match(/^250 OK\r$/gm) ?? []).length === 6);
const sendIp = freshIp();
const message = ['DATA\r\n', 'Subject: hi\r\n', '\r\n', 'hello\r\n', '.\r\n'];
const lines = ['HELO x\r\n'];
for (let i = 0; i < 51; i++) lines.push(`MAIL FROM:<${user}@mopera.ne.jp>\r\n`, `RCPT TO:<${user}@mopera.ne.jp>\r\n`, ...message);
lines.push('QUIT\r\n');
const sends = await tunnel(25, lines, { ip: sendIp });
// The write rate limit (60 a minute) may refuse some with 451 first; the daily cap ends with 550.
check('smtp: 50 messages a day per address, then 550', (sends.text.match(/250 OK queued/g) ?? []).length <= 50 && /550 5\.4\.5/.test(sends.text));
const pop = await tunnel(110, [`USER ${user}\r\n`, 'PASS wrong1\r\n', 'PASS wrong2\r\n', 'PASS wrong3\r\n', 'PASS wrong4\r\n'], { ip: freshIp(), eof: false });
check('pop3: hangs up after 3 wrong passwords', (pop.text.match(/-ERR authentication failed/g) ?? []).length === 3 && pop.code !== 'timeout');

// ---------- tunnels ----------

const many = Array.from({ length: 60 }, () => get('www.mopera.ne.jp', '/'));
const keep = await tunnel(80, many, { eof: false });
check('http: 50 requests per connection, then it closes', (keep.text.match(/HTTP\/1\.1 200/g) ?? []).length === 50 && keep.code === 1000);
const req = post('rakujang.wgg.channel.or.jp', '/swan-ranking', `*=400001&owner=SLOW&score=1|000100&list=RANK|1|20${'&pad=x'.repeat(200)}`);
const t1 = Date.now();
const slow = await tunnel(80, [...Buffer.from(req, 'latin1')].map((b) => Buffer.from([b])));
check(`http: a ${req.length}-byte request sent a byte per message is answered`, slow.text.includes('RANK='), `${Date.now() - t1} ms`);
const flood = await tunnel(80, Array.from({ length: 17000 }, () => 'x'), { eof: false });
check('tunnel: closed after 16,384 messages', flood.code === 1009, String(flood.code));

stopAll();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
