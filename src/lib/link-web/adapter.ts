// The WonderGate adapter for the browser Link: wgcore (link-web/, built to public/link/wgcore.wasm) fed the
// console's serial bytes, with each socket it opens carried to the RevivalGate server over a WebSocket, the
// same tunnel protocol as Swan Revival Link (link/lib.mjs). Runs in the browser and, for tests, in Node 22.
//
// wgcore expects a receive to wait up to ~2 s for the server's reply (Wonder Classic and the mail cart fail
// without it). The wasm is built with Binaryen's asyncify, so js_sock_recv returns a Promise and the call
// into wgcore pauses and resumes around it.

export const DEFAULT_SERVER = 'wss://wg.swanrevival.com/tunnel';
const RECV_NODATA = -2;

export type AdapterEvent =
  | { type: 'log'; line: string }
  | { type: 'connect'; port: number }
  | { type: 'ready'; port: number; handle: string | null }
  | { type: 'unreachable'; port: number }
  | { type: 'close'; port: number };

export interface AdapterOptions {
  wasm: BufferSource | WebAssembly.Module;
  /** Bytes to the console. */
  tx: (bytes: Uint8Array) => void;
  server?: string;
  /** A device token (account link); scores post under the account's name. */
  token?: string | null;
  onEvent?: (e: AdapterEvent) => void;
  /** How long a receive waits for the server before answering "nothing yet" (wgcore's platforms use 2 s). */
  recvWaitMs?: number;
  /** Line silence after which a half-received frame is dropped. */
  frameGapMs?: number;
}

export interface Adapter {
  /** Bytes from the console, in order. */
  feed(bytes: Uint8Array): void;
  /** The console went away (cable unplugged, power off): close sockets, adapter back to off. */
  reset(): Promise<void>;
  /** Resolves when every byte fed so far has been handled. */
  idle(): Promise<void>;
  close(): void;
}

interface Sock {
  port: number;
  ws: WebSocket | null;
  open: boolean;
  closed: boolean;
  pending: Array<Uint8Array | string>;
  data: Uint8Array[];
  wake: (() => void) | null;
}

type Exports = {
  memory: WebAssembly.Memory;
  lw_init(): number;
  lw_rx(b: number): void;
  lw_rx_reset(): void;
  lw_reset(): void;
  lw_mid_frame(): number;
  asyncify_start_unwind(p: number): void;
  asyncify_stop_unwind(): void;
  asyncify_start_rewind(p: number): void;
  asyncify_stop_rewind(): void;
  asyncify_get_state(): number;
};
const UNWINDING = 1;
const REWINDING = 2;

