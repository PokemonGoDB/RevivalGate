// Play the WonderGate games in MesenCE (headless) against the Worker, the way a player would.
//
//   node scripts/wg-mesen-e2e.mjs [game-key ...] [--mesen ~/Code/MesenCE/bin/osx-arm64/Release/osx-arm64/publish] [--via-link]
//
// Default: MesenCE's own WonderGate setting (adapter in the core, relay in the UI) -> Worker, with a
// linked test account, checking afterwards that the scores carry it.
// --foreign-token: save the test token as another server's; games must still play and no score may
//   carry the account (a token is only ever sent to the server that issued it).
// --shots: also save a screenshot at every replay step (runs/<game>/shots/), to see where a replay goes wrong.
// --via-link: MesenCE's TCP serial device (MESEN_WS_SERIAL_TCP) -> swan-link --tcp -> wgcore-host -> Worker.
// Each replay in the game server repo's emu/replays.txt becomes a Lua script for MesenCE's test
// runner; the pass rule is emu/regress.py's (the adapter log shows the expected reply and a hang-up,
// no unknown commands). Memory edits (poke/eeprom/cartee/ram) and resets are replayed with Lua.
// Everything runs from a temp dir with its own ports; MesenCE runs from a portable copy so it never
// touches your MesenCE settings.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { GAME_REPO, ROOT, WRANGLER, assertFree, start, stopAll, waitAll } from './lib/procs.mjs';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: 'string', default: GAME_REPO },
    mesen: { type: 'string', default: join(homedir(), 'Code/MesenCE/bin/osx-arm64/Release/osx-arm64/publish') },
    roms: { type: 'string', default: process.env.WS_ROMS ?? '/Volumes/Games' },
    work: { type: 'string' },
    timeout: { type: 'string', default: '180' },
    'via-link': { type: 'boolean', default: false },
    shots: { type: 'boolean', default: false },
    'foreign-token': { type: 'boolean', default: false }
  }
});
const work = opt.work ?? mkdtempSync(join(tmpdir(), 'wg-mesen-'));

// MesenCE vendors the adapter (Utilities/WonderGate/wg.c); a stale copy makes MesenCE-only failures
const mesenRepo = join(homedir(), 'Code', 'MesenCE');
for (const f of ['wg.c', 'wg.h']) {
  const ours = join(mesenRepo, 'Utilities', 'WonderGate', f);
  const theirs = join(opt.repo, 'core', f);
  if (existsSync(ours) && existsSync(theirs) && readFileSync(ours, 'utf8') !== readFileSync(theirs, 'utf8')) {
    console.log(`WARNING: MesenCE's ${f} differs from the game server repo's. Run node scripts/wg-sync.mjs --mesen ${mesenRepo} and rebuild MesenCE.`);
  }
}
// WG_E2E_PORT: another port when 8790 is taken (other local Workers often use it)
const WORKER_PORT = Number(process.env.WG_E2E_PORT) || 8790;
const LINK_PORT = 27777;
await assertFree([WORKER_PORT, LINK_PORT]);

// ---------- replays -> Lua ----------

