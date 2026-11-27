Seed for the `wcfinal` replay (Wonder Classic, the Net Tour's final). `server.env` fixes the server's date
to 2026-11-30, a fifth Monday inside the final of round 2 (23 to 30 November). `nclassic.json` is the
server's own state file: five members (A to E) with qualifier scores and final scores for rounds 1 and 2,
and a qualifier score (+5, 6th) for WC00000006, the ID the replay's cart is given when it registers. That
score stands in for a qualifier entry made earlier in the month; the replay pokes the cart's own record of
it (tour save +0x102 and +0x106).
