-- Buffers Evolution: 10,000 players ahead of the replay's cart (0'01"00) on Enduro A1, with times
-- 0'00"01 to 0'00"99, so the cart is 10,001st. Its rank must go out as 9999 (the field has four digits).
CREATE TABLE IF NOT EXISTS swan_ranking (
    game TEXT, course INTEGER, player TEXT, owner TEXT,
    score TEXT, extra TEXT, updated REAL,
    PRIMARY KEY (game, course, player, owner));
WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 9999)
INSERT INTO swan_ranking
SELECT 'buffers', 0, printf('%06X', i), 'SEED', printf('0000%02d', 1 + i % 99), '0000', i FROM n;
