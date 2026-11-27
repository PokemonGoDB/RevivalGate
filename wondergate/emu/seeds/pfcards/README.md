Seed for the `pfcards` replay (Pocket Fighter). No other players: `server.env` pins the server's date to
Monday 2026-11-30 (`PF_DATE`, a test hook of the Python server), so the digital card of the day is the
first one and the save's card set (SRAM word `0x0F19`) ends as `01 00` on any day the replay runs.
