// MobileWonderGate cart mail: account auto-setup (start.mopera.ne.jp), SMTP (25), POP3 (110), and the
// daytime clock (13). A port of mail.py. Mail stays on this server: SMTP delivers only to our accounts
// and nothing is ever sent out. Mail to any other address is dropped, and the sender gets a notice in
// their own mailbox. The cart logs in with USER/PASS (never APOP), so only a salted PBKDF2 hash of each
// password is kept. Accounts and mailboxes are D1 tables (migrations-wondergate/0005, 0007).
import { bytesOf, hex, Inbox, indexOf, jst, latin1, unhex } from './bytes';
import { MAIL_BOUNCE_BODY_TAIL, MAIL_BOUNCE_SUBJECT, MAIL_START_PAGE, MAIL_WELCOME_BODY, MAIL_WELCOME_SUBJECT } from './encoded';
import type { Conn } from './env';
import type { Reply } from './http';
import { quota, writeAllowed } from './limits';

const DOMAIN = 'mopera.ne.jp';
const MAIL_HOST = 'mail.mopera.ne.jp';

interface Message { seq: number; id: string; raw: string }

// Limits on what anyone can store. Cart mail is typed on the console, so real messages are small.
const MAX_MESSAGE = 64 * 1024;
const MAX_BOX = 100;
// mail.py uses 200,000 rounds; Workers' PBKDF2 stops at 100,000. The rounds are stored with each hash.
const PBKDF2_ROUNDS = 100_000;
// Per address: accounts set up and messages sent a day. Addresses are sequential and SMTP has no login,
// so these (and the recipients per message) are what stop one sender filling everyone's mailboxes.
const SETUPS_PER_DAY = 20;
const SENDS_PER_DAY = 50;
const MAX_RCPT = 5;
// Wrong passwords before POP3 hangs up (each check is a PBKDF2 hash).
const MAX_LOGIN_FAILS = 3;

const userOf = (n: number) => `wg${String(n).padStart(5, '0')}`;

/** The account number for a mail user name, if it's one we could have issued. */
function accountOf(user: string): number | null {
  const m = /^wg(\d{5,})$/.exec(user);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return userOf(n) === user ? n : null;
}

async function pbkdf2(password: string, salt: string, rounds: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: rounds }, key, 256);
  return hex(new Uint8Array(bits));
}

/** "pbkdf2_sha256$<rounds>$<salt hex>$<digest hex>", as mail.py's hash_password. */
async function hashPassword(password: string, salt = tokenHex(16), rounds = PBKDF2_ROUNDS): Promise<string> {
  return `pbkdf2_sha256$${rounds}$${salt}$${await pbkdf2(password, salt, rounds)}`;
}

/** Check a POP3 login. A row from before hashing holds the plain password: it's hashed now. */
async function checkLogin(conn: Conn, user: string | null, given: string): Promise<boolean> {
  const n = user === null ? null : accountOf(user);
  if (n === null) return false;
  const db = conn.env.WG_DB;
  const row = await db.prepare('SELECT hash FROM mail_accounts WHERE n = ?').bind(n).first<{ hash: string }>();
  if (!row) return false;
  const parts = row.hash.split('$');
  if (parts[0] !== 'pbkdf2_sha256' || parts.length !== 4) {
    if (!timingSafeEqual(row.hash, given)) return false;
    await db.prepare('UPDATE mail_accounts SET hash = ? WHERE n = ?').bind(await hashPassword(given), n).run();
    return true;
  }
  return timingSafeEqual(row.hash, await hashPassword(given, parts[2], Number.parseInt(parts[1], 10)));
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y);
}

const tokenHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** RFC 2822 date in Japan time, as email.utils.formatdate(localtime=True) gives on a JST host. */
function mailDate(): string {
  const t = jst();
  return `${DAYS[t.weekday]}, ${t.d} ${MONTHS[t.month - 1]} ${t.Y} ${t.H}:${t.M}:${t.S} +0900`;
}

// ---------- HTTP: auto-setup ----------

/** start.mopera.ne.jp: GET / is the sign-up page; its form POSTs to /setup, whose reply is the autoconf. */
export async function start(conn: Conn, path: string): Promise<Reply> {
  if (path === '/setup') return autoconf(conn);
  return { status: 200, type: 'text/html', body: bytesOf(MAIL_START_PAGE), note: 'mail: start page' };
}

