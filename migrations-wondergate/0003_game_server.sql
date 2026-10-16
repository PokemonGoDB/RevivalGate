-- State the game server Worker keeps besides swan_ranking (the Python server used JSON files).

-- Bandai charge service: SRVC-CNT hands out a new customer number per call, per service.
CREATE TABLE charge_counter (
  service TEXT PRIMARY KEY,
  n       INTEGER NOT NULL
);

-- Tonpuusou's R rating, shared with the PC version. The game sends an ID and password;
-- we keep only a hash of the password.
CREATE TABLE tonpuusou_players (
  id            TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  rate          INTEGER NOT NULL,   -- R × 100
  games         INTEGER NOT NULL,
  g             TEXT NOT NULL DEFAULT '',
  updated       INTEGER
);
