/*
 * wgcore host program: plays the MobileWonderGate adapter on a PC.
 *
 *   Mednafen:  stdin/stdout are the console's serial line
 *              (wswan.excomm.path; Mednafen passes a dummy argument).
 *   Hardware:  --serial /dev/cu.usbmodemXXXX through an ExtFriend-compatible
 *              dongle (v0 cable or v1), which already inverts the EXT UART.
 *
 *   Tunnel:    --tunnel HOST:PORT carries the sockets over the Bluetooth tunnel
 *              protocol on a TCP stream to a phone stand-in instead of opening
 *              them here (core/wg_tunnel_stream.h); --mtu N sets the link's MTU
 *              (default 247; 23 = the BLE minimum).
 *
 * Usage: wgcore-host [--config FILE] [--log FILE] [--serial DEV [--baud 9600|38400]]
 *                    [--tunnel HOST:PORT [--mtu N]]
 */
#include "wg.h"
#include "wg_posix.h"
#include "wg_tunnel.h"
#include "wg_tunnel_stream.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>

#define FRAME_GAP_MS 500

static void tx_fd(void *ctx, const uint8_t *buf, size_t len)
{
  int fd = *(int *)ctx;

  while (len) {
    ssize_t n = write(fd, buf, len);
    if (n < 0 && errno == EINTR)
      continue;
    if (n <= 0)
      return;
    buf += n;
    len -= (size_t)n;
  }
}

static void log_px(void *ctx, const char *line)
{
  wg_posix_log(ctx, line);
}

static int open_serial(const char *dev, int baud)
{
  struct termios t;
  int fd = open(dev, O_RDWR | O_NOCTTY);

  if (fd < 0) {
    perror(dev);
    return -1;
  }
  if (tcgetattr(fd, &t) != 0) {
    perror("tcgetattr");
    close(fd);
    return -1;
  }
  cfmakeraw(&t);
  t.c_cflag |= CLOCAL | CREAD;
  t.c_cflag &= ~(CRTSCTS | CSTOPB | PARENB);
  t.c_cc[VMIN] = 1;
  t.c_cc[VTIME] = 0;
  cfsetispeed(&t, baud == 38400 ? B38400 : B9600);
  cfsetospeed(&t, baud == 38400 ? B38400 : B9600);
  if (tcsetattr(fd, TCSANOW, &t) != 0) {
    perror("tcsetattr");
    close(fd);
    return -1;
  }
  tcflush(fd, TCIOFLUSH);
  return fd;
}

int main(int argc, char **argv)
{
  static wg_config cfg;
  static wg g;
  static wgt tun;
  static wgt_stream st;
  wgt_ops tops;
  wg_posix px = { NULL, 1, NULL, tx_fd };
  wg_ops ops;
  int in_fd = STDIN_FILENO, out_fd = STDOUT_FILENO;
  const char *config = NULL, *serial = NULL, *logpath = NULL, *tunnel = NULL;
  int baud = 9600, mtu = 247, i;
  char line[256];

  for (i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--config") && i + 1 < argc)      config = argv[++i];
    else if (!strcmp(argv[i], "--serial") && i + 1 < argc) serial = argv[++i];
    else if (!strcmp(argv[i], "--baud") && i + 1 < argc)   baud = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--log") && i + 1 < argc)    logpath = argv[++i];
    else if (!strcmp(argv[i], "--tunnel") && i + 1 < argc) tunnel = argv[++i];
    else if (!strcmp(argv[i], "--mtu") && i + 1 < argc)    mtu = atoi(argv[++i]);
    /* Anything else is ignored: Mednafen passes a dummy argument. */
  }

  signal(SIGPIPE, SIG_IGN);
  wg_config_defaults(&cfg);
  if (config && wg_posix_load_config(&cfg, config) != 0)
    return 1;
  if (logpath && !(px.logf = fopen(logpath, "a")))
    perror(logpath);
  if (serial) {
    if ((in_fd = open_serial(serial, baud)) < 0)
      return 1;
    out_fd = in_fd;
  }
  px.tx_ctx = &out_fd;
  wg_posix_ops(&ops, &px);
  if (tunnel) {
    if (wgt_stream_setup(&st, &tun, tunnel, (uint16_t)mtu, &tops,
                         log_px, &px) != 0) {
      fprintf(stderr, "wgcore-host: --tunnel wants HOST:PORT, got %s\n", tunnel);
      return 1;
    }
    wgt_init(&tun, &tops, &cfg);
    tun.fw = "wgcore-host";
    tun.board = "pc";
    wgt_wg_ops(&tun, &ops);
    wgt_stream_connect(&st);
  }

  wg_init(&g, &ops, &cfg);
  snprintf(line, sizeof line, "wgcore-host up: %s, server %s, %d redirects, reception %u%s%s",
           serial ? serial : "stdio", cfg.server, cfg.n_redirect, cfg.reception,
           tunnel ? ", sockets through the tunnel at " : "", tunnel ? tunnel : "");
  wg_posix_log(&px, line);

  for (;;) {
    struct pollfd p[2] = { { in_fd, POLLIN, 0 }, { -1, POLLIN, 0 } };
    uint8_t buf[256];
    ssize_t n;
    int r;

    if (tunnel)
      p[1].fd = wgt_stream_fd(&st);
    r = poll(p, 2, FRAME_GAP_MS);
    if (r < 0 && errno == EINTR)
      continue;
    if (tunnel)
      wgt_poll(&tun);                  /* the phone's messages, and reconnects */
    if (r == 0) {
      if (g.rx_state != 0)
        wg_rx_reset(&g);
      continue;
    }
    if (!(p[0].revents & (POLLIN | POLLHUP | POLLERR)))
      continue;
    n = read(in_fd, buf, sizeof buf);
    if (n < 0 && errno == EINTR)
      continue;
    if (n <= 0)
      break;
    for (i = 0; i < n; i++)
      wg_rx(&g, buf[i]);
    if (tunnel)
      wgt_adapter_state(&tun, g.status);
  }

  wg_posix_log(&px, "serial line closed, exiting");
  wg_reset(&g);
  return 0;
}
