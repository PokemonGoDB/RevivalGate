-- Tare Panda no GunPey: three puzzle records (course 3) ahead of a fresh save: stage 10 in 1:15,
-- stage 8 in 3:20, stage 5 in 12:05. Scores are SSS 00 TTT ss = stage, 99 - minutes, 60 - seconds.
-- The game works the time out for row 1 only, so rows 2 and 3 used to show 96:40 and 87:55.
CREATE TABLE IF NOT EXISTS swan_ranking (
    game TEXT, course INTEGER, player TEXT, owner TEXT,
    score TEXT, extra TEXT, updated REAL,
    PRIMARY KEY (game, course, player, owner));
INSERT INTO swan_ranking VALUES
    ('tarepang', 3, 'SEED0001', 'TARE+ICHI+++++++', '0100009845', '', 1),
    ('tarepang', 3, 'SEED0002', 'TARE+NI+++++++++', '0080009640', '', 2),
    ('tarepang', 3, 'SEED0003', 'TARE+SAN++++++++', '0050008755', '', 3);
