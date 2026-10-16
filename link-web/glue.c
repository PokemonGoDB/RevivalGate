/*
 * wgcore in the browser: the page supplies serial out, name lookup, and sockets (WebSocket tunnels to the
 * RevivalGate server) as imports. sock_recv may wait for the server's reply: the build runs Binaryen's
 * asyncify over it, so that import can return a Promise and the page awaits it.
 */
#include "vendor/wg.h"

#define IMPORT(name) __attribute__((import_module("env"), import_name(#name)))
#define EXPORT(name) __attribute__((export_name(#name)))

IMPORT(js_tx) void js_tx(const uint8_t *buf, size_t len);
IMPORT(js_resolve) int js_resolve(const char *name, uint8_t *ip);
IMPORT(js_sock_open) int js_sock_open(void);
IMPORT(js_sock_connect) int js_sock_connect(int h, const uint8_t *ip, int port);
IMPORT(js_sock_send) int js_sock_send(int h, const uint8_t *buf, size_t len);
IMPORT(js_sock_recv) int js_sock_recv(int h, uint8_t *buf, size_t len);
IMPORT(js_sock_shutdown) void js_sock_shutdown(int h, int how);
IMPORT(js_sock_close) void js_sock_close(int h);
IMPORT(js_log) void js_log(const char *line);

static void o_tx(void *c, const uint8_t *buf, size_t len) { (void)c; js_tx(buf, len); }
static int o_resolve(void *c, const char *name, uint8_t ip[4]) { (void)c; return js_resolve(name, ip); }
static int o_open(void *c) { (void)c; return js_sock_open(); }
static int o_connect(void *c, int h, const uint8_t ip[4], uint16_t port) { (void)c; return js_sock_connect(h, ip, port); }
static int o_send(void *c, int h, const uint8_t *buf, size_t len) { (void)c; return js_sock_send(h, buf, len); }
static int o_recv(void *c, int h, uint8_t *buf, size_t len) { (void)c; return js_sock_recv(h, buf, len); }
static void o_shutdown(void *c, int h, int how) { (void)c; js_sock_shutdown(h, how); }
static void o_close(void *c, int h) { (void)c; js_sock_close(h); }
static void o_log(void *c, const char *line) { (void)c; js_log(line); }

static const wg_ops ops = { 0, o_tx, o_resolve, o_open, o_connect, o_send, o_recv, o_shutdown, o_close, o_log };
static wg_config cfg;
static wg g;

/* Where asyncify keeps the unwound stack while sock_recv waits: { start, end } then the space itself. */
static struct { uint8_t *start, *end; } async_data;
static uint8_t async_stack[16384];

EXPORT(lw_init) void *lw_init(void)
{
  wg_config_defaults(&cfg);
  wg_init(&g, &ops, &cfg);
  async_data.start = async_stack;
  async_data.end = async_stack + sizeof async_stack;
  return &async_data;
}

EXPORT(lw_rx) void lw_rx(int byte) { wg_rx(&g, (uint8_t)byte); }
EXPORT(lw_rx_reset) void lw_rx_reset(void) { wg_rx_reset(&g); }
EXPORT(lw_reset) void lw_reset(void) { wg_reset(&g); }
EXPORT(lw_mid_frame) int lw_mid_frame(void) { return g.rx_state != 0; }
