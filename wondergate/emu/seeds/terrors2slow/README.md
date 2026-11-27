Seed for the `terrors2slow` replay (Terrors 2). No stored data: `server.env` makes the server send 23:59
as the clock (`T2_TIME`) and start its reply 3 seconds late (`T2_DELAY`). The adapter has to wait as long
as the game asked (5 seconds); one that gives up after 2 makes the game read its clock from the wrong line.
