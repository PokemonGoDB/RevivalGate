// Replays a recorded WonderGate session into the browser Link's adapter (public/link/wgcore.wasm) and
// checks it answers the console byte for byte as the native adapter did.
//
//   node scripts/link-web-replay.mjs <adapter.log> [--server ws://127.0.0.1:8790/tunnel] [--verbose]
//
// Record with WonderswanCartDumper's headless runner and WG_ADAPTER_RAW=1, the native adapter going
// through link/swan-relay.mjs to the same server (a local `wrangler dev` of the game server with a fresh
// database, so nothing lands on the live rankings). "tx XX" lines are the console's bytes, "rx XX" the
// adapter's replies (including "rx LOST" ones the console's port missed).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createAdapter } from '../src/lib/link-web/adapter.ts';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: { server: { type: 'string', default: 'ws://127.0.0.1:8790/tunnel' }, verbose: { type: 'boolean', default: false } }
});
if (!positionals[0]) {
  console.error('usage: node scripts/link-web-replay.mjs <adapter.log> [--server URL] [--verbose]');
  process.exit(2);
}

// Console bytes, each followed by the adapter's reply bytes.
const exchanges = [];
for (const line of readFileSync(positionals[0], 'utf8').split('\n')) {
  // "rx LOST XX": the adapter sent it while the console's port was off; it still counts.
  const m = / (tx|rx)(?: LOST)? ([0-9A-F]{2}) {2}\(line/.exec(line);
  if (!m) continue;
  const b = parseInt(m[2], 16);
  const last = exchanges.at(-1);
  if (m[1] === 'tx') {
    if (!last || last.reply.length) exchanges.push({ send: [b], reply: [] });
    else last.send.push(b);
  } else if (last) last.reply.push(b);
}

const hex = (a) => a.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const out = [];
const adapter = await createAdapter({
  wasm: readFileSync(new URL('../public/link/wgcore.wasm', import.meta.url)),
  server: opt.server,
  tx: (bytes) => out.push(...bytes),
  onEvent: (e) => opt.verbose && console.log('   ', e.type === 'log' ? e.line : JSON.stringify(e))
});

// Fed exchange by exchange (so the adapter's waits line up with the console's), compared as one stream:
// the log records replies when the console's port reads them, which can land after the console's next
// bytes. Inside receive replies (11:0F, 11:10) the bytes are the server's own data, passed through: values
// the server generates (its clock, random IDs, counters) may differ between runs, so differences there are
// counted, not failed, as long as the streams have the same length. Everything else must match exactly.
function serverDataPositions(stream) {
  const at = new Set();
  for (let i = 0; i < stream.length; ) {
    if (stream[i] === 0x55) { i++; continue; }
    const len = stream[i + 2] ?? 0;
    if (stream[i] === 0x11 && (stream[i + 3] === 0x0f || stream[i + 3] === 0x10)) for (let k = i + 5; k < i + 3 + len; k++) at.add(k);
    i += 3 + len;
  }
  return at;
}
const digit = (b) => b >= 0x30 && b <= 0x39;

const want = exchanges.flatMap((x) => x.reply);
const started = Date.now();
for (const x of exchanges) {
  adapter.feed(Uint8Array.from(x.send));
  await adapter.idle();
}
adapter.close();
const got = out;
const data = serverDataPositions(want);
let clock = 0;
let values = 0;
let firstBad = -1;
for (let k = 0; k < Math.max(got.length, want.length); k++) {
  if (got[k] === want[k]) continue;
  if (got.length === want.length && data.has(k)) digit(got[k]) && digit(want[k]) ? clock++ : values++;
  else if (firstBad < 0) firstBad = k;
}
const secs = ((Date.now() - started) / 1000).toFixed(1);
if (firstBad >= 0) {
  const from = Math.max(0, firstBad - 12);
  console.log(`differs at byte ${firstBad} of ${want.length} (got ${got.length}):`);
  console.log(`   expected: ${hex(want.slice(from, firstBad + 24))}`);
  console.log(`   got:      ${hex(got.slice(from, firstBad + 24))}`);
  console.log(`FAIL: ${exchanges.length} exchanges, ${want.length} reply bytes (${secs} s)`);
  process.exit(1);
}
const except = [clock && `${clock} digits of server time`, values && `${values} bytes of server-generated values`].filter(Boolean);
console.log(`PASS: ${exchanges.length} exchanges, ${want.length} reply bytes identical${except.length ? ` except ${except.join(' and ')}` : ''} (${secs} s)`);
