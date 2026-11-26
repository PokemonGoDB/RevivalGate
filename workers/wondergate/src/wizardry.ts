// Wizardry Scenario 1 (Bandai 2001): www2.sting.co.jp/cgi-bin/wg/wiz.cgi. A port of wizardry.py.
//   ?mp=kure  additional maps   ?it=kure  Boltac's stock   ?nm=NAME&sc=SCORE  high-score registration
// Reply: #SUMxxxx #WIZ^... #SUMxxxx, xxxx = 16-bit sum of the bytes between the markers.
import { isOffensive } from '../../../src/lib/wordfilter';
import { bytesOf, jst, parseQuery } from './bytes';
import type { Conn } from './env';
import type { Reply } from './http';
import { writeAllowed } from './limits';
import { withState } from './state';

const PER_MONTH = 12;
const ITEMS = 120; // item numbers 2..121

function wrap(section: string): Uint8Array {
  const data = `#WIZ${section}`;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data.charCodeAt(i) & 0xff;
  const mark = `#SUM${(sum & 0xffff).toString(16).padStart(4, '0')}`;
  return bytesOf(`${mark}${data}${mark}\r\n`);
}

const maps = () => `^MAP${Array.from({ length: 10 }, (_, i) => `1 ${10 + i}`).join(' ')} `;

function shop(): [string, number[]] {
  const t = jst();
  const n = (t.year * 12 + t.month) * PER_MONTH;
  const ids = Array.from({ length: PER_MONTH }, (_, i) => 2 + ((n + i) % ITEMS)).sort((a, b) => a - b);
  return [`^SHP${ids.join(' ')} `, ids];
}

/** Scores in first-registered order (ties keep it), as the Python dict. */
type Scores = Array<[string, number]>;
/** Only the top three and your own place are ever shown; keep the best 1,000 names. */
const KEEP = 1000;

// Character names are up to 8 letters; this is twice that. A longer or offensive name is answered as
// usual but not stored, as is a score from an address that's writing too often.
const MAX_NAME = 16;

/** One "rank name_score " entry, kept inside the cartridge's slot (parser at ROM 0x176AB0): the name is copied up
 *  to '_' with no length check into 6 bytes, and the score then lands on the sixth, so 5 letters is the most that
 *  shows cleanly (a 6-letter name runs on into the score's bytes; two of them hung the ranking screen). The score
 *  is 32-bit, the rank one byte. */
const NAME_MAX = 5;
const RANK_MAX = 255;
function entry(rank: number, name: string, score: number): string {
  return `${rank} ${name.slice(0, NAME_MAX).replace(/_/g, ' ')}_${Math.min(score, 0xffffffff)} `;
}

async function ranking(conn: Conn, name: string, score: number): Promise<[string, number]> {
  const store = name.length <= MAX_NAME && !isOffensive(name) && (await writeAllowed(conn));
  return withState<Scores, [string, number]>(conn, 'wizardry', () => [], (scores) => {
    const i = scores.findIndex(([n]) => n === name);
    if (store && name && score >= 0 && score > (i >= 0 ? scores[i][1] : -1)) {
      if (i >= 0) scores[i][1] = score;
      else scores.push([name, score]);
    }
    if (scores.length > KEEP) {
      const cut = scores.map(([, s], order) => ({ s, order })).sort((a, b) => b.s - a.s || a.order - b.order)[KEEP - 1].s;
      let room = scores.filter(([, s]) => s > cut).length;
      room = KEEP - room;
      for (let i = 0; i < scores.length; ) {
        if (scores[i][1] > cut || (scores[i][1] === cut && room-- > 0)) i++;
        else scores.splice(i, 1);
      }
    }
    const table = scores.map(([n, s], order) => ({ n, s, order })).sort((a, b) => b.s - a.s || a.order - b.order);
    const top: Array<[number, string, number]> = table.slice(0, 3).map((e, k) => [k + 1, e.n, e.s]);
    while (top.length < 3) top.push([top.length + 1, '', 0]);
    const at = table.findIndex((e) => e.n === name);
    const mine: [number, string, number] = at >= 0 ? [at + 1, table[at].n, table[at].s] : [0, name, score];
    let rows = [...top, mine];
    // The cartridge reads a fifth entry when the player's rank is 5 or more: the place just above the player.
    // Its rank is one byte, so past 255 the player reads 255 and the place above 254.
    if (mine[0] >= 5) {
      const shown = Math.min(mine[0], RANK_MAX);
      const above = table[mine[0] - 2];
      rows = [...top, [shown, mine[1], mine[2]], [shown - 1, above.n, above.s]];
    }
    return [`^RNK${rows.map(([r, n, s]) => entry(r, n, s)).join('')}`, mine[0]];
  });
}

export async function handle(conn: Conn, query: string): Promise<Reply> {
  // Names are the cartridge's own bytes; keep them as Latin-1
  const q = parseQuery(query);
  let data: string;
  let note: string;
  if ('mp' in q) {
    data = maps();
    note = 'wizardry maps: 10 floors';
  } else if ('it' in q) {
    const [section, ids] = shop();
    data = section;
    note = `wizardry shop ${ids.join(',')}`;
  } else if ('nm' in q) {
    const sc = q.sc ?? '0';
    const score = /^[0-9]+$/.test(sc) ? Number.parseInt(sc, 10) : 0;
    const [section, rank] = await ranking(conn, q.nm, score);
    data = section;
    note = `wizardry ranking ${q.nm} ${score} -> #${rank}`;
  } else {
    data = '^ERR';
    note = `wizardry: unknown query ${query}`;
  }
  return { status: 200, type: 'text/plain', body: wrap(data), note };
}
