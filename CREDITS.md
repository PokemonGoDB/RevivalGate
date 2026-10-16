# Credits

RevivalGate builds on other people's work. This is what I used, and from whom:

- **trap15's [wonderfence](https://bitbucket.org/trap15/wonderfence)** (MIT, 2014). My adapter follows its handling of the WonderGate protocol, and ships its license notice.
- **Yuvi's [WonderGateway](https://github.com/Yuvi-App/WonderGateway)** (Keitai Archive). Three things:
  1. **Its capture of a real adapter** (`Hardware-Captures/N253i-Pocketfighet.txt`), for three replies:
     - `55 55 55 55 55`, the adapter's answer when the console wakes it. I first used it as the power-on reply; testing against the games' own code later showed it answers the console's `00` wake-up burst, so that's where my adapter sends it.
     - `0F 00 01 FF`, the power-off reply, used as is.
     - `0B 02` for a busy line, which showed that a nonzero `0B` means the line is down. My hang-up reply is built on that.
  2. **Its per-game testing**, from the notes in its code:
     - socket numbers start at 0 (trap15's wonderfence used 0x30);
     - Buffers Evolution expects the phone status to read "ok" before power-on;
     - Rainbow Islands fails on a 1-byte socket-close reply, so mine is 2 bytes (`00 01`);
     - Raku Jongg needs a 4-byte hang-up reply, so mine is `0B 01 00 00 00`.
  3. **Its list of which games work**, which my notes show as a "Keitai Archive" status column next to the game list.

  WonderGateway has no license, so none of its code is used here, only the facts above. I also read its Mednafen patch to see how Mednafen talks to an outside adapter; my emulator build doesn't use it.
- **Keitai Archive's [WS-WonderGate-Patches](https://github.com/Keitai-Archive/WS-WonderGate-Patches)**: the hidden button combos that open the WonderGate menu in Buffers Evolution, D's Garage 21: Tane o Maku Tori, SD Gundam Gashapon Senki, Sennou Millennium, and Tare Panda no GunPey; Final Lap 2000's ranking-screen sequence; that Buffers Evolution needs one finished course first; and that Star Hearts declares an 8 KB save but uses 32 KB.
- **[Keitai Wiki](https://keitaiwiki.com/wiki/MobileWonderGate)**: its list of WonderGate games, what each one did online, and the scanned manuals I used for menu paths.
- **kconger's [wonderfence fork](https://github.com/kconger/wonderfence)** and **the [WSdev wiki](https://ws.nesdev.org/wiki/WonderGate)**: the reply that lets the MobileWonderGate browser open pages (its BPL check), and the wiki's protocol notes.

The game servers are my own. I worked out each game's replies from its code and tested them by running the game in an emulator.
