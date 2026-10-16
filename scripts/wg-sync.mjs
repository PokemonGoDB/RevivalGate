// Copy the game server repo's shared pieces to where they're used:
//   - static downloads (map packs and the like) into the Worker (workers/wondergate/content),
//   - the adapter (core/wg.c, wg.h) into link-web/vendor, rebuilding the browser Link's wasm when it changed,
//   - with --mesen <MesenCE checkout>, the adapter into MesenCE's Utilities/WonderGate.
//   node scripts/wg-sync.mjs [--repo ~/WonderswanCartDumper/wondergate] [--mesen ~/Code/MesenCE]
// The game server repo is the source of truth; don't edit the copies by hand.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GAME_REPO } from './lib/procs.mjs';

const { values: opt } = parseArgs({
  options: { repo: { type: 'string', default: GAME_REPO }, mesen: { type: 'string' } }
});
const from = join(opt.repo, 'server', 'content');
const to = fileURLToPath(new URL('../workers/wondergate/content', import.meta.url));
if (!existsSync(from)) throw new Error(`no ${from}`);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`content: ${from} -> ${to}`);

// The browser Link compiles the same adapter to WebAssembly (link-web/build.sh; needs lld and binaryen).
const web = fileURLToPath(new URL('../link-web/vendor', import.meta.url));
cpSync(join(opt.repo, 'core', 'NOTICE-wonderfence.txt'), join(web, 'NOTICE-wonderfence.txt'));
cpSync(join(opt.repo, 'core', 'NOTICE-wonderfence.txt'), fileURLToPath(new URL('../public/link/NOTICE-wonderfence.txt', import.meta.url)));
const stale = ['wg.c', 'wg.h'].filter((f) => readFileSync(join(opt.repo, 'core', f), 'utf8') !== readFileSync(join(web, f), 'utf8'));
if (stale.length) {
  for (const f of stale) cpSync(join(opt.repo, 'core', f), join(web, f));
  try {
    execFileSync(fileURLToPath(new URL('../link-web/build.sh', import.meta.url)), { stdio: 'inherit' });
    console.log(`adapter: ${stale.join(', ')} -> link-web/vendor, public/link/wgcore.wasm rebuilt (commit both)`);
  } catch {
    console.error(`adapter: ${stale.join(', ')} -> link-web/vendor, but the wasm DIDN'T rebuild: run link-web/build.sh (brew install lld binaryen)`);
    process.exitCode = 1;
  }
}

if (opt.mesen) {
  const dest = join(opt.mesen, 'Utilities', 'WonderGate');
  if (!existsSync(dest)) throw new Error(`no ${dest}`);
  for (const f of ['wg.c', 'wg.h']) cpSync(join(opt.repo, 'core', f), join(dest, f));
  console.log(`adapter: ${join(opt.repo, 'core')} -> ${dest} (rebuild MesenCE; after a wg.h change, delete Core/WS/WsWonderGateDevice.o first)`);
}
