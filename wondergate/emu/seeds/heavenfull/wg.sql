-- Another Heaven: 1233 quick-solve scores ahead of a fresh save (027900), all with 16-character
-- names. The board's five rows are full and the player is 1234th (names were cut to 8, rank to 99).
CREATE TABLE IF NOT EXISTS swan_ranking (
    game TEXT, course INTEGER, player TEXT, owner TEXT,
    score TEXT, extra TEXT, updated REAL,
    PRIMARY KEY (game, course, player, owner));
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1233)
INSERT INTO swan_ranking
SELECT 'heaven', 1, printf('SEED%04d', i), printf('QUICK SOLVER%04d', i), printf('%06d', 1000 + i), '', i FROM n;
