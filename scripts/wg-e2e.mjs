// Play every WonderGate game headless against the Worker, through the relay.
//
//   node scripts/wg-e2e.mjs [game-key ...] [--repo ~/WonderswanCartDumper/wondergate]
//
// Uses that repo's emulator and replays (emu/drive.py, emu/replays.txt) with the same pass rule as
// its emu/regress.py: the adapter log shows the expected reply and a hang-up, with no unknown
// commands. Everything else is ours: a fresh Worker on :8790, the relay on 28080/30000/25555, an
// adapter config pointing there, and output in a temp dir. Nothing touches a server you're running.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { GAME_REPO, ROOT, WRANGLER, assertFree, start, stopAll, waitAll } from './lib/procs.mjs';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: 'string', default: GAME_REPO },
    work: { type: 'string' }
  }
});
const work = opt.work ?? mkdtempSync(join(tmpdir(), 'wg-e2e-'));
// The same game ports as Swan Revival Link (link/lib.mjs GAME_PORTS).
const RELAY = { 80: 28080, 10000: 30000, 5555: 25555, 25: 22525, 110: 21110, 13: 21313 };
const WORKER_PORT = Number(process.env.WG_WORKER_PORT ?? 8790); // WG_WORKER_PORT when 8790 is taken

const conf = join(work, 'adapter.conf');
writeFileSync(
  conf,
  ['reception 15', 'server 127.0.0.1', ...Object.entries(RELAY).map(([game, local]) => `portmap ${game} ${local}`), ''].join('\n')
);
await assertFree([WORKER_PORT, ...Object.values(RELAY)]);
const state = join(work, 'd1');
execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'swanrevival-wondergate', '--local', '--persist-to', state, '-c', 'workers/wondergate/wrangler.jsonc'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, CI: '1' }
});
execFileSync('node', ['scripts/wg-sync.mjs', '--repo', opt.repo], { cwd: ROOT, stdio: 'ignore' });

console.log(`work dir ${work}`);
const worker = start('worker', WRANGLER, ['dev', '-c', 'workers/wondergate/wrangler.jsonc', '--port', String(WORKER_PORT), '--persist-to', state], {
  env: { ...process.env, CI: '1' }
});
start('relay', 'node', ['link/swan-relay.mjs', '--server', `ws://127.0.0.1:${WORKER_PORT}/tunnel`, '--listen', Object.entries(RELAY).map(([g, l]) => `${l}:${g}`).join(','), '--config', join(work, 'relay.json'), '--quiet']);
await waitAll([WORKER_PORT, ...Object.values(RELAY)]);

let fails = 0;
for (const line of readFileSync(join(opt.repo, 'emu', 'replays.txt'), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const [key, rom, steps, expect = '200 OK'] = line.split('|').map((p) => p.trim());
  if (positionals.length && !positionals.includes(key)) continue;
  const out = join(work, 'runs', key);
  mkdirSync(out, { recursive: true });
  const r = spawnSync('python3', ['-I', join(opt.repo, 'emu', 'drive.py'), rom, ...steps.split(/\s+/), `s:${key}`, '--out', out, '--config', conf], {
    encoding: 'utf8',
    timeout: 15 * 60_000
  });
  const logFile = join(out, 'adapter.log');
  const text = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  const unknown = text.split('\n').filter((l) => l.includes('UNKNOWN'));
  const why = [
    [`no '${expect}'`, !text.includes(expect)],
    ['no hang-up', !text.includes('# hang up')],
    [`${unknown.length} unknown cmds`, unknown.length > 0],
    [`exit ${r.status}`, r.status !== 0]
  ]
    .filter(([, bad]) => bad)
    .map(([w]) => w);
  fails += why.length > 0;
  console.log(`[${why.length ? 'FAIL' : 'PASS'}] ${key.padEnd(10)} ${why.join(', ')}`);
  if (r.status !== 0 && r.stderr) console.log(r.stderr.trim().split('\n').slice(-3).map((l) => `           ${l}`).join('\n'));
}
console.log(fails ? `\n${fails} FAILED (logs in ${join(work, 'runs')})` : '\nALL PASS');
const errors = worker.log().split('\n').filter((l) => /ERROR|Uncaught|handler error/.test(l));
if (errors.length) console.log(`worker errors:\n${errors.slice(-10).join('\n')}`);
stopAll();
process.exit(fails ? 1 : 0);
