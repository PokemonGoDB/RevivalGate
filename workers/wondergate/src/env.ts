export interface Env {
  WG_DB: D1Database;
  /** Static downloads (content/), e.g. SD Gundam map packs. */
  CONTENT: Fetcher;
  /** Link-code attempts per address. */
  LINK_LIMITER: RateLimit;
  /** Tunnels opened per address. */
  TUNNEL_LIMITER: RateLimit;
  /** Writes (scores, game state, mail) per address; see limits.ts. */
  WRITE_LIMITER: RateLimit;
}

/** What one tunnel knows about who is playing. */
export interface Conn {
  env: Env;
  /** Account of the relay's device token, or null for an unlinked relay. */
  accountId: string | null;
  /** The player's address (the relay's), as the Python server's per-connection peer: Dark Eyes ties
   * uploads to whoever last sent world info from it. */
  peer: string;
  log: (msg: string) => void;
}
