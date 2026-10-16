// Check the Worker game server against the Python one, byte for byte.
//
//   node scripts/wg-conformance.mjs [--repo ~/WonderswanCartDumper/wondergate] [--only rakujang,final-lap]
//
// Starts its own copies of everything and stops them afterwards; nothing touches a server you're
// running or that repo's data:
//   - the Python server (server/ copied to a temp dir, ports moved to 18080/20000/15555),
//   - the Worker (wrangler dev on :8790 with a fresh local D1),
//   - the relay (28080/30000/25555 -> the Worker).
// Then every request in the repo's captures/ (recorded from real game sessions) is sent, in the
// same order, to both, and the replies are compared after masking clock readings and random
// session tokens. Re-run it whenever the Python server changes.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { GAME_REPO, ROOT, WRANGLER, assertFree, start, stopAll, waitAll } from './lib/procs.mjs';

const { values: opt } = parseArgs({
  options: {
    repo: { type: 'string', default: GAME_REPO },
    only: { type: 'string' },
    work: { type: 'string' }
  }
});
const work = opt.work ?? mkdtempSync(join(tmpdir(), 'wg-conformance-'));
// WG_CONF_OFFSET moves the Python copy's ports when another program already holds 18080 and friends
const OFFSET = Number(process.env.WG_CONF_OFFSET) || 10000;
const PY = { 80: 8080 + OFFSET, 10000: 10000 + OFFSET, 5555: 5555 + OFFSET };
// WG_CONF_WORKER_OFFSET moves the Worker's relay ports the same way
const WOFFSET = Number(process.env.WG_CONF_WORKER_OFFSET) || 20000;
const WK = { 80: 8080 + WOFFSET, 10000: 10000 + WOFFSET, 5555: 5555 + WOFFSET };
const WORKER_PORT = Number(process.env.WG_WORKER_PORT ?? 8790); // WG_WORKER_PORT when 8790 is taken

/** Send bytes, half-close, and collect everything until the server hangs up. */
function exchange(port, data, ms = 15000) {
  return new Promise((res) => {
    const chunks = [];
    const s = connect({ port, host: '127.0.0.1', allowHalfOpen: true }, () => {
      s.write(data);
      s.end();
    });
    const timer = setTimeout(() => (s.destroy(), res({ bytes: Buffer.concat(chunks), timeout: true })), ms);
    s.on('data', (d) => chunks.push(d));
    s.on('close', () => (clearTimeout(timer), res({ bytes: Buffer.concat(chunks), timeout: false })));
    s.on('error', () => {});
  });
}

/** Values that legitimately differ between two runs: clock readings and random numbers. */
function normalize(buf, what = '') {
  let s = buf.toString('latin1');
  s = s.replace(/date=\d{8,12}/g, 'date=<DATE>');
  s = s.replace(/date\d{14}3/g, 'date<TIME>3');
  s = s.replace(/(X-SWAN-TIME-NOW: )\d+/g, '$1<TIME>');
  s = s.replace(/(X-SWAN-CMND-AID: )\S+/g, '$1<TOKEN>');
  s = s.replace(/(X-SWAN-CNTS-AID: )[A-Za-z0-9_-]{80}/g, '$1<TOKEN>');
  s = s.replace(/(X-SWAN-SRVC-TIME: )\d+/g, '$1<TIME>'); // Dark Eyes login
  s = s.replace(/(X-SWAN-MTCH-SEED: )\d+/g, '$1<SEED>'); // Dark Eyes match seed
  s = s.replace(/((?:PPP|MAIL)PASSWORD:)[0-9a-f]{8}/g, '$1<PASSWORD>'); // mail auto-setup
  s = s.replace(/info=([01]{6})[01]{7}\r\n/g, 'info=$1<CARDS>\r\n'); // Pocket Fighter: the Worker rotates the 7 card flags daily
  if (s.includes('BFEVREC=')) s = s.replace(/\b20\d{6}\b/g, '<DATE>');
  const split = s.indexOf('\r\n\r\n') >= 0 ? s.indexOf('\r\n\r\n') + 4 : s.indexOf('\n\n') + 2;
  const head = s.slice(0, split);
  let body = s.slice(split);
  if (what.includes('starhearts')) body = body.replace(/^C0000[0-9A-F]{8}$/, 'C0000<MEMBER>');
  if (/dm4(rankbtl|idbtl)/.test(what) && body.length > 3) body = body.slice(0, 2) + '<SEED>' + body.slice(3);
  if (/dmB(rankbtl|idbtl)/.test(what) && body.length > 3) body = body.slice(0, 1) + '<SEED>' + body.slice(2); // Brave Tamer: seed right after the result
  if (what.includes('/cgi-bin/accsess.cgi') && body.startsWith('T2')) body = 'T2<CLOCK>' + body.slice(5);
  if (what.endsWith('/tonpuusou/') || what.endsWith('/tonpuusou')) body = body.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g, '<DATE>');
  if (what.includes('log_inguz_1999')) body = body.replace(/<BR>\d\d\/\d\d .. \d\d:\d\d/, '<BR><DATE>');
  return head + body;
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const show = (x) => JSON.stringify(x.slice(Math.max(0, i - 60), i + 80));
  return `at byte ${i}\n      python: ${show(a)}\n      worker: ${show(b)}`;
}

