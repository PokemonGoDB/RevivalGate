-- Final Lap 2000: 1200 entrants ahead of a fresh save on England (course 1 total time, course 17 best lap).
-- The player is 1201st and the rival's row is rank 1200: a 4-digit row rank used to hang the game.
CREATE TABLE IF NOT EXISTS swan_ranking (
    game TEXT, course INTEGER, player TEXT, owner TEXT,
    score TEXT, extra TEXT, updated REAL,
    PRIMARY KEY (game, course, player, owner));
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1200)
INSERT INTO swan_ranking
SELECT 'final-lap', c.course, printf('SEED%04d', i), printf('R%02d', i % 100), printf('%05d', 999 + i), '0', i
FROM n, (SELECT 1 AS course UNION ALL SELECT 17) AS c;
