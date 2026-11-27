-- Pocket Fighter: 60 scores above the 00020000 the replay uploads, so the player is 61st, outside
-- the best 50 (the rank used to be cut to 50, and the game said it had ranked in). Owners are 3 letters
-- and the fighter's letter A-L.
CREATE TABLE IF NOT EXISTS swan_ranking (
    game TEXT, course INTEGER, player TEXT, owner TEXT,
    score TEXT, extra TEXT, updated REAL,
    PRIMARY KEY (game, course, player, owner));
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 60)
INSERT INTO swan_ranking
SELECT 'pocketf', 1, printf('SEED%04d', i), printf('P%02d', i) || char(65 + i % 12), printf('%08d', 90000000 - i * 1000), '', i FROM n;