const KEYS = { A: 'a', B: 'b', START: 'start', UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right', Y_UP: 'up2', Y_DOWN: 'down2', Y_LEFT: 'left2', Y_RIGHT: 'right2' };

// drive.py memory edits -> MesenCE memory types (offsets are bytes within each memory)
const MEMORY = { poke: 'wsCartRam', eeprom: 'wsInternalEeprom', cartee: 'wsCartEeprom', ram: 'wsWorkRam' };

/** drive.py steps -> timed steps { frames, keys } and actions { write } / { farcall } / { reset }; null if unsupported. */
function timeline(steps) {
  const out = [];
  for (const step of steps) {
    if (/^w\d+$/.test(step)) out.push({ frames: Number(step.slice(1)), keys: [] });
    else if (step.startsWith('s:')) continue;
    else if (step === 'reset') out.push({ reset: true });
    else if (/^(poke|eeprom|cartee|ram):[0-9A-Fa-f]+=[0-9A-Fa-f]+$/.test(step)) {
      // VAL is one byte or, as in drive.py, a run of bytes written from ADDR upwards
      const [kind, rest] = step.split(':');
      const [addrHex, valHex] = rest.split('=');
      const addr = parseInt(addrHex, 16);
      const bytes = valHex.length <= 2 ? [parseInt(valHex, 16)] : valHex.match(/../g).map((b) => parseInt(b, 16));
      bytes.forEach((b, i) => out.push({ write: [MEMORY[kind], addr + i, b] }));
    } else if (/^farcall:[0-9A-Fa-f]+:[0-9A-Fa-f]+$/.test(step)) {
      const [seg, off] = step.slice(8).split(':').map((v) => parseInt(v, 16));
      out.push({ farcall: [seg, off] });
    } else {
      const [combo, hold] = step.split('*');
      const names = combo.split('+');
      if (!names.every((n) => n in KEYS)) return null;
      out.push({ frames: Number(hold || 6), keys: names.map((n) => KEYS[n]) });
      out.push({ frames: 10, keys: [] });
    }
  }
  return out;
}

function lua(segments, shotsDir = null) {
  const rows = segments
    .map((s) =>
      s.write
        ? `{"write", emu.memType.${s.write[0]}, ${s.write[1]}, ${s.write[2]}}`
        : s.farcall
          ? `{"farcall", ${s.farcall[0]}, ${s.farcall[1]}}`
          : `{${s.frames}, {${s.keys.map((k) => `${k}=true`).join(',')}}}`
    )
    .join(',\n  ');
  return `-- Generated by scripts/wg-mesen-e2e.mjs
local steps = {
  ${rows}
}
local frame, i, left = 0, 1, 0
local first = {}
for _, s in ipairs(steps) do if type(s[1]) == "number" then first = s[2]; break end end

-- drive.py's farcall: call SEG:OFF as if with CALL FAR from where the CPU stands (push CS:IP on
-- the game's stack, jump, wake it from HLT); the routine's RETF resumes the game.
local function farcall(seg, off)
  local st = emu.getState()
  local sp = (st["cpu.sp"] - 4) & 0xFFFF
  local lin = ((st["cpu.ss"] << 4) + sp) & 0xFFFF
  local ip, cs = st["cpu.ip"], st["cpu.cs"]
  emu.write(lin, ip & 0xFF, emu.memType.wsWorkRam)
  emu.write(lin + 1, ip >> 8, emu.memType.wsWorkRam)
  emu.write(lin + 2, cs & 0xFF, emu.memType.wsWorkRam)
  emu.write(lin + 3, cs >> 8, emu.memType.wsWorkRam)
  emu.setState({
    ["cpu.sp"] = sp, ["cpu.cs"] = seg, ["cpu.ip"] = off, ["cpu.halted"] = false,
    ["cpu.prefetch.fetchCs"] = seg, ["cpu.prefetch.fetchIp"] = off, ["cpu.prefetch.size"] = 0,
    ["cpu.prefetch.readPos"] = 0, ["cpu.prefetch.writePos"] = 0, ["cpu.prefetch.waitCycles"] = 0
  })
end

-- Run memory edits, far calls and resets at the current step; stop on the next timed step.
local function advance()
  while steps[i] do
    local s = steps[i]
    if s[1] == "write" then
      emu.write(s[3], s[4], s[2])
      i = i + 1
    elseif s[1] == "farcall" then
      farcall(s[2], s[3])
      i = i + 1
    else
      left = s[1]
      return
    end
  end
end
advance()

-- MesenCE reads input at the end of each frame, so set the first buttons now: games that check a
-- power-on combo (D's Garage) look during the very first frame.
emu.setInput(first, 0, 0)
emu.addEventCallback(function()
  if frame == 0 then emu.setInput(first, 0, 0) end
end, emu.eventType.startFrame)
emu.addEventCallback(function()
  local s = steps[i]
  emu.setInput((s and type(s[1]) == "number") and s[2] or {}, 0, 0)
end, emu.eventType.inputPolled)
emu.addEventCallback(function()
  frame = frame + 1
  left = left - 1
  while steps[i] and left <= 0 do
    i = i + 1
    advance()
    ${shotsDir ? `local f = io.open(string.format("${shotsDir}/%04d_step%03d.png", frame, i), "wb"); if f then f:write(emu.takeScreenshot()); f:close() end` : ''}
  end
  if not steps[i] then emu.stop(0) end
end, emu.eventType.endFrame)
`;
}

function findRom(name) {
  for (const d of ['WonderSwan Roms/Unzipped WS Roms', 'WonderSwan Color/Unzipped Roms']) {
    const dir = join(opt.roms, d);
    if (!existsSync(dir)) continue;
    const hit = readdirSorted(dir).find((f) => /\.wsc?$/i.test(f) && f.toLowerCase().includes(name.toLowerCase()));
    if (hit) return join(dir, hit);
  }
  return null;
}
function readdirSorted(dir) {
  return execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
}

// ---------- servers ----------

// A test account and device, as the site's /api/devices/claim/ would create them.
const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('base64url');

const mesen = join(work, 'mesen');
cpSync(opt.mesen, mesen, { recursive: true });
// settings.json next to the app = portable mode (no first-run window, nothing in your own settings)
writeFileSync(
  join(mesen, 'settings.json'),
  JSON.stringify({
    ...(opt.shots ? { Debug: { ScriptWindow: { AllowIoOsAccess: true } } } : {}),
    ...(opt['via-link'] ? {} : { Ws: { WonderGateEnabled: true, WonderGateServer: `ws://127.0.0.1:${WORKER_PORT}/tunnel`, WonderGateToken: token, WonderGateTokenServer: opt['foreign-token'] ? 'wss://other-server.invalid/tunnel' : `ws://127.0.0.1:${WORKER_PORT}/tunnel`, WonderGateHandle: 'mesentester' } })
  })
);

const state = join(work, 'd1');
execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'swanrevival-wondergate', '--local', '--persist-to', state, '-c', 'workers/wondergate/wrangler.jsonc'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, CI: '1' }
});
execFileSync(WRANGLER, ['d1', 'execute', 'swanrevival-wondergate', '--local', '--persist-to', state, '-c', 'workers/wondergate/wrangler.jsonc', '--command',
  `INSERT INTO accounts (id, handle, created) VALUES ('acct-mesen', 'mesentester', 0);
   INSERT INTO devices (id, account_id, name, token_hash, created) VALUES ('dev-mesen', 'acct-mesen', 'MesenCE test', '${tokenHash}', 0);`], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, CI: '1' } });
