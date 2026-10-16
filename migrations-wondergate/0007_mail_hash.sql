-- MobileWonderGate mail keeps a salted PBKDF2 hash of each password, not the password, and mail to
-- addresses that aren't ours is dropped rather than kept (as mail.py since 2026-10-14). Rows made
-- before this hold the plain password in `hash`; the Worker hashes each one at its next login.
ALTER TABLE mail_accounts RENAME COLUMN password TO hash;
DROP TABLE mail_outbox;
