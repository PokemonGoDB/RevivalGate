-- Daily per-address counts for the game server's hard limits (workers/wondergate/src/limits.ts): mail
-- accounts and messages, Digimon sign-ups, Wonder Classic members, Dark Eyes mercenaries. The key is a
-- SHA-256 of the kind, the day and the address; the address itself is never stored. Rows from earlier
-- days are deleted as new ones are counted.
CREATE TABLE wg_quota (
  key TEXT PRIMARY KEY,
  day INTEGER NOT NULL,   -- days since 1970-01-01 (UTC)
  n   INTEGER NOT NULL
);
CREATE INDEX wg_quota_day ON wg_quota (day);
