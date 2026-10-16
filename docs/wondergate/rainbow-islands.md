# Rainbow Islands: Putty's Party: Item GET / Illust GET ✅

Status: **working** headless (2026-10-13): Item GET adds a random item to the save file; Illust
GET unlocks one of 12 illustrations.

How to reach it (vertical): title → START → ワンダーゲート (Y_LEFT, DOWN) → アイテムGET! /
イラストGET! → pick a file (Y-pad pages files, DOWN selects) → うん! (DOWN). The file must hold
game data: record byte `+0x10` (records are 0x7E bytes at SRAM 0) must be nonzero, else
"ゲームデータがないぜ!". The regression replay sets it with `poke:10=1`.

## Exchange

Only `POST /service/charge/nph-gettime` (relative path, `Host: wgb01.channel.or.jp`) → `TIME-RET: 0`,
`TIME-NOW`. The item / illustration is chosen on the cartridge from the server time.
