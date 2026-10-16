// Names that never appear in public: slurs, hate symbols, and sexual or abusive words. Shared by the site
// (account names, catch posts, and every board that shows a name) and the game server (refuses to store a
// ranking under such a name), so it imports nothing.
//
// Game names are short, often in capitals with no spaces, and players dodge filters with l33t spelling, dots,
// and repeated letters. So each name is checked three ways, and each word list is matched only in the way that
// doesn't catch innocent names:
//   ANYWHERE   inside the name with everything but letters removed ("F.U.C.K", "xxFUCKxx")
//   EDGE       at the start or end of a word ("BULLSHIT", "SLUTTY"), but not inside one ("ASHITA")
//   WORD       a whole word only ("ASS", not "BASS" or "GLASS")
// Every letter of a listed word may repeat ("FUUUCK"). Keep ANYWHERE words long and unambiguous: "RAPIST" would
// catch "THERAPIST", and "NAZI" would catch "IGNAZIO".

const ANYWHERE = [
  // slurs
  'nigger', 'nigga', 'niglet', 'faggot', 'faggit', 'fagot', 'retard', 'tranny', 'trannie', 'shemale',
  'chingchong', 'wetback', 'raghead', 'towelhead', 'zipperhead', 'sandnig', 'beaner',
  // hate
  'hitler', 'siegheil', 'whitepower', 'gaschamber', 'holocaust', 'killyourself',
  // sexual and abusive
  'fuck', 'fck', 'cunt', 'bitch', 'whore', 'asshole', 'dickhead', 'cocksuck', 'motherf', 'cumshot',
  'jizz', 'porn', 'penis', 'vagina', 'pussies', 'blowjob', 'handjob', 'rimjob', 'dildo', 'molest',
  'pedophil', 'paedophil', 'incest', 'bestiality', 'rapedyou', 'jerkoff', 'masturbat', 'orgasm',
  'clitoris', 'testicle', 'scrotum', 'milf', 'hentai', 'bukkake', 'gangbang', 'titties',
  'boobies', 'nutsack', 'ballsack', 'dumbass', 'jackass', 'fatass', 'smartass'
];

const EDGE = ['shit', 'slut', 'wank', 'piss', 'twat', 'nigg'];

const WORD = [
  'ass', 'arse', 'cum', 'sex', 'anal', 'anus', 'kkk', 'heil', 'kike', 'spic', 'chink', 'gook', 'coon', 'dyke',
  'negro', 'paki', 'kys', 'tit', 'titty', 'boob', 'boobs', 'nonce', 'homo', 'prick', 'pussy', 'puss', 'semen',
  'nig', 'jap', 'slag', 'skank', 'hoe', 'hoes', 'thot', 'nude', 'nudes', 'horny',
  // also innocent inside other words: therapist, grape, torpedo, peacock, Dickens, Nazir, Fagin
  'rapist', 'rape', 'raped', 'pedo', 'pedos', 'cock', 'cocks', 'dick', 'dicks', 'tits', 'nazi', 'nazis', 'fag', 'fags'
];

// Numbers and symbols read as letters ("N1GG3R"). Harmless for other names: only listed words count.
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't',
  '8': 'b', '9': 'g', '6': 'g', '(': 'c', '<': 'c', '¢': 'c', '€': 'e', '£': 'l'
};
// Hate numbers, checked on the name as written.
const NUMBERS = /(^|\D)(1488|14\/88|88\/14)(\D|$)/;

/** "fuck" → f+u+c+k+, so each letter may repeat. */
const letters = (word: string) => [...word].map((c) => `${c}+`).join('');
const anywhere = new RegExp(ANYWHERE.map(letters).join('|'));
const edge = new RegExp(`^(?:${EDGE.map(letters).join('|')})|(?:${EDGE.map(letters).join('|')})$`);
const word = new RegExp(`^(?:${WORD.map(letters).join('|')})$`);

/**
 * Lower case, accents and full-width letters folded, l33t read as letters. Anything else becomes a space.
 * Without `digits`, digits are spaces too: short WORD matches would otherwise catch names like "N16" ("nig").
 */
function fold(text: string, digits: boolean): string {
  return [...text.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFKC').toLowerCase()]
    .map((c) => (c >= 'a' && c <= 'z' ? c : !digits && c >= '0' && c <= '9' ? ' ' : (LEET[c] ?? ' ')))
    .join('');
}

const wordsOf = (text: string, digits: boolean) => fold(text, digits).split(/\s+/).filter(Boolean);

/** Whether a name shouldn't be shown in public. */
export function isOffensive(name: string): boolean {
  if (!name) return false;
  if (NUMBERS.test(name)) return true;
  // Words split at spaces and symbols, and at a lower-to-upper step ("BigAss" → "Big", "Ass").
  const split = name.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
  const leet = wordsOf(split, true);
  if (anywhere.test(leet.join('')) || leet.some((w) => edge.test(w))) return true;
  const plain = wordsOf(split, false);
  return word.test(plain.join('')) || plain.some((w) => word.test(w));
}