execFileSync('node', ['scripts/wg-sync.mjs', '--repo', opt.repo], { cwd: ROOT, stdio: 'ignore' });
console.log(`work dir ${work}`);
start('worker', WRANGLER, ['dev', '-c', 'workers/wondergate/wrangler.jsonc', '--port', String(WORKER_PORT), '--persist-to', state], { env: { ...process.env, CI: '1' } });
if (opt['via-link']) {
  start('link', join(ROOT, 'link', 'swan-link'), ['--tcp', String(LINK_PORT), '--adapter', join(opt.repo, 'host', 'wgcore-host'), '--server', `ws://127.0.0.1:${WORKER_PORT}/tunnel`, '--config', join(work, 'link.json'), '--log', join(work, 'link.log')]);
  await waitAll([WORKER_PORT, LINK_PORT]);
} else {
  await waitAll([WORKER_PORT]);
}

// ---------- play ----------

// MesenCE timing overrides (scripts/mesen-replays.txt) replace replays with the same key
const parseReplays = (text) => text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const overrides = new Map(parseReplays(readFileSync(join(ROOT, 'scripts', 'mesen-replays.txt'), 'utf8')).map((l) => [l.split('|')[0].trim(), l]));
const replays = parseReplays(readFileSync(join(opt.repo, 'emu', 'replays.txt'), 'utf8')).map((l) => overrides.get(l.split('|')[0].trim()) ?? l);

