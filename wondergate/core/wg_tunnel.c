/* wg_tunnel: wgcore sockets over the Bluetooth tunnel. See wg_tunnel.h and
 * docs/wondergate-ble-protocol.md. */
#include "wg_tunnel.h"

#include <ctype.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

/* Socket states. */
enum { S_FREE, S_NEW, S_OPENING, S_OPEN };

/* Socket flags. An id is free again once the console has released it and
 * both sides have sent CLOSE (or the link it lived on is gone). */
enum {
  F_EOF        = 0x01,  /* we sent EOF (console shut down its sending side) */
  F_SENT_CLOSE = 0x02,  /* we sent CLOSE */
  F_GOT_CLOSE  = 0x04,  /* the phone sent CLOSE */
  F_RELEASED   = 0x08,  /* the console closed (deleted) the socket */
  F_RD_SHUT    = 0x10,  /* the console shut down its receiving side */
  F_LOST       = 0x20   /* the link went down under it */
};

/* The synthetic address the configured server resolves to; other names get
 * 10.0.0.(2 + slot). */
static const uint8_t NET[3] = { 10, 0, 0 };
#define SERVER_HOST 1
#define FIRST_NAME  2

static void logf_(wgt *t, const char *fmt, ...)
{
  char line[300];
  va_list ap;

  if (!t->ops->log)
    return;
  va_start(ap, fmt);
  vsnprintf(line, sizeof line, fmt, ap);
  va_end(ap);
  t->ops->log(t->ops->ctx, line);
}

static uint32_t now(wgt *t)
{
  return t->ops->now_ms(t->ops->ctx);
}

/* Milliseconds left before deadline, 0 once it passed (wrap-safe). */
static int left(wgt *t, uint32_t deadline)
{
  int32_t d = (int32_t)(deadline - now(t));

  return d > 0 ? (int)d : 0;
}

/* Largest message this link carries: ATT MTU minus the 3-byte header. */
static size_t max_msg(const wgt *t)
{
  return (size_t)t->mtu - 3;
}

static int send_msg(wgt *t, const uint8_t *m, size_t n)
{
  if (t->link != WGT_LINK_READY)
    return -1;
  return t->ops->send(t->ops->ctx, m, n) < 0 ? -1 : 0;
}

static int send2(wgt *t, uint8_t type, uint8_t id)
{
  uint8_t m[2];

  m[0] = type;
  m[1] = id;
  return send_msg(t, m, 2);
}

static wgt_sock *sock(wgt *t, int h)
{
  if (h < 0 || h >= WGT_SOCKS || t->sock[h].state == S_FREE)
    return NULL;
  return &t->sock[h];
}

/* The connection is over for the console: no more sends, recv drains then
 * answers closed. */
static int ended(const wgt_sock *s)
{
  return (s->flags & (F_SENT_CLOSE | F_GOT_CLOSE | F_LOST)) != 0;
}

static void maybe_free(wgt *t, int id)
{
  wgt_sock *s = &t->sock[id];

  if (!(s->flags & F_RELEASED))
    return;
  if (s->state == S_NEW || (s->flags & F_LOST) ||
      (s->flags & (F_SENT_CLOSE | F_GOT_CLOSE)) == (F_SENT_CLOSE | F_GOT_CLOSE)) {
    s->state = S_FREE;
    logf_(t, "# tunnel: socket %d free", id);
  }
}

/* Tell the phone the console took `taken` more bytes, so it may send more.
 * Batched: when half the window is waiting, or the buffer ran dry (the
 * console wants more and the phone may be holding some). */
static void maybe_ack(wgt *t, int id, int force)
{
  wgt_sock *s = &t->sock[id];
  uint8_t m[4];

  if (!s->taken || ended(s))
    return;
  if (!force && s->taken < WGT_WINDOW / 2 && s->len)
    return;
  m[0] = WGT_ACK;
  m[1] = (uint8_t)id;
  m[2] = (uint8_t)(s->taken >> 8);
  m[3] = (uint8_t)s->taken;
  if (send_msg(t, m, 4) == 0)
    s->taken = 0;
}

static int ieq(const char *a, const char *b)
{
  while (*a && *b && tolower((unsigned char)*a) == tolower((unsigned char)*b))
    a++, b++;
  return *a == '\0' && *b == '\0';
}

