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
} wg_posix;

/* Fill ops with POSIX implementations; ops->ctx = p. */
void wg_posix_ops(wg_ops *ops, wg_posix *p);
void wg_posix_log(wg_posix *p, const char *line);
/* Load "key value" lines on top of the current config. 0 = ok. */
int  wg_posix_load_config(wg_config *cfg, const char *path);

#endif