export async function createAdapter(opts: AdapterOptions): Promise<Adapter> {
  const server = opts.server ?? DEFAULT_SERVER;
  const recvWaitMs = opts.recvWaitMs ?? 2000;
  const frameGapMs = opts.frameGapMs ?? 500;
  const emit = (e: AdapterEvent) => opts.onEvent?.(e);

  let ex!: Exports;
  let asyncData = 0;
  let pendingResult: Promise<number> | null = null;
  let resumeValue = 0;
  const socks = new Map<number, Sock>();
  let nextHandle = 1;

  const mem = () => new Uint8Array(ex.memory.buffer);
  const cstr = (p: number) => {
    const m = mem();
    let end = p;
    while (m[end]) end++;
    return new TextDecoder().decode(m.subarray(p, end));
  };

  function deliver(s: Sock, chunk: Uint8Array) {
    s.data.push(chunk);
    s.wake?.();
  }

  function finish(s: Sock) {
    s.closed = true;
    s.wake?.();
  }

  function openTunnel(s: Sock) {
    let ws: WebSocket;
    try {
      ws = new WebSocket(server);
    } catch {
      emit({ type: 'unreachable', port: s.port });
      finish(s);
      return;
    }
    ws.binaryType = 'arraybuffer';
    s.ws = ws;
    ws.addEventListener('open', () => {
      s.open = true;
      ws.send(JSON.stringify({ v: 1, port: s.port, ...(opts.token ? { token: opts.token } : {}) }));
      for (const m of s.pending.splice(0)) ws.send(m);
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.ready) emit({ type: 'ready', port: s.port, handle: msg.handle ?? null });
        } catch {}
        return;
      }
      deliver(s, new Uint8Array(ev.data as ArrayBuffer));
    });
    ws.addEventListener('close', () => {
      finish(s);
      emit({ type: 'close', port: s.port });
    });
    ws.addEventListener('error', () => {
      if (!s.open) emit({ type: 'unreachable', port: s.port });
    });
  }

  function send(s: Sock, m: Uint8Array | string) {
    if (s.open && s.ws) s.ws.send(m);
    else if (!s.closed) s.pending.push(m);
  }

  // Copy what's buffered into wgcore's memory; returns the count.
  function take(s: Sock, buf: number, len: number): number {
    let n = 0;
    const m = mem();
    while (n < len && s.data.length) {
      const c = s.data[0];
      const k = Math.min(c.length, len - n);
      m.set(c.subarray(0, k), buf + n);
      n += k;
      if (k === c.length) s.data.shift();
      else s.data[0] = c.subarray(k);
    }
    return n;
  }

  const imports = {
    env: {
      js_tx(buf: number, len: number) {
        opts.tx(mem().slice(buf, buf + len));
      },
      js_resolve(name: number, ip: number) {
        // Redirected names come here as the configured server, 127.0.0.1. Anything else would need a real
        // internet connection from the console, which a browser can't give it.
        const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(cstr(name));
        if (!m) return -1;
        mem().set(m.slice(1, 5).map(Number), ip);
        return 0;
      },
      js_sock_open() {
        const h = nextHandle++;
        socks.set(h, { port: 0, ws: null, open: false, closed: false, pending: [], data: [], wake: null });
        return h;
      },
      js_sock_connect(h: number, _ip: number, port: number) {
        // Every connection goes to our server; the port says which service (as in Swan Revival Link).
        const s = socks.get(h);
        if (!s) return -1;
        s.port = port;
        emit({ type: 'connect', port });
        openTunnel(s);
        return 0;
      },
      js_sock_send(h: number, buf: number, len: number) {
        const s = socks.get(h);
        if (!s || s.closed) return -1;
        send(s, mem().slice(buf, buf + len));
        return len;
      },
      js_sock_recv(h: number, buf: number, len: number): number | Promise<number> {
        const s = socks.get(h);
        if (!s) return 0;
        if (s.data.length) return take(s, buf, len);
        if (s.closed) return 0;
        // Nothing yet: wait for data, the close, or the timeout (then "nothing yet", and the game asks again).
        return new Promise<number>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            s.wake = null;
            resolve(s.data.length ? take(s, buf, len) : s.closed ? 0 : RECV_NODATA);
          };
          const timer = setTimeout(done, recvWaitMs);
          s.wake = done;
        });
      },
      js_sock_shutdown(h: number, how: number) {
        const s = socks.get(h);
        // The console is done sending but may still be waiting for the reply.
        if (s && how !== 0) send(s, JSON.stringify({ eof: true }));
      },
      js_sock_close(h: number) {
        const s = socks.get(h);
        socks.delete(h);
        if (!s) return;
        s.closed = true;
        s.wake?.();
        if (s.ws && (s.ws.readyState === WebSocket.OPEN || s.ws.readyState === WebSocket.CONNECTING)) s.ws.close();
      },
      js_log(line: number) {
        emit({ type: 'log', line: cstr(line) });
      }
    }
  };

  // Asyncify: a Promise from js_sock_recv unwinds wgcore back to us; when it settles, rewind and resume.
  const recvRaw = imports.env.js_sock_recv;
  imports.env.js_sock_recv = (h: number, buf: number, len: number) => {
    if (ex.asyncify_get_state() === REWINDING) {
      ex.asyncify_stop_rewind();
      return resumeValue;
    }
    const r = recvRaw(h, buf, len);
    if (typeof r === 'number') return r;
    pendingResult = r;
    ex.asyncify_start_unwind(asyncData);
    return 0;
  };

  const instance =
    opts.wasm instanceof WebAssembly.Module
      ? await WebAssembly.instantiate(opts.wasm, imports)
      : (await WebAssembly.instantiate(opts.wasm as BufferSource, imports) as unknown as WebAssembly.WebAssemblyInstantiatedSource).instance;
  ex = instance.exports as unknown as Exports;
  asyncData = ex.lw_init();

  async function call(fn: (...a: number[]) => void, ...args: number[]) {
    fn(...args);
    while (ex.asyncify_get_state() === UNWINDING) {
      ex.asyncify_stop_unwind();
      resumeValue = await pendingResult!;
      pendingResult = null;
      ex.asyncify_start_rewind(asyncData);
      fn(...args);
    }
  }

  // One call into wgcore at a time, in arrival order.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => (queue = queue.then(job, job));
  let gapTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  return {
    feed(bytes) {
      if (closed) return;
      for (const b of bytes) enqueue(() => call(ex.lw_rx, b));
      if (gapTimer) clearTimeout(gapTimer);
      gapTimer = setTimeout(() => {
        enqueue(async () => {
          if (ex.lw_mid_frame()) await call(ex.lw_rx_reset);
        });
      }, frameGapMs);
    },
    reset() {
      return enqueue(() => call(ex.lw_reset));
    },
    idle() {
      return queue;
    },
    close() {
      closed = true;
      if (gapTimer) clearTimeout(gapTimer);
      for (const s of socks.values()) s.ws?.close();
      socks.clear();
    }
  };
}
