// The games speak Latin-1/Shift-JIS bytes and expect them echoed exactly, so text is handled as
// "binary strings": one char per byte, code 0–255 (Python's latin-1 decode/encode).

export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

export function bytesOf(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Bytes received and not yet handled. Appending copies only the new chunk (the buffer doubles when
 * full), so a request sent a byte at a time costs linear time, not quadratic. */
export class Inbox {
  private buf = new Uint8Array(1024);
  private start = 0;
  private end = 0;

  get length() {
    return this.end - this.start;
  }

  push(data: Uint8Array) {
    if (this.end + data.length > this.buf.length) {
      const live = this.end - this.start;
      if (live + data.length <= this.buf.length / 2) {
        this.buf.copyWithin(0, this.start, this.end);
      } else {
        const next = new Uint8Array(Math.max(this.buf.length * 2, live + data.length));
        next.set(this.buf.subarray(this.start, this.end));
        this.buf = next;
      }
      this.start = 0;
      this.end = live;
    }
    this.buf.set(data, this.end);
    this.end += data.length;
  }

  /** What's buffered; valid until the next push or take. */
  view(): Uint8Array {
    return this.buf.subarray(this.start, this.end);
  }

  /** Remove and return the first n bytes. */
  take(n: number): Uint8Array {
    const out = this.buf.slice(this.start, this.start + n);
    this.start += Math.min(n, this.length);
    if (this.start === this.end) this.start = this.end = 0;
    return out;
  }
}

export function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Python's str.strip(chars). */
export function strip(s: string, chars: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

/** Enough of Shift-JIS to run a game's name through the name filter: ASCII, half-width kana, and the
 * full-width letters and digits; anything else reads as ・. A zero byte ends the name. */
export function sjisText(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0) break;
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b >= 0xa1 && b <= 0xdf) out += String.fromCharCode(0xff61 + b - 0xa1);
    else if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) {
      const c = (b << 8) | (bytes[++i] ?? 0);
      if (c === 0x8140) out += ' ';
      else if (c >= 0x824f && c <= 0x8258) out += String.fromCharCode(0x30 + c - 0x824f);
      else if (c >= 0x8260 && c <= 0x8279) out += String.fromCharCode(0x41 + c - 0x8260);
      else if (c >= 0x8281 && c <= 0x829a) out += String.fromCharCode(0x61 + c - 0x8281);
      else out += '・';
    } else out += '・';
  }
  return out;
}

export const isDigits = (s: string) => /^[0-9]+$/.test(s);
export const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Japan time, as the original servers kept. */
export function jst(d = new Date()) {
  const t = new Date(d.getTime() + 9 * 3600_000);
  return {
    Y: pad(t.getUTCFullYear(), 4),
    m: pad(t.getUTCMonth() + 1, 2),
    d: pad(t.getUTCDate(), 2),
    H: pad(t.getUTCHours(), 2),
    M: pad(t.getUTCMinutes(), 2),
    S: pad(t.getUTCSeconds(), 2),
    /** Monday = 0, as Python's weekday() */
    weekday: (t.getUTCDay() + 6) % 7,
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    date: t
  };
}

export function randomUrlsafe(nbytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(nbytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Python's urllib.parse.parse_qsl(q, keep_blank_values=True, encoding="latin-1") into a dict (last value wins). */
export function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const decode = (v: string) => v.replace(/\+/g, ' ').replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    out[decode(i >= 0 ? part.slice(0, i) : part)] = decode(i >= 0 ? part.slice(i + 1) : '');
  }
  return out;
}

export function randomInt(lo: number, hi: number): number {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return lo + (n % (hi - lo));
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function unhex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}