// ---------- set up ----------

const pyDir = join(work, 'py');
cpSync(join(opt.repo, 'server'), join(pyDir, 'server'), { recursive: true });
// What the server reads from outside server/: the portal's downloadable game and its games page.
cpSync(join(opt.repo, 'games'), join(pyDir, 'games'), { recursive: true });
const progress = join(opt.repo, '..', 'docs', 'wondergate', 'progress.json');
if (existsSync(progress)) {
  mkdirSync(join(work, 'docs', 'wondergate'), { recursive: true });
  cpSync(progress, join(work, 'docs', 'wondergate', 'progress.json'));
}
const wgPath = join(pyDir, 'server', 'wgserver.py');
// Move every listening port onto ours (each one + 10000), so a server you're running is untouched.
// Newer servers take WG_PORT_OFFSET; older ones get their port assignments rewritten.
let src = readFileSync(wgPath, 'utf8');
const usesOffset = src.includes('WG_PORT_OFFSET');
if (!usesOffset) {
  // The names have changed before (port 10000 became its own protocol), so match the assignments
  // rather than exact lines, and stop if one is missing.
  for (const [pattern, to] of [
    [/^HTTP_PORTS = \([^)]*\)/m, `HTTP_PORTS = (${PY[80]},)`],
    [/^NCLASSIC_PORT = \d+/m, `NCLASSIC_PORT = ${PY[10000]}`],
    [/^BPL_PORT = \d+/m, `BPL_PORT = ${PY[5555]}`]
  ]) {
    if (!pattern.test(src)) throw new Error(`wgserver.py changed: no ${pattern} to move its ports`);
    src = src.replace(pattern, to);
  }
  writeFileSync(wgPath, src);
  // The mail cart's SMTP/POP3/daytime listeners
  const mailPath = join(pyDir, 'server', 'mail.py');
  if (existsSync(mailPath)) {
    const mailSrc = readFileSync(mailPath, 'utf8');
    const ports = /^SMTP_PORT, POP3_PORT, DAYTIME_PORT = \d+, \d+, \d+/m;
    if (!ports.test(mailSrc)) throw new Error("mail.py changed: can't find its ports to move them");
    writeFileSync(mailPath, mailSrc.replace(ports, `SMTP_PORT, POP3_PORT, DAYTIME_PORT = ${2525 + OFFSET}, ${1110 + OFFSET}, ${1313 + OFFSET}`));
  }
}

