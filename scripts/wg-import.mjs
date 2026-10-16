// Fill the LOCAL rankings database for development. Never touches the remote one.
//
//   node scripts/wg-import.mjs              copy rows from the game server's wg.sqlite
//   node scripts/wg-import.mjs --demo       also add demo rows (player id DEMO-…) to every board
//   node scripts/wg-import.mjs --clear-demo remove the demo rows
//
// WG_SQLITE overrides the source path.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { GAME_REPO } from './lib/procs.mjs';
import { join } from 'node:path';

const DB = 'swanrevival-wondergate';
const SOURCE = process.env.WG_SQLITE ?? join(GAME_REPO, 'data', 'wg.sqlite');
const args = new Set(process.argv.slice(2));

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = (r) =>
  `INSERT OR REPLACE INTO swan_ranking (game, course, player, owner, score, extra, updated) VALUES (${[r.game, r.course, r.player, r.owner, r.score, r.extra, r.updated].map(q).join(', ')});`;

function run(statements) {
  if (!statements.length) return;
  const file = join(mkdtempSync(join(tmpdir(), 'wg-')), 'import.sql');
  writeFileSync(file, statements.join('\n') + '\n');
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', DB, '--local', '--file', file], { stdio: ['ignore', 'ignore', 'inherit'] });
}

if (args.has('--clear-demo')) {
  run(["DELETE FROM swan_ranking WHERE player LIKE 'DEMO-%';"]);
  console.log('demo rows removed');
  process.exit(0);
}

// 1. The game server's own rows (headless test sessions).
const rows = JSON.parse(execFileSync('sqlite3', ['-json', SOURCE, 'SELECT * FROM swan_ranking'], { encoding: 'utf8' }) || '[]');
run(rows.map(insert));
console.log(`${rows.length} rows from ${SOURCE}`);

if (!args.has('--demo')) process.exit(0);

// 2. Demo rows in each game's own upload format. Deterministic, so reruns replace them.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (lo, hi) => Math.floor(lo + rand() * (hi - lo));
const pad = (n, w) => String(n).padStart(w, '0');
const plus = (name, w) => (name + '+'.repeat(w)).slice(0, w);
const now = Date.now() / 1000;
const when = () => now - between(60, 86400 * 20);

const LATIN = ['KAZU', 'MIO', 'SWANFAN', 'GUNPEI', 'YOKOI', 'AKIRA', 'NORI', 'TAMA', 'RIKO', 'HAL', 'SORA', 'JUN'];
const THREE = ['KAZ', 'MIO', 'YKI', 'HAL', 'RIN', 'SOR', 'JUN', 'AYA', 'TOM', 'NAO'];
// Raku Jongg kana, encoded as the game does (gojūon from 0x33).
const GOJUON = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
const raku = (kana) => [...kana].map((c) => String.fromCharCode(0x33 + GOJUON.indexOf(c))).join('');
// Only kana in the documented table (no dakuten yet).
const KANA = ['ねこた', 'さくら', 'たぬき', 'うさこ', 'まつり', 'ひかり', 'かもめ', 'ほたる'];

const demo = [];
const add = (game, course, i, owner, score, extra = '') =>
  demo.push({ game, course, player: `DEMO-${i}`, owner, score, extra, updated: when() });

for (const course of [1, 2, 3]) KANA.forEach((k, i) => add('rakujang', course, i, raku(k), pad(between(20000, 260000), 6), String(between(0, 12))));
for (const course of [1, 2, 4, 5]) LATIN.slice(0, 9).forEach((n, i) => add('gunpeyex', course, i, plus(n, 16), pad(between(1000, 900000), 10), pad(between(5, 400), 4)));
LATIN.slice(0, 8).forEach((n, i) => add('tarepang', 1, i, plus(n, 16), pad(between(1000, 500000), 10), pad(between(5, 300), 4)));
LATIN.slice(0, 8).forEach((n, i) => add('tarepang', 2, i, plus(n, 16), pad(between(1, 40), 3) + pad(between(1000, 900000), 7)));
LATIN.slice(0, 5).forEach((n, i) => add('heaven', 1, i, n, pad(between(10000, 99999), 6)));
for (const course of [1, 2, 3, 4]) LATIN.slice(0, 7).forEach((n, i) => add('tanetori', course, i, plus(n, 16), pad(between(500, 99999), 10)));
LATIN.slice(0, 10).forEach((n, i) => add('sen-know', 1, i, plus(n, 16), pad(between(5000, 9000000), 8), pad(between(1, 60), 3)));
for (let c = 1; c <= 16; c++) {
  THREE.forEach((n, i) => {
    const total = between(9000, 18000); // centiseconds: 1'30"00 – 3'00"00
    const lap = between(2800, 5900);
    const fmt = (cs) => `${Math.floor(cs / 6000)}${pad(Math.floor(cs / 100) % 60, 2)}${pad(cs % 100, 2)}`;
    add('final-lap', c, i, n, fmt(total), '0');
    add('final-lap', c + 16, i, n, fmt(lap), '0');
  });
}
const FIGHTERS = 'ABCDEFGHIJKL';
THREE.forEach((n, i) => {
  const f = FIGHTERS[between(0, 12)];
  const owner = n + f;
  const score = pad(between(10000, 9999999), 8);
  add('pocketf', 1, i, owner, score);
  add('pocketf/2', 1, i, owner, pad(between(100, 99999), 8));
  add(`pocketf/3/${f}`, 1, i, owner, score);
});

run(demo.map(insert));
console.log(`${demo.length} demo rows`);
