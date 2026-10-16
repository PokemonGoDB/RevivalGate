/* wg_tunnel_stream: see wg_tunnel_stream.h. */
#include "wg_tunnel_stream.h"

#include <errno.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define RETRY_MS 1000

static void slog(wgt_stream *s, const char *fmt, ...)
{
  char line[400];
  va_list ap;

  if (!s->log)
    return;
  va_start(ap, fmt);
  vsnprintf(line, sizeof line, fmt, ap);
  va_end(ap);
  s->log(s->log_ctx, line);
}

static uint32_t s_now(void *ctx)
{
  struct timespec ts;

  (void)ctx;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint32_t)((uint64_t)ts.tv_sec * 1000 + (uint64_t)ts.tv_nsec / 1000000);
}

static int write_all(int fd, const uint8_t *p, size_t n)
{
  while (n) {
    ssize_t k = send(fd, p, n, 0);
    if (k < 0 && errno == EINTR)
      continue;
    if (k <= 0)
      return -1;
    p += k;
    n -= (size_t)k;
  }
  return 0;
}

static int write_frame(wgt_stream *s, const uint8_t *msg, size_t len)
{
  uint8_t f[2 + WGT_MAX_MSG];

  if (s->fd < 0 || s->broken || len > WGT_MAX_MSG)
    return -1;
  f[0] = (uint8_t)(len >> 8);
  f[1] = (uint8_t)len;
  memcpy(f + 2, msg, len);
  if (write_all(s->fd, f, 2 + len) != 0) {
    s->broken = 1;
    return -1;
  }
  return 0;
}

static void drop(wgt_stream *s, const char *why)
{
  if (s->fd < 0)
    return;
  slog(s, "# tunnel stream: %s", why);
  close(s->fd);
  s->fd = -1;
  s->broken = 0;
  s->rlen = 0;
  s->next_try = s_now(NULL) + RETRY_MS;
  wgt_link_down(s->t);
}

int wgt_stream_connect(wgt_stream *s)
{
  struct addrinfo hints, *res, *ai;
  uint8_t info[256];
  size_t n;
  int fd = -1, one = 1;

  if (s->fd >= 0)
    return 0;
  s->next_try = s_now(NULL) + RETRY_MS;
  memset(&hints, 0, sizeof hints);
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  if (getaddrinfo(s->host, s->port, &hints, &res) != 0) {
    if (!s->quiet)
      slog(s, "# tunnel stream: can't resolve %s", s->host);
    s->quiet = 1;
    return -1;
  }
  for (ai = res; ai; ai = ai->ai_next) {
    fd = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
    if (fd < 0)
      continue;
    if (connect(fd, ai->ai_addr, ai->ai_addrlen) == 0)
      break;
    close(fd);
    fd = -1;
  }
  freeaddrinfo(res);
  if (fd < 0) {
    if (!s->quiet)
      slog(s, "# tunnel stream: no phone at %s:%s yet (retrying every %d ms)", s->host, s->port, RETRY_MS);
    s->quiet = 1;
    return -1;
  }
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
#ifdef SO_NOSIGPIPE
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
#endif
  s->fd = fd;
  s->broken = 0;
  s->rlen = 0;
  s->quiet = 0;
  /* First frame: INFO, as the phone would read the characteristic. */
  n = wgt_info(s->t, info, sizeof info, s->mtu);
  if (write_frame(s, info, n) != 0) {
    close(fd);
    s->fd = -1;
    return -1;
  }
  slog(s, "# tunnel stream: connected to %s:%s", s->host, s->port);
  wgt_link_up(s->t, s->mtu);
  return 0;
}

static void s_log(void *ctx, const char *line)
{
  wgt_stream *s = ctx;

  s->log(s->log_ctx, line);
}

static int s_send(void *ctx, const uint8_t *msg, size_t len)
{
  return write_frame(ctx, msg, len);
}

/* Hand every whole frame in rbuf to the tunnel. Returns how many. */
static int deliver_frames(wgt_stream *s)
{
  size_t at = 0;
  int n = 0;

  while (s->rlen - at >= 2) {
    size_t len = (size_t)s->rbuf[at] << 8 | s->rbuf[at + 1];
    if (len > WGT_MAX_MSG) {
      drop(s, "oversized frame from the phone, dropping the link");
      return n;
    }
    if (s->rlen - at < 2 + len)
      break;
    wgt_deliver(s->t, s->rbuf + at + 2, len);
    at += 2 + len;
    n++;
    if (s->fd < 0)
      return n;
  }
  memmove(s->rbuf, s->rbuf + at, s->rlen - at);
  s->rlen -= at;
  return n;
}

static void s_pump(void *ctx, int timeout_ms)
{
  wgt_stream *s = ctx;
  uint32_t deadline = s_now(NULL) + (uint32_t)(timeout_ms > 0 ? timeout_ms : 0);

  for (;;) {
    struct pollfd p;
    int32_t wait = (int32_t)(deadline - s_now(NULL));
    ssize_t k;
    int r;

    if (wait < 0)
      wait = 0;
    if (s->broken)
      drop(s, "write to the phone failed");
    if (s->fd < 0) {
      if ((int32_t)(s_now(NULL) - s->next_try) >= 0 && wgt_stream_connect(s) == 0)
        return;
      if (wait > 0) {
        int32_t until = (int32_t)(s->next_try - s_now(NULL));
        poll(NULL, 0, until > 0 && until < wait ? until : wait);
        continue;
      }
      return;
    }
    p.fd = s->fd;
    p.events = POLLIN;
    p.revents = 0;
    r = poll(&p, 1, (int)wait);
    if (r < 0 && errno == EINTR)
      continue;
    if (r <= 0)
      return;
    k = recv(s->fd, s->rbuf + s->rlen, sizeof s->rbuf - s->rlen, 0);
    if (k < 0 && errno == EINTR)
      continue;
    if (k <= 0) {
      drop(s, "phone closed the link");
      return;
    }
    s->rlen += (size_t)k;
    if (deliver_frames(s) > 0 || s->fd < 0)
      return;
    if (wait == 0)
      return;
  }
}

int wgt_stream_setup(wgt_stream *s, wgt *t, const char *hostport, uint16_t mtu, wgt_ops *ops,
                     void (*log)(void *ctx, const char *line), void *log_ctx)
{
  const char *colon = strrchr(hostport, ':');
  size_t hl;

  memset(s, 0, sizeof *s);
  s->fd = -1;
  s->t = t;
  s->mtu = mtu < WGT_MIN_MTU ? WGT_MIN_MTU : mtu > WGT_MAX_MTU ? WGT_MAX_MTU : mtu;
  s->log = log;
  s->log_ctx = log_ctx;
  if (!colon || colon == hostport || !colon[1])
    return -1;
  hl = (size_t)(colon - hostport);
  if (hl >= sizeof s->host || strlen(colon + 1) >= sizeof s->port)
    return -1;
  memcpy(s->host, hostport, hl);
  s->host[hl] = '\0';
  strcpy(s->port, colon + 1);
  ops->ctx = s;
  ops->send = s_send;
  ops->pump = s_pump;
  ops->now_ms = s_now;
  ops->log = log ? s_log : NULL;
  return 0;
}

int wgt_stream_fd(const wgt_stream *s)
{
  return s->fd;
}