await assertFree([...Object.values(PY), WORKER_PORT, ...Object.values(WK)]);
const state = join(work, 'd1');
execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'swanrevival-wondergate', '--local', '--persist-to', state, '-c', 'workers/wondergate/wrangler.jsonc'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, CI: '1' }
});
execFileSync('node', ['scripts/wg-sync.mjs', '--repo', opt.repo], { cwd: ROOT, stdio: 'ignore' });

console.log(`work dir ${work}`);
// On Japan time, like the Worker (a deliberate difference), so dates in binary replies compare.
const python = start('python', 'python3', ['-I', wgPath], { cwd: pyDir, env: { ...process.env, TZ: 'Asia/Tokyo', ...(usesOffset ? { WG_PORT_OFFSET: String(OFFSET) } : {}) } });
const worker = start('worker', WRANGLER, ['dev', '-c', 'workers/wondergate/wrangler.jsonc', '--port', String(WORKER_PORT), '--persist-to', state, '--log-level', 'warn'], {
  env: { ...process.env, CI: '1' }
});
start('relay', 'node', ['link/swan-relay.mjs', '--server', `ws://127.0.0.1:${WORKER_PORT}/tunnel`, '--listen', Object.entries(WK).map(([g, l]) => `${l}:${g}`).join(','), '--config', join(work, 'relay.json'), '--quiet']);

await waitAll([...Object.values(PY), WORKER_PORT, ...Object.values(WK)]);

// ---------- replay ----------

const index = readFileSync(join(opt.repo, 'captures', 'index.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((e) => e.kind === 'http' || e.kind === 'bpl');
const only = opt.only ? new Set(opt.only.split(',')) : null;

const results = { same: 0, differ: [], missing: 0, byHost: {} };
for (const e of index) {
  const file = join(opt.repo, 'captures', e.file);
  if (!existsSync(file)) {
    results.missing++;
    continue;
  }
  const what = e.kind === 'bpl' ? 'bpl' : `${(e.host || '(no host)').split(':')[0]}${e.path ?? ''}`.split('?')[0];
  if (only && ![...only].some((o) => what.includes(o))) continue;
  const data = readFileSync(file);
  const port = e.kind === 'bpl' ? 5555 : String(e.host).endsWith(':10000') ? 10000 : 80;
  const a = await exchange(PY[port], data);
  const b = await exchange(WK[port], data);
  const na = normalize(a.bytes, what);
  const nb = normalize(b.bytes, what);
  const h = (results.byHost[what] ??= { same: 0, differ: 0 });
  if (na === nb && a.timeout === b.timeout) {
    results.same++;
    h.same++;
  } else {
    h.differ++;
    results.differ.push({ file: e.file, what, detail: a.timeout !== b.timeout ? `timeout python=${a.timeout} worker=${b.timeout}` : firstDiff(na, nb) });
  }
}

// ---------- report ----------

console.log(`\n${results.same + results.differ.length} requests replayed: ${results.same} identical, ${results.differ.length} different${results.missing ? `, ${results.missing} capture files missing` : ''}\n`);
for (const [what, h] of Object.entries(results.byHost).sort()) console.log(`  ${h.differ ? 'DIFF' : 'same'}  ${String(h.same + h.differ).padStart(4)}  ${what}${h.differ ? `  (${h.differ} differ)` : ''}`);
const shown = new Set();
for (const d of results.differ) {
  if (shown.has(d.what)) continue;
  shown.add(d.what);
  console.log(`\n${d.what} (${d.file}) ${d.detail}`);
}
writeFileSync(join(work, 'report.json'), JSON.stringify(results, null, 2));
writeFileSync(join(work, 'python.log'), python.log());
writeFileSync(join(work, 'worker.log'), worker.log());
if (results.differ.length) {
  console.log(`\nfull report: ${join(work, 'report.json')}`);
  const tail = worker.log().split('\n').filter((l) => /error|Error/.test(l)).slice(-10).join('\n');
  if (tail) console.log(`worker errors:\n${tail}`);
}
stopAll();
process.exit(results.differ.length ? 1 : 0);
