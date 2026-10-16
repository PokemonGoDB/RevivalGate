-- Same table as the game server's Store (WonderswanCartDumper/wondergate/server/swan_ranking.py),
-- so the game server can write here unchanged. Each player's best score per game table and course.
CREATE TABLE swan_ranking (
  game    TEXT,     -- table key: 'rakujang', 'pocketf/2', 'pocketf/3/A', ...
  course  INTEGER,
  player  TEXT,     -- console/customer id from the game; never shown on the site
  owner   TEXT,     -- name exactly as the game sent it
  score   TEXT,
  extra   TEXT,
  updated REAL,     -- unix seconds
  PRIMARY KEY (game, course, player, owner)
);

CREATE INDEX swan_ranking_updated ON swan_ranking (updated);

-- Names taken off the public site (moderation). The game itself still sees them.
CREATE TABLE ranking_hidden (
  game    TEXT NOT NULL,   -- server game id, e.g. 'rakujang' (covers all its tables)
  owner   TEXT NOT NULL,   -- owner exactly as stored
  reason  TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (game, owner)
);
