#!/usr/bin/env node
// Development relay: fixed local ports -> the game server. Players use swan-link instead.
//
//   node link/swan-relay.mjs --server ws://127.0.0.1:8790/tunnel --listen 18080:80,20000:10000,25555:5555
//
// Point wgcore-host at it with `server 127.0.0.1` and matching `portmap` lines.
import { parseArgs } from 'node:util';
import { DEFAULT_CONFIG, DEFAULT_SERVER, readConfig, startRelay, tokenFor } from './lib.mjs';

const { values: opt } = parseArgs({
  options: {
    server: { type: 'string', default: DEFAULT_SERVER },
    listen: { type: 'string', default: '8080:80,10000:10000,5555:5555' },
    config: { type: 'string', default: DEFAULT_CONFIG },
    quiet: { type: 'boolean', default: false }
  }
});
const log = (...a) => opt.quiet || console.log(new Date().toISOString().slice(11, 19), ...a);
const saved = readConfig(opt.config);
const token = tokenFor(saved, opt.server);
const handle = token ? saved.handle ?? null : null;
const ports = opt.listen.split(',').map((p) => {
  const [local, remote] = p.split(':').map(Number);
  return { local, remote };
});
try {
  for (const p of await startRelay({ ports, server: opt.server, token, log })) log(`listening on 127.0.0.1:${p.local} (game port ${p.remote})`);
} catch (err) {
  console.error(`Can't listen: ${err.message}`);
  process.exit(1);
}
log(`server ${opt.server}; ${token ? `linked${handle ? ` as ${handle}` : ''}` : 'not linked'}`);
