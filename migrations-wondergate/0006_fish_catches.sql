-- Fishing Freaks: Bass Rise catch leaderboard (/translations/fishing-freaks/leaderboard/). Players post the code
-- the game shows for a catch; the site decodes and checks it (src/lib/fish.ts). Honour system: no code proves
-- a catch is real, so entries can be hidden or deleted.

CREATE TABLE fish_catches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code_raw      TEXT NOT NULL,                 -- exactly as typed, so entries can be re-checked if the decoder changes
  code          TEXT NOT NULL UNIQUE,          -- 20 upper-case hex digits (symbols converted), or the 16 ranking characters
  catch_key     TEXT,                          -- the original password's hex; for a ranking code, the one the game shows
                                               -- for the same catch (NULL when a capped value hides it)
  format        TEXT NOT NULL CHECK (format IN ('ranking', 'original')),
  angler        TEXT NOT NULL,                 -- the in-game name, case-sensitive
  name_verified INTEGER NOT NULL,              -- 1: ranking code whose name hash matches
  species_id    INTEGER NOT NULL,
  species       TEXT NOT NULL,
  size_mm       INTEGER NOT NULL,              -- tenths of a cm
  weight_tenths INTEGER,                       -- tenths of a kg; NULL when unknown
  weight_source TEXT CHECK (weight_source IN ('code', 'player')),  -- 'player': typed in, low byte matches the code
  lure          TEXT,                          -- ranking codes only, like colour and weather
  colour        TEXT,
  place         TEXT NOT NULL,
  season        TEXT NOT NULL,
  time          TEXT NOT NULL,
  weather       TEXT,
  decoded       TEXT NOT NULL,                 -- the decoder's output at submit time, JSON
  account_id    TEXT NOT NULL REFERENCES accounts (id),
  created       INTEGER NOT NULL,              -- unix seconds
  hidden        INTEGER NOT NULL DEFAULT 0,    -- moderation
  hidden_reason TEXT,
  superseded_by INTEGER                        -- an original code later posted as its ranking code: that entry's id
);
CREATE INDEX fish_catches_catch ON fish_catches (catch_key);
CREATE INDEX fish_catches_size ON fish_catches (size_mm DESC);
CREATE INDEX fish_catches_weight ON fish_catches (weight_tenths DESC);
CREATE INDEX fish_catches_account ON fish_catches (account_id);

-- Accounts that can moderate site boards. Grant with
-- wrangler d1 execute swanrevival-wondergate --remote --command "INSERT INTO site_admins (account_id, created) VALUES ('<id>', unixepoch())"
CREATE TABLE site_admins (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id),
  created    INTEGER NOT NULL
);
