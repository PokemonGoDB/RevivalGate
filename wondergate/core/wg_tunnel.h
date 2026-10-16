/*
 * wg_tunnel: wgcore's sockets carried over the WonderGate Bluetooth tunnel.
 *
 * The module runs wgcore; the phone is a generic relay that opens one
 * WebSocket per console socket. This file is the module's half of the
 * message protocol in docs/wondergate-ble-protocol.md (v1). The phone's half
 * is Swan Revival's src/lib/ble/ (protocol.ts, relay.ts); keep them in step.
 *
 * It plugs in as wgcore's resolve and sock_* ops (wgt_wg_ops). Names resolve
 * to synthetic addresses (10.0.0.N) so a connect can name the host it
 * dialled; the game's port goes through unchanged (no portmap).
 *
 * Portable C99, no allocation, no threads. The platform moves whole messages:
 * it queues outgoing ones (send) and, inside pump, hands each incoming one to
 * wgt_deliver(). Everything runs on one thread: messages from the phone are
 * only processed inside pump (or wherever the platform calls wgt_deliver from
 * that same thread).
 */
#ifndef WG_TUNNEL_H
#define WG_TUNNEL_H

#include <stddef.h>
#include <stdint.h>
#include "wg.h"

#define WGT_VERSION   1

/* Sockets the module opens at once (INFO byte 1) and the per-socket receive
 * buffer, which is also the window the phone may have unacknowledged (INFO). */
#ifndef WGT_SOCKS
#define WGT_SOCKS     8
#endif
#ifndef WGT_WINDOW
#define WGT_WINDOW    1024
#endif

#define WGT_MIN_MTU   23
#define WGT_MAX_MTU   517                  /* BLE's largest ATT MTU */
#define WGT_MAX_MSG   (WGT_MAX_MTU - 3)
#define WGT_HOST_LEN  63
#define WGT_NAMES     16                   /* remembered DNS names */

/* Defaults; the platform may change t->connect_ms / t->recv_ms after init. */
#define WGT_CONNECT_MS 10000
/* As wg_posix: a receive with nothing buffered waits this long, then answers
 * "0 bytes, still open". Game replays rely on it. */
#define WGT_RECV_MS    2000
/* Once bytes are buffered, a receive keeps gathering while more arrive within
 * this gap (a reply crosses the link as several messages). */
#ifndef WGT_GATHER_MS
#define WGT_GATHER_MS  100
#endif

/* Message types. Module -> phone: */
enum {
  WGT_OPEN = 0x01, WGT_DATA = 0x02, WGT_EOF = 0x03, WGT_CLOSE = 0x04,
  WGT_ACK = 0x05, WGT_STATE = 0x06, WGT_LOG = 0x0F,
  /* Phone -> module: */
  WGT_P_OPENED = 0x81, WGT_P_DATA = 0x82, WGT_P_CLOSE = 0x84, WGT_P_STATUS = 0x85
};

/* STATUS flags. */
enum { WGT_ST_INTERNET = 1, WGT_ST_SERVER = 2, WGT_ST_LINKED = 4 };

/* Phone CLOSE reasons. */
enum { WGT_CR_SERVER = 0, WGT_CR_UNREACHABLE = 1, WGT_CR_REFUSED = 2, WGT_CR_PHONE = 3 };

/* What the console's phone-status query (01:00) should report. */
enum { WGT_PHONE_OK = 0, WGT_PHONE_NO_SERVICE = 2, WGT_PHONE_NONE = 3 };

/* Link to the phone. */
enum { WGT_LINK_DOWN = 0, WGT_LINK_UP = 1, WGT_LINK_READY = 2 };

typedef struct wgt_ops {
  void *ctx;
  /* Queue one message for the phone (one TX notification). Only called while
   * the link is ready. 0 = queued; < 0 = the link is gone (the platform also
   * reports that through wgt_link_down). */
  int  (*send)(void *ctx, const uint8_t *msg, size_t len);
  /* Wait up to timeout_ms (0 = don't wait) for the phone; hand each message
   * to wgt_deliver() and link changes to wgt_link_up()/wgt_link_down().
   * May return early once something was delivered. */
  void (*pump)(void *ctx, int timeout_ms);
  /* Milliseconds from any fixed point; wraps. */
  uint32_t (*now_ms)(void *ctx);
  /* One line of log text, no newline. May be NULL. */
  void (*log)(void *ctx, const char *line);
} wgt_ops;

typedef struct wgt_sock {
  uint8_t  state;                          /* WGT_S_* (wg_tunnel.c) */
  uint8_t  flags;                          /* WGT_F_* (wg_tunnel.c) */
  uint8_t  reason;                         /* the phone's CLOSE reason */
  uint16_t port;
  uint16_t head, len;                      /* buffered server bytes in buf */
  uint16_t taken;                          /* read by the console, not yet ACKed */
  uint8_t  buf[WGT_WINDOW];
} wgt_sock;

typedef struct wgt {
  const wgt_ops   *ops;
  const wg_config *cfg;
  wg_ops           wg;                     /* wgcore's own ops (tx, log), wrapped */

  int      link;                           /* WGT_LINK_* */
  int      status;                         /* last STATUS flags; -1 = none since power-on */
  uint16_t mtu;                            /* ATT MTU of the link */
  int      adapter;                        /* adapter status last sent in STATE; -1 = none */
  int      adapter_now;                    /* latest adapter status seen */
  uint32_t connect_ms, recv_ms;

  /* INFO text fields; NULL or "" = left out. */
  const char *fw, *serial, *board;

  char     names[WGT_NAMES][WGT_HOST_LEN + 1]; /* 10.0.0.(2 + i) */
  int      next_name;

  wgt_sock sock[WGT_SOCKS];
} wgt;

/* Set up; link down. Clears cfg's portmap: in tunnel mode ports go through as
 * the game dialled them. */
void wgt_init(wgt *t, const wgt_ops *ops, wg_config *cfg);
/* Turn wgcore ops (tx and log already filled, e.g. by wg_posix_ops) into
 * tunnel ops: resolve and sock_* go to t, tx and log keep working. */
void wgt_wg_ops(wgt *t, wg_ops *ops);

/* Platform -> tunnel, from the tunnel's thread. */
void wgt_link_up(wgt *t, uint16_t mtu);    /* subscribed; ready after the first STATUS */
void wgt_link_down(wgt *t);                /* every socket is gone */
void wgt_deliver(wgt *t, const uint8_t *msg, size_t len);

/* Process whatever the phone sent, without waiting (call from idle loops). */
void wgt_poll(wgt *t);
/* Report the adapter's status (wg.status) after feeding wgcore; sends STATE
 * when it changed. */
void wgt_adapter_state(wgt *t, uint8_t status);
/* Send one line of module log to the phone (LOG), cut to fit. Dropped while
 * the link isn't ready. Never logs itself. */
void wgt_send_log(wgt *t, const char *line);

/* INFO characteristic: version, sockets, window, mtu, then fw/serial/board.
 * Returns its length (at most size). */
size_t wgt_info(const wgt *t, uint8_t *buf, size_t size, uint16_t mtu);
/* WGT_PHONE_*: no phone / no service / ok (ok until the first STATUS). */
int  wgt_phone_state(const wgt *t);

#endif