let fails = 0;
let played = 0;
for (const line of replays) {
  // 5th column "link": a link-cable session (Lode Runner DATA I/O), no call so no hang-up
  const [key, romName, steps, expect = '200 OK', kind = ''] = line.split('|').map((p) => p.trim());
  if (positionals.length && !positionals.includes(key)) continue;
  const segments = timeline(steps.split(/\s+/));
  if (!segments) {
    console.log(`[SKIP] ${key.padEnd(10)} uses a step this script can't replay`);
    continue;
  }
  const rom = findRom(romName);
  if (!rom) {
    console.log(`[SKIP] ${key.padEnd(10)} no ROM matching "${romName}"`);
    continue;
  }
  played++;
  const out = join(work, 'runs', key);
  mkdirSync(out, { recursive: true });
  // swan-link writes its adapter log next to link.log; the built-in adapter writes to MESEN_WG_LOG
  const adapterLog = opt['via-link'] ? join(work, 'adapter.log') : join(out, 'adapter.log');
  rmSync(adapterLog, { force: true });
  // Each game starts with no save data, like drive.py's fresh emulator
  rmSync(join(mesen, 'Saves'), { recursive: true, force: true });

  // A reset is a power cycle, which unloads Lua scripts: play each part in its own run. Stopping a
  // run saves battery memory and the next run powers on with it, so save data carries over.
  const parts = [[]];
  for (const seg of segments) seg.reset ? parts.push([]) : parts.at(-1).push(seg);

  const env = opt['via-link'] ? { MESEN_WS_SERIAL_TCP: `127.0.0.1:${LINK_PORT}` } : { MESEN_WG_LOG: adapterLog };
  let r = { status: 0, stdout: '', stderr: '' };
  let mesenLog = '';
  for (const [n, part] of parts.entries()) {
    if (!part.some((x) => x.frames)) continue;
    const script = join(out, parts.length > 1 ? `replay-${n + 1}.lua` : 'replay.lua');
    const shots = opt.shots ? join(out, 'shots', `part${n + 1}`) : null;
    if (shots) mkdirSync(shots, { recursive: true });
    writeFileSync(script, lua(part, shots));
    r = spawnSync(join(mesen, 'Mesen'), ['--testrunner', rom, script, `--timeout=${opt.timeout}`], {
      cwd: mesen,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: (Number(opt.timeout) + 30) * 1000
    });
    mesenLog += `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (r.status !== 0) break;
  }
  writeFileSync(join(out, 'mesen.log'), mesenLog);
  // Give the adapter a moment to flush its log after MesenCE disconnects.
  await new Promise((res) => setTimeout(res, 500));
  const text = existsSync(adapterLog) ? readFileSync(adapterLog, 'utf8') : '';
  if (opt['via-link']) writeFileSync(join(out, 'adapter.log'), text);
  const unknown = text.split('\n').filter((l) => l.includes('UNKNOWN'));
  const why = [
    [`no '${expect}'`, !text.includes(expect)],
    ['no hang-up', kind !== 'link' && !text.includes('# hang up')],
    [`${unknown.length} unknown cmds`, unknown.length > 0],
    [`mesen exit ${r.status}`, r.status !== 0]
  ]
    .filter(([, bad]) => bad)
    .map(([w]) => w);
  fails += why.length > 0;
  console.log(`[${why.length ? 'FAIL' : 'PASS'}] ${key.padEnd(10)} ${why.join(', ')}`);
}
if (!opt['via-link']) {
  // Scores posted through MesenCE should carry the linked test account
  const rows = JSON.parse(execFileSync(WRANGLER, ['d1', 'execute', 'swanrevival-wondergate', '--local', '--persist-to', state, '-c', 'workers/wondergate/wrangler.jsonc', '--json', '--command',
    'SELECT game, COUNT(*) AS n, SUM(account_id = \'acct-mesen\') AS linked FROM swan_ranking GROUP BY game'], { cwd: ROOT, env: { ...process.env, CI: '1' } }))[0].results;
  const unlinked = rows.filter((r) => r.n !== r.linked);
  console.log(`\nscores stored: ${rows.map((r) => `${r.game} ${r.linked}/${r.n}`).join(', ') || 'none'}`);
  const linked = rows.reduce((n, r) => n + (r.linked ?? 0), 0);
  if (!rows.length) {
    console.log('(no scores posted by these games)');
  } else if (opt['foreign-token']) {
    if (linked) {
      fails++;
      console.log("[FAIL] another server's token was sent: scores carry the account");
    } else {
      console.log("[PASS] another server's token was never sent: no score carries the account");
    }
  } else if (unlinked.length) {
    fails++;
    console.log('[FAIL] scores without the linked account');
  } else {
    console.log('[PASS] every score carries the linked account');
  }
}
// A run where nothing played (ROM folder not mounted, say) proves nothing
if (!played) console.log(`\nNOTHING PLAYED: no ROMs found under ${opt.roms}`);
else console.log(fails ? `\n${fails} FAILED (logs in ${join(work, 'runs')})` : `\nALL PASS (${played} played)`);
stopAll();
process.exit(fails || !played ? 1 : 0);
