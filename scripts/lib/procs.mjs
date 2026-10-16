// Child processes for the WonderGate test scripts: start, wait for a port, stop everything on exit.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
/** The game server (Python server, adapter, captures): wondergate/ next to these scripts in the public
 * RevivalGate repo, else the private notes checkout. */
export const GAME_REPO = existsSync(join(ROOT, 'wondergate', 'server')) ? join(ROOT, 'wondergate') : join(homedir(), 'WonderswanCartDumper', 'wondergate');

const children = [];

export function start(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  const child = { name, p, log: () => out };
  children.push(child);
  return child;
}

export function stopAll() {
  for (const { p } of children.splice(0)) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {}
  }
}
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(130));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitPort(port, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await new Promise((r) => {
      const s = connect(port, '127.0.0.1', () => (s.destroy(), r(true)));
      s.on('error', () => r(false));
    });
    if (ok) return;
    await sleep(200);
  }
  throw new Error(`nothing listening on ${port}`);
}

/** Refuse to run against something already listening: a stale server would make results meaningless. */
export async function assertFree(ports) {
  for (const port of ports) {
    const busy = await new Promise((r) => {
      const s = connect(port, '127.0.0.1', () => (s.destroy(), r(true)));
      s.on('error', () => r(false));
    });
    if (busy) {
      console.error(`Port ${port} is already in use. Stop whatever is listening there (lsof -nP -iTCP:${port}) and run again.`);
      process.exit(1);
    }
  }
}

/** Start everything, or print each child's log tail and exit. */
export async function waitAll(ports) {
  try {
    await Promise.all(ports.map((p) => waitPort(p)));
  } catch (err) {
    console.error(String(err));
    for (const c of children) console.error(`--- ${c.name}\n${c.log().slice(-2000)}`);
    process.exit(1);
  }
}
