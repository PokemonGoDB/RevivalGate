#!/usr/bin/env node
// Swan Revival Link: puts a WonderSwan's WonderGate games online with RevivalGate (swanrevival.com).
//
// It runs the WonderGate adapter (wgcore-host, which stands in for the 2001 adapter and phone) and
// carries its connections to the RevivalGate server. Two ways to use it:
//
//   Mednafen:      mednafen -wswan.excomm 1 -wswan.excomm.path /path/to/swan-link game.wsc
//                  (Mednafen starts swan-link and uses its stdin/stdout as the console's serial port)
//   Real console:  swan-link --serial /dev/cu.usbmodem1101
//                  (through an ExtFriend-compatible cable on the console's EXT port)
//
//   swan-link --link ABCD2345    link this computer to your account (code from swanrevival.com/account/)
//   swan-link --unlink           forget the link
//
//   Emulator over TCP: swan-link --tcp 7777   (an emulator whose serial port connects to 127.0.0.1:7777)
//
// Options: --adapter <path to wgcore-host>  --server wss://…/tunnel (default: RevivalGate)  --baud 9600
// What it does is logged to ~/.swanrevival/link.log (never to stdout: in Mednafen that's the serial line).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_CONFIG, DEFAULT_SERVER, GAME_PORTS, link, readConfig, setupMednafen, startRelay, tokenFor, unlink } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({
  allowPositionals: true, // Mednafen passes an argument of its own
  options: {
    serial: { type: 'string' },
    tcp: { type: 'string' },
    baud: { type: 'string', default: '9600' },
    adapter: { type: 'string' },
    server: { type: 'string', default: DEFAULT_SERVER },
    config: { type: 'string', default: DEFAULT_CONFIG },
    log: { type: 'string', default: join(homedir(), '.swanrevival', 'link.log') },
    link: { type: 'string' },
    name: { type: 'string', default: hostname() },
    unlink: { type: 'boolean', default: false },
    'setup-mednafen': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

const USAGE = `Swan Revival Link

  With Mednafen:      swan-link --setup-mednafen   once, then play any game in Mednafen
                      (or each time: mednafen -wswan.excomm 1 -wswan.excomm.path ${join(HERE, 'swan-link')} game.wsc)
  With a real console: swan-link --serial /dev/cu.usbmodem1101   (an ExtFriend-compatible cable)

  swan-link --link ABCD2345    link to your account on the server (RevivalGate: swanrevival.com/account/)
  --server wss://…/tunnel      use another server instead of RevivalGate
  swan-link --unlink           forget the link

Guide: https://swanrevival.com/revival-gate/play/`;

mkdirSync(dirname(opt.log), { recursive: true });
const log = (msg) => appendFileSync(opt.log, `${new Date().toISOString()} ${msg}\n`);

if (opt.help) {
  console.log(USAGE);
  process.exit(0);
}
if (opt.unlink) {
  unlink(opt.config);
  console.log('Unlinked. Also remove this computer from your account on the server.');
  process.exit(0);
}
if (opt['setup-mednafen']) {
  let running = false;
  try {
    execFileSync('pgrep', ['-x', 'mednafen'], { stdio: 'ignore' });
    running = true;
  } catch {}
  if (running) {
    console.error('Quit Mednafen first: it rewrites its settings when it closes. Then run this again.');
    process.exit(1);
  }
  const file = setupMednafen({ program: join(HERE, 'swan-link') });
  console.log(`Mednafen's WonderGate is on for every game (${file}). Open any WonderSwan game in Mednafen and go to its WonderGate menu.`);
  process.exit(0);
}
if (opt.link) {
  try {
    const handle = await link({ code: opt.link, name: opt.name, server: opt.server, config: opt.config });
    console.log(`Linked as ${handle ?? 'your account'}. Scores you post from here will show your name.`);
    process.exit(0);
  } catch (err) {
    console.error(`Couldn't link: ${err.message}`);
    process.exit(1);
  }
}
// Started by hand in a terminal without --serial or --tcp: the user probably wants the instructions.
if (!opt.serial && !opt.tcp && process.stdin.isTTY) {
  console.log(USAGE);
  process.exit(0);
}

const adapter = [opt.adapter, join(HERE, 'bin', 'wgcore-host'), join(HERE, 'wgcore-host')].find((p) => p && existsSync(p));
if (!adapter) {
  const msg = `Can't find wgcore-host next to swan-link. Reinstall Swan Revival Link, or pass --adapter.`;
  log(msg);
  console.error(msg);
  process.exit(1);
}

const saved = readConfig(opt.config);
// A link only counts on the server that issued it; another server never sees the token
const token = tokenFor(saved, opt.server);
const handle = token ? saved.handle ?? null : null;
const bound = await startRelay({
  ports: GAME_PORTS.map((remote) => ({ local: 0, remote })),
  server: opt.server,
  token,
  log
});

// The adapter's own config: every WonderGate hostname goes to us, on the ports we just opened.
const conf = join(tmpdir(), `swan-link-${process.pid}.conf`);
writeFileSync(conf, ['reception 15', 'server 127.0.0.1', ...bound.map((p) => `portmap ${p.remote} ${p.local}`), ''].join('\n'));
const cleanup = () => rmSync(conf, { force: true });

const linked = token ? `linked${handle ? ` as ${handle}` : ''}` : 'not linked';
const adapterLog = join(dirname(opt.log), 'adapter.log');

if (opt.tcp) {
  // One adapter per connection: an emulator reconnects on power-off, like plugging the adapter in again.
  const { createServer } = await import('node:net');
  const server = createServer((socket) => {
    const child = spawn(adapter, ['--config', conf, '--log', adapterLog], { stdio: ['pipe', 'pipe', 'pipe'] });
    log(`emulator connected (${socket.remotePort}); adapter ${child.pid}`);
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    child.stderr.on('data', (d) => log(`adapter: ${String(d).trim()}`));
    child.stdin.on('error', () => {});
    socket.on('error', () => {});
    socket.on('close', () => child.kill('SIGTERM'));
    child.on('exit', () => socket.destroy());
  });
  server.on('error', (err) => {
    console.error(`Can't listen on 127.0.0.1:${opt.tcp}: ${err.message}`);
    process.exit(1);
  });
  server.listen(Number(opt.tcp), '127.0.0.1', () => {
    log(`start: TCP 127.0.0.1:${opt.tcp}, server ${opt.server}, ${linked}`);
    console.error(`Swan Revival Link: waiting for the emulator on 127.0.0.1:${opt.tcp}${token ? `, ${linked}` : ''}. Ctrl-C to stop.`);
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => (cleanup(), process.exit(0)));
} else {
  runAdapter();
}

function runAdapter() {
  log(`start: ${opt.serial ? `serial ${opt.serial}` : 'Mednafen (stdio)'}, server ${opt.server}, ${linked}`);
  const args = ['--config', conf, '--log', adapterLog, ...(opt.serial ? ['--serial', opt.serial, '--baud', opt.baud] : [])];
  const child = spawn(adapter, args, {
    // Mednafen mode: the adapter talks to Mednafen directly on our stdin/stdout.
    stdio: opt.serial ? ['ignore', 'ignore', 'pipe'] : ['inherit', 'inherit', 'pipe']
  });
  child.stderr.on('data', (d) => log(`adapter: ${String(d).trim()}`));
  if (opt.serial) {
    console.error(`Swan Revival Link: console on ${opt.serial}${token ? `, linked${handle ? ` as ${handle}` : ''}` : ''}. Open a WonderGate menu in your game. Ctrl-C to stop.`);
  }
  child.on('exit', (code, signal) => {
    log(`adapter exited (${signal ?? code})`);
    cleanup();
    process.exit(code ?? 0);
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      child.kill('SIGTERM');
      cleanup();
      process.exit(0);
    });
  }
}