/** A mail from postmaster to one of our accounts (subject base64 and body already ISO-2022-JP). */
function notice(db: D1Database, n: number, subject: string, body: string): D1PreparedStatement[] {
  const user = userOf(n);
  const raw =
    `From: WonderGate <postmaster@${DOMAIN}>\r\nTo: ${user}@${DOMAIN}\r\nDate: ${mailDate()}\r\n` +
    `Subject: =?ISO-2022-JP?B?${subject}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=ISO-2022-JP\r\n\r\n${body}\r\n`;
  return deliver(db, n, raw);
}

/** Add a message to a mailbox, keeping the newest MAX_BOX. */
function deliver(db: D1Database, n: number, raw: string): D1PreparedStatement[] {
  return [
    db.prepare('INSERT INTO mail_messages (account, id, raw) VALUES (?, ?, ?)').bind(n, tokenHex(6), raw),
    db.prepare('DELETE FROM mail_messages WHERE account = ? AND seq NOT IN (SELECT seq FROM mail_messages WHERE account = ? ORDER BY seq DESC LIMIT ?)').bind(n, n, MAX_BOX)
  ];
}

/** The account number of an address, if it's one of our accounts. */
async function localAccount(db: D1Database, address: string): Promise<number | null> {
  const at = address.indexOf('@');
  const user = at >= 0 ? address.slice(0, at) : address;
  const dom = at >= 0 ? address.slice(at + 1) : '';
  const n = dom.toLowerCase() === DOMAIN ? accountOf(user) : null;
  return n !== null && (await db.prepare('SELECT 1 FROM mail_accounts WHERE n = ?').bind(n).first()) !== null ? n : null;
}

async function autoconf(conn: Conn): Promise<Reply> {
  // Each setup costs a PBKDF2 hash and three writes, and a cart runs it once.
  if (!(await writeAllowed(conn)) || !(await quota(conn, 'mail setup', SETUPS_PER_DAY))) {
    return { status: 500, type: 'text/plain', body: 'error\r\n', note: 'mail autoconf: refused (limit)' };
  }
  const password = tokenHex(4);
  const t = jst();
  const db = conn.env.WG_DB;
  const row = await db.prepare('INSERT INTO mail_accounts (hash, created) VALUES (?, ?) RETURNING n')
    .bind(await hashPassword(password), `${t.Y}-${t.m}-${t.d} ${t.H}:${t.M}:${t.S}`)
    .first<{ n: number }>();
  const user = userOf(row!.n);
  await db.batch(notice(db, row!.n, MAIL_WELCOME_SUBJECT, MAIL_WELCOME_BODY));
  const lines = [
    'DIALUPNUMBERPDC:##', `PPPUSERNAME:${user}`, `PPPPASSWORD:${password}`, `MAILADDRESS:${user}@${DOMAIN}`,
    `POP3SERVERNAME:${MAIL_HOST}`, `SMTPSERVERNAME:${MAIL_HOST}`, `MAILUSERNAME:${user}`, `MAILPASSWORD:${password}`
  ];
  // The cart compares "CONTENT-TYPE: APPLICATION/X-MOPERA-AUTOCONF" exactly and treats the reply as
  // complete once it ends in four LFs.
  return {
    status: 200, type: null, body: lines.join('\n') + '\n\n\n\n', note: `mail autoconf: new account ${user}`,
    headers: { 'CONTENT-TYPE': 'APPLICATION/X-MOPERA-AUTOCONF' }, lf: true
  };
}

// ---------- line-based sessions ----------

// asyncio's default readline limit: mail.py drops the connection on a longer line.
const MAX_LINE = 65536;
const LF = new Uint8Array([10]);

/** Reads lines (up to and including "\n") as they arrive; one command at a time. */
abstract class LineSession {
  private buf = new Inbox();
  /** How far the buffer has been searched for a line end. */
  private scanned = 0;
  protected done = false;

  constructor(protected conn: Conn, private sendBytes: (b: Uint8Array) => void, private closeConn: () => void) {}

  protected say(line: string) {
    if (!this.done) this.sendBytes(bytesOf(line + '\r\n'));
  }

  protected finish() {
    if (this.done) return;
    this.done = true;
    this.closeConn();
  }

  abstract start(): Promise<void>;
  /** Handle one line (raw, with its line ending). */
  protected abstract line(raw: string): Promise<void>;