/* ---- wgcore ops ---- */

static void t_tx(void *ctx, const uint8_t *buf, size_t len)
{
  wgt *t = ctx;

  t->wg.tx(t->wg.ctx, buf, len);
}

static void t_log(void *ctx, const char *line)
{
  wgt *t = ctx;

  if (t->wg.log)
    t->wg.log(t->wg.ctx, line);
}

static int t_resolve(void *ctx, const char *name, uint8_t ip[4])
{
  wgt *t = ctx;
  int i;

  memcpy(ip, NET, 3);
  /* Redirected names arrive as the configured server: the phone's server
   * picks the service by port, so OPEN carries no host for them. */
  if (ieq(name, t->cfg->server)) {
    ip[3] = SERVER_HOST;
    return 0;
  }
  for (i = 0; i < WGT_NAMES; i++)
    if (t->names[i][0] && ieq(name, t->names[i]))
      break;
  if (i == WGT_NAMES) {
    i = t->next_name;
    t->next_name = (t->next_name + 1) % WGT_NAMES;
    /* Too long for OPEN: keep the slot, connect without a host. */
    if (strlen(name) > WGT_HOST_LEN)
      t->names[i][0] = '\0';
    else
      strcpy(t->names[i], name);
  }
  ip[3] = (uint8_t)(FIRST_NAME + i);
  return 0;
}

/* The name a synthetic address stands for; "" for the server and for
 * addresses we never handed out (the MobileWonderGate cart caches DNS). */
static const char *host_of(const wgt *t, const uint8_t ip[4])
{
  int i = (int)ip[3] - FIRST_NAME;

  if (memcmp(ip, NET, 3) || i < 0 || i >= WGT_NAMES)
    return "";
  return t->names[i];
}

static int t_sock_open(void *ctx)
{
  wgt *t = ctx;
  uint32_t deadline = now(t) + 1000;
  int i;

  for (;;) {
    int waiting = 0;
    for (i = 0; i < WGT_SOCKS; i++) {
      wgt_sock *s = &t->sock[i];
      if (s->state == S_FREE) {
        memset(s, 0, offsetof(wgt_sock, buf));
        s->state = S_NEW;
        return i;
      }
      if ((s->flags & F_RELEASED) && !(s->flags & F_GOT_CLOSE))
        waiting = 1;
    }
    /* Every id is in use; some only until the phone's CLOSE crosses ours. */
    if (!waiting || t->link != WGT_LINK_READY || !left(t, deadline))
      break;
    t->ops->pump(t->ops->ctx, left(t, deadline));
  }
  logf_(t, "# tunnel: no free socket");
  return -1;
}

static int t_sock_connect(void *ctx, int h, const uint8_t ip[4], uint16_t port)
{
  wgt *t = ctx;
  wgt_sock *s = sock(t, h);
  uint8_t m[4 + WGT_HOST_LEN];
  const char *host;
  size_t hl;
  uint32_t deadline;

  if (!s || s->state != S_NEW)
    return -1;
  wgt_poll(t);
  if (t->link != WGT_LINK_READY) {
    logf_(t, "# tunnel: connect %d: no phone", h);
    return -1;
  }
  if ((t->status & (WGT_ST_INTERNET | WGT_ST_SERVER)) != (WGT_ST_INTERNET | WGT_ST_SERVER)) {
    logf_(t, "# tunnel: connect %d: phone reports no %s", h,
          t->status & WGT_ST_INTERNET ? "server" : "internet");
    return -1;
  }
  host = host_of(t, ip);
  hl = strlen(host);
  if (4 + hl > max_msg(t)) {
    /* A whole name or none: a cut one could reach the wrong host. */
    logf_(t, "# tunnel: host '%s' doesn't fit MTU %u, sent without it", host, t->mtu);
    hl = 0;
  }
  m[0] = WGT_OPEN;
  m[1] = (uint8_t)h;
  m[2] = (uint8_t)(port >> 8);
  m[3] = (uint8_t)port;
  memcpy(m + 4, host, hl);
  if (send_msg(t, m, 4 + hl) != 0)
    return -1;
  s->state = S_OPENING;
  s->port = port;
  logf_(t, "# tunnel: OPEN %d port %u host '%.*s'", h, port, (int)hl, host);

  deadline = now(t) + t->connect_ms;
  while (s->state == S_OPENING && !(s->flags & (F_GOT_CLOSE | F_LOST)) && left(t, deadline))
    t->ops->pump(t->ops->ctx, left(t, deadline));

  if (s->state == S_OPEN) {
    logf_(t, "# tunnel: %d opened", h);
    return 0;
  }
  if (s->flags & F_LOST) {
    logf_(t, "# tunnel: connect %d: link lost", h);
    return -1;
  }
  if (s->flags & F_GOT_CLOSE)
    logf_(t, "# tunnel: connect %d refused (reason %u)", h, s->reason);
  else
    logf_(t, "# tunnel: connect %d: no answer in %u ms, giving up", h, (unsigned)t->connect_ms);
  /* We give up on the id now; it is free once the console deletes the
   * socket and the phone's CLOSE has crossed ours. */
  if (send2(t, WGT_CLOSE, (uint8_t)h) == 0)
    s->flags |= F_SENT_CLOSE;
  else
    s->flags |= F_LOST;
  return -1;
}

