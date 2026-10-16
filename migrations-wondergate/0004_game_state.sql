-- State for game services that the Python server keeps in JSON files or memory (Digimon's ladder,
-- Wizardry's high scores, Star Hearts members, Dark Eyes matchmaking, MobileWonderGate mail).
-- One row per service; writes check `version` so two requests can't overwrite each other.
CREATE TABLE wg_state (
  key     TEXT PRIMARY KEY,
  value   TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