  async feed(data: Uint8Array) {
    if (this.done) return;
    this.buf.push(data);
    let nl: number;
    while (!this.done && (nl = indexOf(this.buf.view(), LF, this.scanned)) >= 0) {
      const raw = latin1(this.buf.take(nl + 1));
      this.scanned = 0;
      try {
        await this.line(raw);
      } catch {
        // Malformed command: the Python server drops the connection (IndexError/ValueError)
        this.finish();
      }
    }
    this.scanned = this.buf.length;
    if (this.scanned > MAX_LINE) this.finish();
  }

  async eof() {
    this.finish();
  }
}

/** SMTP on port 25 (the cart's MAILER). */
export class SmtpSession extends LineSession {
  private rcpt: string[] = [];
  private sender = '';
  private data: string[] | null = null;
  private size = 0;

  async start() {
    this.say(`220 ${MAIL_HOST} ESMTP`);
  }

  protected async line(raw: string) {
    if (this.data) {
      if (raw === '.\r\n' || raw === '.\n') return this.deliver();
      this.size += raw.length;
      if (this.size <= MAX_MESSAGE) this.data.push(raw.startsWith('..') ? raw.slice(1) : raw);
      return;
    }
    const line = raw.replace(/[\r\n]+$/, '');
    if (!line) return this.finish();
    const cmd = line.slice(0, 4).toUpperCase();
    const arg = () => {
      const i = line.indexOf(':');
      if (i < 0) throw new Error('no argument');
      return line.slice(i + 1).replace(/^[ <>]+|[ <>]+$/g, '');
    };
    if (cmd === 'HELO' || cmd === 'EHLO') this.say(`250 ${MAIL_HOST}`);
    else if (cmd === 'MAIL') {
      const from = arg();
      // It's copied into every message (Return-Path); RFC 5321 allows 256 characters.
      if (from.length > 256) return this.say('501 5.1.7 Bad sender address');
      this.sender = from;
      this.rcpt = [];
      this.say('250 OK');
    } else if (cmd === 'RCPT') {
      const to = arg();
      // RFC 5321 4.5.3.1.10: the client sends the rest in another message.
      if (this.rcpt.length >= MAX_RCPT) return this.say('452 4.5.3 Too many recipients');
      this.rcpt.push(to);
      this.say('250 OK');
    } else if (cmd === 'DATA') {
      this.say('354 End data with <CR><LF>.<CR><LF>');
      this.data = [];
      this.size = 0;
    } else if (cmd === 'RSET') {
      this.rcpt = [];
      this.sender = '';
      this.say('250 OK');
    } else if (cmd === 'NOOP') this.say('250 OK');
    else if (cmd === 'QUIT') {
      this.say('221 Bye');
      this.finish();
    } else this.say('502 Command not implemented');
  }

  private async deliver() {
    const raw = this.data!.join('');
    this.data = null;
    if (this.size > MAX_MESSAGE) {
      this.conn.log(`smtp: refused a ${this.size}-byte message`);
      return this.say('552 Message too large');
    }
    const sender = this.sender;
    const db = this.conn.env.WG_DB;
    const writes: D1PreparedStatement[] = [];
    for (const r of this.rcpt) {
      const n = await localAccount(db, r);
      if (n !== null) {
        writes.push(...deliver(db, n, `Return-Path: <${sender}>\r\n` + raw));
        continue;
      }
      // Never sent out, never kept. The cart still gets 250 (how it handles an SMTP error is unknown),
      // and the sender, if it's one of ours, finds a notice in its mailbox.
      this.conn.log(`smtp: ${r} is not one of our accounts, dropped`);
      const back = await localAccount(db, sender);
      if (back !== null) {
        // ISO-2022-JP starts in ASCII, so the address goes in as it is (mail.py fails on anything else)
        if (!/^[\x00-\x7f]*$/.test(r)) throw new Error('recipient not ASCII');
        writes.push(...notice(db, back, MAIL_BOUNCE_SUBJECT, r + MAIL_BOUNCE_BODY_TAIL));
      }
    }
    if (writes.length) {
      if (!(await writeAllowed(this.conn))) return this.say('451 4.7.1 Too many messages, try again later');
      if (!(await quota(this.conn, 'mail send', SENDS_PER_DAY))) return this.say('550 5.4.5 Daily sending limit reached');
      await db.batch(writes);
    }
    this.say('250 OK queued');
  }
}

/** Python list indexing: negative counts from the end; out of range is an error. */
function at<T>(list: T[], i: number): T {
  const k = i < 0 ? i + list.length : i;
  if (k < 0 || k >= list.length) throw new Error('index');
  return list[k];
}
const pyInt = (s: string | undefined) => {
  if (s === undefined || !/^\s*[+-]?\d+\s*$/.test(s)) throw new Error('int');
  return Number.parseInt(s, 10);
};