static int t_sock_send(void *ctx, int h, const uint8_t *buf, size_t len)
{
  wgt *t = ctx;
  wgt_sock *s = sock(t, h);
  uint8_t m[WGT_MAX_MSG];
  size_t room, done = 0;

  if (!s || s->state != S_OPEN)
    return -1;
  wgt_poll(t);
  if (s->flags & (F_SENT_CLOSE | F_LOST | F_EOF))
    return -1;
  /* The server already closed: like TCP, the send "works" and the console
   * learns of the close when it reads. */
  if (s->flags & F_GOT_CLOSE)
    return (int)len;
  room = max_msg(t) - 2;
  m[0] = WGT_DATA;
  m[1] = (uint8_t)h;
  while (done < len) {
    size_t n = len - done < room ? len - done : room;
    memcpy(m + 2, buf + done, n);
    if (send_msg(t, m, 2 + n) != 0)
      return -1;
    done += n;
  }
  return (int)len;
}

static int t_sock_recv(void *ctx, int h, uint8_t *buf, size_t len)
{
  wgt *t = ctx;
  wgt_sock *s = sock(t, h);
  uint32_t deadline;
  size_t n, i;

  if (!s || s->state != S_OPEN)
    return -1;
  wgt_poll(t);
  deadline = now(t) + t->recv_ms;
  while (!s->len && !ended(s) && !(s->flags & F_RD_SHUT) && left(t, deadline))
    t->ops->pump(t->ops->ctx, left(t, deadline));

  /* Hand the game what a TCP socket would: a reply crosses the link as
   * several messages (18 bytes each at the smallest MTU), and Dark Eyes reads
   * its reply in one receive. Keep gathering while more is still arriving. */
  if (s->len && s->len < len) {
    uint32_t gap = now(t) + WGT_GATHER_MS;
    while (s->len < len && !ended(s) && !(s->flags & F_RD_SHUT) && left(t, gap)) {
      uint16_t had = s->len;
      t->ops->pump(t->ops->ctx, left(t, gap));
      if (s->len != had)
        gap = now(t) + WGT_GATHER_MS;
    }
  }

  if (s->flags & F_RD_SHUT)
    return 0;
  if (!s->len)
    return ended(s) ? 0 : WG_RECV_NODATA;
  n = len < s->len ? len : s->len;
  for (i = 0; i < n; i++)
    buf[i] = s->buf[(s->head + i) % WGT_WINDOW];
  s->head = (uint16_t)((s->head + n) % WGT_WINDOW);
  s->len = (uint16_t)(s->len - n);
  s->taken = (uint16_t)(s->taken + n);
  maybe_ack(t, h, 0);
  return (int)n;
}

static void t_sock_shutdown(void *ctx, int h, int how)
{
  wgt *t = ctx;
  wgt_sock *s = sock(t, h);

  if (!s || s->state != S_OPEN)
    return;
  if (how != 0 && !(s->flags & F_EOF) && !ended(s)) {
    if (send2(t, WGT_EOF, (uint8_t)h) == 0)
      logf_(t, "# tunnel: EOF %d", h);
    s->flags |= F_EOF;
  }
  if (how != 1) {
    /* Reads now answer closed, like a BSD socket; what's buffered is
     * dropped and acknowledged so the phone isn't left holding it. */
    s->flags |= F_RD_SHUT;
    s->taken = (uint16_t)(s->taken + s->len);
    s->len = 0;
    maybe_ack(t, h, 1);
  }
}

