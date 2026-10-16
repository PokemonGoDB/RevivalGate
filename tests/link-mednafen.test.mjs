// swan-link --setup-mednafen: only the two WonderGate settings change, and the old file is kept.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupMednafen } from '../link/lib.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'mednafen-'));

test('creates the settings when Mednafen has none yet', () => {
  const h = home();
  const file = setupMednafen({ program: '/x/swan-link', home: h });
  assert.equal(readFileSync(file, 'utf8'), 'wswan.excomm 1\nwswan.excomm.path /x/swan-link\n');
});

test('replaces only the two settings, matching whole names, and keeps a copy', () => {
  const h = home();
  const before = ';VERSION 1.32.1\nwswan.excomm.path /old/adapter.sh\nvideo.fs 0\nwswan.excomm 0\nwswan.rotateinput 0\n';
  writeFileSync(join(h, 'mednafen.cfg'), before);
  const file = setupMednafen({ program: '/home/me/swan-link/swan-link', home: h });
  assert.equal(
    readFileSync(file, 'utf8'),
    ';VERSION 1.32.1\nwswan.excomm.path /home/me/swan-link/swan-link\nvideo.fs 0\nwswan.excomm 1\nwswan.rotateinput 0\n'
  );
  assert.equal(readFileSync(`${file}.before-swan-link`, 'utf8'), before);
});

test('running it twice changes nothing more', () => {
  const h = home();
  setupMednafen({ program: '/p', home: h });
  const once = readFileSync(join(h, 'mednafen.cfg'), 'utf8');
  setupMednafen({ program: '/p', home: h });
  assert.equal(readFileSync(join(h, 'mednafen.cfg'), 'utf8'), once);
});
