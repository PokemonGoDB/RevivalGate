-- MobileWonderGate cart mail, moved out of the single wg_state row (which D1 caps at 2 MB, and every
-- cart that runs auto-setup adds an account). The Python server keeps the same data in mail.json.

-- One row per auto-setup. The address is "wg" + n, zero-padded to five digits.
CREATE TABLE mail_accounts (
  n        INTEGER PRIMARY KEY AUTOINCREMENT,
  password TEXT NOT NULL,
  created  TEXT NOT NULL
);

-- Mailboxes, oldest first by seq. `id` is the POP3 UIDL.
CREATE TABLE mail_messages (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  account INTEGER NOT NULL REFERENCES mail_accounts (n),
  id      TEXT NOT NULL,
  raw     TEXT NOT NULL
);
CREATE INDEX mail_messages_account ON mail_messages (account, seq);

-- Mail to addresses that aren't ours: kept (latest 100), never relayed.
CREATE TABLE mail_outbox (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  sender    TEXT NOT NULL,
  recipient TEXT NOT NULL,
  raw       TEXT NOT NULL
);
