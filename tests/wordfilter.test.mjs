// The public-name filter (src/lib/wordfilter.ts). Run: pnpm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOffensive } from '../src/lib/wordfilter.ts';

test('catches slurs and abuse, however they are spelled', () => {
  for (const name of [
    'FUCK', 'fuck you', 'F.U.C.K', 'FUUUCK', 'xxFUCKxx', 'Ｆｕｃｋ', 'fück', 'BULLSHIT', 'shithead', 'BigAss', 'ASS',
    'A S S', 'N1GG3R', 'n i g g e r', 'niggaz', 'faggot', 'FAG', 'retarded', 'HITLER', 'H1TL3R', 'nazi', 'KKK',
    'SIEG HEIL', '1488', 'cunt', 'b!tch', 'whore', 'RAPIST', 'rape', 'COCK', 'dick', 'PEDO', 'PORN', 'TITS',
    'DUMBASS', 'kys', 'KILLYOURSELF'
  ]) {
    assert.equal(isOffensive(name), true, name);
  }
});

test('leaves ordinary names alone', () => {
  for (const name of [
    '', 'MIO', 'AAA', 'BASS', 'BassMan', 'GLASS', 'CLASSIC', 'Cassie', 'ASHITA', 'THERAPIST', 'GRAPE', 'DRAPE',
    'TORPEDO', 'PEACOCK', 'HANCOCK', 'COCKPIT', 'DICKENS', 'NAZIR', 'IGNAZIO', 'FAGIN', 'SWANKY', 'THORNY',
    'FUKUOKA', 'ESSEX', 'ANALOG', 'TITAN', 'SCRAPE', 'Dekotora', 'KAMIKAZE', 'ACE4', 'R2D2', 'MARIO64', 'SPICY',
    'Mr.Tamago', 'Buffers', 'SAKURA', 'ZERO', 'HIRO', 'Final Lap', 'Lake Biwa', 'Wonder Swan', 'Hamster', 'NIGER',
    'クラウド', 'あいう', 'N16', 'N19', 'A55', 'K15'
  ]) {
    assert.equal(isOffensive(name), false, name);
  }
});
