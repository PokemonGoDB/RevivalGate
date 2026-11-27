/*
 * wg_posix: BSD-socket networking, logging and config loading for wgcore,
 * shared by the PC host program and the emulator core's serial bridge.
 * The caller supplies only the serial output (tx).
 */
#ifndef WG_POSIX_H
#define WG_POSIX_H

#include <stdio.h>
#include "wg.h"

typedef struct wg_posix {
  FILE *logf;          /* may be NULL */
  int   log_stderr;    /* also echo log lines to stderr */
  void *tx_ctx;        /* passed to tx */
  void (*tx)(void *tx_ctx, const uint8_t *buf, size_t len);
  /* The descriptor the console's bytes arrive on, when the console runs in real
   * time while a receive waits out the game's own wait (wg.h, sock_recv_wait):
   * a byte from it ends that wait with no answer. NULL = the console can't send
   * meanwhile (the emulator core: its clock stands still inside the call). */
  const int *console_fd;
} wg_posix;

/* Fill ops with POSIX implementations; ops->ctx = p. */
void wg_posix_ops(wg_ops *ops, wg_posix *p);
void wg_posix_log(wg_posix *p, const char *line);
/* Load "key value" lines on top of the current config. 0 = ok. */
int  wg_posix_load_config(wg_config *cfg, const char *path);

#endif