static void t_sock_close(void *ctx, int h)
{
  wgt *t = ctx;
  wgt_sock *s = sock(t, h);

  if (!s)
    return;
  s->flags |= F_RELEASED;
  s->len = 0;
  if (s->state != S_NEW && !(s->flags & (F_SENT_CLOSE | F_LOST))) {
    if (send2(t, WGT_CLOSE, (uint8_t)h) == 0)
      s->flags |= F_SENT_CLOSE;
    else
      s->flags |= F_LOST;
    logf_(t, "# tunnel: CLOSE %d%s", h, s->flags & F_GOT_CLOSE ? "" : " (waiting for the phone's)");
  }
  maybe_free(t, h);
}

/* ---- setup ---- */

void wgt_init(wgt *t, const wgt_ops *ops, wg_config *cfg)
{
  memset(t, 0, sizeof *t);
  t->ops = ops;
  t->cfg = cfg;
  t->link = WGT_LINK_DOWN;
  t->status = -1;
  t->mtu = WGT_MIN_MTU;
  t->adapter = -1;
  t->adapter_now = WG_STAT_OFF;
  t->connect_ms = WGT_CONNECT_MS;
  t->recv_ms = WGT_RECV_MS;
  if (cfg->n_portmap) {
    logf_(t, "# tunnel: ignoring %d portmap lines (ports go through as dialled)", cfg->n_portmap);
    cfg->n_portmap = 0;
  }
}

void wgt_wg_ops(wgt *t, wg_ops *ops)
{
  t->wg = *ops;
  ops->ctx = t;
  ops->tx = t_tx;
  ops->resolve = t_resolve;
  ops->sock_open = t_sock_open;
  ops->sock_connect = t_sock_connect;
  ops->sock_send = t_sock_send;
  ops->sock_recv = t_sock_recv;
  ops->sock_shutdown = t_sock_shutdown;
  ops->sock_close = t_sock_close;
  ops->log = t_log;
}

/* ---- link and messages ---- */

void wgt_link_up(wgt *t, uint16_t mtu)
{
  if (mtu < WGT_MIN_MTU)
    mtu = WGT_MIN_MTU;
  if (mtu > WGT_MAX_MTU)
    mtu = WGT_MAX_MTU;
  t->mtu = mtu;
  if (t->link == WGT_LINK_DOWN) {
    t->link = WGT_LINK_UP;
    logf_(t, "# tunnel: phone connected (MTU %u), waiting for STATUS", mtu);
  }
}

void wgt_link_down(wgt *t)
{
  int i, n = 0;

  if (t->link == WGT_LINK_DOWN)
    return;
  t->link = WGT_LINK_DOWN;
  t->adapter = -1;
  for (i = 0; i < WGT_SOCKS; i++) {
    wgt_sock *s = &t->sock[i];
    if (s->state == S_FREE || s->state == S_NEW)
      continue;
    n++;
    /* A dropped call: the console sees its sockets closed. */
    s->flags |= F_LOST;
    s->len = 0;
    s->taken = 0;
    maybe_free(t, i);
  }
  logf_(t, "# tunnel: phone link down, %d socket%s dropped", n, n == 1 ? "" : "s");
}

static void got_status(wgt *t, uint8_t flags)
{
  int first = t->link == WGT_LINK_UP;

  if (first || flags != t->status)
    logf_(t, "# tunnel: STATUS internet %s, server %s, account %s", flags & WGT_ST_INTERNET ? "yes" : "no",
          flags & WGT_ST_SERVER ? "yes" : "no", flags & WGT_ST_LINKED ? "linked" : "not linked");
  t->status = flags;
  if (first) {
    t->link = WGT_LINK_READY;
    wgt_adapter_state(t, (uint8_t)t->adapter_now);
  }
}

