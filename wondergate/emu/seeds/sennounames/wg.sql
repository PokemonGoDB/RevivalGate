-- Sennou Millennium: 12000 scores ahead of a fresh save, names stored form-encoded as the game
-- uploads them (space as +, plus as %2b). The player is 12001st of 12001 (counts were cut to 9999)
-- and the row just above is "A B[]+-?0123456." (names used to come back still encoded).
CREATE TABLE IF NOT EXISTS swan_ranking (
    game TEXT, course INTEGER, player TEXT, owner TEXT,
    score TEXT, extra TEXT, updated REAL,
    PRIMARY KEY (game, course, player, owner));
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 11999)
INSERT INTO swan_ranking
SELECT 'sen-know', 1, printf('SEED%05d', i), printf('SENNOU+%05d++++', i), printf('%08d', 90000000 - i), '005', i FROM n;
INSERT INTO swan_ranking VALUES
    ('sen-know', 1, 'SEED12000', 'A+B[]%2b-?0123456.', '00000001', '001', 12000);
