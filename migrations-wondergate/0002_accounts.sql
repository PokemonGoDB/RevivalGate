-- Player accounts, and the link from a score to the account whose relay posted it.

-- Set by the game server from the relay's device token; NULL for scores from an unlinked relay.
ALTER TABLE swan_ranking ADD COLUMN account_id TEXT;
CREATE INDEX swan_ranking_account ON swan_ranking (account_id);

CREATE TABLE accounts (
  id      TEXT PRIMARY KEY,                    -- random, never shown
  handle  TEXT UNIQUE COLLATE NOCASE,          -- NULL until the player picks one
  created INTEGER NOT NULL,                    -- unix seconds
  hidden  INTEGER NOT NULL DEFAULT 0           -- moderation: 1 hides the handle and profile
);

-- Sign-in identities. Only the provider's own account number is kept: no email, no name.
CREATE TABLE identities (
  provider   TEXT NOT NULL,                    -- 'discord' | 'google' | 'dev' (local only)
  subject    TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  created    INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                 -- SHA-256 of the cookie value
  account_id TEXT NOT NULL REFERENCES accounts (id),
  expires    INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions (account_id);

-- A relay signed in to an account: the PC program, the phone app, or a module.
CREATE TABLE devices (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,             -- SHA-256 of the token the relay holds
  created    INTEGER NOT NULL,
  last_seen  INTEGER,
  revoked    INTEGER
);
CREATE INDEX devices_account ON devices (account_id);

-- One-time codes shown on the site and entered in a relay. Ten minutes, single use.
CREATE TABLE link_codes (
  code_hash  TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  expires    INTEGER NOT NULL
);
