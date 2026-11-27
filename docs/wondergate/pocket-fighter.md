# Pocket Fighter: rankings, extras, cards ✅

Status: **working** headless (2026-10-13; points upload 2026-10-15): customer ID, score and points
uploads ("ランクイン"), score / total point / per-character ranking downloads (OFFICIAL DATA shows them), and the paid extras: the
EXTRA MENU's six "NOTHING" slots become TRAINING MODE, SOUND TEST, EVENT TEST, RESET MODE, COMMAND
LIST, PASSWORD FIGHTER; the card download adds digital cards.

How to reach it: title → POCKET FIGHTER → OPTION → GAME DATA → WONDER GATE → 『かきんサービス』
agree (LEFT, A) → つうしんをはじめる → はい → (first time: customer ID screen) → サービス →
アップロード / ダウンロード. **Every yes/no prompt defaults to いいえ**; answer はい with LEFT, A.
The full first-time flow is replayed by `emu/regress.py` (key `pocketf`).

Goes through the Bandai charge service first (see [charge.md](charge.md)): srvccount, gettime,
srvcinfo (free, open until 2099), session, then the content request below.

## Content requests: `POST /service/swan-ranking/pocketf`

| Menu | Body | Reply body |
|---|---|---|
| upload score | `*=<customer id>&owner=<name 3 + fighter A-L>&score=01|<8 digits>` | `course=1|1|<entrants>|<top>|<yours>|<rank>` (1-50 = ランクイン, anything else = ランクがい) |
| upload points | `…&owner=<name 3 + fighter>&score=02|<8 digits>&score=<3 + fighter>|<8 digits>` | same course line (we answer with total points) |
| download score | `…&group=1&list=ANSPF_SCORE|1|50` | course line + `ANSPF_SCORE=<k>` + `<rank>|<score>|<owner 4>|` rows |
| download total points | `…&group=2&list=ANSPF_SCORE|1|50` | same, points table |
| download per fighter | `…&owner=CAP<fighter>&group=<3 + fighter>&list=…` | same, that fighter's points table |
| extras / cards | `…&group=0` | `info=` + 13 flags, `1` = on: extras read the first 6 (ROM `0x1CFB61`), cards skip 6 and read 7 (`0x1CFAFB`). One card flag is on per day, see below |

**Tables:** the number in an upload's `score=NN|` and a download's `group=` is the same table: 1
score, 2 total points, 3-14 one fighter's points (3 + the fighter's number: Ryu 3 … Gouki 14). Menus:
アップロード → スコアランキング / ポイントランキング; ダウンロード → スコアランキング / ポイントランキング
(→ トータルランキング / キャラクターランキング → 12-fighter grid, cursor on Ryu, column by column) / カード /
エクストラ. Seen 2026-10-15 in MesenCE: a points upload sent `owner=MORE&score=02|00002000&score=07|00002000`
(Morrigan, `MOR` being the name saved on Morrigan's slot), a Ken download `owner=CAPB&group=4`. The
captures before that only held score uploads.

Rows: the parser (ROM `0x1CF9C4`) reads the score, then 4 chars: 3-letter name + fighter letter
(portrait). The ranking screen pages with UP/DOWN.

## Fighter letters

The 4th owner character is `'A'` + the game's character number. The upload builder (ROM `0x1CFC0F`)
writes `[0x314] + 'A'` after the saved record's three name letters (`[0x319..0x31B]`; the points record
uses `[0x33C]` / `[0x341..0x343]`); a per-fighter download sends `CAP` + `'A'` + its menu choice
(`0x1EDF0C` sets item `0x0F` + choice, `0x1CFC57` turns it into the letter). The WonderGate
ranking browser steps that number through 0-11 (`[0x0C12]`, wraps at 12, ROM `0x1CF46D`) and names
it from the 12-entry 3-letter table at ROM `0x13F164`, so that table is the order:

| Letter | Fighter | Letter | Fighter | Letter | Fighter |
|---|---|---|---|---|---|
| A | Ryu (RYU) | E | Morrigan (MOR) | I | Ibuki (IBU) |
| B | Ken (KEN) | F | Lei-Lei (LEI) | J | Zangief (ZAN) |
| C | Chun-Li (CHN) | G | Felicia (FEL) | K | Dan (DAN) |
| D | Sakura (SAK) | H | Tabasa (TAB) | L | Gouki (GOU) |

**Confirmed (2026-10-15):** a score played as Ibuki uploaded with `I`, so I = Ibuki and J = Zangief,
although the select screen's name grid (ROM `0x10F14C`, two names per row) lists Zangief first.

**Per-fighter rankings are points rankings** (the menu's キャラクターランキング sits under
ポイントランキング), filled by the points upload's second `score=` (see Tables above). An earlier note
here said they came from the score table filtered by the fighter letter; that was wrong, from
captures that never held a points upload.

## Digital cards: what the game does with the 7 flags (2026-11-26)

The card download only ever adds to the set in the save (SRAM word `0x0F19`, one bit per card): for
each `1` it sets that card's bit, and it never clears one. If the set grew it says あたらしいデジタル
カードを にゅうしゅしました!!, otherwise あたらしいデジタルカードは ありませんでした。 Seen in the game:
flags `0100000` took the save from `00` to `02`; `0000100` then made it `12`; the same reply again,
and one with all flags off, said "no new cards" and left `12`; all seven on gives `7F`.

**One card a day (2026-11-27).** Both servers turn on one of the 7 card flags per day, Japan time,
Monday the first (`info=1111111000000` on a Monday, `…0100000` on a Tuesday, `…0000001` on a
Sunday), so the set fills over a week of downloads. The six extras are always on. The Worker has
done this since 2026-10-15; the Python server turned all 7 on until now, and `wg-conformance.mjs`
no longer masks the flags. The schedule is ours: Bandai's own is not known.

Seen in the game against the Python server: a download on a Saturday (Japan time) got
`info=1111110000010`, the game said あたらしいデジタルカードを にゅうしゅしました!! and the save went from
`00` to `20`; a second download the same day said あたらしいデジタルカードは ありませんでした。 and left `20`.
With the date pinned (below): Monday `01`, again the same day "no new cards"; then Tuesday `03`,
again "no new cards"; then Sunday `43`.

`PF_DATE=YYYY-MM-DD` in the Python server's environment is a test hook that fixes the day the card
is chosen for (not in the Worker). The `pfcards` replay runs with `PF_DATE=2026-11-30`, a Monday
(`emu/seeds/pfcards/server.env`), so its save always ends with `0x0F19` = `01 00`; without the
hook the value is 1 shifted left by the weekday (Monday 0) and changes daily.

Not run: the Worker with the game itself. Its `info=` replies were compared with the Python
server's for the recorded card requests, unmasked, and were the same.

## Upload result and table size (2026-11-26)

After an upload the game reads the rank from the course line: 1 to 50 gives 『ランクイン』 (you are in
the national ranking), anything else (0, 51, 100, 9999, 65536 tried) gives 『ランクがい』 ベスト50がい
です. The server used to cut the rank to 50, so a player in 61st place was told ランクイン; it now sends
the real rank (up to 9999). Seen in the game with 49, 50 and 60 better scores seeded: ランクイン,
ランクがい, ランクがい. A reply with no course line shows no result and goes straight to 『しゅうりょう』.

A download of a full table says ダウンロードできたスコアは 50けんです, and OFFICIAL DATA → SCORE RANKING
shows all 50 rows, five to a page, with 8-digit scores (`99999999` in first place).

Not checked: names other than three letters, and the points tables at these sizes.
