-- Raku Jongg: other players above a save whose three modes have three different names (the replay
-- pokes あいう / かきくけ / たちつ; default scores 001000, 000200, 000200). Two better Story scores,
-- one better Dan score and three better Time attack scores, so the player is 3rd, 2nd and 4th.
-- Owners are the game's character codes ('K' 0x4B is は, and so on).
CREATE TABLE IF NOT EXISTS swan_ranking (
    game TEXT, course INTEGER, player TEXT, owner TEXT,
    score TEXT, extra TEXT, updated REAL,
    PRIMARY KEY (game, course, player, owner));
INSERT INTO swan_ranking VALUES
    ('rakujang', 1, 'SEED01', 'KLM', '005000', '04', 1),
    ('rakujang', 1, 'SEED02', 'NOP', '003000', '03', 2),
    ('rakujang', 2, 'SEED01', 'KLM', '000900', '10', 1),
    ('rakujang', 3, 'SEED01', 'KLM', '000800', '09', 1),
    ('rakujang', 3, 'SEED02', 'NOP', '000700', '08', 2),
    ('rakujang', 3, 'SEED03', 'QRS', '000600', '07', 3);