/** POP3 on port 110. */
export class Pop3Session extends LineSession {
  private user: string | null = null;
  private box: Message[] | null = null;
  private deleted = new Set<number>();
  private fails = 0;

  async start() {
    this.say(`+OK ${MAIL_HOST} POP3 ready`);
  }

  protected async line(raw: string) {
    const line = raw.replace(/[\r\n]+$/, '');
    if (!line) return this.finish();
    const parts = line.split(/\s+/).filter(Boolean);
    if (!parts.length) throw new Error('empty');
    const cmd = parts[0].toUpperCase();
    const args = parts.slice(1);
    if (cmd === 'USER') {
      this.user = args.length ? args[0] : null;
      this.say('+OK');
    } else if (cmd === 'PASS') {
      if (!(await checkLogin(this.conn, this.user, args.length ? args[0] : ''))) {
        this.say('-ERR authentication failed');
        if (++this.fails >= MAX_LOGIN_FAILS) {
          this.conn.log(`pop3: ${this.fails} failed logins, closed`);
          this.finish();
        }
        return;
      }
      const { results } = await this.conn.env.WG_DB.prepare('SELECT seq, id, raw FROM mail_messages WHERE account = ? ORDER BY seq')
        .bind(accountOf(this.user!))
        .all<Message>();
      this.box = results;
      this.say(`+OK ${this.box.length} messages`);
    } else if (this.box === null && cmd !== 'QUIT') {
      this.say('-ERR not logged in');
    } else if (cmd === 'STAT') {
      const live = this.box!.filter((_, i) => !this.deleted.has(i));
      this.say(`+OK ${live.length} ${live.reduce((n, m) => n + m.raw.length, 0)}`);
    } else if (cmd === 'LIST' || cmd === 'UIDL') {
      const key = (m: Message) => (cmd === 'LIST' ? String(m.raw.length) : m.id);
      if (args.length) {
        const i = pyInt(args[0]) - 1;
        this.say(`+OK ${i + 1} ${key(at(this.box!, i))}`);
      } else {
        this.say('+OK');
        this.box!.forEach((m, i) => {
          if (!this.deleted.has(i)) this.say(`${i + 1} ${key(m)}`);
        });
        this.say('.');
      }
    } else if (cmd === 'RETR' || cmd === 'TOP') {
      const i = pyInt(args[0]) - 1;
      let raw = at(this.box!, i).raw;
      if (cmd === 'TOP') {
        const split = raw.indexOf('\r\n\r\n');
        const head = split >= 0 ? raw.slice(0, split) : raw;
        const body = split >= 0 ? raw.slice(split + 4) : '';
        const n = args.length > 1 ? pyInt(args[1]) : 0;
        raw = head + '\r\n\r\n' + body.split('\r\n').slice(0, n).join('\r\n');
      }
      this.say(`+OK ${raw.length} octets`);
      for (const l of raw.split('\r\n')) this.say(l.startsWith('.') ? '.' + l : l);
      this.say('.');
    } else if (cmd === 'DELE') {
      this.deleted.add(pyInt(args[0]) - 1);
      this.say('+OK deleted');
    } else if (cmd === 'RSET') {
      this.deleted.clear();
      this.say('+OK');
    } else if (cmd === 'NOOP') {
      this.say('+OK');
    } else if (cmd === 'QUIT') {
      if (this.box !== null && this.deleted.size) {
        const seqs = [...this.deleted].filter((i) => i >= 0 && i < this.box!.length).map((i) => this.box![i].seq);
        const db = this.conn.env.WG_DB;
        if (seqs.length) await db.batch(seqs.map((seq) => db.prepare('DELETE FROM mail_messages WHERE seq = ?').bind(seq)));
      }
      this.say('+OK bye');
      this.finish();
    } else {
      this.say('-ERR unknown command');
    }
  }
}

/** Daytime on port 13 (ns1/ns2.channel.or.jp): the MAILER asks for the time before sending. */
export class DaytimeSession {
  constructor(private send: (b: Uint8Array) => void, private close: () => void) {}
  async start() {
    const t = jst();
    this.send(bytesOf(`${DAYS[t.weekday]} ${MONTHS[t.month - 1]} ${t.d} ${t.H}:${t.M}:${t.S} ${t.Y}\r\n`));
    this.close();
  }
  async feed() {}
  async eof() {
    this.close();
  }
}

