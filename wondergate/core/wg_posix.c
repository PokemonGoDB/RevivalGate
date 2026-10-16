/* wg_posix: see wg_posix.h. */
#include "wg_posix.h"

#include <arpa/inet.h>
#include <errno.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

/* How long a receive waits before answering "0 bytes, still open". A real
 * adapter answers at once; Wonder Classic polls an idle socket and treats
 * "closed" as a dead server. Long enough for our local server to reply. */
#define RECV_TIMEOUT_S 2

void wg_posix_log(wg_posix *p, const char *line)
{
  struct timeval tv;
  struct tm tm;
  char ts[32];

  gettimeofday(&tv, NULL);
  localtime_r(&tv.tv_sec, &tm);
  strftime(ts, sizeof ts, "%H:%M:%S", &tm);
  if (p->log_stderr)
    fprintf(stderr, "%s.%03d %s\n", ts, (int)(tv.tv_usec / 1000), line);
  if (p->logf) {
    fprintf(p->logf, "%s.%03d %s\n", ts, (int)(tv.tv_usec / 1000), line);
    fflush(p->logf);
  }
}

static void p_log(void *ctx, const char *line)
{
  wg_posix_log(ctx, line);
}

static void p_tx(void *ctx, const uint8_t *buf, size_t len)
{
  wg_posix *p = ctx;

  p->tx(p->tx_ctx, buf, len);
}

static int p_resolve(void *ctx, const char *name, uint8_t ip[4])
{
  struct addrinfo hints, *res;
  struct sockaddr_in *sin;

  (void)ctx;
  memset(&hints, 0, sizeof hints);
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;
  if (getaddrinfo(name, NULL, &hints, &res) != 0)
    return -1;
  sin = (struct sockaddr_in *)res->ai_addr;
  memcpy(ip, &sin->sin_addr.s_addr, 4);
  freeaddrinfo(res);
  return 0;
}

static int p_sock_open(void *ctx)
{
  struct timeval tv = { RECV_TIMEOUT_S, 0 };
  int one = 1, s;

  (void)ctx;
  s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (s < 0)
    return -1;
  setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  setsockopt(s, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
#ifdef SO_NOSIGPIPE
  setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
#endif
  return s;
}

static int p_sock_connect(void *ctx, int s, const uint8_t ip[4], uint16_t port)
{
  struct sockaddr_in a;

  (void)ctx;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons(port);
  memcpy(&a.sin_addr.s_addr, ip, 4);
  return connect(s, (struct sockaddr *)&a, sizeof a) == 0 ? 0 : -1;
}

static int p_sock_send(void *ctx, int s, const uint8_t *buf, size_t len)
{
  (void)ctx;
  return (int)send(s, buf, len, 0);
}

static int p_sock_recv(void *ctx, int s, uint8_t *buf, size_t len)
{
  ssize_t n;

  (void)ctx;
  do
    n = recv(s, buf, len, 0);
  while (n < 0 && errno == EINTR);
  if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK))
    return WG_RECV_NODATA;
  return (int)n;
}

static void p_sock_shutdown(void *ctx, int s, int how)
{
  (void)ctx;
  shutdown(s, how == 0 ? SHUT_RD : how == 1 ? SHUT_WR : SHUT_RDWR);
}

static void p_sock_close(void *ctx, int s)
{
  (void)ctx;
  close(s);
}

void wg_posix_ops(wg_ops *ops, wg_posix *p)
{
  ops->ctx = p;
  ops->tx = p_tx;
  ops->resolve = p_resolve;
  ops->sock_open = p_sock_open;
  ops->sock_connect = p_sock_connect;
  ops->sock_send = p_sock_send;
  ops->sock_recv = p_sock_recv;
  ops->sock_shutdown = p_sock_shutdown;
  ops->sock_close = p_sock_close;
  ops->log = p_log;
}

int wg_posix_load_config(wg_config *cfg, const char *path)
{
  char line[256];
  int n = 0;
  FILE *f = fopen(path, "r");

  if (!f) {
    fprintf(stderr, "wgcore: can't open config %s\n", path);
    return -1;
  }
  while (fgets(line, sizeof line, f)) {
    n++;
    if (wg_config_line(cfg, line) != 0)
      fprintf(stderr, "wgcore: %s:%d: bad line: %s", path, n, line);
  }
  fclose(f);
  return 0;
}
