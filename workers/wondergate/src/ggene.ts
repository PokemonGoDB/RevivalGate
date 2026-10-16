// SD Gundam G Generation Gather Beat 1 & 2: the WonderGate shop lists on wgg02.channel.or.jp. A port
// of ggene.py (the lists are generated into encoded.ts from it).
//   GET /download/ggene_gb/gggbgate.txt    Gather Beat (1): Bandai's cumulative list, OUR estimated prices
//   GET /download/ggene_gb/gggbgate2.txt   Gather Beat 2: Bandai's lineup at the recorded prices
// Lines "T" + 3-digit id + 4-digit price in supply points; see that repo's docs/wondergate/gather-beat.md.
import { GGENE_FILES } from './encoded';
import type { Reply } from './http';

export const isFile = (path: string) => Object.hasOwn(GGENE_FILES, path);

export function handle(path: string): Reply {
  const [game, data] = GGENE_FILES[path];
  return { status: 200, type: 'text/plain', body: data, note: `ggene ${game}: ${data.split('\n').length - 1} lines` };
}
