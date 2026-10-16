/*
 * wg_tunnel_stream: the tunnel's link over a TCP stream, a stand-in for
 * Bluetooth in tests (POSIX). Used by wgcore-host --tunnel and the emulator
 * core (WG_ADAPTER_TUNNEL).
 *
 * The module connects as a client to HOST:PORT (the "phone"). Every message
 * either way is one frame: its length as u16 big-endian, then its bytes. The
 * module's first frame on each connection is INFO's bytes (as the INFO
 * characteristic would read); after that both sides send protocol messages,
 * the phone starting with STATUS. A closed connection is a lost link; the
 * module then reconnects about once a second (it "advertises again").
 */
#ifndef WG_TUNNEL_STREAM_H
#define WG_TUNNEL_STREAM_H

#include "wg_tunnel.h"

typedef struct wgt_stream {
  wgt     *t;
  char     host[256], port[16];
  uint16_t mtu;                  /* reported in INFO and used for the link */
  int      fd;                   /* -1 = not connected */
  int      broken;               /* a write failed; reported as link down by the next pump */
  int      quiet;                /* connect failure already logged */
  uint32_t next_try;
  uint8_t  rbuf[4096];
  size_t   rlen;
  void   (*log)(void *ctx, const char *line);
  void    *log_ctx;
} wgt_stream;

/* Parse HOST:PORT and fill ops (ctx = s) for wgt_init. log may be NULL.
 * 0 = ok. Call wgt_stream_connect() once wgt_init() has run. */
int  wgt_stream_setup(wgt_stream *s, wgt *t, const char *hostport, uint16_t mtu, wgt_ops *ops,
                      void (*log)(void *ctx, const char *line), void *log_ctx);
/* Try to connect now (pump retries on its own while the link is down). 0 = up. */
int  wgt_stream_connect(wgt_stream *s);
/* The socket to poll for incoming messages, -1 while down. */
int  wgt_stream_fd(const wgt_stream *s);

#endif
