# Rainbow Islands: Putty's Party: Item GET / Illust GET ✅

Status: **working** headless (2026-10-13): Item GET adds a random item to the save file; Illust
GET unlocks one of 12 illustrations.

How to reach it (vertical): title → START → ワンダーゲート (Y_LEFT, DOWN) → アイテムGET! /
イラストGET! → pick a file (Y-pad pages files, DOWN selects) → うん! (DOWN). The file must hold
game data: record byte `+0x10` (records are 0x7E bytes at SRAM 0) must be nonzero, else
"ゲームデータがないぜ!". The regression replay sets it with `poke:10=1`.

## Exchange

Only `POST /service/charge/nph-gettime` (relative path, `Host: wgb01.channel.or.jp`) → `TIME-RET: 0`,
`TIME-NOW`. The game waits for the server to close the connection and then needs only HTTP 200.

## What the reply does (checked in the game, 2026-11-26)

The server time is **not** used. It is copied to SRAM `0x0DBE` and never read: a read watch on it
saw nothing through Item GET and Illust GET. (An earlier note here said the item was chosen from the
server time; that was a guess.) What the cartridge does (state machine at `F4A2:3256`, ROM `0x1F7C76`):

- **Item GET** (`F4A2:33D6`): item = counter `[0x0CF1]` mod 5 (4 becomes 6), and the file's record
  gets `+0x15 + item` = 1. In the replay that is SRAM `0x18` = `01`.
- **Illust GET** (`F4A2:310D`): the first illustration not yet unlocked, from number 2 up to a limit
  set by the file's score (record `+0x8A`, 32 bits: 2 below 500,000, 3 below 1,000,000, then one
  more per million or so, 13 from 10,000,000; read from the code), is marked at SRAM `0x20A + n` = n.
  A file with score 0 gets number 2, 「はなのソファでひとやすみ」 (SRAM `0x20C` = `02`, seen in the game).
- 404 or 500: error 999, back to the file list, nothing written.

All replies tried are in [charge.md](charge.md). Illust GET steps: as the replay, with `Y_LEFT`
before the second `DOWN` (cursor to イラストGET!).