static void got_data(wgt *t, int id, const uint8_t *p, size_t n)
{
  wgt_sock *s = &t->sock[id];
  size_t room, i;

  /* Late data for a socket we closed (or never opened) is dropped. */
  if (s->state != S_OPEN && s->state != S_OPENING)
    return;
  if (s->flags & (F_SENT_CLOSE | F_GOT_CLOSE | F_LOST | F_RELEASED))
    return;
  if (s->flags & F_RD_SHUT) {
    s->taken = (uint16_t)(s->taken + n);
    maybe_ack(t, id, 1);
    return;
  }
  room = s->len + s->taken < WGT_WINDOW ? (size_t)(WGT_WINDOW - s->len - s->taken) : 0;
  if (n > room) {
    logf_(t, "# tunnel: %d: phone sent %u bytes past the window, dropped", id, (unsigned)(n - room));
    n = room;
  }
  for (i = 0; i < n; i++)
    s->buf[(s->head + s->len + i) % WGT_WINDOW] = p[i];
  s->len = (uint16_t)(s->len + n);
}

void wgt_deliver(wgt *t, const uint8_t *m, size_t n)
{
  int id = n > 1 ? m[1] : -1;
  wgt_sock *s = id >= 0 && id < WGT_SOCKS ? &t->sock[id] : NULL;

  if (n < 2)
    return;
  switch (m[0]) {
  case WGT_P_STATUS:
    got_status(t, m[1]);
    break;
  case WGT_P_OPENED:
    if (s && s->state == S_OPENING && !ended(s))
      s->state = S_OPEN;
    break;
  case WGT_P_DATA:
    if (s)
      got_data(t, id, m + 2, n - 2);
    break;
  case WGT_P_CLOSE:
    if (!s || s->state == S_FREE || s->state == S_NEW)
      break;
    s->flags |= F_GOT_CLOSE;
    s->reason = n > 2 ? m[2] : 0;
    if (!(s->flags & F_RELEASED))
      logf_(t, "# tunnel: phone closed %d (reason %u)", id, s->reason);
    maybe_free(t, id);
    break;
  default:
    break;                                 /* newer messages: ignored by design */
  }
}

void wgt_poll(wgt *t)
{
  t->ops->pump(t->ops->ctx, 0);
}

void wgt_adapter_state(wgt *t, uint8_t status)
{
  uint8_t m[2];

  t->adapter_now = status;
  if (t->link != WGT_LINK_READY || t->adapter == status)
    return;
  m[0] = WGT_STATE;
  m[1] = status;
  if (send_msg(t, m, 2) == 0)
    t->adapter = status;
}

void wgt_send_log(wgt *t, const char *line)
{
  uint8_t m[WGT_MAX_MSG];
  size_t n = strlen(line), room = max_msg(t) - 1;

  if (t->link != WGT_LINK_READY)
    return;
  if (n > room) {
    n = room;
    while (n && ((uint8_t)line[n] & 0xC0) == 0x80)  /* don't split a UTF-8 character */
      n--;
  }
  m[0] = WGT_LOG;
  memcpy(m + 1, line, n);
  send_msg(t, m, 1 + n);
}

size_t wgt_info(const wgt *t, uint8_t *buf, size_t size, uint16_t mtu)
{
  const char *key[3] = { "fw", "serial", "board" };
  const char *val[3];
  size_t o = 6;
  int i;

  val[0] = t->fw;
  val[1] = t->serial;
  val[2] = t->board;
  if (size < 6)
    return 0;
  buf[0] = WGT_VERSION;
  buf[1] = WGT_SOCKS;
  buf[2] = (uint8_t)(WGT_WINDOW >> 8);
  buf[3] = (uint8_t)WGT_WINDOW;
  buf[4] = (uint8_t)(mtu >> 8);
  buf[5] = (uint8_t)mtu;
  for (i = 0; i < 3; i++) {
    int k;
    if (!val[i] || !val[i][0])
      continue;
    k = snprintf((char *)buf + o, size - o, "%s%s=%s", o > 6 ? "\n" : "", key[i], val[i]);
    if (k < 0 || o + (size_t)k >= size)
      break;
    o += (size_t)k;
  }
  return o;
}

int wgt_phone_state(const wgt *t)
{
  if (t->status < 0)
    return WGT_PHONE_OK;                   /* no phone seen yet since power-on */
  if (t->link != WGT_LINK_READY)
    return WGT_PHONE_NONE;
  if ((t->status & (WGT_ST_INTERNET | WGT_ST_SERVER)) != (WGT_ST_INTERNET | WGT_ST_SERVER))
    return WGT_PHONE_NO_SERVICE;
  return WGT_PHONE_OK;
}
