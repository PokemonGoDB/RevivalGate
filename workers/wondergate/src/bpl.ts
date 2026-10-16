// BPL (port 5555): the MobileWonderGate browser asks whether a URL is allowed.
// 24-byte header, little-endian type at 2 and total size at 4. We echo the request header with
// type 0x0010 (allow, no blocks). A port of wgserver.bpl_conn.
import { concat } from './bytes';
import type { Conn } from './env';

const HEADER = 0x18;

export class BplSession {
  private buf: Uint8Array = new Uint8Array(0);
  private done = false;

  constructor(private conn: Conn, private send: (b: Uint8Array) => void, private close: () => void) {}

  async feed(data: Uint8Array) {
    if (this.done) return;
    this.buf = concat(this.buf, data);
    while (this.buf.length >= HEADER) {
      const total = new DataView(this.buf.buffer, this.buf.byteOffset).getUint32(4, true);
      const need = Math.max(HEADER, total);
      if (this.buf.length < need) return;
      const resp = this.buf.slice(0, HEADER);
      this.buf = this.buf.slice(need);
      const v = new DataView(resp.buffer);
      resp[0] = 0x01;
      resp[1] = HEADER;
      v.setUint16(2, 0x0010, true);
      v.setUint32(4, HEADER, true);
      this.conn.log(`BPL request ${total} bytes -> allow`);
      this.send(resp);
    }
  }

  async eof() {
    if (!this.done) {
      this.done = true;
      this.close();
    }
  }
}
